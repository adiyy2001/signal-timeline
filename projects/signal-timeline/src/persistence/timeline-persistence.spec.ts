import { TimelineEngine } from '../core/engine';
import type { TimelinePersistenceOptions } from './adapter';
import { currentFormat, type Slices } from './format';
import { TimelinePersistence } from './timeline-persistence';
import { createAsyncAdapter, createMemoryAdapter } from './testing/memory-adapter';

const initial: Slices = { a: { x: 1 }, b: [1] };

function createEngine(state: Slices = initial): TimelineEngine<Slices> {
  return new TimelineEngine<Slices>(state, { schedule: (task) => task() });
}

function edit(engine: TimelineEngine<Slices>, key: 'a' | 'b', value: unknown): void {
  engine.record({ ...engine.state, [key]: value }, { label: `set ${key}` });
}

function setup(
  options: Partial<TimelinePersistenceOptions> & Pick<TimelinePersistenceOptions, 'adapter'>,
) {
  const engine = createEngine();
  const live = { state: engine.state };
  const applied: Slices[] = [];
  const persistence = new TimelinePersistence(engine, options, {
    keys: ['a', 'b'],
    liveState: () => live.state,
    applyState: (target) => {
      applied.push(target);
      live.state = target;
    },
  });
  return { engine, live, applied, persistence };
}

function saved(): string {
  const source = createEngine();
  edit(source, 'a', { x: 5 });
  edit(source, 'b', [1, 2]);
  source.undo();
  return JSON.stringify({
    format: currentFormat,
    keys: ['a', 'b'],
    ...source.snapshot(),
  });
}

describe('TimelinePersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('saving', () => {
    it('saves nothing until something changes', () => {
      const adapter = createMemoryAdapter();
      const { persistence } = setup({ adapter });
      persistence.start();
      vi.advanceTimersByTime(1000);
      expect(adapter.saves).toBe(0);
    });

    it('saves once, 250 ms after the last change by default', () => {
      const adapter = createMemoryAdapter();
      const { engine, persistence } = setup({ adapter });
      persistence.start();
      edit(engine, 'a', { x: 2 });
      vi.advanceTimersByTime(200);
      edit(engine, 'a', { x: 3 });
      vi.advanceTimersByTime(249);
      expect(adapter.saves).toBe(0);
      vi.advanceTimersByTime(1);
      expect(adapter.saves).toBe(1);
      expect(JSON.parse(adapter.stored ?? '').nodes).toHaveLength(2);
    });

    it('honours debounceMs', () => {
      const adapter = createMemoryAdapter();
      const { engine, persistence } = setup({ adapter, debounceMs: 20 });
      persistence.start();
      edit(engine, 'a', { x: 2 });
      vi.advanceTimersByTime(20);
      expect(adapter.saves).toBe(1);
    });

    it('saves a move through the history as well', () => {
      const adapter = createMemoryAdapter();
      const { engine, persistence } = setup({ adapter, debounceMs: 10 });
      persistence.start();
      edit(engine, 'a', { x: 2 });
      vi.advanceTimersByTime(10);
      engine.undo();
      vi.advanceTimersByTime(10);
      expect(adapter.saves).toBe(2);
      expect(JSON.parse(adapter.stored ?? '').currentId).toBe(engine.rootId);
    });

    it('saves at once when the page is hidden', () => {
      const adapter = createMemoryAdapter();
      const { engine, persistence } = setup({ adapter });
      persistence.start();
      edit(engine, 'a', { x: 2 });
      window.dispatchEvent(new Event('pagehide'));
      expect(adapter.saves).toBe(1);
      vi.advanceTimersByTime(1000);
      expect(adapter.saves).toBe(1);
    });

    it('saves what is pending on dispose and then stops listening', () => {
      const adapter = createMemoryAdapter();
      const { engine, persistence } = setup({ adapter });
      persistence.start();
      edit(engine, 'a', { x: 2 });
      persistence.dispose();
      expect(adapter.saves).toBe(1);
      edit(engine, 'a', { x: 3 });
      vi.advanceTimersByTime(1000);
      window.dispatchEvent(new Event('pagehide'));
      expect(adapter.saves).toBe(1);
    });

    it('does not save when nothing changed since the last save', () => {
      const adapter = createMemoryAdapter();
      const { engine, persistence } = setup({ adapter });
      persistence.start();
      edit(engine, 'a', { x: 2 });
      persistence.flush();
      persistence.flush();
      expect(adapter.saves).toBe(1);
    });

    it('waits for a transaction to end before it saves', () => {
      const adapter = createMemoryAdapter();
      const { engine, persistence } = setup({ adapter, debounceMs: 10 });
      persistence.start();
      edit(engine, 'a', { x: 2 });
      engine.begin(engine.state);
      vi.advanceTimersByTime(10);
      expect(adapter.saves).toBe(0);
      engine.commit('empty', engine.state);
      edit(engine, 'b', [2]);
      vi.advanceTimersByTime(10);
      expect(adapter.saves).toBe(1);
    });

    it('keeps working in memory when the storage is full, and saves again later', () => {
      const adapter = createMemoryAdapter();
      const onError = vi.fn();
      const { engine, persistence } = setup({ adapter, onError, debounceMs: 10 });
      persistence.start();
      adapter.failSaveWith = new Error('QuotaExceededError');
      edit(engine, 'a', { x: 2 });
      vi.advanceTimersByTime(10);
      expect(onError).toHaveBeenCalledWith(adapter.failSaveWith);
      expect(engine.canUndo).toBe(true);
      adapter.failSaveWith = undefined;
      edit(engine, 'a', { x: 3 });
      vi.advanceTimersByTime(10);
      expect(adapter.saves).toBe(1);
    });

    it('reports a rejected asynchronous save', async () => {
      const onError = vi.fn();
      const failure = new Error('network');
      const adapter = {
        load: () => null,
        save: () => Promise.reject(failure),
        remove: () => undefined,
      };
      const { engine, persistence } = setup({ adapter, onError, debounceMs: 1 });
      persistence.start();
      edit(engine, 'a', { x: 2 });
      vi.advanceTimersByTime(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it('writes a console warning when no onError is given', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const adapter = createMemoryAdapter();
      adapter.failSaveWith = new Error('full');
      const { engine, persistence } = setup({ adapter, debounceMs: 1 });
      persistence.start();
      edit(engine, 'a', { x: 2 });
      vi.advanceTimersByTime(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('rehydration', () => {
    it('brings back the history and the current state', () => {
      const adapter = createMemoryAdapter(saved());
      const { engine, live, applied, persistence } = setup({ adapter });
      persistence.start();
      expect(engine.size).toBe(2);
      expect(engine.canUndo).toBe(true);
      expect(engine.state).toEqual({ a: { x: 5 }, b: [1] });
      expect(live.state).toEqual({ a: { x: 5 }, b: [1] });
      expect(applied).toHaveLength(1);
      expect(adapter.saves).toBe(0);
    });

    it('can undo what happened before the reload', () => {
      const adapter = createMemoryAdapter(saved());
      const { engine, persistence } = setup({ adapter });
      persistence.start();
      expect(engine.undo()?.after).toEqual(initial);
      expect(engine.redo()?.after).toEqual({ a: { x: 5 }, b: [1] });
    });

    it('keeps the history only when the stored state equals the live state', () => {
      const adapter = createMemoryAdapter(saved());
      const options = { adapter, rehydrate: 'history-if-state-matches' } as const;
      const matching = setup(options);
      matching.live.state = { a: { x: 5 }, b: [1] };
      matching.persistence.start();
      expect(matching.engine.size).toBe(2);
      expect(matching.applied).toHaveLength(0);
    });

    it('drops the stored history when the live state differs', () => {
      const adapter = createMemoryAdapter(saved());
      const different = setup({ adapter, rehydrate: 'history-if-state-matches' });
      different.persistence.start();
      expect(different.engine.size).toBe(0);
      expect(different.engine.canUndo).toBe(false);
      expect(different.applied).toHaveLength(0);
      expect(adapter.removals).toBe(0);
    });

    it('ignores and removes a corrupt payload and reports it', () => {
      const adapter = createMemoryAdapter('{broken');
      const onError = vi.fn();
      const { engine, persistence } = setup({ adapter, onError });
      persistence.start();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(adapter.removals).toBe(1);
      expect(adapter.stored).toBeNull();
      expect(engine.size).toBe(0);
    });

    it('ignores a payload whose patches do not apply', () => {
      const broken = JSON.parse(saved());
      broken.nodes[0].forward = [{ op: 'remove', path: '/a/missing' }];
      const adapter = createMemoryAdapter(JSON.stringify(broken));
      const onError = vi.fn();
      const { engine, persistence } = setup({ adapter, onError });
      persistence.start();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(adapter.removals).toBe(1);
      expect(engine.size).toBe(0);
    });

    it('ignores a payload with an unknown format', () => {
      const adapter = createMemoryAdapter(JSON.stringify({ ...JSON.parse(saved()), format: 7 }));
      const onError = vi.fn();
      const { engine, persistence } = setup({ adapter, onError });
      persistence.start();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(engine.size).toBe(0);
    });

    it('reads an old format through migrate', () => {
      const old = JSON.stringify({ ...JSON.parse(saved()), format: 0 });
      const adapter = createMemoryAdapter(old);
      const migrate = (payload: unknown) => ({ ...(payload as object), format: currentFormat });
      const { engine, persistence } = setup({ adapter, migrate });
      persistence.start();
      expect(engine.size).toBe(2);
    });

    it('ignores a payload saved for other keys', () => {
      const adapter = createMemoryAdapter(JSON.stringify({ ...JSON.parse(saved()), keys: ['a'] }));
      const onError = vi.fn();
      const { engine, persistence } = setup({ adapter, onError });
      persistence.start();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(engine.size).toBe(0);
    });

    it('reports a failing load and then saves normally', () => {
      const adapter = createMemoryAdapter();
      adapter.failLoadWith = new Error('blocked');
      const onError = vi.fn();
      const { engine, persistence } = setup({ adapter, onError, debounceMs: 1 });
      persistence.start();
      expect(onError).toHaveBeenCalledWith(adapter.failLoadWith);
      edit(engine, 'a', { x: 2 });
      vi.advanceTimersByTime(1);
      expect(adapter.saves).toBe(1);
    });

    it('reports a failing removal', () => {
      const failure = new Error('cannot remove');
      const onError = vi.fn();
      const adapter = {
        load: () => '{broken',
        save: () => undefined,
        remove: () => {
          throw failure;
        },
      };
      setup({ adapter, onError }).persistence.start();
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it('reports a rejected asynchronous removal', async () => {
      const failure = new Error('cannot remove');
      const onError = vi.fn();
      const adapter = {
        load: () => '{broken',
        save: () => undefined,
        remove: () => Promise.reject(failure),
      };
      setup({ adapter, onError }).persistence.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it('reports a failure while writing the restored state and keeps the history', () => {
      const adapter = createMemoryAdapter(saved());
      const onError = vi.fn();
      const engine = createEngine();
      const persistence = new TimelinePersistence(
        engine,
        { adapter, onError },
        {
          keys: ['a', 'b'],
          liveState: () => initial,
          applyState: () => {
            throw new Error('write failed');
          },
        },
      );
      persistence.start();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(engine.size).toBe(2);
    });
  });

  describe('asynchronous adapters', () => {
    it('rehydrates when the load resolves and saves only afterwards', async () => {
      const memory = createMemoryAdapter(saved());
      const adapter = createAsyncAdapter(memory);
      const { engine, persistence } = setup({ adapter, debounceMs: 1 });
      persistence.start();
      expect(engine.size).toBe(0);
      adapter.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(engine.size).toBe(2);
      edit(engine, 'b', [9]);
      await vi.advanceTimersByTimeAsync(1);
      adapter.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(memory.saves).toBe(1);
    });

    it('does not overwrite the stored history while the load is pending', async () => {
      const memory = createMemoryAdapter(saved());
      const adapter = createAsyncAdapter(memory);
      const { engine, persistence } = setup({ adapter, debounceMs: 1 });
      persistence.start();
      edit(engine, 'a', { x: 9 });
      await vi.advanceTimersByTimeAsync(5);
      adapter.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(memory.saves).toBe(0);
      expect(engine.size).toBe(1);
    });

    it('reports a rejected load', async () => {
      const onError = vi.fn();
      const failure = new Error('offline');
      const adapter = {
        load: () => Promise.reject(failure),
        save: () => undefined,
        remove: () => undefined,
      };
      const { engine, persistence } = setup({ adapter, onError, debounceMs: 1 });
      persistence.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(onError).toHaveBeenCalledWith(failure);
      edit(engine, 'a', { x: 2 });
      await vi.advanceTimersByTimeAsync(1);
    });

    it('ignores a load that resolves after dispose', async () => {
      const memory = createMemoryAdapter(saved());
      const adapter = createAsyncAdapter(memory);
      const { engine, persistence } = setup({ adapter });
      persistence.start();
      persistence.dispose();
      adapter.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(engine.size).toBe(0);
    });
  });
});
