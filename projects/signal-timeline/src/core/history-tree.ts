import { applyPatch } from './apply';
import type { Operation, Patch } from './patch';

export type NodeId = number;

export interface PendingChange<S> {
  readonly before: S;
  readonly after: S;
}

export interface HistoryNode<S> {
  readonly id: NodeId;
  parentId: NodeId | undefined;
  depth: number;
  readonly children: NodeId[];
  lastVisitedChild: NodeId | undefined;
  label: string;
  timestamp: number;
  forward: Patch | undefined;
  inverse: Patch | undefined;
  pending: PendingChange<S> | undefined;
  checkpoint: S | undefined;
  key: string | undefined;
  changedKeys: readonly string[];
  open: boolean;
  merged: boolean;
}

export type NodeView<S> = Readonly<Omit<HistoryNode<S>, 'children'>> & {
  readonly children: readonly NodeId[];
};

export interface NodeInit<S> {
  readonly label: string;
  readonly timestamp: number;
  readonly key?: string;
  readonly changedKeys?: readonly string[];
  readonly forward?: Patch;
  readonly inverse?: Patch;
  readonly pending?: PendingChange<S>;
  readonly checkpoint?: S;
}

export interface TreePath {
  readonly up: readonly NodeId[];
  readonly down: readonly NodeId[];
  readonly ancestor: NodeId;
}

export interface RootInit<S> {
  readonly id?: NodeId;
  readonly label: string;
  readonly timestamp: number;
  readonly checkpoint: S;
}

const rootLagLimit = 256;

class LaggingState<S> {
  private operations: Operation[] = [];

  constructor(private base: S) {}

  get laggingOperations(): number {
    return this.operations.length;
  }

  advance(patch: Patch): void {
    for (const operation of patch) {
      this.operations.push(operation);
    }
  }

  reset(state: S): void {
    this.base = state;
    this.operations = [];
  }

  resolve(): S {
    if (this.operations.length > 0) {
      this.base = applyPatch(this.base, this.operations);
      this.operations = [];
    }
    return this.base;
  }
}

export class HistoryTree<S> {
  private readonly nodes = new Map<NodeId, HistoryNode<S>>();
  private readonly leaves = new Set<NodeId>();
  private rootNodeId: NodeId;
  private rootDepth = 0;
  private laggingRoot: LaggingState<S> | undefined;
  private nextNodeId: NodeId;

  constructor(root: RootInit<S>, nextId = 1) {
    const rootId = root.id ?? nextId;
    this.rootNodeId = rootId;
    this.nextNodeId = Math.max(nextId, rootId + 1);
    this.nodes.set(rootId, {
      id: rootId,
      parentId: undefined,
      depth: 0,
      children: [],
      lastVisitedChild: undefined,
      label: root.label,
      timestamp: root.timestamp,
      forward: undefined,
      inverse: undefined,
      pending: undefined,
      checkpoint: root.checkpoint,
      key: undefined,
      changedKeys: [],
      open: false,
      merged: false,
    });
    this.leaves.add(rootId);
  }

  get rootId(): NodeId {
    return this.rootNodeId;
  }

  get rootDepthOffset(): number {
    return this.rootDepth;
  }

  get nextId(): NodeId {
    return this.nextNodeId;
  }

  get size(): number {
    return this.nodes.size - 1;
  }

  get(id: NodeId): HistoryNode<S> | undefined {
    return this.nodes.get(id);
  }

  require(id: NodeId): HistoryNode<S> {
    const node = this.nodes.get(id);
    if (node === undefined) {
      throw new RangeError(`Unknown history node ${id}`);
    }
    return node;
  }

  all(): IterableIterator<HistoryNode<S>> {
    return this.nodes.values();
  }

  createNode(parentId: NodeId, init: NodeInit<S>): HistoryNode<S> {
    return this.insertNode(parentId, this.nextNodeId, init);
  }

  insertNode(parentId: NodeId, id: NodeId, init: NodeInit<S>): HistoryNode<S> {
    if (this.nodes.has(id)) {
      throw new RangeError(`History node ${id} already exists`);
    }
    const parent = this.require(parentId);
    const node: HistoryNode<S> = {
      id,
      parentId,
      depth: parent.depth + 1,
      children: [],
      lastVisitedChild: undefined,
      label: init.label,
      timestamp: init.timestamp,
      forward: init.forward,
      inverse: init.inverse,
      pending: init.pending,
      checkpoint: init.checkpoint,
      key: init.key,
      changedKeys: init.changedKeys ?? [],
      open: false,
      merged: false,
    };
    this.nodes.set(id, node);
    parent.children.push(id);
    this.leaves.delete(parentId);
    this.leaves.add(id);
    this.nextNodeId = Math.max(this.nextNodeId, id + 1);
    return node;
  }

  removeLeaf(id: NodeId): void {
    const node = this.require(id);
    if (node.children.length > 0 || node.parentId === undefined) {
      throw new RangeError(`History node ${id} is not a removable leaf`);
    }
    const parent = this.require(node.parentId);
    parent.children.splice(parent.children.indexOf(id), 1);
    if (parent.lastVisitedChild === id) {
      parent.lastVisitedChild = parent.children.at(-1);
    }
    if (parent.children.length === 0) {
      this.leaves.add(parent.id);
    }
    this.leaves.delete(id);
    this.nodes.delete(id);
  }

  oldestLeafOtherThan(excluded: NodeId): NodeId | undefined {
    let oldest: NodeId | undefined;
    for (const id of this.leaves) {
      if (id !== excluded && id !== this.rootNodeId && (oldest === undefined || id < oldest)) {
        oldest = id;
      }
    }
    return oldest;
  }

  promoteOnlyChild(label: string): void {
    const oldRoot = this.require(this.rootNodeId);
    if (oldRoot.children.length !== 1) {
      throw new RangeError('The root can only be advanced when it has exactly one child');
    }
    const child = this.require(oldRoot.children[0]);
    const lagging = this.laggingRoot;
    const childState = this.stateOfChild(child);
    const lagBase = lagging === undefined ? oldRoot.checkpoint : undefined;
    child.parentId = undefined;
    child.forward = undefined;
    child.inverse = undefined;
    child.pending = undefined;
    child.label = label;
    child.key = undefined;
    child.changedKeys = [];
    child.open = false;
    child.merged = false;
    this.nodes.delete(oldRoot.id);
    this.leaves.delete(oldRoot.id);
    this.rootNodeId = child.id;
    this.rootDepth = child.depth;
    this.laggingRoot = undefined;
    this.installRootState(child, childState, lagging ?? this.startLagging(lagBase));
  }

  private startLagging(base: S | undefined): LaggingState<S> {
    if (base === undefined) {
      throw new RangeError('The root has no state to advance from');
    }
    return new LaggingState<S>(base);
  }

  private stateOfChild(child: HistoryNode<S>): { readonly state: S } | { readonly patch: Patch } {
    if (child.checkpoint !== undefined) {
      return { state: child.checkpoint };
    }
    if (child.pending !== undefined) {
      return { state: child.pending.after };
    }
    if (child.forward === undefined) {
      throw new RangeError('The new root has no way to a state');
    }
    return { patch: child.forward };
  }

  private installRootState(
    root: HistoryNode<S>,
    source: { readonly state: S } | { readonly patch: Patch },
    lagging: LaggingState<S>,
  ): void {
    if ('state' in source) {
      Object.defineProperty(root, 'checkpoint', {
        value: source.state,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      return;
    }
    const state = lagging;
    state.advance(source.patch);
    if (state.laggingOperations > rootLagLimit) {
      Object.defineProperty(root, 'checkpoint', {
        value: state.resolve(),
        writable: true,
        enumerable: true,
        configurable: true,
      });
      return;
    }
    this.laggingRoot = state;
    Object.defineProperty(root, 'checkpoint', {
      get: () => state.resolve(),
      set: (value: S | undefined) => {
        if (value !== undefined) {
          state.reset(value);
        }
      },
      enumerable: true,
      configurable: true,
    });
  }

  pathBetween(from: NodeId, to: NodeId): TreePath {
    const up: NodeId[] = [];
    const downReversed: NodeId[] = [];
    let left = this.require(from);
    let right = this.require(to);
    while (left.depth > right.depth) {
      up.push(left.id);
      left = this.require(this.parentOf(left));
    }
    while (right.depth > left.depth) {
      downReversed.push(right.id);
      right = this.require(this.parentOf(right));
    }
    while (left.id !== right.id) {
      up.push(left.id);
      downReversed.push(right.id);
      left = this.require(this.parentOf(left));
      right = this.require(this.parentOf(right));
    }
    return { up, down: downReversed.reverse(), ancestor: left.id };
  }

  parentOf(node: HistoryNode<S>): NodeId {
    if (node.parentId === undefined) {
      throw new RangeError(`History node ${node.id} has no parent`);
    }
    return node.parentId;
  }
}
