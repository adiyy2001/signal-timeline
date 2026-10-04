import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { patchState, signalStore, withMethods, withState, type Prettify } from '@ngrx/signals';
import { updateEntity, withEntities, setAllEntities } from '@ngrx/signals/entities';
import { withTimeline } from 'signal-timeline';

export interface Shape {
  readonly id: string;
  readonly x: number;
  readonly color: string;
}

export function makeShapes(count: number): Shape[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `shape-${index}`,
    x: index,
    color: index % 2 === 0 ? 'red' : 'blue',
  }));
}

const PlainStore = signalStore(
  { protectedState: false },
  withEntities<Shape>(),
  withState({ counter: 0 }),
  withMethods((store) => ({
    load: (shapes: Shape[]) => patchState(store, setAllEntities(shapes)),
    move: (id: string, x: number) => patchState(store, updateEntity({ id, changes: { x } })),
    bump: (counter: number) => patchState(store, { counter }),
  })),
);

const TimelineStore = signalStore(
  { protectedState: false },
  withEntities<Shape>(),
  withState({ counter: 0 }),
  withTimeline(),
  withMethods((store) => ({
    load: (shapes: Shape[]) => patchState(store, setAllEntities(shapes)),
    move: (id: string, x: number) => patchState(store, updateEntity({ id, changes: { x } })),
    bump: (counter: number) => patchState(store, { counter }),
  })),
);

export type PlainShapeStore = Prettify<InstanceType<typeof PlainStore>>;
export type TimelineShapeStore = Prettify<InstanceType<typeof TimelineStore>>;

export function createPlainStore(shapes: Shape[]): InstanceType<typeof PlainStore> {
  const store = runInInjectionContext(Injector.create({ providers: [] }), () => new PlainStore());
  store.load(shapes);
  return store;
}

export function createTimelineStore(shapes: Shape[]): InstanceType<typeof TimelineStore> {
  const store = runInInjectionContext(
    Injector.create({ providers: [] }),
    () => new TimelineStore(),
  );
  store.load(shapes);
  store.clear();
  return store;
}
