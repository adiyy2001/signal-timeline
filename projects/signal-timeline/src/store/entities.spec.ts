import { TestBed } from '@angular/core/testing';
import {
  getState,
  patchState,
  signalStore,
  type,
  withLinkedState,
  withMethods,
  withState,
} from '@ngrx/signals';
import {
  addEntity,
  removeEntity,
  setAllEntities,
  updateEntity,
  withEntities,
} from '@ngrx/signals/entities';
import { linkedSignal } from '@angular/core';
import { withTimeline } from './with-timeline';

interface Shape {
  readonly id: string;
  readonly x: number;
  readonly color: string;
}

const shapeA: Shape = { id: 'a', x: 0, color: 'red' };
const shapeB: Shape = { id: 'b', x: 10, color: 'blue' };

const ShapeStore = signalStore(
  { providedIn: 'root', protectedState: false },
  withEntities<Shape>(),
  withState({ selectedId: undefined as string | undefined }),
  withTimeline({ skip: ['selectedId'] }),
  withMethods((store) => ({
    add: (shape: Shape) => patchState(store, addEntity(shape)),
    move: (id: string, x: number) => patchState(store, updateEntity({ id, changes: { x } })),
    remove: (id: string) => patchState(store, removeEntity(id)),
    replaceAll: (shapes: Shape[]) => patchState(store, setAllEntities(shapes)),
    select: (selectedId: string | undefined) => patchState(store, { selectedId }),
  })),
);

describe('withTimeline with entities', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('undoes and redoes add, update and remove', () => {
    const store = TestBed.inject(ShapeStore);
    store.add(shapeA);
    store.add(shapeB);
    store.move('a', 5);
    store.remove('b');
    expect(store.ids()).toEqual(['a']);
    store.undo();
    expect(store.ids()).toEqual(['a', 'b']);
    store.undo();
    expect(store.entityMap()['a']?.x).toBe(0);
    store.undo();
    store.undo();
    expect(store.ids()).toEqual([]);
    store.redo();
    store.redo();
    store.redo();
    store.redo();
    expect(getState(store).ids).toEqual(['a']);
    expect(store.entityMap()['a']?.x).toBe(5);
  });

  it('undoes setAllEntities and jumps over it', () => {
    const store = TestBed.inject(ShapeStore);
    store.add(shapeA);
    store.replaceAll([shapeB]);
    expect(store.ids()).toEqual(['b']);
    store.undo();
    expect(store.ids()).toEqual(['a']);
    expect(store.entityMap()).toEqual({ a: shapeA });
  });

  it('keeps the entity patch small', () => {
    const store = TestBed.inject(ShapeStore);
    store.add(shapeA);
    store.add(shapeB);
    store.move('a', 7);
    const patch = store.entryPatch(store.entries()[3]?.id as number);
    expect(patch?.forward).toEqual([{ op: 'replace', path: '/entityMap/a/x', value: 7 }]);
  });

  it('leaves skipped keys out of history', () => {
    const store = TestBed.inject(ShapeStore);
    store.add(shapeA);
    store.select('a');
    expect(store.entries()).toHaveLength(2);
    store.undo();
    expect(store.selectedId()).toBe('a');
  });

  it('works with a named collection', () => {
    const Store = signalStore(
      { providedIn: 'root', protectedState: false },
      withEntities({ entity: type<Shape>(), collection: 'shape' }),
      withTimeline({ track: ['shapeEntityMap', 'shapeIds'] }),
      withMethods((store) => ({
        add: (shape: Shape) => patchState(store, addEntity(shape, { collection: 'shape' })),
      })),
    );
    const store = TestBed.inject(Store);
    store.add(shapeA);
    expect(store.shapeIds()).toEqual(['a']);
    store.undo();
    expect(store.shapeIds()).toEqual([]);
    store.redo();
    expect(store.shapeEntityMap()['a']).toEqual(shapeA);
  });

  it('copes with string and numeric ids side by side in one history', () => {
    const Store = signalStore(
      { providedIn: 'root', protectedState: false },
      withEntities<{ id: number; label: string }>(),
      withTimeline(),
      withMethods((store) => ({
        add: (id: number, label: string) => patchState(store, addEntity({ id, label })),
      })),
    );
    const store = TestBed.inject(Store);
    store.add(1, 'one');
    store.add(2, 'two');
    store.undo();
    expect(store.ids()).toEqual([1]);
  });
});

describe('withTimeline with linked state', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('stays consistent when a linked key is tracked together with its source', () => {
    const Store = signalStore(
      { providedIn: 'root', protectedState: false },
      withState({ count: 1 }),
      withLinkedState(({ count }) => ({ doubled: linkedSignal(() => count() * 2) })),
      withTimeline(),
      withMethods((store) => ({
        set: (count: number) => patchState(store, { count }),
      })),
    );
    const store = TestBed.inject(Store);
    store.set(5);
    expect(store.doubled()).toBe(10);
    store.undo();
    expect(store.count()).toBe(1);
    expect(store.doubled()).toBe(2);
    store.redo();
    expect(store.doubled()).toBe(10);
  });

  it('can leave the linked key out with skip and still stays consistent', () => {
    const Store = signalStore(
      { providedIn: 'root', protectedState: false },
      withState({ count: 1 }),
      withLinkedState(({ count }) => ({ doubled: linkedSignal(() => count() * 2) })),
      withTimeline({ skip: ['doubled'] }),
      withMethods((store) => ({
        set: (count: number) => patchState(store, { count }),
      })),
    );
    const store = TestBed.inject(Store);
    store.set(5);
    expect(store.entries()).toHaveLength(2);
    store.undo();
    expect(store.doubled()).toBe(2);
  });
});
