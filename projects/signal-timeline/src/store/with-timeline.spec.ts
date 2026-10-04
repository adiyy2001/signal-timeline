import { TestBed } from '@angular/core/testing';
import { getState, patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { TimelineError } from '../core/engine';
import type { TimelineOptions } from './options';
import { createCounterStore, initialCounter, type CounterState } from './testing/stores';
import { withTimeline } from './with-timeline';

function setup(options: TimelineOptions<CounterState> = {}) {
  const Store = createCounterStore(options);
  return TestBed.inject(Store);
}

describe('withTimeline', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts with the initial entry only', () => {
      const store = setup();
      expect(store.entries().map((entry) => entry.label)).toEqual(['Initial state']);
      expect(store.currentEntryId()).toBe(store.entries()[0]?.id);
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);
      expect(store.isReplaying()).toBe(false);
      expect(store.redoBranches()).toEqual([]);
    });

    it('does nothing on undo, redo and clear of an untouched history', () => {
      const store = setup();
      store.undo();
      store.redo();
      store.clear();
      expect(store.entries()).toHaveLength(1);
      expect(getState(store)).toEqual(initialCounter);
    });
  });

  describe('recording', () => {
    it('creates an entry per patchState and updates the signals at once', () => {
      const store = setup();
      store.setCount(1);
      expect(store.canUndo()).toBe(true);
      expect(store.entries()).toHaveLength(2);
      expect(store.currentEntryId()).toBe(store.entries()[1]?.id);
      store.setCount(2);
      expect(store.entries()).toHaveLength(3);
    });

    it('creates no entry when nothing changed', () => {
      const store = setup();
      store.setCount(0);
      patchState(store, {});
      expect(store.entries()).toHaveLength(1);
    });

    it('records one entry for a patch that touches several keys', () => {
      const store = setup();
      store.both(5, 'five');
      expect(store.entries()).toHaveLength(2);
      store.undo();
      expect(store.count()).toBe(0);
      expect(store.title()).toBe('start');
    });

    it('labels entries with the changed keys by default', () => {
      const store = setup();
      store.setCount(1);
      store.both(2, 'two');
      expect(store.entries().map((entry) => entry.label)).toEqual([
        'Initial state',
        'Change count',
        'Change count, title',
      ]);
    });

    it('uses the label function with the change', () => {
      const store = setup({
        label: ({ changedKeys, before, after }) =>
          `${changedKeys.join('+')}: ${before.count} to ${after.count}`,
      });
      store.setCount(3);
      expect(store.entries()[1]?.label).toBe('count: 0 to 3');
    });

    it('restores nested state and arrays', () => {
      const store = setup();
      store.setDeep(9);
      store.addTag('a');
      store.addTag('b');
      expect(store.nested.deep.value()).toBe(9);
      store.undo();
      expect(store.tags()).toEqual(['a']);
      store.undo();
      store.undo();
      expect(store.nested.deep.value()).toBe(1);
      expect(store.tags()).toEqual([]);
      store.redo();
      store.redo();
      store.redo();
      expect(getState(store).tags).toEqual(['a', 'b']);
      expect(store.nested.deep.value()).toBe(9);
    });

    it('restores the exact references of untouched slices', () => {
      const store = setup();
      const nested = getState(store).nested;
      store.setCount(1);
      store.undo();
      store.redo();
      expect(getState(store).nested).toBe(nested);
    });

    it('records patchState calls made in an effect or a method alike', () => {
      const store = setup();
      TestBed.runInInjectionContext(() => patchState(store, { title: 'x' }));
      expect(store.entries()).toHaveLength(2);
    });

    it('does not record the writes of an undo', () => {
      const store = setup();
      store.setCount(1);
      store.undo();
      expect(store.entries()).toHaveLength(2);
      expect(store.canRedo()).toBe(true);
    });
  });

  describe('tracked keys', () => {
    it('records only the keys in track', () => {
      const store = setup({ track: ['count'] });
      store.setTitle('changed');
      expect(store.entries()).toHaveLength(1);
      store.setCount(1);
      expect(store.entries()).toHaveLength(2);
    });

    it('records everything except the keys in skip', () => {
      const store = setup({ skip: ['title'] });
      store.setTitle('changed');
      expect(store.entries()).toHaveLength(1);
      store.setCount(1);
      expect(store.entries()).toHaveLength(2);
    });

    it('leaves untracked keys alone on undo and redo', () => {
      const store = setup({ track: ['count'] });
      store.setCount(1);
      store.setTitle('kept');
      store.setCount(2);
      store.undo();
      expect(store.count()).toBe(1);
      expect(store.title()).toBe('kept');
      store.undo();
      store.redo();
      store.redo();
      expect(store.count()).toBe(2);
      expect(store.title()).toBe('kept');
    });

    it('treats a change to a tracked and an untracked key as one tracked change', () => {
      const store = setup({ track: ['count'] });
      patchState(store, { count: 4, title: 'both' });
      expect(store.entries()).toHaveLength(2);
      store.undo();
      expect(store.count()).toBe(0);
      expect(store.title()).toBe('both');
    });

    it('rejects an unknown key at runtime', () => {
      const unknown = { track: ['missing'] } as unknown as TimelineOptions<CounterState>;
      expect(() => setup(unknown)).toThrow(TimelineError);
      expect(() =>
        setup({ skip: ['missing'] } as unknown as TimelineOptions<CounterState>),
      ).toThrow('unknown state key');
    });

    it('rejects track and skip together at runtime', () => {
      const both = {
        track: ['count'],
        skip: ['title'],
      } as unknown as TimelineOptions<CounterState>;
      expect(() => setup(both)).toThrow('either track or skip');
    });
  });

  describe('limits', () => {
    it('keeps at most maxEntries entries and moves the start forward', () => {
      const store = setup({ maxEntries: 3 });
      for (let value = 1; value <= 6; value += 1) {
        store.setCount(value);
      }
      expect(store.entries()).toHaveLength(4);
      for (let step = 0; step < 6; step += 1) {
        store.undo();
      }
      expect(store.count()).toBe(3);
      expect(store.canUndo()).toBe(false);
    });

    it('rejects a maxEntries below one', () => {
      expect(() => setup({ maxEntries: 0 })).toThrow(TimelineError);
    });

    it('keeps jumps correct with a small checkpoint interval', () => {
      const store = setup({ checkpointEvery: 2 });
      for (let value = 1; value <= 9; value += 1) {
        store.setCount(value);
      }
      const ids = store.entries().map((entry) => entry.id);
      store.jumpTo(ids[3] as number);
      expect(store.count()).toBe(3);
      store.jumpTo(ids[9] as number);
      expect(store.count()).toBe(9);
      store.jumpTo(ids[0] as number);
      expect(store.count()).toBe(0);
    });
  });

  describe('coalescing', () => {
    it('merges changes with the same key into one entry', () => {
      const store = setup({ coalesce: { key: ({ changedKeys }) => changedKeys[0] } });
      store.setCount(1);
      store.setCount(2);
      store.setCount(3);
      expect(store.entries()).toHaveLength(2);
      store.setTitle('new');
      expect(store.entries()).toHaveLength(3);
      store.undo();
      store.undo();
      expect(store.count()).toBe(0);
    });

    it('does not merge when the key function returns undefined', () => {
      const store = setup({ coalesce: { key: () => undefined } });
      store.setCount(1);
      store.setCount(2);
      expect(store.entries()).toHaveLength(3);
    });

    it('merges changes inside the time window and seals the entry when it passes', () => {
      vi.useFakeTimers();
      const store = setup({ coalesce: { windowMs: 100 } });
      store.setCount(1);
      vi.advanceTimersByTime(50);
      store.setCount(2);
      vi.advanceTimersByTime(50);
      store.setCount(3);
      expect(store.entries()).toHaveLength(2);
      vi.advanceTimersByTime(200);
      store.setCount(4);
      expect(store.entries()).toHaveLength(3);
      store.undo();
      expect(store.count()).toBe(3);
      store.undo();
      expect(store.count()).toBe(0);
    });

    it('materializes an idle window entry by itself', () => {
      vi.useFakeTimers();
      const store = setup({ coalesce: { windowMs: 100 } });
      store.setCount(1);
      vi.advanceTimersByTime(150);
      expect(store.entryPatch(store.entries()[1]?.id as number)?.forward).toEqual([
        { op: 'replace', path: '/count', value: 1 },
      ]);
    });

    it('merges everything inside coalesce(key, fn) into one entry', () => {
      const store = setup();
      store.coalesce('drag', () => {
        store.setCount(1);
        store.setCount(2);
        store.setCount(3);
      });
      expect(store.entries()).toHaveLength(2);
      store.coalesce('drag', () => {
        store.setCount(4);
      });
      expect(store.entries()).toHaveLength(3);
    });

    it('ends the gesture when the callback throws', () => {
      const store = setup();
      expect(() =>
        store.coalesce('drag', () => {
          store.setCount(1);
          throw new Error('boom');
        }),
      ).toThrow('boom');
      store.setCount(2);
      expect(store.entries()).toHaveLength(3);
    });

    it('supports a gesture across separate calls', () => {
      const store = setup();
      store.beginCoalescing('resize');
      store.setCount(1);
      store.setCount(2);
      store.endCoalescing();
      expect(store.entries()).toHaveLength(2);
      store.undo();
      expect(store.count()).toBe(0);
    });

    it('drops a gesture that ends where it started', () => {
      const store = setup();
      store.coalesce('drag', () => {
        store.setCount(1);
        store.setCount(0);
      });
      expect(store.entries()).toHaveLength(1);
      expect(store.canUndo()).toBe(false);
    });

    it('rejects endCoalescing without a gesture', () => {
      const store = setup();
      expect(() => store.endCoalescing()).toThrow(TimelineError);
    });
  });

  describe('transactions', () => {
    it('turns several patchState calls into one entry with the given label', () => {
      const store = setup();
      store.transaction('rename and count', () => {
        store.setCount(1);
        store.setTitle('t');
        store.addTag('x');
      });
      expect(store.entries()).toHaveLength(2);
      expect(store.entries()[1]?.label).toBe('rename and count');
      store.undo();
      expect(getState(store)).toEqual(initialCounter);
      store.redo();
      expect(store.count()).toBe(1);
      expect(store.tags()).toEqual(['x']);
    });

    it('creates no entry when the transaction changes nothing', () => {
      const store = setup();
      store.transaction('noop', () => undefined);
      store.transaction('there and back', () => {
        store.setCount(1);
        store.setCount(0);
      });
      expect(store.entries()).toHaveLength(1);
      store.setCount(2);
      expect(store.entries()).toHaveLength(2);
    });

    it('joins nested transactions to the outer one', () => {
      const store = setup();
      store.transaction('outer', () => {
        store.setCount(1);
        store.transaction('inner', () => {
          store.setTitle('t');
        });
        store.setCount(2);
      });
      expect(store.entries()).toHaveLength(2);
      expect(store.entries()[1]?.label).toBe('outer');
    });

    it('restores the state and records nothing when the callback throws', () => {
      const store = setup();
      store.setCount(1);
      expect(() =>
        store.transaction('failing', () => {
          store.setCount(2);
          store.setTitle('half');
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(store.count()).toBe(1);
      expect(store.title()).toBe('start');
      expect(store.entries()).toHaveLength(2);
      store.setCount(3);
      expect(store.entries()).toHaveLength(3);
    });

    it('does not record changes of untracked keys made inside a transaction', () => {
      const store = setup({ track: ['count'] });
      store.transaction('only title', () => {
        store.setTitle('x');
      });
      expect(store.entries()).toHaveLength(1);
    });

    it('rejects undo, redo, jumpTo and clear inside a transaction', () => {
      const store = setup();
      store.setCount(1);
      store.transaction('t', () => {
        expect(() => store.undo()).toThrow(TimelineError);
        expect(() => store.redo()).toThrow(TimelineError);
        expect(() => store.jumpTo(1)).toThrow(TimelineError);
        expect(() => store.clear()).toThrow(TimelineError);
      });
    });

    it('seals an open gesture before it starts', () => {
      const store = setup({ coalesce: { key: () => 'k' } });
      store.setCount(1);
      store.transaction('t', () => {
        store.setCount(2);
      });
      store.setCount(3);
      expect(store.entries().map((entry) => entry.label)).toEqual([
        'Initial state',
        'Change count',
        't',
        'Change count',
      ]);
    });
  });

  describe('branches and jumps', () => {
    it('starts a branch instead of dropping the redo history', () => {
      const store = setup();
      store.setCount(1);
      store.setCount(2);
      store.undo();
      store.setCount(30);
      const entries = store.entries();
      expect(entries).toHaveLength(4);
      const fork = entries[1];
      expect(fork?.children).toHaveLength(2);
      store.undo();
      expect(store.redoBranches()).toEqual(fork?.children);
    });

    it('redo follows the last visited branch and redo(branchId) picks another', () => {
      const store = setup();
      store.setCount(1);
      store.setCount(2);
      store.undo();
      store.setCount(30);
      store.undo();
      store.redo();
      expect(store.count()).toBe(30);
      store.undo();
      const [older] = store.redoBranches();
      store.redo(older);
      expect(store.count()).toBe(2);
    });

    it('rejects redo into an entry that is not a branch of the current one', () => {
      const store = setup();
      store.setCount(1);
      expect(() => store.redo(999)).toThrow(TimelineError);
    });

    it('jumps across branches and back', () => {
      const store = setup();
      store.setCount(1);
      store.setCount(2);
      store.undo();
      store.setCount(30);
      const ids = store.entries().map((entry) => entry.id);
      store.jumpTo(ids[2] as number);
      expect(store.count()).toBe(2);
      store.jumpTo(ids[3] as number);
      expect(store.count()).toBe(30);
      store.jumpTo(ids[0] as number);
      expect(getState(store)).toEqual(initialCounter);
      expect(store.currentEntryId()).toBe(ids[0]);
    });

    it('rejects an unknown entry', () => {
      const store = setup();
      expect(() => store.jumpTo(999)).toThrow(TimelineError);
    });

    it('jumping to the current entry changes nothing', () => {
      const store = setup();
      store.setCount(1);
      store.jumpTo(store.currentEntryId());
      expect(store.isReplaying()).toBe(false);
    });
  });

  describe('clear and patches', () => {
    it('forgets the history and keeps the state', () => {
      const store = setup();
      store.setCount(1);
      store.setCount(2);
      store.clear();
      expect(store.entries()).toHaveLength(1);
      expect(store.count()).toBe(2);
      expect(store.canUndo()).toBe(false);
      store.setCount(3);
      store.undo();
      expect(store.count()).toBe(2);
    });

    it('exposes the forward and inverse patch of an entry', () => {
      const store = setup();
      store.setDeep(5);
      const id = store.entries()[1]?.id as number;
      expect(store.entryPatch(id)).toEqual({
        forward: [{ op: 'replace', path: '/nested/deep/value', value: 5 }],
        inverse: [{ op: 'replace', path: '/nested/deep/value', value: 1 }],
      });
    });

    it('has no patch for the initial entry or an unknown entry', () => {
      const store = setup();
      expect(store.entryPatch(store.entries()[0]?.id as number)).toBeUndefined();
      expect(store.entryPatch(999)).toBeUndefined();
    });

    it('computes patches for entries that are still pending', () => {
      const store = setup();
      store.setCount(1);
      store.setCount(2);
      expect(store.entryPatch(store.entries()[2]?.id as number)?.forward).toEqual([
        { op: 'replace', path: '/count', value: 2 },
      ]);
    });
  });

  describe('lifecycle', () => {
    it('keeps the history of separate store instances apart', () => {
      const Store = signalStore(
        withState({ count: 0 }),
        withTimeline(),
        withMethods((store) => ({ set: (count: number) => patchState(store, { count }) })),
      );
      const first = TestBed.runInInjectionContext(() => new Store());
      const second = TestBed.runInInjectionContext(() => new Store());
      first.set(1);
      expect(first.entries()).toHaveLength(2);
      expect(second.entries()).toHaveLength(1);
    });

    it('starts from a fresh history when the store is destroyed and created again', () => {
      const Store = createCounterStore();
      const first = TestBed.inject(Store);
      first.setCount(1);
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const second = TestBed.inject(Store);
      expect(second.entries()).toHaveLength(1);
      expect(second.count()).toBe(0);
    });

    it('clears the idle timer when the store is destroyed', () => {
      vi.useFakeTimers();
      const store = setup({ coalesce: { windowMs: 100 } });
      store.setCount(1);
      TestBed.resetTestingModule();
      expect(() => vi.advanceTimersByTime(500)).not.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('development warnings', () => {
    it('warns once when a tracked key holds a class instance', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const Store = signalStore(
        { providedIn: 'root' },
        withState({ when: new Date(0), label: 'a' }),
        withTimeline(),
        withMethods((store) => ({ rename: (label: string) => patchState(store, { label }) })),
      );
      TestBed.inject(Store);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('"when"');
      warn.mockRestore();
    });

    it('stays quiet for plain data and for undefined values', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const Store = signalStore(
        { providedIn: 'root' },
        withState<{ selected: string | undefined; list: number[] }>({
          selected: undefined,
          list: [1, 2],
        }),
        withTimeline(),
      );
      TestBed.inject(Store);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('checks an entry that stays open until its window passes', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const Store = signalStore(
        { providedIn: 'root' },
        withState<{ value: unknown }>({ value: 1 }),
        withTimeline({ coalesce: { windowMs: 100 } }),
        withMethods((store) => ({ set: (value: unknown) => patchState(store, { value }) })),
      );
      const store = TestBed.inject(Store);
      store.set(new Map());
      await vi.advanceTimersByTimeAsync(10);
      expect(warn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('warns when a later change introduces non plain data', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const Store = signalStore(
        { providedIn: 'root' },
        withState<{ value: unknown }>({ value: 1 }),
        withTimeline(),
        withMethods((store) => ({ set: (value: unknown) => patchState(store, { value }) })),
      );
      const store = TestBed.inject(Store);
      store.set(new Map());
      await Promise.resolve();
      expect(warn).toHaveBeenCalledTimes(1);
      store.set(new Set());
      await Promise.resolve();
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });
});
