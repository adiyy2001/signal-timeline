import type { Patch } from '../core/patch';
import type { TimelinePersistenceOptions } from '../persistence/adapter';

/**
 * Describes one change to the store, passed to the `label` and `coalesce.key` options.
 * `before` and `after` are the complete store states around the change.
 */
export interface TimelineChange<State> {
  /** The state keys whose value changed. */
  readonly changedKeys: readonly (keyof State & string)[];
  /** The whole state before the change. */
  readonly before: State;
  /** The whole state after the change. */
  readonly after: State;
}

/**
 * Which state keys the timeline records. Pass `track` to record only those keys or `skip`
 * to record everything except those keys. Passing both is a type error.
 */
export type TimelineKeyOptions<State> =
  | {
      /** The only state keys that are recorded. */
      readonly track?: readonly (keyof State & string)[];
      /** Not allowed together with `track`. */
      readonly skip?: never;
    }
  | {
      /** State keys that are left out of the history. */
      readonly skip?: readonly (keyof State & string)[];
      /** Not allowed together with `skip`. */
      readonly track?: never;
    };

/**
 * Merges changes into one entry, so a drag becomes one undo step.
 */
export interface TimelineCoalesceOptions<State> {
  /**
   * A change within this many milliseconds of the previous change joins the open entry. It
   * applies to every change that has no key, so unrelated edits made in quick succession merge
   * as well. Use `key` when only edits of one kind should merge.
   */
  readonly windowMs?: number;
  /**
   * Consecutive changes that return the same string join one entry. `undefined` ends the entry.
   * An entry joined by key stays open, however long it takes, until a different change, an
   * undo, a redo, a jump or `endCoalescing` seals it. To close it after a pause, call
   * `beginCoalescing` and `endCoalescing` from a timer.
   */
  readonly key?: (change: TimelineChange<State>) => string | undefined;
}

/**
 * Options that every store accepts, alone or in a group.
 */
export interface TimelineSharedOptions<State> {
  /**
   * Builds the label of a new entry. The default lists the changed keys.
   */
  readonly label?: (change: TimelineChange<State>) => string;
}

/**
 * Options for a store that keeps its own history.
 */
export interface TimelineStandaloneOptions<State> extends TimelineSharedOptions<State> {
  /** Leave it out, or pass `false`, for a store that keeps its own history. */
  readonly group?: false;
  /** Only members of a group have a store key. */
  readonly storeKey?: undefined;
  /**
   * The most entries kept, the initial state excluded. The oldest branch that is not the current one goes first.
   */
  readonly maxEntries?: number;
  /**
   * A full copy of the state is kept at every entry whose depth is a multiple of this number, so a jump
   * replays at most this many entries. Defaults to 250. A lower number makes jumps cheaper on long
   * histories and keeps more copies of the state in memory.
   */
  readonly checkpointEvery?: number;
  /** Merges changes into one entry. */
  readonly coalesce?: TimelineCoalesceOptions<State>;
  /**
   * Saves the history and brings it back after a reload.
   */
  readonly persistence?: TimelinePersistenceOptions;
}

/**
 * Options for a store that shares one history with other stores through `provideTimelineGroup`.
 * The limits, the coalescing window and the persistence belong to the group.
 */
export interface TimelineGroupMemberOptions<State> extends TimelineSharedOptions<State> {
  /** Pass `true` and provide the group with `provideTimelineGroup`. */
  readonly group: true;
  /**
   * Names the store inside the shared history. It must be unique in the group and stay the same
   * between releases, because saved history is addressed by it.
   */
  readonly storeKey: string;
  /** Only `key` is accepted. The coalescing window belongs to the group. */
  readonly coalesce?: Pick<TimelineCoalesceOptions<State>, 'key'> & {
    /** Set on the group. */
    readonly windowMs?: never;
  };
  /** Set on the group. */
  readonly maxEntries?: never;
  /** Set on the group. */
  readonly checkpointEvery?: never;
  /** Set on the group. */
  readonly persistence?: never;
}

/**
 * Options for `withTimeline`.
 */
export type TimelineOptions<State> = TimelineKeyOptions<State> &
  (TimelineStandaloneOptions<State> | TimelineGroupMemberOptions<State>);

/**
 * One node of the history tree as the store exposes it.
 */
export interface TimelineEntry {
  /** Increasing integer, never reused. */
  readonly id: number;
  /** `undefined` for the initial state. */
  readonly parentId: number | undefined;
  /** What the label option returned for the change, or `Initial state` for the first entry. */
  readonly label: string;
  /** Milliseconds since the epoch of the last change merged into the entry. */
  readonly timestamp: number;
  /** Child ids in creation order. More than one means the history branches here. */
  readonly children: readonly number[];
  /** Number of steps from the initial state. */
  readonly depth: number;
  /**
   * The state keys the entry changed. In a timeline group these are the store keys, so the
   * list says which stores the entry touched. Empty for the initial state.
   */
  readonly changedKeys: readonly string[];
}

/**
 * The forward patch and the inverse patch of an entry, in RFC 6902 style.
 */
export interface TimelineEntryPatches {
  /** Turns the parent state into the state of the entry. */
  readonly forward: Patch;
  /** Turns the state of the entry back into the parent state. */
  readonly inverse: Patch;
}
