import * as fc from 'fast-check';
import { applyPatch as applyWithOracle } from 'rfc6902';
import { applyPatch } from './apply';
import { diff, diffPair } from './diff';
import type { JsonValue } from './patch';
import {
  jsonArrayArbitrary,
  jsonObjectArbitrary,
  jsonValueArbitrary,
  safeJsonObjectArbitrary,
} from './testing/json-arbitraries';
import { canonical } from './testing/canonical';
import { assertProperty } from './testing/property';
import {
  applyRandomEdits,
  randomEditArbitrary,
  safeRandomEditArbitrary,
} from './testing/random-edit';
import { createTrap } from './testing/trap';

const editedPair = fc
  .tuple(jsonValueArbitrary, fc.array(randomEditArbitrary, { minLength: 1, maxLength: 4 }))
  .map(([before, edits]) => ({ before, after: applyRandomEdits(before, edits) }));

const independentPair = fc
  .tuple(jsonValueArbitrary, jsonValueArbitrary)
  .map(([before, after]) => ({ before, after }));

const anyPair = fc.oneof(editedPair, independentPair);

function sharedReferencesSurvive(before: unknown, after: unknown, result: unknown): boolean {
  if (before === after) {
    return result === before;
  }
  if (
    typeof before === 'object' &&
    before !== null &&
    typeof after === 'object' &&
    after !== null &&
    typeof result === 'object' &&
    result !== null &&
    Array.isArray(before) === Array.isArray(after) &&
    Array.isArray(before) === Array.isArray(result)
  ) {
    const beforeRecord: Record<string, unknown> = { ...before };
    const afterRecord: Record<string, unknown> = { ...after };
    const resultRecord: Record<string, unknown> = { ...result };
    if (Array.isArray(before) && before.length !== (after as unknown[]).length) {
      return true;
    }
    return Object.keys(afterRecord).every(
      (key) =>
        !Object.hasOwn(beforeRecord, key) ||
        sharedReferencesSurvive(beforeRecord[key], afterRecord[key], resultRecord[key]),
    );
  }
  return true;
}

describe('patch properties', () => {
  it('apply(a, diff(a, b)) equals b', () => {
    assertProperty(
      fc.property(anyPair, ({ before, after }) => {
        expect(canonical(applyPatch(before, diff(before, after)))).toEqual(canonical(after));
      }),
    );
  });

  it('apply(b, inverse) equals a', () => {
    assertProperty(
      fc.property(anyPair, ({ before, after }) => {
        const { inverse } = diffPair(before, after);
        expect(canonical(applyPatch(after, inverse))).toEqual(canonical(before));
      }),
    );
  });

  it('a forward patch followed by its inverse is the identity', () => {
    assertProperty(
      fc.property(anyPair, ({ before, after }) => {
        const { forward, inverse } = diffPair(before, after);
        expect(canonical(applyPatch(applyPatch(before, forward), inverse))).toEqual(
          canonical(before),
        );
      }),
    );
  });

  it('an inverse followed by its forward patch is the identity on the other side', () => {
    assertProperty(
      fc.property(anyPair, ({ before, after }) => {
        const { forward, inverse } = diffPair(before, after);
        expect(canonical(applyPatch(applyPatch(after, inverse), forward))).toEqual(
          canonical(after),
        );
      }),
    );
  });

  it('diff of a state with itself is empty', () => {
    assertProperty(
      fc.property(jsonValueArbitrary, (state) => {
        expect(diff(state, state)).toEqual([]);
        expect(diff(state, structuredClone(state))).toEqual([]);
      }),
    );
  });

  it('forward and inverse patches have the same number of operations on object-only edits', () => {
    assertProperty(
      fc.property(jsonObjectArbitrary, jsonObjectArbitrary, (before, after) => {
        const { forward, inverse } = diffPair(before, after);
        expect(inverse).toHaveLength(forward.length);
      }),
    );
  });

  it('keeps the identity of every subtree that did not change', () => {
    assertProperty(
      fc.property(editedPair, ({ before, after }) => {
        const result = applyPatch(before, diff(before, after));
        expect(sharedReferencesSurvive(before, after, result)).toBe(true);
      }),
    );
  });

  it('never reads a shared subtree while diffing and applying', () => {
    assertProperty(
      fc.property(
        jsonObjectArbitrary,
        fc.array(randomEditArbitrary, { maxLength: 3 }),
        (base, edits) => {
          const trap = createTrap();
          const before = { base, shared: trap.value, tail: 0 };
          const after = { base: applyRandomEdits(base, edits), shared: trap.value, tail: 1 };
          const pair = diffPair(before, after);
          const forward = applyPatch(before, pair.forward);
          const backward = applyPatch(forward, pair.inverse);
          expect(forward.shared).toBe(trap.value);
          expect(backward.shared).toBe(trap.value);
          expect(trap.touches()).toBe(0);
        },
      ),
    );
  });

  it('never mutates its input', () => {
    assertProperty(
      fc.property(anyPair, ({ before, after }) => {
        const beforeCopy = structuredClone(before);
        const afterCopy = structuredClone(after);
        const { forward, inverse } = diffPair(before, after);
        applyPatch(before, forward);
        applyPatch(after, inverse);
        expect(canonical(before)).toEqual(canonical(beforeCopy));
        expect(canonical(after)).toEqual(canonical(afterCopy));
      }),
    );
  });

  it('gives the same result as the rfc6902 package on a deep clone', () => {
    const pair = fc
      .tuple(
        safeJsonObjectArbitrary,
        fc.array(safeRandomEditArbitrary, { minLength: 1, maxLength: 4 }),
      )
      .map(([before, edits]) => ({ before, after: applyRandomEdits(before, edits) }))
      .filter(({ after }) => typeof after === 'object' && after !== null && !Array.isArray(after));
    assertProperty(
      fc.property(pair, ({ before, after }) => {
        const { forward, inverse } = diffPair(before, after);
        const cloned = structuredClone(before);
        const errors = applyWithOracle(
          cloned,
          forward.map((operation) => ({ ...operation })),
        );
        expect(errors.every((error) => error === null)).toBe(true);
        expect(canonical(cloned)).toEqual(canonical(applyPatch(before, forward)));
        const reverted = structuredClone(after);
        applyWithOracle(
          reverted,
          inverse.map((operation) => ({ ...operation })),
        );
        expect(canonical(reverted)).toEqual(canonical(before));
      }),
    );
  });

  it('handles arrays with inserts, removals and edits at random positions', () => {
    const arrayEdit = fc.record({
      kind: fc.constantFrom('insert', 'remove', 'edit', 'append'),
      index: fc.nat(20),
      value: fc.integer({ min: 0, max: 3 }),
    });
    assertProperty(
      fc.property(jsonArrayArbitrary, fc.array(arrayEdit, { maxLength: 6 }), (before, edits) => {
        const after = edits.reduce<JsonValue[]>((current, edit) => {
          const next = current.slice();
          if (edit.kind === 'insert') {
            next.splice(edit.index % (next.length + 1), 0, edit.value);
          } else if (edit.kind === 'append') {
            next.push(edit.value);
          } else if (next.length > 0 && edit.kind === 'remove') {
            next.splice(edit.index % next.length, 1);
          } else if (next.length > 0) {
            next[edit.index % next.length] = edit.value;
          }
          return next;
        }, before);
        const { forward, inverse } = diffPair(before, after);
        expect(applyPatch(before, forward)).toStrictEqual(after);
        expect(canonical(applyPatch(after, inverse))).toEqual(canonical(before));
      }),
    );
  });
});
