import type { Signal } from '@angular/core';
import { expectTypeOf } from 'expect-type';
import {
  patchState,
  signalStore,
  withMethods,
  withState,
  type EmptyFeatureResult,
} from '@ngrx/signals';
import type { ignoreReplays, skipReplay } from './replay';
import type {
  TimelineChange,
  TimelineEntry,
  TimelineEntryPatches,
  TimelineOptions,
} from './options';
import type { TimelineSource } from './timeline-api';
import { withTimeline } from './with-timeline';

interface State {
  readonly count: number;
  readonly title: string;
}

type FeatureInput = Pick<EmptyFeatureResult, 'props' | 'methods'> & { state: State };

type OptionsParameter = Parameters<typeof withTimeline<FeatureInput>>[0];

export const Store = signalStore(
  withState<State>({ count: 0, title: '' }),
  withTimeline({ track: ['count'] }),
  withMethods((store) => ({
    set: (count: number) => patchState(store, { count }),
  })),
);

type StoreInstance = InstanceType<typeof Store>;

describe('withTimeline option types', () => {
  it('accepts track with state keys', () => {
    expectTypeOf<{ track: ['count'] }>().toExtend<TimelineOptions<State>>();
    expectTypeOf<{ track: ['count', 'title'] }>().toExtend<TimelineOptions<State>>();
  });

  it('accepts skip with state keys', () => {
    expectTypeOf<{ skip: ['title'] }>().toExtend<TimelineOptions<State>>();
  });

  it('rejects keys that are not in the state', () => {
    expectTypeOf<{ track: ['nope'] }>().not.toExtend<TimelineOptions<State>>();
    expectTypeOf<{ skip: ['nope'] }>().not.toExtend<TimelineOptions<State>>();
  });

  it('rejects track and skip together', () => {
    expectTypeOf<{ track: ['count']; skip: ['title'] }>().not.toExtend<TimelineOptions<State>>();
  });

  it('types the options against the state of the store it is added to', () => {
    expectTypeOf<NonNullable<OptionsParameter>>().toEqualTypeOf<TimelineOptions<State>>();
  });

  it('gives label and coalesce key the typed change', () => {
    expectTypeOf<TimelineChange<State>['changedKeys']>().toEqualTypeOf<
      readonly ('count' | 'title')[]
    >();
    expectTypeOf<TimelineChange<State>['before']>().toEqualTypeOf<State>();
    expectTypeOf<NonNullable<TimelineOptions<State>['label']>>()
      .parameter(0)
      .toEqualTypeOf<TimelineChange<State>>();
    expectTypeOf<
      NonNullable<NonNullable<TimelineOptions<State>['coalesce']>['key']>
    >().returns.toEqualTypeOf<string | undefined>();
  });

  it('accepts numeric options', () => {
    expectTypeOf<{ maxEntries: number; checkpointEvery: number }>().toExtend<
      TimelineOptions<State>
    >();
    expectTypeOf<{ coalesce: { windowMs: number } }>().toExtend<TimelineOptions<State>>();
    expectTypeOf<{ maxEntries: string }>().not.toExtend<TimelineOptions<State>>();
  });
});

describe('withTimeline store type', () => {
  it('adds exactly the documented members', () => {
    expectTypeOf<
      Exclude<Extract<keyof StoreInstance, string>, 'count' | 'title' | 'set'>
    >().toEqualTypeOf<
      | 'entries'
      | 'currentEntryId'
      | 'redoBranches'
      | 'canUndo'
      | 'canRedo'
      | 'isReplaying'
      | 'undo'
      | 'redo'
      | 'jumpTo'
      | 'clear'
      | 'transaction'
      | 'coalesce'
      | 'beginCoalescing'
      | 'endCoalescing'
      | 'entryPatch'
    >();
  });

  it('hides the private runtime member', () => {
    expectTypeOf<StoreInstance>().not.toHaveProperty('_timelineRuntime');
  });

  it('types the signals', () => {
    expectTypeOf<StoreInstance['entries']>().toEqualTypeOf<Signal<readonly TimelineEntry[]>>();
    expectTypeOf<StoreInstance['currentEntryId']>().toEqualTypeOf<Signal<number>>();
    expectTypeOf<StoreInstance['redoBranches']>().toEqualTypeOf<Signal<readonly number[]>>();
    expectTypeOf<StoreInstance['canUndo']>().toEqualTypeOf<Signal<boolean>>();
    expectTypeOf<StoreInstance['canRedo']>().toEqualTypeOf<Signal<boolean>>();
    expectTypeOf<StoreInstance['isReplaying']>().toEqualTypeOf<Signal<boolean>>();
  });

  it('types the methods', () => {
    expectTypeOf<StoreInstance['undo']>().toEqualTypeOf<() => void>();
    expectTypeOf<StoreInstance['redo']>().toEqualTypeOf<(branchId?: number) => void>();
    expectTypeOf<StoreInstance['jumpTo']>().toEqualTypeOf<(entryId: number) => void>();
    expectTypeOf<StoreInstance['clear']>().toEqualTypeOf<() => void>();
    expectTypeOf<StoreInstance['transaction']>().toEqualTypeOf<
      (label: string, run: () => void) => void
    >();
    expectTypeOf<StoreInstance['coalesce']>().toEqualTypeOf<
      (key: string, run: () => void) => void
    >();
    expectTypeOf<StoreInstance['beginCoalescing']>().toEqualTypeOf<(key: string) => void>();
    expectTypeOf<StoreInstance['endCoalescing']>().toEqualTypeOf<() => void>();
    expectTypeOf<StoreInstance['entryPatch']>().toEqualTypeOf<
      (entryId: number) => TimelineEntryPatches | undefined
    >();
  });

  it('does not accept a string where an entry id is expected', () => {
    expectTypeOf<StoreInstance['jumpTo']>().parameter(0).not.toEqualTypeOf<string>();
    expectTypeOf<StoreInstance['redo']>().parameters.toEqualTypeOf<[branchId?: number]>();
  });

  it('keeps the state signals and the user methods', () => {
    expectTypeOf<StoreInstance['count']>().toEqualTypeOf<Signal<number>>();
    expectTypeOf<StoreInstance['set']>().toEqualTypeOf<(count: number) => void>();
  });

  it('is usable as a timeline source and as a replay aware store', () => {
    expectTypeOf<StoreInstance>().toExtend<TimelineSource>();
    expectTypeOf<Parameters<typeof skipReplay>[0]>().toEqualTypeOf<{
      readonly isReplaying: Signal<boolean>;
    }>();
    expectTypeOf<ReturnType<typeof ignoreReplays<number>>>().toBeFunction();
  });
});
