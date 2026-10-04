import { HistoryTree } from './history-tree';

function build(): HistoryTree<number> {
  const tree = new HistoryTree<number>({ label: 'root', timestamp: 0, checkpoint: 0 });
  return tree;
}

describe('HistoryTree', () => {
  it('starts with one root and no entries', () => {
    const tree = build();
    expect(tree.size).toBe(0);
    expect(tree.require(tree.rootId)).toMatchObject({
      depth: 0,
      parentId: undefined,
      label: 'root',
    });
    expect(tree.nextId).toBe(tree.rootId + 1);
  });

  it('honours an explicit root id and next id', () => {
    const tree = new HistoryTree<number>({ id: 7, label: 'r', timestamp: 0, checkpoint: 0 }, 3);
    expect(tree.rootId).toBe(7);
    expect(tree.nextId).toBe(8);
  });

  it('links children to their parent and tracks depth', () => {
    const tree = build();
    const first = tree.createNode(tree.rootId, { label: 'a', timestamp: 1 });
    const second = tree.createNode(first.id, { label: 'b', timestamp: 2 });
    expect(tree.size).toBe(2);
    expect(second.depth).toBe(2);
    expect(tree.require(tree.rootId).children).toEqual([first.id]);
    expect(tree.parentOf(second)).toBe(first.id);
  });

  it('never reuses an id after a removal', () => {
    const tree = build();
    const node = tree.createNode(tree.rootId, { label: 'a', timestamp: 1 });
    tree.removeLeaf(node.id);
    const next = tree.createNode(tree.rootId, { label: 'b', timestamp: 2 });
    expect(next.id).toBeGreaterThan(node.id);
  });

  it('rejects unknown nodes, duplicate ids and the root as a parent lookup', () => {
    const tree = build();
    expect(() => tree.require(99)).toThrow(RangeError);
    const node = tree.createNode(tree.rootId, { label: 'a', timestamp: 1 });
    expect(() => tree.insertNode(tree.rootId, node.id, { label: 'dup', timestamp: 1 })).toThrow(
      'already exists',
    );
    expect(() => tree.parentOf(tree.require(tree.rootId))).toThrow('has no parent');
  });

  it('removes only leaves and repairs the last visited child', () => {
    const tree = build();
    const first = tree.createNode(tree.rootId, { label: 'a', timestamp: 1 });
    const second = tree.createNode(tree.rootId, { label: 'b', timestamp: 2 });
    const root = tree.require(tree.rootId);
    root.lastVisitedChild = second.id;
    tree.createNode(first.id, { label: 'c', timestamp: 3 });
    expect(() => tree.removeLeaf(first.id)).toThrow('not a removable leaf');
    expect(() => tree.removeLeaf(tree.rootId)).toThrow('not a removable leaf');
    tree.removeLeaf(second.id);
    expect(root.children).toEqual([first.id]);
    expect(root.lastVisitedChild).toBe(first.id);
  });

  it('turns a parent back into a leaf when its last child goes', () => {
    const tree = build();
    const first = tree.createNode(tree.rootId, { label: 'a', timestamp: 1 });
    const second = tree.createNode(first.id, { label: 'b', timestamp: 2 });
    tree.removeLeaf(second.id);
    expect(tree.oldestLeafOtherThan(tree.rootId)).toBe(first.id);
  });

  it('finds the oldest leaf that is not excluded and never the root', () => {
    const tree = build();
    expect(tree.oldestLeafOtherThan(-1)).toBeUndefined();
    const first = tree.createNode(tree.rootId, { label: 'a', timestamp: 1 });
    const second = tree.createNode(tree.rootId, { label: 'b', timestamp: 2 });
    const third = tree.createNode(second.id, { label: 'c', timestamp: 3 });
    expect(tree.oldestLeafOtherThan(third.id)).toBe(first.id);
    expect(tree.oldestLeafOtherThan(first.id)).toBe(third.id);
    expect(tree.oldestLeafOtherThan(99)).toBe(first.id);
  });

  it('computes the path through the lowest common ancestor', () => {
    const tree = build();
    const a = tree.createNode(tree.rootId, { label: 'a', timestamp: 1 });
    const b = tree.createNode(a.id, { label: 'b', timestamp: 2 });
    const c = tree.createNode(b.id, { label: 'c', timestamp: 3 });
    const d = tree.createNode(a.id, { label: 'd', timestamp: 4 });
    const e = tree.createNode(d.id, { label: 'e', timestamp: 5 });
    expect(tree.pathBetween(c.id, e.id)).toEqual({
      up: [c.id, b.id],
      down: [d.id, e.id],
      ancestor: a.id,
    });
    expect(tree.pathBetween(c.id, a.id)).toEqual({ up: [c.id, b.id], down: [], ancestor: a.id });
    expect(tree.pathBetween(a.id, c.id)).toEqual({ up: [], down: [b.id, c.id], ancestor: a.id });
    expect(tree.pathBetween(c.id, c.id)).toEqual({ up: [], down: [], ancestor: c.id });
  });

  it('promotes the only child of the root', () => {
    const tree = build();
    const a = tree.createNode(tree.rootId, { label: 'a', timestamp: 1, forward: [], inverse: [] });
    const b = tree.createNode(a.id, { label: 'b', timestamp: 2 });
    const oldRoot = tree.rootId;
    tree.promoteOnlyChild(5, 'start');
    expect(tree.rootId).toBe(a.id);
    expect(tree.get(oldRoot)).toBeUndefined();
    expect(tree.require(a.id)).toMatchObject({
      parentId: undefined,
      checkpoint: 5,
      label: 'start',
      forward: undefined,
      inverse: undefined,
    });
    expect(tree.size).toBe(1);
    expect(tree.require(b.id).parentId).toBe(a.id);
  });

  it('refuses to promote when the root has several children or none', () => {
    const tree = build();
    expect(() => tree.promoteOnlyChild(0, 'x')).toThrow('exactly one child');
    tree.createNode(tree.rootId, { label: 'a', timestamp: 1 });
    tree.createNode(tree.rootId, { label: 'b', timestamp: 2 });
    expect(() => tree.promoteOnlyChild(0, 'x')).toThrow('exactly one child');
  });

  it('iterates over every node', () => {
    const tree = build();
    tree.createNode(tree.rootId, { label: 'a', timestamp: 1 });
    expect([...tree.all()].map((node) => node.label)).toEqual(['root', 'a']);
  });
});
