import { indexEntries, isAncestorOrSelf, pathFromRoot, resolveTip } from './active-path';
import { entriesFromParents, treeParents } from './testing/entries';

const byId = indexEntries(entriesFromParents(treeParents));

describe('active path', () => {
  it('finds ancestors and the node itself, and nothing for unrelated nodes', () => {
    expect(isAncestorOrSelf(byId, 2, 5)).toBe(true);
    expect(isAncestorOrSelf(byId, 5, 5)).toBe(true);
    expect(isAncestorOrSelf(byId, 1, 7)).toBe(true);
    expect(isAncestorOrSelf(byId, 4, 5)).toBe(false);
    expect(isAncestorOrSelf(byId, 5, 2)).toBe(false);
  });

  it('lists the path from the root to a tip', () => {
    expect(pathFromRoot(byId, 5)).toEqual([1, 2, 3, 5]);
    expect(pathFromRoot(byId, 1)).toEqual([1]);
    expect(pathFromRoot(byId, 99)).toEqual([]);
  });

  it('continues along the newest children from the current entry', () => {
    expect(resolveTip(byId, 1, undefined)).toBe(7);
    expect(resolveTip(byId, 2, undefined)).toBe(4);
    expect(resolveTip(byId, 5, undefined)).toBe(5);
  });

  it('keeps the previous branch while the current entry stays on it', () => {
    expect(resolveTip(byId, 2, 5)).toBe(5);
    expect(resolveTip(byId, 1, 5)).toBe(5);
    expect(resolveTip(byId, 5, 5)).toBe(5);
  });

  it('leaves the previous branch when the current entry is off it or the tip is gone', () => {
    expect(resolveTip(byId, 4, 5)).toBe(4);
    expect(resolveTip(byId, 6, 5)).toBe(7);
    expect(resolveTip(byId, 2, 99)).toBe(4);
  });

  it('stops where the newest child is not in the index', () => {
    const broken = indexEntries(
      entriesFromParents([1]).map((entry) => ({ ...entry, children: [...entry.children, 40] })),
    );
    expect(resolveTip(broken, 1, undefined)).toBe(1);
  });
});
