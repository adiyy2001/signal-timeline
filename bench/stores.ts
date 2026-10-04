import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import {
  patchState,
  signalStore,
  withMethods,
  withState,
  type WritableStateSource,
} from '@ngrx/signals';
import {
  addEntity,
  type EntityState,
  removeEntity,
  setAllEntities,
  updateEntity,
  withEntities,
} from '@ngrx/signals/entities';
import { withTimeline, type TimelinePersistenceOptions } from 'signal-timeline';

export type IdKind = 'string' | 'integer';

export interface Shape {
  readonly id: string | number;
  readonly x: number;
  readonly color: string;
}

export interface ShapeState {
  readonly counter: number;
  readonly settings: {
    readonly view: { readonly zoom: number; readonly panX: number; readonly panY: number };
    readonly grid: { readonly size: number; readonly visible: boolean };
  };
}

export function shapeId(index: number, kind: IdKind): string | number {
  return kind === 'string' ? `shape-${index}` : index;
}

export function makeShapes(count: number, kind: IdKind): Shape[] {
  return Array.from({ length: count }, (_, index) => ({
    id: shapeId(index, kind),
    x: index,
    color: index % 2 === 0 ? 'red' : 'blue',
  }));
}

const initialState: ShapeState = {
  counter: 0,
  settings: {
    view: { zoom: 1, panX: 0, panY: 0 },
    grid: { size: 8, visible: true },
  },
};

function shapeMethods(store: WritableStateSource<EntityState<Shape> & ShapeState>) {
  return {
    load: (shapes: Shape[]) => patchState(store, setAllEntities(shapes)),
    move: (id: string | number, x: number) =>
      patchState(store, updateEntity({ id, changes: { x } })),
    add: (shape: Shape) => patchState(store, addEntity(shape)),
    remove: (id: string | number) => patchState(store, removeEntity(id)),
    bump: (counter: number) => patchState(store, { counter }),
    zoom: (zoom: number) =>
      patchState(store, (state: ShapeState) => ({
        settings: { ...state.settings, view: { ...state.settings.view, zoom } },
      })),
  };
}

const PlainStore = signalStore(
  { protectedState: false },
  withEntities<Shape>(),
  withState(initialState),
  withMethods((store) => shapeMethods(store)),
);

export interface BenchTimelineOptions {
  readonly checkpointEvery?: number;
  readonly maxEntries?: number;
  readonly persistence?: TimelinePersistenceOptions;
}

function defineTimelineStore(options: BenchTimelineOptions) {
  return signalStore(
    { protectedState: false },
    withEntities<Shape>(),
    withState(initialState),
    withTimeline(options),
    withMethods((store) => shapeMethods(store)),
  );
}

export type TimelineBenchStore = InstanceType<ReturnType<typeof defineTimelineStore>>;
export type PlainBenchStore = InstanceType<typeof PlainStore>;

function instantiate<T>(create: () => T): T {
  return runInInjectionContext(Injector.create({ providers: [] }), create);
}

export function createPlainStore(shapes: Shape[]): PlainBenchStore {
  const store = instantiate(() => new PlainStore());
  store.load(shapes);
  return store;
}

export function createTimelineStore(
  shapes: Shape[],
  options: BenchTimelineOptions = {},
): TimelineBenchStore {
  const Store = defineTimelineStore(options);
  const store = instantiate(() => new Store());
  store.load(shapes);
  store.clear();
  return store;
}

export interface EditableStore {
  move(id: string | number, x: number): void;
  bump(counter: number): void;
  zoom(zoom: number): void;
}

export function applyEdit(
  store: EditableStore,
  index: number,
  entityCount: number,
  kind: IdKind,
): void {
  const remainder = index % 10;
  if (remainder < 7) {
    store.move(shapeId((index * 37) % entityCount, kind), index);
  } else if (remainder < 9) {
    store.bump(index);
  } else {
    store.zoom(1 + (index % 50) / 100);
  }
}
