import { TestBed } from '@angular/core/testing';
import { getState } from '@ngrx/signals';
import * as fc from 'fast-check';
import { canonical as canonicalValue } from '../core/testing/canonical';
import { assertProperty } from '../core/testing/property';
import { createMemoryAdapter } from '../persistence/testing/memory-adapter';
import { provideTimelineGroup } from './provide-timeline-group';
import { TimelineGroup, type TimelineGroupOptions } from './timeline-group';
import { createGuardStore, createLayoutStore, createShapesStore } from './testing/stores';

type Edit =
  | { kind: 'add'; item: string }
  | { kind: 'select'; item: string | null }
  | { kind: 'zoom'; value: number }
  | { kind: 'panel'; open: boolean }
  | { kind: 'cursor'; value: number }
  | { kind: 'guard'; value: number };

type Step =
  | Edit
  | { kind: 'transaction'; edits: readonly Edit[] }
  | { kind: 'undo'; via: number }
  | { kind: 'redo'; via: number; pick: number }
  | { kind: 'jump'; via: number; pick: number };

const edit: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ kind: fc.constant('add' as const), item: fc.constantFrom('a', 'b', 'c') }),
  fc.record({
    kind: fc.constant('select' as const),
    item: fc.constantFrom('a', 'b', null),
  }),
  fc.record({ kind: fc.constant('zoom' as const), value: fc.integer({ min: 1, max: 3 }) }),
  fc.record({ kind: fc.constant('panel' as const), open: fc.boolean() }),
  fc.record({ kind: fc.constant('cursor' as const), value: fc.integer({ min: 0, max: 5 }) }),
  fc.record({ kind: fc.constant('guard' as const), value: fc.integer({ min: 0, max: 3 }) }),
);

const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 6, arbitrary: edit },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('transaction' as const),
      edits: fc.array(edit, { minLength: 1, maxLength: 4 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('undo' as const), via: fc.nat({ max: 2 }) }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('redo' as const),
      via: fc.nat({ max: 2 }),
      pick: fc.nat({ max: 3 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('jump' as const),
      via: fc.nat({ max: 2 }),
      pick: fc.nat(),
    }),
  },
);

function boot(options: TimelineGroupOptions = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideTimelineGroup(options)] });
  const shapes = TestBed.inject(createShapesStore());
  const layout = TestBed.inject(createLayoutStore());
  const guard = TestBed.inject(createGuardStore({ failOn: undefined }));
  const group = TestBed.inject(TimelineGroup);
  return { shapes, layout, guard, group };
}

type Booted = ReturnType<typeof boot>;

function tracked(booted: Booted): string {
  const layout = { ...getState(booted.layout), cursor: 0 };
  return JSON.stringify(
    canonicalValue({ shapes: getState(booted.shapes), layout, guard: getState(booted.guard) }),
  );
}

function applyEdit({ shapes, layout, guard }: Booted, change: Edit): void {
  switch (change.kind) {
    case 'add':
      shapes.add(change.item);
      break;
    case 'select':
      shapes.select(change.item);
      break;
    case 'zoom':
      layout.setZoom(change.value);
      break;
    case 'panel':
      layout.setPanel(change.open ? 'open' : 'closed');
      break;
    case 'cursor':
      layout.moveCursor(change.value);
      break;
    case 'guard':
      guard.setValue(change.value);
      break;
  }
}

function controls(booted: Booted, via: number) {
  return [booted.shapes, booted.layout, booted.group][via % 3] ?? booted.group;
}

function comparable<T extends { depth: number; timestamp: number }>(entry: T): T {
  return { ...entry, timestamp: entry.depth === 0 ? 0 : entry.timestamp };
}

describe('timeline group properties', () => {
  it('keeps every store equal to the state recorded for the current entry', () => {
    assertProperty(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const booted = boot({ checkpointEvery: 3 });
        const { group } = booted;
        const model = new Map<number, string>([[group.currentEntryId(), tracked(booted)]]);
        steps.forEach((current) => {
          switch (current.kind) {
            case 'undo':
              controls(booted, current.via).undo();
              break;
            case 'redo': {
              const branches = group.redoBranches();
              controls(booted, current.via).redo(
                branches.length === 0 ? undefined : branches[current.pick % branches.length],
              );
              break;
            }
            case 'jump': {
              const ids = group.entries().map((entry) => entry.id);
              controls(booted, current.via).jumpTo(ids[current.pick % ids.length] as number);
              break;
            }
            case 'transaction': {
              const entriesBefore = group.entries().length;
              const before = tracked(booted);
              group.transaction('t', () =>
                current.edits.forEach((inner) => applyEdit(booted, inner)),
              );
              const changed = tracked(booted) !== before;
              expect(group.entries().length).toBe(entriesBefore + (changed ? 1 : 0));
              model.set(group.currentEntryId(), tracked(booted));
              break;
            }
            default:
              applyEdit(booted, current);
              model.set(group.currentEntryId(), tracked(booted));
          }
          expect(tracked(booted)).toBe(model.get(group.currentEntryId()));
        });
        group.entries().forEach((entry) => {
          group.jumpTo(entry.id);
          expect(tracked(booted)).toBe(model.get(entry.id));
        });
      }),
    );
  }, 120_000);

  it('restores persisted group history to the same state at every entry', () => {
    assertProperty(
      fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
        const adapter = createMemoryAdapter();
        const options: TimelineGroupOptions = {
          checkpointEvery: 4,
          persistence: { adapter },
          stores: ['shapes', 'layout', 'guard'],
        };
        const original = boot(options);
        steps.forEach((current) => {
          switch (current.kind) {
            case 'undo':
              original.group.undo();
              break;
            case 'redo':
              original.group.redo();
              break;
            case 'jump': {
              const ids = original.group.entries().map((entry) => entry.id);
              original.group.jumpTo(ids[current.pick % ids.length] as number);
              break;
            }
            case 'transaction':
              original.group.transaction('t', () =>
                current.edits.forEach((inner) => applyEdit(original, inner)),
              );
              break;
            default:
              applyEdit(original, current);
          }
        });
        const expected = new Map<number, string>();
        original.group.entries().forEach((entry) => {
          original.group.jumpTo(entry.id);
          expected.set(entry.id, tracked(original));
        });
        const currentId = original.group.currentEntryId();
        original.group.jumpTo(currentId);
        const entries = original.group.entries().map(comparable);
        window.dispatchEvent(new Event('pagehide'));

        const reloaded = boot(options);
        expect(reloaded.group.entries().map(comparable)).toEqual(entries);
        expect(reloaded.group.currentEntryId()).toBe(currentId);
        expect(tracked(reloaded)).toBe(expected.get(currentId));
        reloaded.group.entries().forEach((entry) => {
          reloaded.group.jumpTo(entry.id);
          expect(tracked(reloaded)).toBe(expected.get(entry.id));
        });
      }),
    );
  }, 120_000);
});
