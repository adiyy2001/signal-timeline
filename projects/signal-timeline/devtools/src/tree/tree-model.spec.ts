import { indexEntries, pathFromRoot } from '../active-path';
import { buildTreeModel } from './tree-model';
import { entriesFromParents, treeParents } from '../testing/entries';

const entries = entriesFromParents(treeParents);
const byId = indexEntries(entries);

function modelFor(currentId: number, tipId: number, collapsed: readonly number[] = []) {
  return buildTreeModel(entries, byId, currentId, pathFromRoot(byId, tipId), new Set(collapsed));
}

describe('buildTreeModel', () => {
  it('marks the current entry, the active branch and the expandable nodes', () => {
    const model = modelFor(3, 5);
    const byNode = new Map(model.nodes.map((node) => [node.id, node]));
    expect(byNode.get(3)).toMatchObject({ current: true, onActivePath: true, expandable: true });
    expect(byNode.get(5)).toMatchObject({ current: false, onActivePath: true, expandable: false });
    expect(byNode.get(4)).toMatchObject({ onActivePath: false });
    expect(model.nodes.filter((node) => node.current)).toHaveLength(1);
    expect(model.nodes.map((node) => node.id)).toEqual([1, 2, 3, 5, 4, 6, 7]);
  });

  it('draws one edge per non root node and marks the active ones', () => {
    const model = modelFor(3, 5);
    expect(model.edges).toHaveLength(6);
    expect(model.edges.filter((edge) => edge.active).map((edge) => edge.toId)).toEqual([2, 3, 5]);
  });

  it('hides the descendants of a collapsed node', () => {
    const model = modelFor(5, 5, [6]);
    expect(model.nodes.map((node) => node.id)).toEqual([1, 2, 3, 5, 4, 6]);
    expect(model.nodes.find((node) => node.id === 6)).toMatchObject({
      expandable: true,
      expanded: false,
    });
  });

  it('never collapses an ancestor of the current entry', () => {
    const model = modelFor(5, 5, [2, 3]);
    expect(model.nodes.map((node) => node.id)).toContain(5);
    expect(model.nodes.find((node) => node.id === 3)).toMatchObject({
      expanded: true,
      lockedOpen: true,
    });
  });

  it('collapses the current entry itself without hiding it', () => {
    const model = modelFor(2, 5, [2]);
    expect(model.nodes.map((node) => node.id)).toEqual([1, 2, 6, 7]);
    expect(model.nodes.find((node) => node.id === 2)).toMatchObject({
      current: true,
      expanded: false,
      lockedOpen: false,
    });
  });

  it('reports the grid size', () => {
    const model = modelFor(3, 5);
    expect(model.columns).toBe(3);
    expect(model.rows).toBe(4);
  });

  it('skips entries that the index does not know', () => {
    const model = buildTreeModel(entries, new Map(), 1, [], new Set());
    expect(model.nodes).toEqual([]);
  });
});
