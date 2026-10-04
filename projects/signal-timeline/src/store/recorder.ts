import { isDevMode } from '@angular/core';
import { findNonPlainValue } from './plain-check';
import type { TimelineChange } from './options';
import type { ReplayController } from './replay';
import type { TimelineRuntime } from './runtime';

export interface RecorderConfig<Full extends object> {
  readonly runtime: TimelineRuntime<Record<string, unknown>>;
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
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly config: RecorderConfig<Full>) {
    this.previous = config.initial;
    if (isDevMode()) {
      this.warnOnNonPlain(config.trackedKeys, config.initial);
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
    if (this.config.runtime.inTransaction) {
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
    const result = this.config.runtime.engine.record(this.pick(state), {
      label: this.config.label(change),
      key: this.config.coalesceKey?.(change),
    });
    if (result === undefined) {
      return;
    }
    if (isDevMode()) {
      this.warnOnNonPlain(changedKeys, state);
    }
    this.sealWhenIdle();
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private sealWhenIdle(): void {
    const { idleSealMs, runtime } = this.config;
    if (idleSealMs === undefined) {
      return;
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      runtime.engine.seal();
    }, idleSealMs);
  }

  private changedTrackedKeys(state: Full): string[] {
    const known = this.config.runtime.engine.state;
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

  private warnOnNonPlain(keys: readonly string[], state: Full): void {
    for (const key of keys) {
      if (this.warned.has(key)) {
        continue;
      }
      const problem = findNonPlainValue((state as Record<string, unknown>)[key]);
      if (problem !== undefined) {
        this.warned.add(key);
        console.warn(
          `signal-timeline: the tracked key "${key}" is not plain data (${problem}). ` +
            'History needs plain objects, arrays and primitives. Add the key to "skip" or store plain data.',
        );
      }
    }
  }
}
