import { isDevMode } from '@angular/core';
import { findNonPlainValue } from './plain-check';
import type { RecordOptions, RecordResult } from '../core/engine';
import type { PatchPair } from '../core/diff';
import type { TimelineChange } from './options';
import type { ReplayController } from './replay';

export interface RecorderTarget {
  readonly inTransaction: boolean;
  readonly knownSlices: Record<string, unknown>;
  readonly pathOffset: number;
  record(slices: Record<string, unknown>, options: RecordOptions): RecordResult | undefined;
  seal(): void;
  isSettled(id: number): boolean;
  patchOf(id: number): PatchPair | undefined;
}

export interface RecorderConfig<Full extends object> {
  readonly target: RecorderTarget;
  readonly replay: ReplayController;
  readonly trackedKeys: readonly string[];
  readonly label: (change: TimelineChange<Full>) => string;
  readonly coalesceKey: ((change: TimelineChange<Full>) => string | undefined) | undefined;
  readonly initial: Full;
  readonly idleSealMs: number | undefined;
}

export function defaultLabel(keys: readonly string[]): string {
  return keys.length === 0 ? 'Change' : `Change ${keys.join(', ')}`;
}

export class Recorder<Full extends object> {
  private previous: Full;
  private readonly warned = new Set<string>();
  private lastRecordedId: number | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly config: RecorderConfig<Full>) {
    this.previous = config.initial;
    if (isDevMode()) {
      for (const key of config.trackedKeys) {
        this.warnOnNonPlain(key, (config.initial as Record<string, unknown>)[key]);
      }
    }
  }

  pick(state: Full): Record<string, unknown> {
    const slices: Record<string, unknown> = {};
    for (const key of this.config.trackedKeys) {
      slices[key] = (state as Record<string, unknown>)[key];
    }
    return slices;
  }

  observe(state: Full): void {
    const before = this.previous;
    this.previous = state;
    if (this.config.replay.applying) {
      return;
    }
    if (this.config.replay.windowOpen && this.anyKeyChanged(before, state)) {
      this.config.replay.closeNow();
    }
    if (this.config.target.inTransaction) {
      return;
    }
    const changedKeys = this.changedTrackedKeys(state);
    if (changedKeys.length === 0) {
      return;
    }
    const change: TimelineChange<Full> = {
      changedKeys: changedKeys as (keyof Full & string)[],
      before,
      after: state,
    };
    const result = this.config.target.record(this.pick(state), {
      label: this.config.label(change),
      key: this.config.coalesceKey?.(change),
    });
    if (result === undefined) {
      return;
    }
    this.lastRecordedId = result.id;
    if (isDevMode()) {
      queueMicrotask(() => this.checkRecordedEntry(result.id));
    }
    this.sealWhenIdle();
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private sealWhenIdle(): void {
    const { idleSealMs, target } = this.config;
    if (idleSealMs === undefined) {
      return;
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      target.seal();
      if (isDevMode() && this.lastRecordedId !== undefined) {
        this.checkRecordedEntry(this.lastRecordedId);
      }
    }, idleSealMs);
  }

  private changedTrackedKeys(state: Full): string[] {
    const known = this.config.target.knownSlices;
    const incoming = state as Record<string, unknown>;
    return this.config.trackedKeys.filter((key) => !Object.is(known[key], incoming[key]));
  }

  private anyKeyChanged(before: Full, after: Full): boolean {
    const previous = before as Record<string, unknown>;
    const next = after as Record<string, unknown>;
    const keys = Object.keys(next);
    return (
      keys.length !== Object.keys(previous).length ||
      keys.some((key) => !Object.is(previous[key], next[key]))
    );
  }

  private checkRecordedEntry(id: number): void {
    if (!this.config.target.isSettled(id)) {
      return;
    }
    const patches = this.config.target.patchOf(id);
    for (const operation of patches?.forward ?? []) {
      if (operation.op !== 'remove') {
        this.warnOnNonPlain(
          operation.path.split('/')[this.config.target.pathOffset] ?? '',
          operation.value,
        );
      }
    }
  }

  private warnOnNonPlain(key: string, value: unknown): void {
    if (this.warned.has(key)) {
      return;
    }
    const problem = findNonPlainValue(value);
    if (problem !== undefined) {
      this.warned.add(key);
      console.warn(
        `signal-timeline: the tracked key "${key}" is not plain data (${problem}). ` +
          'History needs plain objects, arrays and primitives. Add the key to "skip" or store plain data.',
      );
    }
  }
}
