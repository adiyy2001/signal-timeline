import { layoutTree, type LayoutEntry } from './layout-tree';
import { entriesFromParents } from './testing/entries';

function layoutEntries(parents: readonly number[]): readonly LayoutEntry[] {
  return entriesFromParents(parents);
}

function placeOf(parents: readonly number[], activePath: readonly number[]) {
  const layout = layoutTree(layoutEntries(parents), activePath);
  return new Map(layout.nodes.map((node) => [node.id, node]));
}

describe('layoutTree', () => {
  it('places a single node at the origin', () => {
    const layout = layoutTree(layoutEntries([]), [1]);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0]).toMatchObject({ column: 0, row: 0, setSize: 1, positionInSet: 1 });
    expect(layout.columns).toBe(1);
    expect(layout.rows).toBe(1);
  });

  it('returns an empty layout for no entries', () => {
    expect(layoutTree([], [])).toEqual({ nodes: [], columns: 0, rows: 0 });
  });

  it('draws a linear history in one column, one row per step', () => {
    const place = placeOf([1, 2, 3, 4], [1, 2, 3, 4, 5]);
    expect([...place.values()].map((node) => [node.column, node.row])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ]);
  });

  it('puts the active child first even when it was created last', () => {
    const place = placeOf([1, 1, 1], [1, 4]);
    expect(place.get(4)?.column).toBe(0);
    expect(place.get(2)?.column).toBe(1);
    expect(place.get(3)?.column).toBe(2);
    expect(place.get(4)?.positionInSet).toBe(1);
    expect(place.get(2)?.positionInSet).toBe(2);
    expect(place.get(3)?.positionInSet).toBe(3);
    expect(place.get(2)?.setSize).toBe(3);
  });

  it('gives a branch its own columns for its whole subtree', () => {
    const place = placeOf([1, 2, 2, 3, 1, 6], [1, 2, 3, 5]);
    const columnsOf = (ids: readonly number[]) => ids.map((id) => place.get(id)?.column);
    expect(columnsOf([1, 2, 3, 5])).toEqual([0, 0, 0, 0]);
    expect(columnsOf([4])).toEqual([1]);
    expect(columnsOf([6, 7])).toEqual([2, 2]);
  });

  it('lists nodes depth first with the active child first', () => {
    const layout = layoutTree(layoutEntries([1, 2, 2, 3, 1, 6]), [1, 2, 3, 5]);
    expect(layout.nodes.map((node) => node.id)).toEqual([1, 2, 3, 5, 4, 6, 7]);
  });

  it('keeps siblings of the root path in creation order after the active child', () => {
    const layout = layoutTree(layoutEntries([1, 1, 1]), [1, 3]);
    expect(layout.nodes.map((node) => node.id)).toEqual([1, 3, 2, 4]);
  });

  it('is stable when the active path is empty', () => {
    const layout = layoutTree(layoutEntries([1, 1]), []);
    expect(layout.nodes.map((node) => [node.id, node.column])).toEqual([
      [1, 0],
      [2, 0],
      [3, 1],
    ]);
  });

  it('survives a history ten thousand entries deep without recursion', () => {
    const parents = Array.from({ length: 10_000 }, (_, index) => index + 1);
    const layout = layoutTree(layoutEntries(parents), []);
    expect(layout.rows).toBe(10_001);
    expect(layout.columns).toBe(1);
  });

  it('treats an entry whose parent is missing as a root and places roots side by side', () => {
    const layout = layoutTree(
      [
        { id: 5, parentId: 4, children: [6] },
        { id: 6, parentId: 5, children: [] },
        { id: 9, parentId: undefined, children: [] },
      ],
      [9],
    );
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    expect(byId.get(9)).toMatchObject({ column: 0, row: 0, parentId: undefined });
    expect(byId.get(5)).toMatchObject({ column: 1, row: 0, parentId: undefined });
    expect(byId.get(6)).toMatchObject({ column: 1, row: 1, parentId: 5 });
    expect(layout.columns).toBe(2);
  });

  it('ignores a child that does not point back at its parent and never visits a node twice', () => {
    const layout = layoutTree(
      [
        { id: 1, parentId: undefined, children: [2, 2, 3] },
        { id: 2, parentId: 1, children: [] },
        { id: 3, parentId: 2, children: [] },
      ],
      [],
    );
    expect(layout.nodes.map((node) => node.id)).toEqual([1, 2]);
  });
});
