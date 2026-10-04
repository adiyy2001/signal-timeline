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

  it('promotes the only child of the root and takes its state from the forward patch', () => {
    const tree = build();
    const a = tree.createNode(tree.rootId, {
      label: 'a',
      timestamp: 1,
      forward: [{ op: 'replace', path: '', value: 5 }],
      inverse: [{ op: 'replace', path: '', value: 0 }],
    });
    const b = tree.createNode(a.id, { label: 'b', timestamp: 2 });
    const oldRoot = tree.rootId;
    tree.promoteOnlyChild('start');
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

  it('takes the state of a promoted child from its own checkpoint or its pending change', () => {
    const withCheckpoint = build();
    const first = withCheckpoint.createNode(withCheckpoint.rootId, {
      label: 'a',
      timestamp: 1,
      checkpoint: 11,
    });
    withCheckpoint.promoteOnlyChild('start');
    expect(withCheckpoint.require(first.id).checkpoint).toBe(11);

    const withPending = build();
    const second = withPending.createNode(withPending.rootId, {
      label: 'a',
      timestamp: 1,
      pending: { before: 0, after: 12 },
    });
    withPending.promoteOnlyChild('start');
    expect(withPending.require(second.id).checkpoint).toBe(12);
  });

  it('keeps the state of the root right when many promotions are queued behind it', () => {
    const tree = build();
    let parent = tree.rootId;
    const total = 700;
    for (let value = 1; value <= total; value += 1) {
      parent = tree.createNode(parent, {
        label: String(value),
        timestamp: value,
        forward: [{ op: 'replace', path: '', value }],
        inverse: [{ op: 'replace', path: '', value: value - 1 }],
      }).id;
    }
    const observed: number[] = [];
    for (let value = 1; value <= total; value += 1) {
      tree.promoteOnlyChild('start');
      if (value % 97 === 0 || value === total) {
        observed.push(tree.require(tree.rootId).checkpoint as number);
      }
    }
    expect(observed).toEqual([97, 194, 291, 388, 485, 582, 679, 700]);
  });

  it('replaces the state of a root whose state is still queued', () => {
    const tree = build();
    const first = tree.createNode(tree.rootId, {
      label: 'a',
      timestamp: 1,
      forward: [{ op: 'replace', path: '', value: 3 }],
      inverse: [{ op: 'replace', path: '', value: 0 }],
    });
    tree.promoteOnlyChild('start');
    tree.require(first.id).checkpoint = 40;
    expect(tree.require(first.id).checkpoint).toBe(40);
  });

  it('refuses to promote when the root has several children or none', () => {
    const tree = build();
    expect(() => tree.promoteOnlyChild('x')).toThrow('exactly one child');
    tree.createNode(tree.rootId, { label: 'a', timestamp: 1 });
    tree.createNode(tree.rootId, { label: 'b', timestamp: 2 });
    expect(() => tree.promoteOnlyChild('x')).toThrow('exactly one child');
  });

  it('iterates over every node', () => {
    const tree = build();
    tree.createNode(tree.rootId, { label: 'a', timestamp: 1 });
    expect([...tree.all()].map((node) => node.label)).toEqual(['root', 'a']);
  });
});
