import { deepEqual } from '../core/equal';
import type { TimelineEngine } from '../core/engine';
import type { TimelinePersistenceOptions } from './adapter';
import { parseSnapshot, serializeSnapshot, type Slices } from './format';

export interface PersistenceHost {
  readonly keys: readonly string[];
  liveState(): Slices;
  applyState(target: Slices): void;
}

const defaultDebounceMs = 250;

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return typeof value === 'object' && value !== null && 'then' in value;
}

function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export class TimelinePersistence {
  private ready = false;
  private dirty = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly onPageHide = (): void => this.flush();

  constructor(
    private readonly engine: TimelineEngine<Slices>,
    private readonly options: TimelinePersistenceOptions,
    private readonly host: PersistenceHost,
  ) {}

  start(): void {
    this.unsubscribe = this.engine.subscribe(() => this.markDirty());
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
    }
    this.rehydrate();
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.ready && this.dirty && !this.disposed) {
      this.save();
    }
  }

  dispose(): void {
    this.flush();
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
    }
  }

  private markDirty(): void {
    if (!this.ready) {
      return;
    }
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.options.debounceMs ?? defaultDebounceMs);
  }

  private rehydrate(): void {
    const startVersion = this.engine.version;
    let loaded: string | null | PromiseLike<string | null>;
    try {
      loaded = this.options.adapter.load();
    } catch (error) {
      this.report(error);
      this.finishRehydration();
      return;
    }
    if (!isPromiseLike(loaded)) {
      this.adopt(loaded);
      this.finishRehydration();
      return;
    }
    loaded.then(
      (text) => {
        if (!this.disposed && this.engine.version === startVersion) {
          this.adopt(text);
        }
        this.finishRehydration();
      },
      (error: unknown) => {
        this.report(error);
        this.finishRehydration();
      },
    );
  }

  private finishRehydration(): void {
    this.ready = true;
    this.dirty = false;
  }

  private adopt(text: string | null): void {
    if (text === null) {
      return;
    }
    const before = this.engine.snapshot();
    try {
      const snapshot = parseSnapshot(text, { keys: this.host.keys, migrate: this.options.migrate });
      this.engine.load(snapshot);
    } catch (error) {
      this.report(error);
      this.discardStored();
      return;
    }
    if (this.options.rehydrate === 'history-if-state-matches') {
      if (!deepEqual(jsonRoundTrip(this.host.liveState()), this.engine.state)) {
        this.engine.load(before);
      }
      return;
    }
    try {
      this.host.applyState(this.engine.state);
    } catch (error) {
      this.report(error);
    }
  }

  private save(): void {
    this.dirty = false;
    if (this.engine.transactionDepth > 0) {
      this.dirty = true;
      return;
    }
    try {
      const text = serializeSnapshot(this.engine.snapshot(), this.host.keys);
      const result = this.options.adapter.save(text);
      if (result !== undefined && isPromiseLike(result)) {
        result.then(undefined, (error: unknown) => this.report(error));
      }
    } catch (error) {
      this.report(error);
    }
  }

  private discardStored(): void {
    try {
      const result = this.options.adapter.remove();
      if (result !== undefined && isPromiseLike(result)) {
        result.then(undefined, (error: unknown) => this.report(error));
      }
    } catch (error) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    if (this.options.onError !== undefined) {
      this.options.onError(error);
      return;
    }
    console.warn('signal-timeline: persistence failed', error);
  }
}
