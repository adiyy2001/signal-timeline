import type { Patch } from './patch';

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

export class HistoryTree<S> {
  private readonly nodes = new Map<NodeId, HistoryNode<S>>();
  private readonly leaves = new Set<NodeId>();
  private rootNodeId: NodeId;
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
      open: false,
      merged: false,
    });
    this.leaves.add(rootId);
  }

  get rootId(): NodeId {
    return this.rootNodeId;
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

  promoteOnlyChild(checkpoint: S, label: string): void {
    const oldRoot = this.require(this.rootNodeId);
    if (oldRoot.children.length !== 1) {
      throw new RangeError('The root can only be advanced when it has exactly one child');
    }
    const child = this.require(oldRoot.children[0]);
    child.parentId = undefined;
    child.forward = undefined;
    child.inverse = undefined;
    child.pending = undefined;
    child.checkpoint = checkpoint;
    child.label = label;
    child.key = undefined;
    child.open = false;
    child.merged = false;
    this.nodes.delete(oldRoot.id);
    this.leaves.delete(oldRoot.id);
    this.rootNodeId = child.id;
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
