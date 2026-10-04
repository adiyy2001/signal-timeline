import { applyPatch } from './apply';
import { isCheckpointDepth, nearestCheckpoint, pathFromAnchor } from './checkpoints';
import { systemClock, type Clock } from './clock';
import { diffPair, type PatchPair } from './diff';
import { HistoryTree, type HistoryNode, type NodeId, type NodeView } from './history-tree';
import { parsePointer } from './json-pointer';
import { PatchError, type Operation, type Patch } from './patch';

export class TimelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimelineError';
  }
}

export class SnapshotError extends TimelineError {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export interface EngineOptions {
  readonly checkpointEvery?: number;
  readonly maxEntries?: number;
  readonly coalesceWindowMs?: number;
  readonly pendingLimit?: number;
  readonly clock?: Clock;
  readonly schedule?: (task: () => void) => void;
  readonly rootLabel?: string;
}

export interface RecordOptions {
  readonly label: string;
  readonly key?: string;
}

export interface RecordResult {
  readonly id: NodeId;
  readonly merged: boolean;
}

export interface Move<S> {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly before: S;
  readonly after: S;
}

export interface SnapshotNode {
  readonly id: NodeId;
  readonly parentId: NodeId;
  readonly label: string;
  readonly timestamp: number;
  readonly forward: Patch;
  readonly inverse: Patch;
  readonly changedKeys: readonly string[];
  readonly lastVisitedChild: NodeId | undefined;
}

export interface EngineSnapshot<S> {
  readonly root: {
    readonly id: NodeId;
    readonly label: string;
    readonly timestamp: number;
    readonly state: S;
    readonly lastVisitedChild: NodeId | undefined;
  };
  readonly nodes: readonly SnapshotNode[];
  readonly currentId: NodeId;
  readonly nextId: NodeId;
}

const defaultCheckpointEvery = 250;
const defaultPendingLimit = 64;
const defaultRootLabel = 'Initial state';

function requirePositiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TimelineError(`${name} must be a positive integer`);
  }
  return value;
}

interface SnapshotRoute<S> {
  readonly base: S;
  readonly entries: SnapshotNode[];
}

type HeldState<S> = { readonly state: S } | { readonly route: SnapshotRoute<S> };

function extendRoute<S>(parent: HeldState<S>, entry: SnapshotNode): SnapshotRoute<S> {
  if ('state' in parent) {
    return { base: parent.state, entries: [entry] };
  }
  parent.route.entries.push(entry);
  return parent.route;
}

function rootsChanged(before: object, after: object): boolean {
  const beforeKeys = Object.keys(before);
  if (beforeKeys.length !== Object.keys(after).length) {
    return true;
  }
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  return beforeKeys.some(
    (key) => !Object.hasOwn(afterRecord, key) || !Object.is(beforeRecord[key], afterRecord[key]),
  );
}

function changedRootKeys(before: object, after: object): string[] {
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  return [...keys].filter(
    (key) =>
      !Object.hasOwn(beforeRecord, key) ||
      !Object.hasOwn(afterRecord, key) ||
      !Object.is(beforeRecord[key], afterRecord[key]),
  );
}

function rootKeysOfPatch(patch: Patch): string[] {
  const keys = new Set<string>();
  for (const operation of patch) {
    const [first] = parsePointer(operation.path);
    if (first !== undefined) {
      keys.add(first);
    }
  }
  return [...keys];
}

export class TimelineEngine<S extends object> {
  private tree: HistoryTree<S>;
  private currentNodeId: NodeId;
  private currentState: S;
  private openNodeId: NodeId | undefined;
  private changeVersion = 0;
  private readonly listeners = new Set<() => void>();
  private readonly transactionStarts: S[] = [];
  private readonly gestureKeys: string[] = [];
  private readonly settledQueue: NodeId[] = [];
  private flushScheduled = false;
  private readonly checkpointEvery: number;
  private readonly maxEntries: number;
  private readonly windowMs: number | undefined;
  private readonly pendingLimit: number;
  private readonly clock: Clock;
  private readonly schedule: (task: () => void) => void;
  private readonly rootLabel: string;

  constructor(initialState: S, options: EngineOptions = {}) {
    this.checkpointEvery = requirePositiveInteger(
      'checkpointEvery',
      options.checkpointEvery ?? defaultCheckpointEvery,
    );
    this.maxEntries =
      options.maxEntries === undefined
        ? Number.POSITIVE_INFINITY
        : requirePositiveInteger('maxEntries', options.maxEntries);
    this.windowMs = options.coalesceWindowMs;
    if (this.windowMs !== undefined && (!Number.isFinite(this.windowMs) || this.windowMs < 0)) {
      throw new TimelineError('coalesceWindowMs must be a non-negative number');
    }
    this.pendingLimit = options.pendingLimit ?? defaultPendingLimit;
    if (!Number.isInteger(this.pendingLimit) || this.pendingLimit < 0) {
      throw new TimelineError('pendingLimit must be a non-negative integer');
    }
    this.clock = options.clock ?? systemClock;
    this.schedule = options.schedule ?? ((task) => queueMicrotask(task));
    this.rootLabel = options.rootLabel ?? defaultRootLabel;
    this.tree = new HistoryTree<S>({
      label: this.rootLabel,
      timestamp: this.clock.now(),
      checkpoint: initialState,
    });
    this.currentNodeId = this.tree.rootId;
    this.currentState = initialState;
  }

  static restore<S extends object>(
    snapshot: EngineSnapshot<S>,
    options: EngineOptions = {},
  ): TimelineEngine<S> {
    const engine = new TimelineEngine<S>(snapshot.root.state, options);
    engine.load(snapshot);
    return engine;
  }

  get state(): S {
    return this.currentState;
  }

  get currentId(): NodeId {
    return this.currentNodeId;
  }

  get rootId(): NodeId {
    return this.tree.rootId;
  }

  get nextId(): NodeId {
    return this.tree.nextId;
  }

  get rootDepth(): number {
    return this.tree.rootDepthOffset;
  }

  get size(): number {
    return this.tree.size;
  }

  get version(): number {
    return this.changeVersion;
  }

  get canUndo(): boolean {
    return this.tree.require(this.currentNodeId).parentId !== undefined;
  }

  get canRedo(): boolean {
    return this.tree.require(this.currentNodeId).children.length > 0;
  }

  get transactionDepth(): number {
    return this.transactionStarts.length;
  }

  get pendingCount(): number {
    let count = 0;
    for (const node of this.tree.all()) {
      if (node.pending !== undefined) {
        count += 1;
      }
    }
    return count;
  }

  redoBranches(): readonly NodeId[] {
    return this.tree.require(this.currentNodeId).children;
  }

  node(id: NodeId): NodeView<S> | undefined {
    return this.tree.get(id);
  }

  nodes(): readonly NodeView<S>[] {
    return [...this.tree.all()];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  record(after: S, options: RecordOptions): RecordResult | undefined {
    this.assertNoTransaction('record');
    if (!rootsChanged(this.currentState, after)) {
      return undefined;
    }
    const key = this.gestureKeys.at(-1) ?? options.key;
    const now = this.clock.now();
    const open = this.openNode();
    if (open !== undefined && this.canMerge(open, key, now)) {
      this.merge(open, after, now);
      return { id: open.id, merged: true };
    }
    this.seal();
    const node = this.attach({ label: options.label, key, after, timestamp: now });
    return { id: node.id, merged: false };
  }

  undo(): Move<S> | undefined {
    this.assertNoTransaction('undo');
    this.seal();
    const parentId = this.tree.require(this.currentNodeId).parentId;
    return parentId === undefined ? undefined : this.moveTo(parentId);
  }

  redo(childId?: NodeId): Move<S> | undefined {
    this.assertNoTransaction('redo');
    this.seal();
    const current = this.tree.require(this.currentNodeId);
    if (childId !== undefined && !current.children.includes(childId)) {
      throw new TimelineError(`Entry ${childId} is not a redo branch of entry ${current.id}`);
    }
    const target = childId ?? current.lastVisitedChild ?? current.children.at(-1);
    return target === undefined ? undefined : this.moveTo(target);
  }

  jumpTo(id: NodeId): Move<S> | undefined {
    this.assertNoTransaction('jumpTo');
    if (this.tree.get(id) === undefined) {
      throw new TimelineError(`Unknown entry ${id}`);
    }
    this.seal();
    return this.tree.get(id) === undefined ? undefined : this.moveTo(id);
  }

  begin(state: S): void {
    this.seal();
    this.transactionStarts.push(state);
  }

  commit(label: string, endState: S): NodeId | undefined {
    if (this.transactionStarts.length === 0) {
      throw new TimelineError('No transaction to commit');
    }
    this.transactionStarts.pop();
    if (this.transactionStarts.length > 0) {
      return undefined;
    }
    const before = this.currentState;
    if (!rootsChanged(before, endState)) {
      return undefined;
    }
    const pair = diffPair(before, endState);
    if (pair.forward.length === 0) {
      this.currentState = endState;
      return undefined;
    }
    return this.attach({
      label,
      key: undefined,
      after: endState,
      timestamp: this.clock.now(),
      pair,
    }).id;
  }

  rollback(): S {
    const start = this.transactionStarts.pop();
    if (start === undefined) {
      throw new TimelineError('No transaction to roll back');
    }
    return start;
  }

  beginCoalescing(key: string): void {
    this.seal();
    this.gestureKeys.push(key);
  }

  endCoalescing(): void {
    if (this.gestureKeys.pop() === undefined) {
      throw new TimelineError('No coalescing gesture to end');
    }
    this.seal();
  }

  seal(): void {
    const node = this.openNode();
    if (node === undefined) {
      return;
    }
    this.openNodeId = undefined;
    node.open = false;
    if (!node.merged) {
      this.settle(node.id);
      return;
    }
    const liveState = node.pending?.after;
    this.materializeNode(node);
    if (node.forward?.length === 0 && liveState !== undefined) {
      this.discardEmptyNode(node, liveState);
    }
  }

  patchOf(id: NodeId): PatchPair | undefined {
    const node = this.tree.get(id);
    if (node === undefined || node.parentId === undefined) {
      return undefined;
    }
    return this.patchesOf(node);
  }

  materialize(id: NodeId): void {
    const node = this.tree.get(id);
    if (node !== undefined && !node.open) {
      this.materializeNode(node);
    }
  }

  materializeAll(): void {
    for (const node of this.tree.all()) {
      if (!node.open) {
        this.materializeNode(node);
      }
    }
  }

  stateAt(id: NodeId): S {
    this.tree.require(id);
    const anchor = nearestCheckpoint(this.tree, id);
    return this.replay(anchor.state, pathFromAnchor(this.tree, anchor, id));
  }

  clear(): void {
    this.assertNoTransaction('clear');
    this.seal();
    this.tree = new HistoryTree<S>(
      { label: this.rootLabel, timestamp: this.clock.now(), checkpoint: this.currentState },
      this.tree.nextId,
    );
    this.currentNodeId = this.tree.rootId;
    this.settledQueue.length = 0;
    this.changed();
  }

  addRootKey(key: string, value: unknown): void {
    this.assertNoTransaction('addRootKey');
    if (Object.hasOwn(this.currentState, key)) {
      throw new TimelineError(`The state already has the key "${key}"`);
    }
    const extend = (state: S): S => ({ ...state, [key]: value });
    for (const node of this.tree.all()) {
      if (node.checkpoint !== undefined) {
        node.checkpoint = extend(node.checkpoint);
      }
      if (node.pending !== undefined) {
        node.pending = { before: extend(node.pending.before), after: extend(node.pending.after) };
      }
    }
    this.currentState = extend(this.currentState);
  }

  snapshot(): EngineSnapshot<S> {
    this.assertNoTransaction('snapshot');
    const root = this.tree.require(this.tree.rootId);
    const nodes: SnapshotNode[] = [];
    for (const node of this.tree.all()) {
      if (node.parentId !== undefined) {
        const pair = this.patchesOf(node);
        nodes.push({
          id: node.id,
          parentId: node.parentId,
          label: node.label,
          timestamp: node.timestamp,
          forward: pair.forward,
          inverse: pair.inverse,
          changedKeys: node.changedKeys,
          lastVisitedChild: node.lastVisitedChild,
        });
      }
    }
    nodes.sort((left, right) => left.id - right.id);
    return {
      root: {
        id: root.id,
        label: root.label,
        timestamp: root.timestamp,
        state: this.stateAt(root.id),
        lastVisitedChild: root.lastVisitedChild,
      },
      nodes,
      currentId: this.currentNodeId,
      nextId: this.tree.nextId,
    };
  }

  load(snapshot: EngineSnapshot<S>): void {
    this.assertNoTransaction('load');
    const { root } = snapshot;
    const tree = new HistoryTree<S>(
      { id: root.id, label: root.label, timestamp: root.timestamp, checkpoint: root.state },
      snapshot.nextId,
    );
    const ordered = [...snapshot.nodes].sort((left, right) => left.id - right.id);
    const childCounts = new Map<NodeId, number>();
    for (const entry of ordered) {
      childCounts.set(entry.parentId, (childCounts.get(entry.parentId) ?? 0) + 1);
    }
    const held = new Map<NodeId, HeldState<S>>([[root.id, { state: root.state }]]);
    const remainingChildren = new Map<NodeId, number>([[root.id, childCounts.get(root.id) ?? 0]]);
    const requested = new Map<NodeId, NodeId | undefined>([[root.id, root.lastVisitedChild]]);
    let currentState: S | undefined = snapshot.currentId === root.id ? root.state : undefined;
    for (const entry of ordered) {
      const parent = held.get(entry.parentId);
      if (parent === undefined || entry.parentId >= entry.id || entry.id >= snapshot.nextId) {
        throw new SnapshotError(`Entry ${entry.id} has no valid parent`);
      }
      const depth = tree.require(entry.parentId).depth + 1;
      const childCount = childCounts.get(entry.id) ?? 0;
      const checkpoint = isCheckpointDepth(depth, this.checkpointEvery);
      const route = extendRoute(parent, entry);
      const needsState = checkpoint || entry.id === snapshot.currentId || childCount !== 1;
      const state = needsState ? this.resolveRoute(route) : undefined;
      try {
        tree.insertNode(entry.parentId, entry.id, {
          label: entry.label,
          timestamp: entry.timestamp,
          forward: entry.forward,
          inverse: entry.inverse,
          changedKeys: entry.changedKeys,
          checkpoint: checkpoint ? state : undefined,
        });
      } catch (error) {
        throw new SnapshotError(error instanceof Error ? error.message : String(error));
      }
      if (entry.id === snapshot.currentId) {
        currentState = state;
      }
      this.holdForChildren(held, remainingChildren, entry.parentId);
      if (childCount > 0) {
        held.set(entry.id, state === undefined ? { route } : { state });
        remainingChildren.set(entry.id, childCount);
      }
      requested.set(entry.id, entry.lastVisitedChild);
    }
    for (const node of tree.all()) {
      const choice = requested.get(node.id);
      if (choice !== undefined && !node.children.includes(choice)) {
        throw new SnapshotError(`Entry ${choice} is not a child of entry ${node.id}`);
      }
      node.lastVisitedChild = choice ?? node.children.at(-1);
    }
    if (currentState === undefined) {
      throw new SnapshotError(`The current entry ${snapshot.currentId} does not exist`);
    }
    this.tree = tree;
    this.currentNodeId = snapshot.currentId;
    this.currentState = currentState;
    this.openNodeId = undefined;
    this.settledQueue.length = 0;
    this.transactionStarts.length = 0;
    this.gestureKeys.length = 0;
    this.prune();
    this.changed();
  }

  private holdForChildren(
    held: Map<NodeId, HeldState<S>>,
    remainingChildren: Map<NodeId, number>,
    parentId: NodeId,
  ): void {
    const remaining = (remainingChildren.get(parentId) ?? 1) - 1;
    if (remaining <= 0) {
      held.delete(parentId);
      remainingChildren.delete(parentId);
    } else {
      remainingChildren.set(parentId, remaining);
    }
  }

  private resolveRoute(route: SnapshotRoute<S>): S {
    try {
      return applyPatch(
        route.base,
        route.entries.flatMap((entry) => entry.forward),
      );
    } catch (error) {
      if (!(error instanceof PatchError)) {
        throw error;
      }
      let state = route.base;
      for (const entry of route.entries) {
        state = this.replaySnapshotEntry(state, entry);
      }
      throw new SnapshotError(`Entries do not apply: ${error.message}`);
    }
  }

  private replaySnapshotEntry(parentState: S, entry: SnapshotNode): S {
    try {
      return applyPatch(parentState, entry.forward);
    } catch (error) {
      if (error instanceof PatchError) {
        throw new SnapshotError(`Entry ${entry.id} does not apply: ${error.message}`);
      }
      throw error;
    }
  }

  private openNode(): HistoryNode<S> | undefined {
    return this.openNodeId === undefined ? undefined : this.tree.get(this.openNodeId);
  }

  private canMerge(open: HistoryNode<S>, key: string | undefined, now: number): boolean {
    if (key !== undefined) {
      return open.key === key;
    }
    return (
      open.key === undefined && this.windowMs !== undefined && now - open.timestamp <= this.windowMs
    );
  }

  private merge(open: HistoryNode<S>, after: S, now: number): void {
    if (open.pending === undefined) {
      throw new TimelineError('An open entry lost its pending change');
    }
    open.pending = { before: open.pending.before, after };
    open.changedKeys = changedRootKeys(open.pending.before, after);
    open.timestamp = now;
    open.merged = true;
    if (open.checkpoint !== undefined) {
      open.checkpoint = after;
    }
    this.currentState = after;
    this.changed();
  }

  private attach(change: {
    label: string;
    key: string | undefined;
    after: S;
    timestamp: number;
    pair?: PatchPair;
  }): HistoryNode<S> {
    const parent = this.tree.require(this.currentNodeId);
    const node = this.tree.createNode(parent.id, {
      label: change.label,
      timestamp: change.timestamp,
      key: change.key,
      changedKeys:
        change.pair === undefined
          ? changedRootKeys(this.currentState, change.after)
          : rootKeysOfPatch(change.pair.forward),
      forward: change.pair?.forward,
      inverse: change.pair?.inverse,
      pending:
        change.pair === undefined ? { before: this.currentState, after: change.after } : undefined,
      checkpoint: isCheckpointDepth(parent.depth + 1, this.checkpointEvery)
        ? change.after
        : undefined,
    });
    parent.lastVisitedChild = node.id;
    this.currentNodeId = node.id;
    this.currentState = change.after;
    const staysOpen =
      change.pair === undefined && (change.key !== undefined || this.windowMs !== undefined);
    if (staysOpen) {
      node.open = true;
      this.openNodeId = node.id;
    } else if (change.pair === undefined) {
      this.settle(node.id);
    }
    this.prune();
    this.changed();
    return node;
  }

  private settle(id: NodeId): void {
    this.settledQueue.push(id);
    if (this.settledQueue.length > this.pendingLimit) {
      this.flush();
    } else if (!this.flushScheduled) {
      this.flushScheduled = true;
      this.schedule(() => {
        this.flushScheduled = false;
        this.flush();
      });
    }
  }

  private flush(): void {
    const ids = this.settledQueue.splice(0);
    for (const id of ids) {
      const node = this.tree.get(id);
      if (node !== undefined && !node.open) {
        this.materializeNode(node);
      }
    }
  }

  private materializeNode(node: HistoryNode<S>): void {
    if (node.pending !== undefined) {
      const pair = diffPair(node.pending.before, node.pending.after);
      node.forward = pair.forward;
      node.inverse = pair.inverse;
      node.pending = undefined;
    }
  }

  private patchesOf(node: HistoryNode<S>): PatchPair {
    if (node.pending !== undefined) {
      if (node.open) {
        return diffPair(node.pending.before, node.pending.after);
      }
      this.materializeNode(node);
    }
    if (node.forward === undefined || node.inverse === undefined) {
      throw new TimelineError(`Entry ${node.id} has no patches`);
    }
    return { forward: node.forward, inverse: node.inverse };
  }

  private discardEmptyNode(node: HistoryNode<S>, liveState: S): void {
    const parentId = this.tree.parentOf(node);
    this.tree.removeLeaf(node.id);
    this.currentNodeId = parentId;
    this.currentState = liveState;
    this.changed();
  }

  private moveTo(targetId: NodeId): Move<S> | undefined {
    const fromId = this.currentNodeId;
    if (fromId === targetId) {
      return undefined;
    }
    const before = this.currentState;
    const route = this.tree.pathBetween(fromId, targetId);
    const after = this.resolve(before, route.up, route.down, targetId);
    this.rememberVisited(route.up, route.down);
    this.currentNodeId = targetId;
    this.currentState = after;
    this.changed();
    return { from: fromId, to: targetId, before, after };
  }

  private resolve(start: S, up: readonly NodeId[], down: readonly NodeId[], targetId: NodeId): S {
    const anchor = nearestCheckpoint(this.tree, targetId);
    if (anchor.distance < up.length + down.length) {
      return this.replay(anchor.state, pathFromAnchor(this.tree, anchor, targetId));
    }
    return this.replay(this.stepBackAll(start, up), down);
  }

  private replay(start: S, steps: readonly NodeId[]): S {
    return this.walk(start, steps, (node) => ({
      literal: node.pending?.after,
      patch: node.forward,
      missing: `Entry ${node.id} has no forward patch`,
    }));
  }

  private stepBackAll(start: S, steps: readonly NodeId[]): S {
    return this.walk(start, steps, (node) => ({
      literal: node.pending?.before,
      patch: node.inverse,
      missing: `Entry ${node.id} has no inverse patch`,
    }));
  }

  private walk(
    start: S,
    steps: readonly NodeId[],
    choose: (node: HistoryNode<S>) => {
      literal: S | undefined;
      patch: Patch | undefined;
      missing: string;
    },
  ): S {
    let state = start;
    let batch: Operation[] = [];
    for (const id of steps) {
      const { literal, patch, missing } = choose(this.tree.require(id));
      if (literal !== undefined) {
        state = literal;
        batch = [];
      } else if (patch === undefined) {
        throw new TimelineError(missing);
      } else {
        for (const operation of patch) {
          batch.push(operation);
        }
      }
    }
    return batch.length === 0 ? state : applyPatch(state, batch);
  }

  private rememberVisited(up: readonly NodeId[], down: readonly NodeId[]): void {
    for (const id of [...up, ...down]) {
      const node = this.tree.require(id);
      this.tree.require(this.tree.parentOf(node)).lastVisitedChild = id;
    }
  }

  private prune(): void {
    while (this.tree.size > this.maxEntries) {
      const leaf = this.tree.oldestLeafOtherThan(this.currentNodeId);
      if (leaf === undefined) {
        this.advanceRoot();
      } else {
        this.tree.removeLeaf(leaf);
      }
    }
  }

  private advanceRoot(): void {
    this.tree.promoteOnlyChild(this.rootLabel);
  }

  private assertNoTransaction(action: string): void {
    if (this.transactionStarts.length > 0) {
      throw new TimelineError(`Cannot ${action} inside a transaction`);
    }
  }

  private changed(): void {
    this.changeVersion += 1;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
