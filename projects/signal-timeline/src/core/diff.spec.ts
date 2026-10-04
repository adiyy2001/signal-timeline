import { applyPatch } from './apply';
import { diff, diffPair } from './diff';
import { createTrap } from './testing/trap';

describe('diff', () => {
  it('returns an empty patch for the same reference and for equal primitives', () => {
    const state = { a: [1, 2] };
    expect(diff(state, state)).toEqual([]);
    expect(diff(1, 1)).toEqual([]);
    expect(diff('a', 'a')).toEqual([]);
    expect(diff(NaN, NaN)).toEqual([]);
  });

  it('replaces primitives and mixed types', () => {
    expect(diff(1, 2)).toEqual([{ op: 'replace', path: '', value: 2 }]);
    expect(diff({ a: 1 }, { a: [1] })).toEqual([{ op: 'replace', path: '/a', value: [1] }]);
    expect(diff([1], { 0: 1 })).toEqual([{ op: 'replace', path: '', value: { 0: 1 } }]);
    expect(diff(null, {})).toEqual([{ op: 'replace', path: '', value: {} }]);
  });

  it('treats dates, maps and class instances as atomic', () => {
    const first = new Date(0);
    const second = new Date(1);
    expect(diff({ when: first }, { when: second })).toEqual([
      { op: 'replace', path: '/when', value: second },
    ]);
    expect(diff({ when: first }, { when: first })).toEqual([]);
    const mapA = new Map([[1, 1]]);
    const mapB = new Map([[1, 1]]);
    expect(diff({ m: mapA }, { m: mapB })).toHaveLength(1);
  });

  it('emits removes before adds and recurses into shared keys', () => {
    const patch = diff({ a: 1, b: { c: 1 }, d: 1 }, { b: { c: 2 }, d: 1, e: 5 });
    expect(patch).toEqual([
      { op: 'remove', path: '/a' },
      { op: 'replace', path: '/b/c', value: 2 },
      { op: 'add', path: '/e', value: 5 },
    ]);
  });

  it('escapes keys in paths', () => {
    expect(diff({ 'a/b': 1, 'c~d': 1 }, { 'a/b': 2, 'c~d': 2 })).toEqual([
      { op: 'replace', path: '/a~1b', value: 2 },
      { op: 'replace', path: '/c~0d', value: 2 },
    ]);
  });

  it('skips an unchanged subtree without reading it', () => {
    const trap = createTrap();
    const before = { shared: trap.value, count: 1 };
    const after = { shared: trap.value, count: 2 };
    expect(diff(before, after)).toEqual([{ op: 'replace', path: '/count', value: 2 }]);
    expect(trap.touches()).toBe(0);
  });

  it('appends to an array with one add', () => {
    expect(diff([1, 2], [1, 2, 3])).toEqual([{ op: 'add', path: '/2', value: 3 }]);
  });

  it('removes from the end of an array with one remove', () => {
    expect(diff([1, 2, 3], [1, 2])).toEqual([{ op: 'remove', path: '/2' }]);
  });

  it('inserts in the middle by trimming the shared prefix and suffix', () => {
    expect(diff(['a', 'b', 'd'], ['a', 'b', 'c', 'd'])).toEqual([
      { op: 'add', path: '/2', value: 'c' },
    ]);
  });

  it('removes in the middle by trimming the shared prefix and suffix', () => {
    expect(diff(['a', 'b', 'c', 'd'], ['a', 'd'])).toEqual([
      { op: 'remove', path: '/2' },
      { op: 'remove', path: '/1' },
    ]);
  });

  it('compares same-length arrays element by element and recurses', () => {
    const before = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const after = [before[0], { n: 20 }, before[2]];
    expect(diff(before, after)).toEqual([{ op: 'replace', path: '/1/n', value: 20 }]);
  });

  it('rewrites the changed middle when the lengths differ', () => {
    expect(diff([1, 2, 3, 4], [1, 9, 9, 9, 4])).toEqual([
      { op: 'remove', path: '/2' },
      { op: 'remove', path: '/1' },
      { op: 'add', path: '/1', value: 9 },
      { op: 'add', path: '/2', value: 9 },
      { op: 'add', path: '/3', value: 9 },
    ]);
  });

  it('does not let the suffix overlap the prefix', () => {
    expect(diff([1, 1], [1, 1, 1])).toEqual([{ op: 'add', path: '/2', value: 1 }]);
    expect(applyPatch([1, 1], diff([1, 1], [1, 1, 1]))).toEqual([1, 1, 1]);
  });

  it('diffs arrays at the root', () => {
    expect(diff([1], [1, 2])).toEqual([{ op: 'add', path: '/1', value: 2 }]);
  });

  it('keeps references to values, it does not clone them', () => {
    const added = { big: [1, 2, 3] };
    const patch = diff({}, { added });
    expect(patch).toEqual([{ op: 'add', path: '/added', value: added }]);
    const [operation] = patch;
    expect(operation?.op === 'add' && operation.value).toBe(added);
  });
});

describe('diffPair', () => {
  it('returns the same forward patch as diff', () => {
    const before = { a: [1, 2], b: { c: 1 } };
    const after = { a: [1, 3, 2], b: { c: 2, d: 1 } };
    expect(diffPair(before, after).forward).toEqual(diff(before, after));
  });

  it('carries the old value in the inverse of a replace and a remove', () => {
    const { inverse } = diffPair({ a: 1, b: 2 }, { a: 5 });
    expect(inverse).toEqual([
      { op: 'replace', path: '/a', value: 1 },
      { op: 'add', path: '/b', value: 2 },
    ]);
  });

  it('turns an add into a remove', () => {
    expect(diffPair({}, { a: 1 }).inverse).toEqual([{ op: 'remove', path: '/a' }]);
  });

  it('orders the inverse of an array rewrite so that it applies cleanly', () => {
    const before = [1, 2, 3, 4];
    const after = [1, 9, 9, 9, 4];
    const { forward, inverse } = diffPair(before, after);
    expect(applyPatch(applyPatch(before, forward), inverse)).toEqual(before);
    expect(inverse).toEqual([
      { op: 'remove', path: '/3' },
      { op: 'remove', path: '/2' },
      { op: 'remove', path: '/1' },
      { op: 'add', path: '/1', value: 2 },
      { op: 'add', path: '/2', value: 3 },
    ]);
  });

  it('returns two empty patches for equal states', () => {
    const state = { a: 1 };
    expect(diffPair(state, state)).toEqual({ forward: [], inverse: [] });
  });
});
