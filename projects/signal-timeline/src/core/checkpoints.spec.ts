import { isCheckpointDepth, nearestCheckpoint, pathFromAnchor } from './checkpoints';
import { HistoryTree } from './history-tree';

function chain(length: number, interval: number): HistoryTree<{ n: number }> {
  const tree = new HistoryTree({ label: 'root', timestamp: 0, checkpoint: { n: 0 } });
  let parent = tree.rootId;
  for (let depth = 1; depth <= length; depth += 1) {
    const node = tree.createNode(parent, {
      label: String(depth),
      timestamp: depth,
      checkpoint: isCheckpointDepth(depth, interval) ? { n: depth } : undefined,
    });
    parent = node.id;
  }
  return tree;
}

describe('checkpoints', () => {
  it('places checkpoints at multiples of the interval, never at depth zero', () => {
    expect(isCheckpointDepth(0, 3)).toBe(false);
    expect(isCheckpointDepth(3, 3)).toBe(true);
    expect(isCheckpointDepth(4, 3)).toBe(false);
    expect(isCheckpointDepth(6, 3)).toBe(true);
    expect([1, 2, 3].map((depth) => isCheckpointDepth(depth, 1))).toEqual([true, true, true]);
  });

  it('finds the nearest checkpoint on the way to the root', () => {
    const tree = chain(8, 3);
    const rootId = tree.rootId;
    expect(nearestCheckpoint(tree, rootId + 8)).toMatchObject({ nodeId: rootId + 6, distance: 2 });
    expect(nearestCheckpoint(tree, rootId + 6)).toMatchObject({ nodeId: rootId + 6, distance: 0 });
    expect(nearestCheckpoint(tree, rootId + 2)).toMatchObject({ nodeId: rootId, distance: 2 });
  });

  it('lists the nodes between an anchor and its target in forward order', () => {
    const tree = chain(8, 3);
    const rootId = tree.rootId;
    const anchor = nearestCheckpoint(tree, rootId + 8);
    expect(pathFromAnchor(tree, anchor, rootId + 8)).toEqual([rootId + 7, rootId + 8]);
    expect(pathFromAnchor(tree, nearestCheckpoint(tree, rootId + 6), rootId + 6)).toEqual([]);
  });
});
