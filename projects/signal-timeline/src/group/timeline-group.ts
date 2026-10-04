import { DestroyRef, inject, Injector } from '@angular/core';
import { TimelineError, type RecordOptions, type RecordResult } from '../core/engine';
import type { PatchPair } from '../core/diff';
import type { TimelinePersistenceOptions } from '../persistence/adapter';
import { TimelinePersistence } from '../persistence/timeline-persistence';
import type { RecorderTarget } from '../store/recorder';
import { closeAfterNextRender, ReplayController } from '../store/replay';
import { TimelineRuntime } from '../store/runtime';
import type { TimelineMethods, TimelineProps, TimelineSource } from '../store/timeline-api';

type Slices = Record<string, unknown>;
type Composite = Record<string, Slices>;

/**
 * Options for `provideTimelineGroup`. They apply to the one history all member stores share.
 */
export type TimelineGroupOptions = {
  /** The most entries kept, the initial state excluded. */
  readonly maxEntries?: number;
  /** A full copy of the state is kept at every entry whose depth is a multiple of this number. */
  readonly checkpointEvery?: number;
  /** Changes within this many milliseconds of each other join one entry. */
  readonly coalesce?: { readonly windowMs?: number };
} & (
  | { readonly persistence?: undefined; readonly stores?: undefined }
  | {
      /** Saves and restores the shared history. */
      readonly persistence: TimelinePersistenceOptions;
      /**
       * The store keys of every member. History is restored once all of them have joined, and
       * a store with another key is rejected, so a payload is never applied to the wrong stores.
       */
      readonly stores: readonly string[];
    }
);

export interface GroupMember {
  readonly storeKey: string;
  read(): Slices;
  write(slices: Slices): void;
}

export interface GroupMembership {
  readonly target: RecorderTarget;
  readonly replay: ReplayController;
  readonly control: TimelineRuntime<Composite>;
  readonly idleSealMs: number | undefined;
  activate(): void;
  leave(): void;
}

/**
 * One timeline shared by several stores. Provide it with `provideTimelineGroup()` in the
 * injector the stores live in, and add `withTimeline({ group: true, storeKey })` to each store.
 * One `undo` then reverts everything a `group.transaction` changed across all of them.
 *
 * A store that joins after changes were made starts at its current state. The history before it
 * joined treats that state as constant.
 */
export class TimelineGroup implements TimelineSource, TimelineMethods {
  private readonly members = new Map<string, GroupMember>();
  private readonly retired = new Set<string>();
  private readonly replay: ReplayController;
  private readonly runtime: TimelineRuntime<Composite>;
  private readonly windowMs: number | undefined;
  private persistence: TimelinePersistence | undefined;

  readonly entries: TimelineProps['entries'];
  readonly currentEntryId: TimelineProps['currentEntryId'];
  readonly redoBranches: TimelineProps['redoBranches'];
  readonly canUndo: TimelineProps['canUndo'];
  readonly canRedo: TimelineProps['canRedo'];
  readonly isReplaying: TimelineProps['isReplaying'];

  constructor(private readonly options: TimelineGroupOptions = {}) {
    const injector = inject(Injector);
    this.windowMs = options.coalesce?.windowMs;
    if (options.persistence !== undefined && (options.stores ?? []).length === 0) {
      throw new TimelineError('Group persistence needs the list of store keys in "stores"');
    }
    this.replay = new ReplayController(closeAfterNextRender(injector));
    this.runtime = new TimelineRuntime<Composite>(
      {},
      {
        host: { read: () => this.readAll(), write: (changes) => this.writeAll(changes) },
        replay: this.replay,
        engine: {
          maxEntries: options.maxEntries,
          checkpointEvery: options.checkpointEvery,
          coalesceWindowMs: this.windowMs,
        },
      },
    );
    const { props } = this.runtime;
    this.entries = props.entries;
    this.currentEntryId = props.currentEntryId;
    this.redoBranches = props.redoBranches;
    this.canUndo = props.canUndo;
    this.canRedo = props.canRedo;
    this.isReplaying = props.isReplaying;
    inject(DestroyRef).onDestroy(() => this.persistence?.dispose());
  }

  undo(): void {
    this.runtime.undo();
  }

  redo(branchId?: number): void {
    this.runtime.redo(branchId);
  }

  jumpTo(entryId: number): void {
    this.runtime.jumpTo(entryId);
  }

  clear(): void {
    this.runtime.clear();
  }

  entryPatch(entryId: number): ReturnType<TimelineSource['entryPatch']> {
    return this.runtime.entryPatch(entryId);
  }

  /**
   * Runs `run` and turns every change it makes, in any member store, into one entry. Nothing is
   * recorded when the net change is empty. If `run` throws, every store is put back.
   */
  transaction(label: string, run: () => void): void {
    this.runtime.transaction(label, run);
  }

  coalesce(key: string, run: () => void): void {
    this.runtime.coalesce(key, run);
  }

  beginCoalescing(key: string): void {
    this.runtime.beginCoalescing(key);
  }

  endCoalescing(): void {
    this.runtime.endCoalescing();
  }

  /**
   * Adds a store to the group. `withTimeline` calls it, application code does not.
   *
   * @internal
   */
  join(member: GroupMember): GroupMembership {
    const { storeKey } = member;
    this.admit(storeKey);
    this.runtime.engine.addRootKey(storeKey, member.read());
    this.members.set(storeKey, member);
    return {
      target: this.targetFor(storeKey),
      replay: this.replay,
      control: this.runtime,
      idleSealMs: this.windowMs,
      activate: () => this.startPersistenceWhenComplete(),
      leave: () => this.leave(storeKey),
    };
  }

  private admit(storeKey: string): void {
    if (this.members.has(storeKey)) {
      throw new TimelineError(`Another store in the group already uses the storeKey "${storeKey}"`);
    }
    if (this.retired.has(storeKey)) {
      throw new TimelineError(
        `The storeKey "${storeKey}" belonged to a store that was destroyed. Use a new key.`,
      );
    }
    const expected = this.options.stores;
    if (expected !== undefined && !expected.includes(storeKey)) {
      throw new TimelineError(`The storeKey "${storeKey}" is not in the group option "stores"`);
    }
  }

  private leave(storeKey: string): void {
    this.members.delete(storeKey);
    this.retired.add(storeKey);
  }

  private startPersistenceWhenComplete(): void {
    const { persistence, stores } = this.options;
    if (persistence === undefined || stores === undefined || this.persistence !== undefined) {
      return;
    }
    if (!stores.every((key) => this.members.has(key))) {
      return;
    }
    this.persistence = new TimelinePersistence(this.runtime.engine, persistence, {
      keys: stores,
      liveState: () => this.readAll(),
      applyState: (target) => this.runtime.writeState(target as Composite),
    });
    this.persistence.start();
  }

  private readAll(): Composite {
    const composite: Composite = {};
    const known = this.runtime.engine.state;
    for (const key of Object.keys(known)) {
      composite[key] = this.members.get(key)?.read() ?? known[key] ?? {};
    }
    return composite;
  }

  private writeAll(changes: Partial<Composite>): void {
    const failures: unknown[] = [];
    for (const key of Object.keys(this.runtime.engine.state)) {
      const slices = changes[key];
      const member = this.members.get(key);
      if (slices !== undefined && member !== undefined) {
        try {
          member.write(slices);
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length > 0) {
      throw failures[0];
    }
  }

  private targetFor(storeKey: string): RecorderTarget {
    const engine = this.runtime.engine;
    const runtime = this.runtime;
    return {
      get inTransaction(): boolean {
        return runtime.inTransaction;
      },
      get knownSlices(): Slices {
        return engine.state[storeKey] ?? {};
      },
      pathOffset: 2,
      record(slices: Slices, options: RecordOptions): RecordResult | undefined {
        return engine.record({ ...engine.state, [storeKey]: slices }, options);
      },
      seal: () => engine.seal(),
      isSettled: (id) => {
        const node = engine.node(id);
        return node !== undefined && !node.open;
      },
      patchOf: (id): PatchPair | undefined => engine.patchOf(id),
    };
  }
}
