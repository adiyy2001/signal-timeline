import type { Signal } from '@angular/core';
import type { TimelineEntry, TimelineEntryPatches } from './options';

/**
 * What the devtools and other consumers need from a timeline. A store with `withTimeline`
 * satisfies it.
 */
export interface TimelineSource {
  /** Every entry of the history tree, the initial state first, in creation order. */
  readonly entries: Signal<readonly TimelineEntry[]>;
  /** The id of the entry the live state matches. */
  readonly currentEntryId: Signal<number>;
  /** The ids of the entries `redo` can move to from the current entry. */
  readonly redoBranches: Signal<readonly number[]>;
  /** True when the current entry has a parent. */
  readonly canUndo: Signal<boolean>;
  /** True when the current entry has at least one child. */
  readonly canRedo: Signal<boolean>;
  /**
   * True while the store is replaying history, from the moment of an undo, redo or jump until
   * the render that runs the effects it scheduled. Read it untracked, or use `skipReplay`.
   */
  readonly isReplaying: Signal<boolean>;
  /** Moves to the parent entry. Does nothing at the initial state. */
  undo(): void;
  /**
   * Moves to a child entry. Without an id it follows the branch visited last. Throws when the
   * id is not a child of the current entry.
   */
  redo(branchId?: number): void;
  /** Moves to any entry, on any branch. Throws for an id that does not exist. */
  jumpTo(entryId: number): void;
  /** Forgets all entries and keeps the current state as the new initial state. */
  clear(): void;
  /** The forward and inverse patch of an entry, or `undefined` for the initial state. */
  entryPatch(entryId: number): TimelineEntryPatches | undefined;
}

/**
 * The methods `withTimeline` adds to a store.
 */
export type TimelineMethods = {
  /** Moves to the parent entry. Does nothing at the initial state. */
  undo(): void;
  /**
   * Moves to a child entry. Without an id it follows the branch visited last. Throws when the
   * id is not a child of the current entry.
   */
  redo(branchId?: number): void;
  /** Moves to any entry, on any branch. Throws for an id that does not exist. */
  jumpTo(entryId: number): void;
  /** Forgets all entries and keeps the current state as the new initial state. */
  clear(): void;
  /**
   * Runs `run` and turns every change it makes into one entry labelled `label`. Nothing is
   * recorded when the net change is empty. If `run` throws, the state is put back and the error
   * is rethrown. `run` must be synchronous: changes made after it returns are separate entries.
   */
  transaction(label: string, run: () => void): void;
  /**
   * Runs `run` and merges every change it makes into one entry, the way one drag becomes one
   * undo step. The entry is dropped if the gesture ends where it started.
   */
  coalesce(key: string, run: () => void): void;
  /**
   * Starts a gesture that spans several event handlers. Changes merge into one entry until
   * `endCoalescing` is called.
   */
  beginCoalescing(key: string): void;
  /** Ends the gesture started with `beginCoalescing`. */
  endCoalescing(): void;
  /** The forward and inverse patch of an entry, or `undefined` for the initial state. */
  entryPatch(entryId: number): TimelineEntryPatches | undefined;
};

/**
 * The signals `withTimeline` adds to a store.
 */
export type TimelineProps = {
  /** Every entry of the history tree, the initial state first, in creation order. */
  readonly entries: Signal<readonly TimelineEntry[]>;
  /** The id of the entry the live state matches. */
  readonly currentEntryId: Signal<number>;
  /** The ids of the entries `redo` can move to from the current entry. */
  readonly redoBranches: Signal<readonly number[]>;
  /** True when the current entry has a parent. */
  readonly canUndo: Signal<boolean>;
  /** True when the current entry has at least one child. */
  readonly canRedo: Signal<boolean>;
  /**
   * True while the store is replaying history, from the moment of an undo, redo or jump until
   * the render that runs the effects it scheduled. Read it untracked, or use `skipReplay`.
   */
  readonly isReplaying: Signal<boolean>;
};
