import { effect } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { getState } from '@ngrx/signals';
import { createMemoryAdapter } from '../persistence/testing/memory-adapter';
import { createSessionStorageAdapter } from '../persistence/web-storage-adapter';
import type { TimelineOptions } from './options';
import { skipReplay } from './replay';
import { createCounterStore, initialCounter, type CounterState } from './testing/stores';

const storageKey = 'counter-history';

function open(options: TimelineOptions<CounterState> = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(createCounterStore(options));
}

function persistent(
  overrides: Partial<NonNullable<TimelineOptions<CounterState>['persistence']>> = {},
) {
  return {
    persistence: { adapter: createSessionStorageAdapter(storageKey), ...overrides },
  } satisfies TimelineOptions<CounterState>;
}

function hidePage(): void {
  window.dispatchEvent(new Event('pagehide'));
}

describe('withTimeline persistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('keeps the history across a reload and can undo what happened before it', () => {
    const before = open(persistent());
    before.setCount(1);
    before.setTitle('one');
    before.undo();
    before.setCount(7);
    hidePage();
    const labelsBefore = before.entries().map((entry) => entry.label);
    const idsBefore = before.entries().map((entry) => entry.id);

    const after = open(persistent());
    expect(after.entries().map((entry) => entry.label)).toEqual(labelsBefore);
    expect(after.entries().map((entry) => entry.id)).toEqual(idsBefore);
    expect(after.count()).toBe(7);
    expect(after.title()).toBe('start');
    after.undo();
    expect(after.count()).toBe(1);
    after.redo();
    expect(after.count()).toBe(7);
    after.jumpTo(idsBefore[2] as number);
    expect(getState(after)).toMatchObject({ count: 1, title: 'one' });
  });

  it('keeps branches and the branch that redo follows', () => {
    const before = open(persistent());
    before.setCount(1);
    before.undo();
    before.setCount(2);
    before.undo();
    hidePage();
    const after = open(persistent());
    expect(after.redoBranches()).toHaveLength(2);
    after.redo();
    expect(after.count()).toBe(2);
  });

  it('continues recording after a reload and saves again', () => {
    open(persistent()).setCount(1);
    hidePage();
    const reloaded = open(persistent());
    reloaded.setCount(2);
    hidePage();
    const third = open(persistent());
    expect(third.entries()).toHaveLength(3);
    expect(third.count()).toBe(2);
    expect(third.entries().at(-1)?.id).toBe(reloaded.currentEntryId());
  });

  it('saves after the debounce delay and on destroy', () => {
    vi.useFakeTimers();
    const store = open(persistent({ debounceMs: 40 }));
    store.setCount(1);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    vi.advanceTimersByTime(40);
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
    store.setCount(2);
    TestBed.resetTestingModule();
    expect(JSON.parse(sessionStorage.getItem(storageKey) ?? '').nodes).toHaveLength(2);
  });

  it('does not record the restore as a change', () => {
    open(persistent()).setCount(1);
    hidePage();
    const reloaded = open(persistent());
    expect(reloaded.entries()).toHaveLength(2);
    expect(reloaded.currentEntryId()).toBe(reloaded.entries()[1]?.id);
  });

  it('marks the restore as a replay, so effects skip it', () => {
    open(persistent()).setCount(1);
    hidePage();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const store = TestBed.inject(createCounterStore(persistent()));
    expect(store.isReplaying()).toBe(true);
    let fired = 0;
    TestBed.runInInjectionContext(() =>
      effect(() => {
        store.count();
        skipReplay(store, () => {
          fired += 1;
        });
      }),
    );
    TestBed.tick();
    expect(fired).toBe(0);
    expect(store.isReplaying()).toBe(false);
  });

  it('ignores a stored history that was saved for other tracked keys', () => {
    open({ track: ['count'], ...persistent() }).setCount(1);
    hidePage();
    const onError = vi.fn();
    const other = open(persistent({ onError }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(other.entries()).toHaveLength(1);
    expect(other.count()).toBe(0);
  });

  it('stores only tracked keys', () => {
    open({ skip: ['tags'], ...persistent() }).setCount(1);
    hidePage();
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? '');
    expect(stored.keys).toEqual(['count', 'nested', 'title']);
    expect(Object.keys(stored.root.state).sort()).toEqual(['count', 'nested', 'title']);
  });

  it('replaces a corrupt stored value and reports it', () => {
    sessionStorage.setItem(storageKey, '{"format":1');
    const onError = vi.fn();
    const store = open(persistent({ onError }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    store.setCount(1);
    hidePage();
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
  });

  it('keeps working when the storage is full', () => {
    const onError = vi.fn();
    const store = open(persistent({ onError }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    store.setCount(1);
    hidePage();
    expect(onError).toHaveBeenCalledTimes(1);
    store.undo();
    expect(store.count()).toBe(0);
    store.redo();
    expect(store.count()).toBe(1);
  });

  describe('history-if-state-matches', () => {
    it('drops the history when the live state is not the stored one', () => {
      open(persistent()).setCount(5);
      hidePage();
      const reloaded = open(persistent({ rehydrate: 'history-if-state-matches' }));
      expect(reloaded.entries()).toHaveLength(1);
      expect(reloaded.count()).toBe(0);
    });

    it('keeps the history when the live state is the stored one', () => {
      const before = open(persistent());
      before.setCount(5);
      before.undo();
      hidePage();
      const reloaded = open(persistent({ rehydrate: 'history-if-state-matches' }));
      expect(reloaded.entries()).toHaveLength(2);
      expect(getState(reloaded)).toEqual(initialCounter);
      reloaded.redo();
      expect(reloaded.count()).toBe(5);
    });
  });

  describe('with an in-memory adapter', () => {
    it('is not saved until something changes', () => {
      vi.useFakeTimers();
      const adapter = createMemoryAdapter();
      open({ persistence: { adapter } });
      vi.advanceTimersByTime(1000);
      expect(adapter.saves).toBe(0);
    });

    it('can restore the history of a store with a custom label', () => {
      const adapter = createMemoryAdapter();
      const label = () => 'edit';
      const before = open({ label, persistence: { adapter } });
      before.setCount(1);
      hidePage();
      const after = open({ label, persistence: { adapter } });
      expect(after.entries().map((entry) => entry.label)).toEqual(['Initial state', 'edit']);
    });
  });
});
