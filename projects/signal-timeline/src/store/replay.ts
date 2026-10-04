import { afterNextRender, signal, untracked, type Injector, type Signal } from '@angular/core';
import { filter, type MonoTypeOperatorFunction } from 'rxjs';

export type WindowCloser = (close: () => void) => void;

export class ReplayController {
  private readonly open = signal(false);
  private applyingDepth = 0;
  private closeScheduled = false;
  private generation = 0;
  readonly isReplaying: Signal<boolean> = this.open.asReadonly();

  constructor(private readonly closeWhenRendered: WindowCloser) {}

  get applying(): boolean {
    return this.applyingDepth > 0;
  }

  get windowOpen(): boolean {
    return untracked(this.open);
  }

  run(write: () => void): void {
    this.applyingDepth += 1;
    try {
      this.openWindow();
      write();
    } finally {
      this.applyingDepth -= 1;
    }
  }

  closeNow(): void {
    this.generation += 1;
    this.closeScheduled = false;
    this.open.set(false);
  }

  private openWindow(): void {
    this.open.set(true);
    if (this.closeScheduled) {
      return;
    }
    this.closeScheduled = true;
    const generation = this.generation;
    this.closeWhenRendered(() => {
      if (generation === this.generation) {
        this.closeNow();
      }
    });
  }
}

export function closeAfterNextRender(injector: Injector): WindowCloser {
  return (close) => {
    try {
      afterNextRender(close, { injector });
    } catch {
      queueMicrotask(close);
    }
  };
}

/**
 * Anything that reports whether history is being replayed. A store with `withTimeline` and a
 * `TimelineGroup` both qualify.
 */
export interface ReplayAware {
  /** True while history is replayed, until the render that runs the effects it scheduled. */
  readonly isReplaying: Signal<boolean>;
}

/**
 * Runs `run` unless the store is replaying history. Use it inside an `effect` or a
 * `signalMethod` for work that must not repeat when the user undoes or redoes.
 * The flag is read untracked, so the effect does not depend on it.
 */
export function skipReplay(store: ReplayAware, run: () => void): void {
  if (!untracked(store.isReplaying)) {
    run();
  }
}

/**
 * An RxJS operator that drops values while the store is replaying history.
 * Put it at the start of the pipe of an `rxMethod`.
 */
export function ignoreReplays<T>(store: ReplayAware): MonoTypeOperatorFunction<T> {
  return filter(() => !untracked(store.isReplaying));
}
