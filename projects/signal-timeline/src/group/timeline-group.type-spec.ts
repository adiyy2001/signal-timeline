import type { Signal } from '@angular/core';
import { expectTypeOf } from 'expect-type';
import { signalStore, withState } from '@ngrx/signals';
import type { TimelineEntry, TimelineOptions } from '../store/options';
import type { TimelineMethods, TimelineSource } from '../store/timeline-api';
import { withTimeline } from '../store/with-timeline';
import type {
  TimelinePersistenceAdapter,
  TimelinePersistenceOptions,
} from '../persistence/adapter';
import type { provideTimelineGroup } from './provide-timeline-group';
import type { TimelineGroup, TimelineGroupOptions } from './timeline-group';

interface State {
  readonly count: number;
  readonly title: string;
}

export const Member = signalStore(
  withState<State>({ count: 0, title: '' }),
  withTimeline({ group: true, storeKey: 'member', skip: ['title'] }),
);

describe('group member option types', () => {
  it('needs a storeKey when group is true', () => {
    expectTypeOf<{ group: true }>().not.toExtend<TimelineOptions<State>>();
    expectTypeOf<{ group: true; storeKey: 'a' }>().toExtend<TimelineOptions<State>>();
    expectTypeOf<{ group: true; storeKey: 1 }>().not.toExtend<TimelineOptions<State>>();
  });

  it('does not accept a storeKey on a store with its own history', () => {
    expectTypeOf<{ storeKey: 'a' }>().not.toExtend<TimelineOptions<State>>();
    expectTypeOf<{ group: false; storeKey: 'a' }>().not.toExtend<TimelineOptions<State>>();
    expectTypeOf<{ group: false }>().toExtend<TimelineOptions<State>>();
  });

  it('keeps the limits and persistence on the group', () => {
    expectTypeOf<{ group: true; storeKey: 'a'; maxEntries: 3 }>().not.toExtend<
      TimelineOptions<State>
    >();
    expectTypeOf<{ group: true; storeKey: 'a'; checkpointEvery: 3 }>().not.toExtend<
      TimelineOptions<State>
    >();
    expectTypeOf<{
      group: true;
      storeKey: 'a';
      persistence: { adapter: TimelinePersistenceAdapter };
    }>().not.toExtend<TimelineOptions<State>>();
    expectTypeOf<{ group: true; storeKey: 'a'; coalesce: { windowMs: 5 } }>().not.toExtend<
      TimelineOptions<State>
    >();
  });

  it('still accepts the label, the coalescing key and key selection in a group', () => {
    expectTypeOf<{
      group: true;
      storeKey: 'a';
      track: ['count'];
      label: () => string;
      coalesce: { key: () => string };
    }>().toExtend<TimelineOptions<State>>();
    expectTypeOf<{ group: true; storeKey: 'a'; track: ['nope'] }>().not.toExtend<
      TimelineOptions<State>
    >();
  });

  it('accepts persistence on a store with its own history', () => {
    expectTypeOf<{
      persistence: { adapter: TimelinePersistenceAdapter; rehydrate: 'history-and-state' };
    }>().toExtend<TimelineOptions<State>>();
    expectTypeOf<{
      persistence: { adapter: TimelinePersistenceAdapter; rehydrate: 'always' };
    }>().not.toExtend<TimelineOptions<State>>();
    expectTypeOf<{ persistence: { rehydrate: 'history-and-state' } }>().not.toExtend<
      TimelineOptions<State>
    >();
  });
});

describe('persistence option types', () => {
  it('types the adapter', () => {
    expectTypeOf<TimelinePersistenceAdapter['load']>().returns.toEqualTypeOf<
      string | null | Promise<string | null>
    >();
    expectTypeOf<TimelinePersistenceAdapter['save']>().parameters.toEqualTypeOf<[value: string]>();
    expectTypeOf<TimelinePersistenceOptions['debounceMs']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<NonNullable<TimelinePersistenceOptions['migrate']>>().parameters.toEqualTypeOf<
      [payload: unknown, fromFormat: number]
    >();
  });
});

describe('timeline group types', () => {
  it('is a timeline source with the store methods', () => {
    expectTypeOf<TimelineGroup>().toExtend<TimelineSource>();
    expectTypeOf<TimelineGroup>().toExtend<TimelineMethods>();
    expectTypeOf<TimelineGroup['entries']>().toEqualTypeOf<Signal<readonly TimelineEntry[]>>();
  });

  it('exposes the stores an entry touched', () => {
    expectTypeOf<TimelineEntry['changedKeys']>().toEqualTypeOf<readonly string[]>();
  });

  it('asks for the store keys when persistence is set', () => {
    expectTypeOf<{ maxEntries: 5; coalesce: { windowMs: 10 } }>().toExtend<TimelineGroupOptions>();
    expectTypeOf<{
      persistence: TimelinePersistenceOptions;
    }>().not.toExtend<TimelineGroupOptions>();
    expectTypeOf<{
      persistence: TimelinePersistenceOptions;
      stores: ['a', 'b'];
    }>().toExtend<TimelineGroupOptions>();
    expectTypeOf<{ stores: ['a'] }>().not.toExtend<TimelineGroupOptions>();
  });

  it('provides the group from options', () => {
    expectTypeOf<Parameters<typeof provideTimelineGroup>>().toEqualTypeOf<
      [options?: TimelineGroupOptions]
    >();
  });
});
