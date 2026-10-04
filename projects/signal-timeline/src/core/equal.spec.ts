import { deepEqual } from './equal';

describe('deepEqual', () => {
  it('compares primitives with Object.is', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(0, -0)).toBe(false);
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(deepEqual('a', 'b')).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it('compares arrays by length and items', () => {
    expect(deepEqual([1, [2]], [1, [2]])).toBe(true);
    expect(deepEqual([1], [1, 2])).toBe(false);
    expect(deepEqual([1, 2], [1, 3])).toBe(false);
  });

  it('ignores key order and compares own keys', () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: undefined }, { b: undefined })).toBe(false);
  });

  it('does not equate arrays and objects, or distinct class instances', () => {
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(new Date(0), new Date(0))).toBe(false);
  });

  it('handles an own key named like an object member', () => {
    const left = JSON.parse('{"__proto__": 1, "constructor": 2}') as unknown;
    const right = JSON.parse('{"constructor": 2, "__proto__": 1}') as unknown;
    expect(deepEqual(left, right)).toBe(true);
  });
});
