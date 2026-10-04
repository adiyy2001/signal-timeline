import { DestroyRef, inject, Injector } from '@angular/core';
import {
  getState,
  patchState,
  signalStoreFeature,
  type,
  watchState,
  withMethods,
  withProps,
  type EmptyFeatureResult,
  type SignalStoreFeature,
  type SignalStoreFeatureResult,
  type WritableStateSource,
} from '@ngrx/signals';
import { TimelineError } from '../core/engine';
import type { TimelineChange, TimelineOptions } from './options';
import { defaultLabel, Recorder } from './recorder';
import { closeAfterNextRender, ReplayController } from './replay';
import { TimelineRuntime } from './runtime';
import type { TimelineMethods, TimelineProps } from './timeline-api';

type Slices = Record<string, unknown>;
type LooseState = WritableStateSource<Slices>;
export type TimelineFeatureResult = {
  state: EmptyFeatureResult['state'];
  props: TimelineProps;
  methods: TimelineMethods;
};
type RuntimeProps = { readonly _timelineRuntime: TimelineRuntime<Slices> };

interface UntypedOptions {
  readonly track?: readonly string[];
  readonly skip?: readonly string[];
  readonly maxEntries?: number;
  readonly checkpointEvery?: number;
  readonly coalesce?: {
    readonly windowMs?: number;
    readonly key?: (change: TimelineChange<Slices>) => string | undefined;
  };
  readonly label?: (change: TimelineChange<Slices>) => string;
}

function requireKnownKeys(option: string, keys: readonly string[], state: object): void {
  for (const key of keys) {
    if (!Object.hasOwn(state, key)) {
      throw new TimelineError(`${option} names the unknown state key "${key}"`);
    }
  }
}

function resolveTrackedKeys(options: UntypedOptions, state: Slices): readonly string[] {
  if (options.track !== undefined && options.skip !== undefined) {
    throw new TimelineError('Pass either track or skip, not both');
  }
  const stateKeys = Object.keys(state);
  if (options.track !== undefined) {
    requireKnownKeys('track', options.track, state);
    return stateKeys.filter((key) => options.track?.includes(key));
  }
  const skipped = options.skip ?? [];
  requireKnownKeys('skip', skipped, state);
  return stateKeys.filter((key) => !skipped.includes(key));
}

function createRuntime(store: LooseState, options: UntypedOptions): TimelineRuntime<Slices> {
  const injector = inject(Injector);
  const initial = getState(store);
  const trackedKeys = resolveTrackedKeys(options, initial);
  const replay = new ReplayController(closeAfterNextRender(injector));
  const pick = (state: Slices): Slices => {
    const slices: Slices = {};
    for (const key of trackedKeys) {
      slices[key] = state[key];
    }
    return slices;
  };
  const runtime = new TimelineRuntime<Slices>(pick(initial), {
    host: {
      read: () => pick(getState(store)),
      write: (changes) => patchState(store, changes),
    },
    replay,
    engine: {
      maxEntries: options.maxEntries,
      checkpointEvery: options.checkpointEvery,
      coalesceWindowMs: options.coalesce?.windowMs,
    },
  });
  const recorder = new Recorder<Slices>({
    runtime,
    replay,
    trackedKeys,
    label: options.label ?? ((change) => defaultLabel(change.changedKeys)),
    coalesceKey: options.coalesce?.key,
    initial,
    idleSealMs: options.coalesce?.windowMs,
  });
  watchState(store, (state) => recorder.observe(state), { injector });
  inject(DestroyRef).onDestroy(() => recorder.dispose());
  return runtime;
}

/**
 * Adds undo, redo, transactions, a branching history tree and time travel to a SignalStore.
 * Put it after the features that define the state it should track. Tracked state must be plain
 * data: objects, arrays, strings, numbers, booleans and null.
 *
 * Every `patchState` call that changes a tracked key becomes one entry. A change made after an
 * undo starts a new branch and keeps the old one. Keys that are derived from other keys, for
 * example through `withLinkedState`, belong in `skip`.
 */
export function withTimeline<Input extends SignalStoreFeatureResult>(
  options: TimelineOptions<NoInfer<Input['state']>> = {},
): SignalStoreFeature<Input, TimelineFeatureResult> {
  const feature = signalStoreFeature(
    type<SignalStoreFeatureResult>(),
    withProps((store) => ({
      _timelineRuntime: createRuntime(store as unknown as LooseState, options as UntypedOptions),
    })),
    withProps(({ _timelineRuntime }: RuntimeProps): TimelineProps => _timelineRuntime.props),
    withMethods(({ _timelineRuntime }: RuntimeProps): TimelineMethods => ({
      undo: () => _timelineRuntime.undo(),
      redo: (branchId) => _timelineRuntime.redo(branchId),
      jumpTo: (entryId) => _timelineRuntime.jumpTo(entryId),
      clear: () => _timelineRuntime.clear(),
      transaction: (label, run) => _timelineRuntime.transaction(label, run),
      coalesce: (key, run) => _timelineRuntime.coalesce(key, run),
      beginCoalescing: (key) => _timelineRuntime.beginCoalescing(key),
      endCoalescing: () => _timelineRuntime.endCoalescing(),
      entryPatch: (entryId) => _timelineRuntime.entryPatch(entryId),
    })),
  );
  return feature as unknown as SignalStoreFeature<Input, TimelineFeatureResult>;
}
