import { applyPatch } from './apply';
import { PatchError, type Patch } from './patch';
import { createTrap } from './testing/trap';

function countingMap(entries: Record<string, unknown>): {
  value: Record<string, unknown>;
  copies: () => number;
} {
  let copies = 0;
  const value = new Proxy(entries, {
    get(target, key, receiver) {
      if (key === 'a') {
        copies += 1;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  return { value, copies: () => copies };
}

describe('applyPatch', () => {
  describe('objects', () => {
    it('adds a new key', () => {
      expect(applyPatch({ a: 1 }, [{ op: 'add', path: '/b', value: 2 }])).toStrictEqual({
        a: 1,
        b: 2,
      });
    });

    it('overwrites an existing key with add', () => {
      expect(applyPatch({ a: 1 }, [{ op: 'add', path: '/a', value: 2 }])).toStrictEqual({ a: 2 });
    });

    it('removes a key', () => {
      expect(applyPatch({ a: 1, b: 2 }, [{ op: 'remove', path: '/a' }])).toStrictEqual({ b: 2 });
    });

    it('replaces a key', () => {
      expect(applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: 'x' }])).toStrictEqual({
        a: 'x',
      });
    });

    it('works on nested paths and escaped segments', () => {
      const state = { 'a/b': { 'c~d': [1, { e: 2 }] } };
      const result = applyPatch(state, [{ op: 'replace', path: '/a~1b/c~0d/1/e', value: 3 }]);
      expect(result).toStrictEqual({ 'a/b': { 'c~d': [1, { e: 3 }] } });
    });

    it('rejects remove and replace of a missing key', () => {
      expect(() => applyPatch({}, [{ op: 'remove', path: '/a' }])).toThrow(PatchError);
      expect(() => applyPatch({}, [{ op: 'replace', path: '/a', value: 1 }])).toThrow(PatchError);
    });

    it('does not read inherited keys', () => {
      expect(() => applyPatch({}, [{ op: 'remove', path: '/toString' }])).toThrow(PatchError);
      expect(() => applyPatch({}, [{ op: 'add', path: '/toString/x', value: 1 }])).toThrow(
        PatchError,
      );
    });
  });

  describe('arrays', () => {
    it('inserts at an index', () => {
      expect(applyPatch([1, 3], [{ op: 'add', path: '/1', value: 2 }])).toStrictEqual([1, 2, 3]);
    });

    it('appends with a dash', () => {
      expect(applyPatch([1], [{ op: 'add', path: '/-', value: 2 }])).toStrictEqual([1, 2]);
    });

    it('appends with an index equal to the length', () => {
      expect(applyPatch([1], [{ op: 'add', path: '/1', value: 2 }])).toStrictEqual([1, 2]);
    });

    it('removes at an index and shifts the rest', () => {
      expect(applyPatch([1, 2, 3], [{ op: 'remove', path: '/1' }])).toStrictEqual([1, 3]);
    });

    it('replaces at an index', () => {
      expect(applyPatch([1, 2], [{ op: 'replace', path: '/0', value: 9 }])).toStrictEqual([9, 2]);
    });

    it('rejects an index past the end, a leading zero, a negative index and a dash outside add', () => {
      expect(() => applyPatch([1], [{ op: 'add', path: '/2', value: 0 }])).toThrow(PatchError);
      expect(() => applyPatch([1], [{ op: 'remove', path: '/1' }])).toThrow(PatchError);
      expect(() => applyPatch([1], [{ op: 'replace', path: '/01', value: 0 }])).toThrow(PatchError);
      expect(() => applyPatch([1], [{ op: 'replace', path: '/-1', value: 0 }])).toThrow(PatchError);
      expect(() => applyPatch([1], [{ op: 'replace', path: '/-', value: 0 }])).toThrow(PatchError);
      expect(() => applyPatch([[1]], [{ op: 'add', path: '/1/0', value: 0 }])).toThrow(PatchError);
    });
  });

  describe('root', () => {
    it('replaces the whole document', () => {
      expect(applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: [1] }])).toStrictEqual([1]);
    });

    it('treats add at the root as a replacement', () => {
      expect(applyPatch(1, [{ op: 'add', path: '', value: 2 }])).toBe(2);
    });

    it('rejects removing the root', () => {
      expect(() => applyPatch({}, [{ op: 'remove', path: '' }])).toThrow(PatchError);
    });

    it('can continue patching a value that was just set as the root', () => {
      const value = { a: 1 };
      const result = applyPatch<unknown>(0, [
        { op: 'replace', path: '', value },
        { op: 'replace', path: '/a', value: 2 },
      ]);
      expect(result).toStrictEqual({ a: 2 });
      expect(value).toStrictEqual({ a: 1 });
    });

    it('rejects a path into a primitive', () => {
      expect(() => applyPatch(1, [{ op: 'add', path: '/a', value: 1 }])).toThrow(PatchError);
      expect(() => applyPatch({ a: 1 }, [{ op: 'add', path: '/a/b', value: 1 }])).toThrow(
        PatchError,
      );
    });

    it('does not treat dates and class instances as containers', () => {
      expect(() =>
        applyPatch({ when: new Date(0) }, [{ op: 'add', path: '/when/x', value: 1 }]),
      ).toThrow(PatchError);
    });
  });

  describe('errors', () => {
    it('reports the failing operation index and path', () => {
      const patch: Patch = [
        { op: 'add', path: '/a', value: 1 },
        { op: 'remove', path: '/missing' },
      ];
      try {
        applyPatch({}, patch);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(PatchError);
        expect((error as PatchError).operationIndex).toBe(1);
        expect((error as PatchError).path).toBe('/missing');
      }
    });

    it('reports malformed pointers with the operation index', () => {
      try {
        applyPatch({}, [{ op: 'add', path: 'no-slash', value: 1 }]);
        expect.unreachable();
      } catch (error) {
        expect((error as PatchError).operationIndex).toBe(0);
        expect((error as PatchError).path).toBe('no-slash');
      }
    });

    it('leaves the input untouched when a later operation fails', () => {
      const state = { list: [1, 2], nested: { a: 1 } };
      const snapshot = structuredClone(state);
      expect(() =>
        applyPatch(state, [
          { op: 'add', path: '/list/-', value: 3 },
          { op: 'replace', path: '/nested/a', value: 2 },
          { op: 'remove', path: '/nested/missing' },
        ]),
      ).toThrow(PatchError);
      expect(state).toStrictEqual(snapshot);
    });
  });

  describe('immutability and sharing', () => {
    it('returns the same reference for an empty patch', () => {
      const state = { a: 1 };
      expect(applyPatch(state, [])).toBe(state);
    });

    it('never mutates the input and copies only the containers on the path', () => {
      const untouched = Object.freeze({ deep: Object.freeze([1, 2, 3]) });
      const changed = Object.freeze({ value: 1 });
      const frozen = Object.freeze({ changed, untouched });
      const result = applyPatch(frozen, [{ op: 'replace', path: '/changed/value', value: 2 }]);
      expect(result).toStrictEqual({ changed: { value: 2 }, untouched: { deep: [1, 2, 3] } });
      expect(result).not.toBe(frozen);
      expect(result.changed).not.toBe(changed);
      expect(result.untouched).toBe(untouched);
      expect(changed.value).toBe(1);
    });

    it('copies a container once however many operations hit it', () => {
      const map = countingMap({ a: 1, b: 2, c: 3 });
      const result = applyPatch({ map: map.value }, [
        { op: 'add', path: '/map/d', value: 4 },
        { op: 'replace', path: '/map/a', value: 10 },
        { op: 'remove', path: '/map/b' },
      ]);
      expect(map.copies()).toBe(1);
      expect(result.map).toStrictEqual({ a: 10, c: 3, d: 4 });
      expect(map.value).toStrictEqual({ a: 1, b: 2, c: 3 });
    });

    it('copies an array once however many operations hit it', () => {
      const items = [1, 2, 3];
      const result = applyPatch({ items }, [
        { op: 'add', path: '/items/-', value: 4 },
        { op: 'remove', path: '/items/0' },
        { op: 'replace', path: '/items/0', value: 9 },
      ]);
      expect(result.items).toStrictEqual([9, 3, 4]);
      expect(items).toStrictEqual([1, 2, 3]);
    });

    it('does not mutate a value taken from the patch itself', () => {
      const added = { list: [1] };
      const result = applyPatch<Record<string, unknown>>({}, [
        { op: 'add', path: '/x', value: added },
        { op: 'add', path: '/x/list/-', value: 2 },
      ]);
      expect(result).toStrictEqual({ x: { list: [1, 2] } });
      expect(added).toStrictEqual({ list: [1] });
    });

    it('never reads a shared subtree that is not on a changed path', () => {
      const trap = createTrap();
      const state = { shared: trap.value, other: { a: 1 } };
      const result = applyPatch(state, [{ op: 'replace', path: '/other/a', value: 2 }]);
      expect(result.shared).toBe(trap.value);
      expect(trap.touches()).toBe(0);
    });
  });

  describe('dangerous keys', () => {
    it('writes __proto__, constructor and prototype as own properties', () => {
      const result = applyPatch<Record<string, unknown>>({}, [
        { op: 'add', path: '/__proto__', value: { polluted: true } },
        { op: 'add', path: '/constructor', value: 1 },
        { op: 'add', path: '/prototype', value: 2 },
      ]);
      expect(Object.keys(result)).toEqual(['__proto__', 'constructor', 'prototype']);
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    it('patches below an own __proto__ key without touching the prototype', () => {
      const state = applyPatch<Record<string, unknown>>({}, [
        { op: 'add', path: '/__proto__', value: { a: 1 } },
      ]);
      const result = applyPatch(state, [{ op: 'replace', path: '/__proto__/a', value: 2 }]);
      expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toStrictEqual({ a: 2 });
      expect(Object.getOwnPropertyDescriptor(state, '__proto__')?.value).toStrictEqual({ a: 1 });
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });

    it('does not follow inherited constructor or prototype keys', () => {
      expect(() =>
        applyPatch({}, [{ op: 'add', path: '/constructor/prototype/x', value: 1 }]),
      ).toThrow(PatchError);
      expect(({} as { x?: number }).x).toBeUndefined();
    });
  });
});
