import type { HistoryNode, HistoryTree, NodeId } from './history-tree';

export interface CheckpointAnchor<S> {
  readonly nodeId: NodeId;
  readonly state: S;
  readonly distance: number;
}

export function isCheckpointDepth(depth: number, interval: number): boolean {
  return depth > 0 && depth % interval === 0;
}

export function nearestCheckpoint<S>(tree: HistoryTree<S>, target: NodeId): CheckpointAnchor<S> {
  let node: HistoryNode<S> = tree.require(target);
  let distance = 0;
  while (node.checkpoint === undefined) {
    node = tree.require(tree.parentOf(node));
    distance += 1;
  }
  return { nodeId: node.id, state: node.checkpoint, distance };
}

export function pathFromAnchor<S>(
  tree: HistoryTree<S>,
  anchor: CheckpointAnchor<S>,
  target: NodeId,
): readonly NodeId[] {
  const steps: NodeId[] = [];
  let node = tree.require(target);
  while (node.id !== anchor.nodeId) {
    steps.push(node.id);
    node = tree.require(tree.parentOf(node));
  }
  return steps.reverse();
}
