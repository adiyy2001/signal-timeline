import { computed, signal, type Signal } from '@angular/core';
import { TimelineEngine, TimelineError, type EngineOptions, type Move } from '../core/engine';
import type { NodeView } from '../core/history-tree';
import type { TimelineEntry, TimelineEntryPatches } from './options';
import type { ReplayController } from './replay';
import type { TimelineProps } from './timeline-api';

export interface RuntimeHost<S extends object> {
  read(): S;
  write(changes: Partial<S>): void;
}

export interface RuntimeConfig<S extends object> {
  readonly host: RuntimeHost<S>;
  readonly replay: ReplayController;
  readonly engine?: EngineOptions;
}

function toEntry<S>(node: NodeView<S>): TimelineEntry {
  return {
    id: node.id,
    parentId: node.parentId,
    label: node.label,
    timestamp: node.timestamp,
    children: node.children,
    depth: node.depth,
  };
}

function changedSlices<S extends object>(before: S, after: S): Partial<S> {
  const changes: Partial<S> = {};
  for (const key of Object.keys(after) as (keyof S & string)[]) {
    if (!Object.is(before[key], after[key])) {
      changes[key] = after[key];
    }
  }
  return changes;
}

export class TimelineRuntime<S extends object> {
  readonly engine: TimelineEngine<S>;
  readonly props: TimelineProps;
  private readonly version = signal(0);

  constructor(
    initial: S,
    private readonly config: RuntimeConfig<S>,
  ) {
    this.engine = new TimelineEngine<S>(initial, config.engine);
    this.engine.subscribe(() => this.version.update((value) => value + 1));
    this.props = this.createProps();
  }

  get inTransaction(): boolean {
    return this.engine.transactionDepth > 0;
  }

  undo(): void {
    this.apply(this.engine.undo());
  }

  redo(branchId?: number): void {
    this.apply(this.engine.redo(branchId));
  }

  jumpTo(entryId: number): void {
    this.apply(this.engine.jumpTo(entryId));
  }

  clear(): void {
    this.engine.clear();
  }

  entryPatch(entryId: number): TimelineEntryPatches | undefined {
    return this.engine.patchOf(entryId);
  }

  transaction(label: string, run: () => void): void {
    this.engine.begin(this.config.host.read());
    try {
      run();
    } catch (error) {
      const start = this.engine.rollback();
      this.restore(start);
      throw error;
    }
    this.engine.commit(label, this.config.host.read());
  }

  coalesce(key: string, run: () => void): void {
    this.engine.beginCoalescing(key);
    try {
      run();
    } finally {
      this.engine.endCoalescing();
    }
  }

  beginCoalescing(key: string): void {
    this.engine.beginCoalescing(key);
  }

  endCoalescing(): void {
    this.engine.endCoalescing();
  }

  private restore(target: S): void {
    const live = this.config.host.read();
    const changes = changedSlices(live, target);
    if (Object.keys(changes).length > 0) {
      this.config.replay.run(() => this.config.host.write(changes));
    }
  }

  private apply(move: Move<S> | undefined): void {
    if (move === undefined) {
      return;
    }
    const changes = changedSlices(move.before, move.after);
    if (Object.keys(changes).length > 0) {
      this.config.replay.run(() => this.config.host.write(changes));
    }
  }

  private createProps(): TimelineProps {
    const engine = this.engine;
    const version = this.version;
    const watch = <T>(read: () => T): Signal<T> =>
      computed(() => {
        version();
        return read();
      });
    return {
      entries: watch(() => engine.nodes().map(toEntry)),
      currentEntryId: watch(() => engine.currentId),
      redoBranches: watch(() => engine.redoBranches()),
      canUndo: watch(() => engine.canUndo),
      canRedo: watch(() => engine.canRedo),
      isReplaying: this.config.replay.isReplaying,
    };
  }
}

export function requireKnownKeys(
  option: string,
  keys: readonly string[],
  state: object,
): readonly string[] {
  for (const key of keys) {
    if (!Object.hasOwn(state, key)) {
      throw new TimelineError(`${option} names the unknown state key "${key}"`);
    }
  }
  return keys;
}
