import { effect, EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { getState, patchState, signalStore, withState } from '@ngrx/signals';
import { createMemoryAdapter } from '../persistence/testing/memory-adapter';
import { skipReplay } from '../store/replay';
import { withTimeline } from '../store/with-timeline';
import { provideTimelineGroup } from './provide-timeline-group';
import { TimelineGroup, type GroupMember, type TimelineGroupOptions } from './timeline-group';
import {
  createGuardStore,
  createLayoutStore,
  createShapesStore,
  initialLayout,
  initialShapes,
} from './testing/stores';

function configure(options: TimelineGroupOptions = {}): void {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideTimelineGroup(options)] });
}

function setup(options: TimelineGroupOptions = {}) {
  configure(options);
  const shapes = TestBed.inject(createShapesStore());
  const layout = TestBed.inject(createLayoutStore());
  const group = TestBed.inject(TimelineGroup);
  return { shapes, layout, group };
}

describe('timeline group', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('one history for several stores', () => {
    it('starts with the initial entry and shares the signals with the stores', () => {
      const { shapes, layout, group } = setup();
      expect(group.entries()).toHaveLength(1);
      expect(shapes.entries).toBe(group.entries);
      expect(layout.currentEntryId).toBe(group.currentEntryId);
      expect(shapes.isReplaying).toBe(group.isReplaying);
      expect(group.canUndo()).toBe(false);
    });

    it('turns a group transaction over two stores into one entry that one undo reverts', () => {
      const { shapes, layout, group } = setup();
      group.transaction('Add and zoom', () => {
        shapes.add('rect');
        layout.setZoom(2);
        layout.setPanel('closed');
      });
      expect(group.entries()).toHaveLength(2);
      expect(group.entries()[1]?.label).toBe('Add and zoom');
      group.undo();
      expect(getState(shapes)).toEqual(initialShapes);
      expect(getState(layout)).toEqual(initialLayout);
      group.redo();
      expect(shapes.items()).toEqual(['rect']);
      expect(layout.zoom()).toBe(2);
      expect(layout.panel()).toBe('closed');
    });

    it('says which stores an entry touched', () => {
      const { shapes, layout, group } = setup();
      shapes.add('a');
      layout.setZoom(3);
      group.transaction('both', () => {
        shapes.add('b');
        layout.setPanel('closed');
      });
      expect(group.entries().map((entry) => entry.changedKeys)).toEqual([
        [],
        ['shapes'],
        ['layout'],
        ['shapes', 'layout'],
      ]);
    });

    it('records changes outside a transaction as one entry each, whichever store made them', () => {
      const { shapes, layout, group } = setup();
      shapes.add('a');
      layout.setZoom(2);
      shapes.select('a');
      expect(group.entries()).toHaveLength(4);
      shapes.undo();
      expect(shapes.selected()).toBeNull();
      expect(layout.zoom()).toBe(2);
      layout.undo();
      expect(layout.zoom()).toBe(1);
      expect(shapes.items()).toEqual(['a']);
      layout.redo();
      shapes.redo();
      expect(layout.zoom()).toBe(2);
      expect(shapes.selected()).toBe('a');
    });

    it('lets a store transaction delegate to the group', () => {
      const { shapes, group } = setup();
      shapes.transaction('two adds', () => {
        shapes.add('a');
        shapes.add('b');
      });
      expect(group.entries()).toHaveLength(2);
      shapes.undo();
      expect(shapes.items()).toEqual([]);
    });

    it('rolls every store back when a group transaction throws', () => {
      const { shapes, layout, group } = setup();
      expect(() =>
        group.transaction('fails', () => {
          shapes.add('a');
          layout.setZoom(5);
          throw new Error('nope');
        }),
      ).toThrow('nope');
      expect(getState(shapes)).toEqual(initialShapes);
      expect(getState(layout)).toEqual(initialLayout);
      expect(group.entries()).toHaveLength(1);
    });

    it('creates no entry for a group transaction without a net change', () => {
      const { shapes, group } = setup();
      group.transaction('noop', () => {
        shapes.select('a');
        shapes.select(null);
      });
      expect(group.entries()).toHaveLength(1);
    });

    it('jumps across stores and branches', () => {
      const { shapes, layout, group } = setup();
      shapes.add('a');
      layout.setZoom(2);
      const marked = group.currentEntryId();
      group.undo();
      group.undo();
      layout.setPanel('closed');
      expect(group.entries()).toHaveLength(4);
      group.jumpTo(marked);
      expect(shapes.items()).toEqual(['a']);
      expect(layout.zoom()).toBe(2);
      expect(layout.panel()).toBe('open');
    });

    it('exposes the patch of an entry with paths under the store key', () => {
      const { shapes, group } = setup();
      shapes.select('x');
      const patch = group.entryPatch(group.currentEntryId());
      expect(patch?.forward).toEqual([{ op: 'replace', path: '/shapes/selected', value: 'x' }]);
    });

    it('clears the whole shared history', () => {
      const { shapes, layout, group } = setup();
      shapes.add('a');
      layout.setZoom(2);
      group.clear();
      expect(group.entries()).toHaveLength(1);
      expect(group.canUndo()).toBe(false);
      expect(shapes.items()).toEqual(['a']);
    });

    it('merges changes in a coalescing gesture across stores', () => {
      const { shapes, layout, group } = setup();
      group.coalesce('drag', () => {
        shapes.select('a');
        layout.setZoom(2);
        shapes.select('b');
      });
      expect(group.entries()).toHaveLength(2);
      group.beginCoalescing('resize');
      layout.setZoom(3);
      layout.setZoom(4);
      group.endCoalescing();
      expect(group.entries()).toHaveLength(3);
      group.undo();
      expect(layout.zoom()).toBe(2);
    });

    it('merges changes inside the group window across stores', () => {
      vi.useFakeTimers();
      const { shapes, layout, group } = setup({ coalesce: { windowMs: 100 } });
      shapes.select('a');
      layout.setZoom(2);
      expect(group.entries()).toHaveLength(2);
      vi.advanceTimersByTime(101);
      layout.setZoom(3);
      expect(group.entries()).toHaveLength(3);
    });

    it('limits the history with maxEntries of the group', () => {
      const { shapes, group } = setup({ maxEntries: 3 });
      for (const item of ['a', 'b', 'c', 'd', 'e']) {
        shapes.add(item);
      }
      expect(group.entries()).toHaveLength(4);
      for (let step = 0; step < 5; step += 1) {
        group.undo();
      }
      expect(shapes.items()).toEqual(['a', 'b']);
    });
  });

  describe('stores with skipped keys', () => {
    it('leaves a skipped key out of the history', () => {
      const { layout, group } = setup();
      layout.setZoom(2);
      layout.moveCursor(10);
      expect(group.entries()).toHaveLength(2);
      group.undo();
      expect(layout.zoom()).toBe(1);
      expect(layout.cursor()).toBe(10);
    });

    it('does not record a change that touches only skipped keys', () => {
      const { layout, group } = setup();
      layout.moveCursor(4);
      expect(group.entries()).toHaveLength(1);
    });
  });

  describe('a store that joins late', () => {
    it('keeps its state at join time as the constant before it joined', () => {
      configure({ checkpointEvery: 2 });
      const shapes = TestBed.inject(createShapesStore());
      const group = TestBed.inject(TimelineGroup);
      shapes.add('a');
      shapes.add('b');
      shapes.add('c');
      const layout = TestBed.inject(createLayoutStore());
      layout.setZoom(2);
      layout.setZoom(3);
      layout.setZoom(4);
      expect(group.entries()).toHaveLength(7);
      group.jumpTo(group.entries()[0]?.id as number);
      expect(shapes.items()).toEqual([]);
      expect(layout.zoom()).toBe(1);
      group.jumpTo(group.entries()[3]?.id as number);
      expect(shapes.items()).toEqual(['a', 'b', 'c']);
      expect(layout.zoom()).toBe(1);
      group.jumpTo(group.entries()[5]?.id as number);
      expect(layout.zoom()).toBe(3);
      group.jumpTo(group.entries()[6]?.id as number);
      expect(layout.zoom()).toBe(4);
    });

    it('records a late store inside an entry that is still pending', () => {
      configure();
      const shapes = TestBed.inject(createShapesStore());
      const group = TestBed.inject(TimelineGroup);
      shapes.add('a');
      const layout = TestBed.inject(createLayoutStore());
      group.undo();
      expect(shapes.items()).toEqual([]);
      group.redo();
      layout.setZoom(2);
      group.undo();
      expect(layout.zoom()).toBe(1);
      expect(shapes.items()).toEqual(['a']);
    });
  });

  describe('invalid use', () => {
    it('throws for two stores with the same storeKey', () => {
      configure();
      TestBed.inject(createShapesStore('shared'));
      expect(() => TestBed.inject(createLayoutStore('shared'))).toThrow(
        /already uses the storeKey "shared"/,
      );
    });

    it('throws for a member store without a group', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      expect(() => TestBed.inject(createShapesStore())).toThrow(/no group is provided/);
    });

    it('throws for a member store without a storeKey', () => {
      configure();
      const Store = signalStore(
        { providedIn: 'root' },
        withState({ a: 1 }),
        withTimeline({ group: true, storeKey: '' }),
      );
      expect(() => TestBed.inject(Store)).toThrow(/needs a storeKey/);
    });

    it.each([
      ['maxEntries', { maxEntries: 5 }],
      ['checkpointEvery', { checkpointEvery: 5 }],
      ['persistence', { persistence: { adapter: createMemoryAdapter() } }],
    ])('rejects %s on a member store', (name, extra) => {
      configure();
      const Store = signalStore(
        { providedIn: 'root' },
        withState({ a: 1 }),
        withTimeline({ group: true, storeKey: 'a', ...extra } as never),
      );
      expect(() => TestBed.inject(Store)).toThrow(
        new RegExp(`Set ${name} on provideTimelineGroup`),
      );
    });

    it('rejects a coalescing window on a member store', () => {
      configure();
      const Store = signalStore(
        { providedIn: 'root' },
        withState({ a: 1 }),
        withTimeline({ group: true, storeKey: 'a', coalesce: { windowMs: 5 } } as never),
      );
      expect(() => TestBed.inject(Store)).toThrow(/coalesce.windowMs on provideTimelineGroup/);
    });

    it('does not let a destroyed store key come back', () => {
      configure();
      const parent = TestBed.inject(EnvironmentInjector);
      const Store = createShapesStore('scoped');
      const first = createEnvironmentInjector([Store], parent);
      first.get(Store);
      first.destroy();
      const second = createEnvironmentInjector([Store], parent);
      expect(() => second.get(Store)).toThrow(/belonged to a store that was destroyed/);
    });

    it('stops writing to a destroyed store', () => {
      configure();
      const parent = TestBed.inject(EnvironmentInjector);
      const layout = TestBed.inject(createLayoutStore());
      const Scoped = createShapesStore('scoped');
      const child = createEnvironmentInjector([Scoped], parent);
      const scoped = child.get(Scoped);
      const group = TestBed.inject(TimelineGroup);
      scoped.add('a');
      layout.setZoom(2);
      child.destroy();
      group.undo();
      expect(layout.zoom()).toBe(1);
      expect(scoped.items()).toEqual(['a']);
      group.undo();
      group.redo();
      group.redo();
      expect(layout.zoom()).toBe(2);
      group.transaction('after destroy', () => layout.setZoom(3));
      expect(group.entries().at(-1)?.changedKeys).toEqual(['layout']);
    });

    it('rejects persistence without store keys', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideTimelineGroup({
            persistence: { adapter: createMemoryAdapter() },
            stores: [],
          }),
        ],
      });
      expect(() => TestBed.inject(TimelineGroup)).toThrow(/needs the list of store keys/);
    });

    it('rejects a store that is not in the stores option', () => {
      configure({ persistence: { adapter: createMemoryAdapter() }, stores: ['layout'] });
      expect(() => TestBed.inject(createShapesStore())).toThrow(/not in the group option "stores"/);
    });
  });

  describe('side effects during a group replay', () => {
    it('does not run effects in either store during an undo, a redo or a jump', () => {
      const { shapes, layout, group } = setup();
      const runs: string[] = [];
      TestBed.runInInjectionContext(() => {
        effect(() => {
          const items = shapes.items();
          skipReplay(group, () => runs.push(`shapes:${items.length}`));
        });
        effect(() => {
          const zoom = layout.zoom();
          skipReplay(layout, () => runs.push(`layout:${zoom}`));
        });
      });
      TestBed.tick();
      runs.length = 0;
      group.transaction('both', () => {
        shapes.add('a');
        layout.setZoom(2);
      });
      TestBed.tick();
      expect(runs.sort()).toEqual(['layout:2', 'shapes:1']);
      runs.length = 0;
      group.undo();
      TestBed.tick();
      group.redo();
      TestBed.tick();
      group.jumpTo(group.entries()[0]?.id as number);
      TestBed.tick();
      expect(runs).toEqual([]);
      layout.setZoom(9);
      TestBed.tick();
      expect(runs).toEqual(['layout:9']);
    });

    it('reports isReplaying in both stores together', () => {
      const { shapes, layout, group } = setup();
      shapes.add('a');
      group.undo();
      expect(shapes.isReplaying()).toBe(true);
      expect(layout.isReplaying()).toBe(true);
      TestBed.tick();
      expect(shapes.isReplaying()).toBe(false);
    });
  });

  describe('a replay where one store fails', () => {
    function setupWithGuard() {
      configure();
      const gate: { failOn: number | undefined } = { failOn: undefined };
      const shapes = TestBed.inject(createShapesStore());
      const guard = TestBed.inject(createGuardStore(gate));
      const group = TestBed.inject(TimelineGroup);
      return { shapes, guard, group, gate };
    }

    it('puts every store back and keeps the position when a store rejects the target', () => {
      const { shapes, guard, group, gate } = setupWithGuard();
      guard.setValue(1);
      group.transaction('both', () => {
        shapes.add('a');
        guard.setValue(2);
      });
      const position = group.currentEntryId();
      gate.failOn = 1;
      expect(() => group.undo()).toThrow('rejected 1');
      expect(shapes.items()).toEqual(['a']);
      expect(guard.value()).toBe(2);
      expect(group.currentEntryId()).toBe(position);
      expect(group.canUndo()).toBe(true);
      gate.failOn = undefined;
      group.undo();
      expect(shapes.items()).toEqual([]);
      expect(guard.value()).toBe(1);
    });

    it('still reaches the target stores when the failing store comes first', () => {
      const { shapes, guard, group, gate } = setupWithGuard();
      guard.setValue(1);
      shapes.add('a');
      gate.failOn = 0;
      expect(() => group.jumpTo(group.entries()[0]?.id as number)).toThrow('rejected 0');
      expect(shapes.items()).toEqual(['a']);
      expect(guard.value()).toBe(1);
      expect(group.currentEntryId()).toBe(group.entries()[2]?.id);
    });
  });

  describe('group persistence', () => {
    function persistentGroup(adapter = createMemoryAdapter()) {
      return {
        adapter,
        options: {
          persistence: { adapter, debounceMs: 20 },
          stores: ['shapes', 'layout'],
        } satisfies TimelineGroupOptions,
      };
    }

    it('restores the shared history and every store after a reload', () => {
      const { adapter, options } = persistentGroup();
      const first = setup(options);
      first.group.transaction('both', () => {
        first.shapes.add('a');
        first.layout.setZoom(2);
      });
      first.shapes.add('b');
      first.group.undo();
      window.dispatchEvent(new Event('pagehide'));
      const second = setup(options);
      expect(second.group.entries().map((entry) => entry.label)).toEqual(
        first.group.entries().map((entry) => entry.label),
      );
      expect(second.shapes.items()).toEqual(['a']);
      expect(second.layout.zoom()).toBe(2);
      second.group.undo();
      expect(second.shapes.items()).toEqual([]);
      expect(second.layout.zoom()).toBe(1);
      expect(adapter.saves).toBeGreaterThan(0);
    });

    it('waits for every store before it restores or saves', () => {
      vi.useFakeTimers();
      const { adapter, options } = persistentGroup();
      const first = setup(options);
      first.shapes.add('a');
      window.dispatchEvent(new Event('pagehide'));
      const saved = adapter.saves;
      configure(options);
      const shapes = TestBed.inject(createShapesStore());
      shapes.add('x');
      vi.advanceTimersByTime(100);
      expect(adapter.saves).toBe(saved);
      expect(shapes.items()).toEqual(['x']);
    });

    it('ignores a stored history that was saved for other stores', () => {
      const adapter = createMemoryAdapter();
      const onError = vi.fn();
      const first = setup({
        persistence: { adapter },
        stores: ['shapes', 'layout'],
      });
      first.shapes.add('a');
      window.dispatchEvent(new Event('pagehide'));
      configure({ persistence: { adapter, onError }, stores: ['shapes', 'guard'] });
      const shapes = TestBed.inject(createShapesStore());
      TestBed.inject(createGuardStore({ failOn: undefined }));
      expect(onError).toHaveBeenCalledTimes(1);
      expect(shapes.items()).toEqual([]);
    });

    it('saves on destroy', () => {
      const { adapter, options } = persistentGroup();
      const { shapes } = setup(options);
      shapes.add('a');
      TestBed.resetTestingModule();
      expect(JSON.parse(adapter.stored ?? '').nodes).toHaveLength(1);
    });
  });
});

describe('TimelineGroup with plain members', () => {
  function plainMember(
    storeKey: string,
    write: GroupMember['write'],
  ): GroupMember & {
    slice: Record<string, unknown>;
  } {
    const member = {
      storeKey,
      slice: { value: 0 } as Record<string, unknown>,
      read: () => member.slice,
      write,
    };
    return member;
  }

  it('applies every store even when one of them throws, then reverts all of them', () => {
    configureEmpty();
    const group = TestBed.runInInjectionContext(() => new TimelineGroup());
    const applied: string[] = [];
    const first = plainMember('first', (slices) => {
      applied.push(`first:${slices['value']}`);
      first.slice = slices;
    });
    const second = plainMember('second', (slices) => {
      applied.push(`second:${slices['value']}`);
      if (slices['value'] === 0) {
        throw new Error('second refuses');
      }
      second.slice = slices;
    });
    const third = plainMember('third', (slices) => {
      applied.push(`third:${slices['value']}`);
      third.slice = slices;
    });
    [first, second, third].forEach((member) => group.join(member));
    group.transaction('all', () => {
      first.slice = { value: 1 };
      second.slice = { value: 1 };
      third.slice = { value: 1 };
    });
    const position = group.currentEntryId();
    expect(() => group.undo()).toThrow('second refuses');
    expect(applied).toEqual(['first:0', 'second:0', 'third:0', 'first:1', 'second:1', 'third:1']);
    expect([first.slice, second.slice, third.slice]).toEqual([
      { value: 1 },
      { value: 1 },
      { value: 1 },
    ]);
    expect(group.currentEntryId()).toBe(position);
    expect(group.canUndo()).toBe(true);
  });
});

function configureEmpty(): void {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
}

describe('provideTimelineGroup', () => {
  it('provides one group per injector', () => {
    configureEmptyWithGroup();
    expect(TestBed.inject(TimelineGroup)).toBe(TestBed.inject(TimelineGroup));
  });

  it('gives a plain store without group options its own history', () => {
    configureEmptyWithGroup();
    const Store = signalStore(
      { providedIn: 'root', protectedState: false },
      withState({ a: 1 }),
      withTimeline(),
    );
    const store = TestBed.inject(Store);
    patchState(store, { a: 2 });
    expect(store.entries()).toHaveLength(2);
    expect(TestBed.inject(TimelineGroup).entries()).toHaveLength(1);
  });
});

function configureEmptyWithGroup(): void {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideTimelineGroup()] });
}
