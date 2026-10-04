import { TestBed } from '@angular/core/testing';
import { getState } from '@ngrx/signals';
import * as fc from 'fast-check';
import { canonical as canonicalValue } from '../core/testing/canonical';
import { assertProperty } from '../core/testing/property';
import { createMemoryAdapter } from '../persistence/testing/memory-adapter';
import { createCounterStore } from './testing/stores';

type Step =
  | { kind: 'count'; value: number }
  | { kind: 'title'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'deep'; value: number }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'jump'; pick: number };

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('count' as const),
      value: fc.integer({ min: 0, max: 4 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('title' as const),
      value: fc.constantFrom('a', 'b', 'c'),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('tag' as const), value: fc.constantFrom('x', 'y') }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('deep' as const),
      value: fc.integer({ min: 0, max: 3 }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('undo' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('redo' as const) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('jump' as const), pick: fc.nat() }) },
);

function boot(
  adapter: ReturnType<typeof createMemoryAdapter>,
  checkpointEvery: number,
  maxEntries?: number,
) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(
    createCounterStore({ checkpointEvery, maxEntries, persistence: { adapter } }),
  );
}

type Store = ReturnType<typeof boot>;

function canonicalState(store: Store): string {
  return JSON.stringify(canonicalValue(getState(store)));
}

function run(store: Store, current: Step): void {
  switch (current.kind) {
    case 'count':
      store.setCount(current.value);
      break;
    case 'title':
      store.setTitle(current.value);
      break;
    case 'tag':
      store.addTag(current.value);
      break;
    case 'deep':
      store.setDeep(current.value);
      break;
    case 'undo':
      store.undo();
      break;
    case 'redo':
      store.redo();
      break;
    case 'jump': {
      const ids = store.entries().map((entry) => entry.id);
      store.jumpTo(ids[current.pick % ids.length] as number);
      break;
    }
  }
}

function comparable<T extends { depth: number; timestamp: number }>(entry: T): T {
  return { ...entry, timestamp: entry.depth === 0 ? 0 : entry.timestamp };
}

describe('persisted history properties', () => {
  it.each([
    { checkpointEvery: 3, maxEntries: undefined },
    { checkpointEvery: 50, maxEntries: 6 },
  ])(
    'restores the same history and the same state at every entry (%o)',
    ({ checkpointEvery, maxEntries }) => {
      assertProperty(
        fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
          const adapter = createMemoryAdapter();
          const original = boot(adapter, checkpointEvery, maxEntries);
          steps.forEach((current) => run(original, current));
          const currentId = original.currentEntryId();
          const entries = original.entries().map(comparable);
          const expected = new Map<number, string>();
          original.entries().forEach((entry) => {
            original.jumpTo(entry.id);
            expected.set(entry.id, canonicalState(original));
          });
          original.jumpTo(currentId);
          window.dispatchEvent(new Event('pagehide'));

          const reloaded = boot(adapter, checkpointEvery, maxEntries);
          expect(reloaded.entries().map(comparable)).toEqual(entries);
          expect(reloaded.currentEntryId()).toBe(currentId);
          expect(canonicalState(reloaded)).toBe(expected.get(currentId));
          reloaded.entries().forEach((entry) => {
            reloaded.jumpTo(entry.id);
            expect(canonicalState(reloaded)).toBe(expected.get(entry.id));
          });
        }),
      );
    },
    120_000,
  );

  it('keeps recording correctly after a restore', () => {
    assertProperty(
      fc.property(
        fc.array(step, { maxLength: 20 }),
        fc.array(step, { maxLength: 20 }),
        (before, after) => {
          const adapter = createMemoryAdapter();
          const first = boot(adapter, 3);
          before.forEach((current) => run(first, current));
          window.dispatchEvent(new Event('pagehide'));
          const second = boot(adapter, 3);
          const model = new Map<number, string>();
          const control = boot(createMemoryAdapter(adapter.stored), 3);
          expect(canonicalState(control)).toBe(canonicalState(second));
          const live = boot(adapter, 3);
          after.forEach((current) => {
            run(live, current);
            model.set(live.currentEntryId(), canonicalState(live));
            expect(canonicalState(live)).toBe(model.get(live.currentEntryId()));
          });
          live.entries().forEach((entry) => {
            live.jumpTo(entry.id);
            if (model.has(entry.id)) {
              expect(canonicalState(live)).toBe(model.get(entry.id));
            }
          });
        },
      ),
    );
  }, 120_000);
});
