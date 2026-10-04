import { indexEntries, pathFromRoot } from '../active-path';
import { navigateTree } from './tree-navigation';
import { buildTreeModel } from './tree-model';
import { entriesFromParents, treeParents } from '../testing/entries';

const entries = entriesFromParents(treeParents);
const byId = indexEntries(entries);

function nodes(currentId = 5, collapsed: readonly number[] = []) {
  return buildTreeModel(entries, byId, currentId, pathFromRoot(byId, 5), new Set(collapsed)).nodes;
}

describe('navigateTree', () => {
  it('moves down and up through the visible nodes in keyboard order', () => {
    expect(navigateTree('ArrowDown', nodes(), 1)).toEqual({ kind: 'focus', id: 2 });
    expect(navigateTree('ArrowDown', nodes(), 5)).toEqual({ kind: 'focus', id: 4 });
    expect(navigateTree('ArrowUp', nodes(), 4)).toEqual({ kind: 'focus', id: 5 });
  });

  it('stays at the ends', () => {
    expect(navigateTree('ArrowUp', nodes(), 1)).toEqual({ kind: 'focus', id: 1 });
    expect(navigateTree('ArrowDown', nodes(), 7)).toEqual({ kind: 'focus', id: 7 });
  });

  it('goes to the first and the last node', () => {
    expect(navigateTree('Home', nodes(), 4)).toEqual({ kind: 'focus', id: 1 });
    expect(navigateTree('End', nodes(), 4)).toEqual({ kind: 'focus', id: 7 });
  });

  it('opens a closed node, then moves into it', () => {
    expect(navigateTree('ArrowRight', nodes(5, [6]), 6)).toEqual({ kind: 'expand', id: 6 });
    expect(navigateTree('ArrowRight', nodes(), 6)).toEqual({ kind: 'focus', id: 7 });
  });

  it('does nothing on Right at a leaf', () => {
    expect(navigateTree('ArrowRight', nodes(), 7)).toEqual({ kind: 'none' });
  });

  it('closes an open node, then moves to the parent', () => {
    expect(navigateTree('ArrowLeft', nodes(), 6)).toEqual({ kind: 'collapse', id: 6 });
    expect(navigateTree('ArrowLeft', nodes(), 7)).toEqual({ kind: 'focus', id: 6 });
    expect(navigateTree('ArrowLeft', nodes(), 1)).toEqual({ kind: 'none' });
  });

  it('moves to the parent instead of closing a node on the way to the current entry', () => {
    expect(navigateTree('ArrowLeft', nodes(), 3)).toEqual({ kind: 'focus', id: 2 });
  });

  it('activates with Enter and Space', () => {
    expect(navigateTree('Enter', nodes(), 4)).toEqual({ kind: 'activate', id: 4 });
    expect(navigateTree(' ', nodes(), 4)).toEqual({ kind: 'activate', id: 4 });
  });

  it('ignores other keys and unknown nodes', () => {
    expect(navigateTree('a', nodes(), 4)).toEqual({ kind: 'none' });
    expect(navigateTree('ArrowDown', nodes(), 99)).toEqual({ kind: 'none' });
    expect(navigateTree('Home', [], 1)).toEqual({ kind: 'none' });
  });
});
