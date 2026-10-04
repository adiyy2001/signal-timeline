import type { Signal } from '@angular/core';
import type { TimelineEntry, TimelineEntryPatches } from './options';

/**
 * What the devtools and other consumers need from a timeline.
 */
export interface TimelineSource {
  readonly entries: Signal<readonly TimelineEntry[]>;
  readonly currentEntryId: Signal<number>;
  readonly redoBranches: Signal<readonly number[]>;
  readonly canUndo: Signal<boolean>;
  readonly canRedo: Signal<boolean>;
  readonly isReplaying: Signal<boolean>;
  undo(): void;
  redo(branchId?: number): void;
  jumpTo(entryId: number): void;
  clear(): void;
  entryPatch(entryId: number): TimelineEntryPatches | undefined;
}

/**
 * The members `withTimeline` adds to a store.
 */
export type TimelineMethods = {
  undo(): void;
  redo(branchId?: number): void;
  jumpTo(entryId: number): void;
  clear(): void;
  transaction(label: string, run: () => void): void;
  coalesce(key: string, run: () => void): void;
  beginCoalescing(key: string): void;
  endCoalescing(): void;
  entryPatch(entryId: number): TimelineEntryPatches | undefined;
};

export type TimelineProps = {
  readonly entries: Signal<readonly TimelineEntry[]>;
  readonly currentEntryId: Signal<number>;
  readonly redoBranches: Signal<readonly number[]>;
  readonly canUndo: Signal<boolean>;
  readonly canRedo: Signal<boolean>;
  readonly isReplaying: Signal<boolean>;
};
