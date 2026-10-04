import { copyPlainObject, hasOwn, isContainer, isPlainObject, setOwn } from './values';

describe('values', () => {
  it('recognizes plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
    expect(
      isPlainObject(
        new (class Point {
          x = 1;
        })(),
      ),
    ).toBe(false);
    expect(isPlainObject('text')).toBe(false);
  });

  it('treats plain objects and arrays as containers', () => {
    expect(isContainer({})).toBe(true);
    expect(isContainer([])).toBe(true);
    expect(isContainer(new Date())).toBe(false);
    expect(isContainer(1)).toBe(false);
  });

  it('checks own properties only', () => {
    expect(hasOwn({ a: 1 }, 'a')).toBe(true);
    expect(hasOwn({ a: 1 }, 'toString')).toBe(false);
  });

  it('writes dangerous keys as own data properties', () => {
    const target: Record<string, unknown> = {};
    setOwn(target, '__proto__', { polluted: true });
    setOwn(target, 'constructor', 1);
    setOwn(target, 'plain', 2);
    expect(Object.keys(target)).toEqual(['__proto__', 'constructor', 'plain']);
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('copies an object including an own __proto__ key', () => {
    const source: Record<string, unknown> = {};
    setOwn(source, '__proto__', 1);
    setOwn(source, 'a', 2);
    const copy = copyPlainObject(source);
    expect(copy).not.toBe(source);
    expect(Object.keys(copy)).toEqual(['__proto__', 'a']);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
  });
});
