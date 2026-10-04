import { TestBed } from '@angular/core/testing';
import { getState } from '@ngrx/signals';
import * as fc from 'fast-check';
import { TimelineEngine } from '../core/engine';
import { canonical as canonicalValue } from '../core/testing/canonical';
import { assertProperty } from '../core/testing/property';
import { createCounterStore, initialCounter, type CounterState } from './testing/stores';

function canonical(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

type Step =
  | { kind: 'count'; value: number }
  | { kind: 'title'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'deep'; value: number }
  | { kind: 'both'; count: number; title: string }
  | { kind: 'transaction'; steps: readonly Step[] }
  | { kind: 'undo' }
  | { kind: 'redo'; pick: number }
  | { kind: 'jump'; pick: number };

const editStep: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('count' as const), value: fc.integer({ min: 0, max: 4 }) }),
  fc.record({ kind: fc.constant('title' as const), value: fc.constantFrom('a', 'b', 'c') }),
  fc.record({ kind: fc.constant('tag' as const), value: fc.constantFrom('x', 'y') }),
  fc.record({ kind: fc.constant('deep' as const), value: fc.integer({ min: 0, max: 3 }) }),
  fc.record({
    kind: fc.constant('both' as const),
    count: fc.integer({ min: 0, max: 4 }),
    title: fc.constantFrom('a', 'b', 'c'),
  }),
);

const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 5, arbitrary: editStep },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('transaction' as const),
      steps: fc.array(editStep, { minLength: 1, maxLength: 4 }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('undo' as const) }) },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('redo' as const), pick: fc.nat({ max: 3 }) }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('jump' as const), pick: fc.nat() }) },
);

function freshStore(options: Parameters<typeof createCounterStore>[0] = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(createCounterStore(options));
}

type Store = ReturnType<typeof freshStore>;

function applyEdit(store: Store, edit: Step): void {
  switch (edit.kind) {
    case 'count':
      store.setCount(edit.value);
      break;
    case 'title':
      store.setTitle(edit.value);
      break;
    case 'tag':
      store.addTag(edit.value);
      break;
    case 'deep':
      store.setDeep(edit.value);
      break;
    case 'both':
      store.both(edit.count, edit.title);
      break;
    default:
      break;
  }
}

function stateOf(store: Store): CounterState {
  return getState(store);
}

describe('withTimeline properties', () => {
  it('keeps the live state equal to the state recorded for the current entry', () => {
    assertProperty(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const store = freshStore({ checkpointEvery: 3 });
        const model = new Map<number, string>([
          [store.currentEntryId(), canonical(initialCounter)],
        ]);
        const remember = (): void => {
          model.set(store.currentEntryId(), canonical(stateOf(store)));
        };
        const run = (current: Step): void => {
          switch (current.kind) {
            case 'undo':
              store.undo();
              break;
            case 'redo': {
              const branches = store.redoBranches();
              store.redo(
                branches.length === 0 ? undefined : branches[current.pick % branches.length],
              );
              break;
            }
            case 'jump': {
              const ids = store.entries().map((entry) => entry.id);
              store.jumpTo(ids[current.pick % ids.length] as number);
              break;
            }
            case 'transaction':
              store.transaction('t', () =>
                current.steps.forEach((inner) => applyEdit(store, inner)),
              );
              remember();
              break;
            default:
              applyEdit(store, current);
              remember();
          }
          expect(canonical(stateOf(store))).toBe(model.get(store.currentEntryId()));
        };
        steps.forEach(run);
        store.entries().forEach((entry) => {
          store.jumpTo(entry.id);
          expect(canonical(stateOf(store))).toBe(model.get(entry.id));
        });
      }),
    );
  });

  it('returns the identical state after undoing k times and redoing k times', () => {
    assertProperty(
      fc.property(fc.array(editStep, { maxLength: 25 }), fc.nat(), (edits, extra) => {
        const store = freshStore({ checkpointEvery: 4 });
        edits.forEach((edit) => applyEdit(store, edit));
        const before = stateOf(store);
        const depth =
          store.entries().find((entry) => entry.id === store.currentEntryId())?.depth ?? 0;
        const k = depth === 0 ? 0 : extra % (depth + 1);
        for (let index = 0; index < k; index += 1) {
          store.undo();
        }
        for (let index = 0; index < k; index += 1) {
          store.redo();
        }
        expect(canonical(stateOf(store))).toBe(canonical(before));
      }),
    );
  });

  it('matches an engine fed the same sequence, step by step', () => {
    assertProperty(
      fc.property(
        fc.array(editStep, { maxLength: 25 }),
        fc.array(fc.boolean(), { maxLength: 25 }),
        (edits, moves) => {
          const store = freshStore();
          const engine = new TimelineEngine<CounterState>(initialCounter);
          edits.forEach((edit) => {
            applyEdit(store, edit);
            engine.record(stateOf(store), { label: 'edit' });
          });
          moves.forEach((forward) => {
            if (forward) {
              store.redo();
              engine.redo();
            } else {
              store.undo();
              engine.undo();
            }
            expect(canonical(stateOf(store))).toBe(canonical(engine.state));
            expect(store.canUndo()).toBe(engine.canUndo);
            expect(store.canRedo()).toBe(engine.canRedo);
          });
        },
      ),
    );
  });

  it('creates exactly one entry for a transaction with a net change and none without', () => {
    assertProperty(
      fc.property(fc.array(editStep, { minLength: 1, maxLength: 6 }), (edits) => {
        const store = freshStore();
        const before = canonical(stateOf(store));
        const entriesBefore = store.entries().length;
        store.transaction('t', () => edits.forEach((edit) => applyEdit(store, edit)));
        const changed = canonical(stateOf(store)) !== before;
        expect(store.entries().length).toBe(entriesBefore + (changed ? 1 : 0));
      }),
    );
  });

  it('keeps one parent per entry and a valid current pointer', () => {
    assertProperty(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const store = freshStore({ maxEntries: 8 });
        steps.forEach((current) => {
          switch (current.kind) {
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
            case 'transaction':
              store.transaction('t', () =>
                current.steps.forEach((inner) => applyEdit(store, inner)),
              );
              break;
            default:
              applyEdit(store, current);
          }
        });
        const entries = store.entries();
        const ids = new Set(entries.map((entry) => entry.id));
        expect(ids.size).toBe(entries.length);
        expect(ids.has(store.currentEntryId())).toBe(true);
        const roots = entries.filter((entry) => entry.parentId === undefined);
        expect(roots).toHaveLength(1);
        const childCount = new Map<number, number>();
        entries.forEach((entry) => {
          if (entry.parentId !== undefined) {
            expect(ids.has(entry.parentId)).toBe(true);
            childCount.set(entry.parentId, (childCount.get(entry.parentId) ?? 0) + 1);
          }
        });
        entries.forEach((entry) => {
          expect(entry.children).toHaveLength(childCount.get(entry.id) ?? 0);
        });
        expect(entries.length).toBeLessThanOrEqual(9);
      }),
    );
  });
});
