import type { TimelinePersistenceAdapter } from '../adapter';

export interface MemoryAdapter extends TimelinePersistenceAdapter {
  stored: string | null;
  saves: number;
  removals: number;
  failSaveWith: Error | undefined;
  failLoadWith: Error | undefined;
}

export function createMemoryAdapter(initial: string | null = null): MemoryAdapter {
  const adapter: MemoryAdapter = {
    stored: initial,
    saves: 0,
    removals: 0,
    failSaveWith: undefined,
    failLoadWith: undefined,
    load() {
      if (adapter.failLoadWith !== undefined) {
        throw adapter.failLoadWith;
      }
      return adapter.stored;
    },
    save(value) {
      if (adapter.failSaveWith !== undefined) {
        throw adapter.failSaveWith;
      }
      adapter.saves += 1;
      adapter.stored = value;
    },
    remove() {
      adapter.removals += 1;
      adapter.stored = null;
    },
  };
  return adapter;
}

export function createAsyncAdapter(inner: MemoryAdapter): TimelinePersistenceAdapter & {
  release(): void;
} {
  const waiting: (() => void)[] = [];
  const wait = (): Promise<void> =>
    new Promise((resolve) => {
      waiting.push(resolve);
    });
  return {
    async load() {
      await wait();
      return inner.load();
    },
    async save(value) {
      await wait();
      inner.save(value);
    },
    async remove() {
      await wait();
      inner.remove();
    },
    release() {
      for (const resolve of waiting.splice(0)) {
        resolve();
      }
    },
  };
}
