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
import { TimelineGroup } from '../group/timeline-group';
import type { TimelinePersistenceOptions } from '../persistence/adapter';
import { TimelinePersistence } from '../persistence/timeline-persistence';
import { defaultLabel, Recorder, type RecorderTarget } from './recorder';
import { closeAfterNextRender, ReplayController } from './replay';
import { TimelineRuntime, type TimelineControl } from './runtime';
import type { TimelineMethods, TimelineProps } from './timeline-api';

type Slices = Record<string, unknown>;
type LooseState = WritableStateSource<Slices>;
/**
 * What `withTimeline` adds to a store: no state, the timeline signals and the timeline methods.
 */
export type TimelineFeatureResult = {
  /** The feature adds no state. */
  state: EmptyFeatureResult['state'];
  /** The signals of the timeline. */
  props: TimelineProps;
  /** The methods of the timeline. */
  methods: TimelineMethods;
};
type RuntimeProps = { readonly _timelineRuntime: TimelineControl };

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
  readonly group?: boolean;
  readonly storeKey?: string;
  readonly persistence?: TimelinePersistenceOptions;
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

function pickKeys(keys: readonly string[], state: Slices): Slices {
  const slices: Slices = {};
  for (const key of keys) {
    slices[key] = state[key];
  }
  return slices;
}

function singleStoreTarget(runtime: TimelineRuntime<Slices>): RecorderTarget {
  const { engine } = runtime;
  return {
    get inTransaction(): boolean {
      return runtime.inTransaction;
    },
    get knownSlices(): Slices {
      return engine.state;
    },
    pathOffset: 1,
    record: (slices, recordOptions) => engine.record(slices, recordOptions),
    seal: () => engine.seal(),
    isSettled: (id) => {
      const node = engine.node(id);
      return node !== undefined && !node.open;
    },
    patchOf: (id) => engine.patchOf(id),
  };
}

function watchChanges(
  store: LooseState,
  injector: Injector,
  options: UntypedOptions,
  setup: {
    readonly target: RecorderTarget;
    readonly replay: ReplayController;
    readonly trackedKeys: readonly string[];
    readonly idleSealMs: number | undefined;
  },
): void {
  const recorder = new Recorder<Slices>({
    target: setup.target,
    replay: setup.replay,
    trackedKeys: setup.trackedKeys,
    label: options.label ?? ((change) => defaultLabel(change.changedKeys)),
    coalesceKey: options.coalesce?.key,
    initial: getState(store),
    idleSealMs: setup.idleSealMs,
  });
  watchState(store, (state) => recorder.observe(state), { injector });
  inject(DestroyRef).onDestroy(() => recorder.dispose());
}

function createStandaloneRuntime(
  store: LooseState,
  options: UntypedOptions,
  trackedKeys: readonly string[],
): TimelineControl {
  const injector = inject(Injector);
  const replay = new ReplayController(closeAfterNextRender(injector));
  const runtime = new TimelineRuntime<Slices>(pickKeys(trackedKeys, getState(store)), {
    host: {
      read: () => pickKeys(trackedKeys, getState(store)),
      write: (changes) => patchState(store, changes),
    },
    replay,
    engine: {
      maxEntries: options.maxEntries,
      checkpointEvery: options.checkpointEvery,
      coalesceWindowMs: options.coalesce?.windowMs,
    },
  });
  watchChanges(store, injector, options, {
    target: singleStoreTarget(runtime),
    replay,
    trackedKeys,
    idleSealMs: options.coalesce?.windowMs,
  });
  if (options.persistence !== undefined) {
    const persistence = new TimelinePersistence(runtime.engine, options.persistence, {
      keys: trackedKeys,
      liveState: () => pickKeys(trackedKeys, getState(store)),
      applyState: (target) => runtime.writeState(target),
    });
    persistence.start();
    inject(DestroyRef).onDestroy(() => persistence.dispose());
  }
  return runtime;
}

function requireMemberOptions(options: UntypedOptions): string {
  const { storeKey } = options;
  if (typeof storeKey !== 'string' || storeKey === '') {
    throw new TimelineError('A store in a timeline group needs a storeKey');
  }
  const groupOnly = ['maxEntries', 'checkpointEvery', 'persistence'] as const;
  for (const name of groupOnly) {
    if (options[name] !== undefined) {
      throw new TimelineError(`Set ${name} on provideTimelineGroup, not on a member store`);
    }
  }
  if (options.coalesce?.windowMs !== undefined) {
    throw new TimelineError('Set coalesce.windowMs on provideTimelineGroup, not on a member store');
  }
  return storeKey;
}

function createMemberRuntime(
  store: LooseState,
  options: UntypedOptions,
  trackedKeys: readonly string[],
): TimelineControl {
  const storeKey = requireMemberOptions(options);
  const injector = inject(Injector);
  const group = inject(TimelineGroup, { optional: true });
  if (group === null) {
    throw new TimelineError(
      `The store "${storeKey}" is a timeline group member, but no group is provided. Add provideTimelineGroup() to the providers.`,
    );
  }
  const membership = group.join({
    storeKey,
    read: () => pickKeys(trackedKeys, getState(store)),
    write: (slices) => {
      const live = getState(store);
      const changes: Slices = {};
      for (const key of trackedKeys) {
        if (!Object.is(live[key], slices[key])) {
          changes[key] = slices[key];
        }
      }
      if (Object.keys(changes).length > 0) {
        patchState(store, changes);
      }
    },
  });
  watchChanges(store, injector, options, {
    target: membership.target,
    replay: membership.replay,
    trackedKeys,
    idleSealMs: membership.idleSealMs,
  });
  inject(DestroyRef).onDestroy(() => membership.leave());
  membership.activate();
  return membership.control;
}

function createRuntime(store: LooseState, options: UntypedOptions): TimelineControl {
  const trackedKeys = resolveTrackedKeys(options, getState(store));
  return options.group === true
    ? createMemberRuntime(store, options, trackedKeys)
    : createStandaloneRuntime(store, options, trackedKeys);
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
