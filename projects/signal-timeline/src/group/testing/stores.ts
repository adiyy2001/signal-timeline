import {
  patchState,
  signalStore,
  watchState,
  withHooks,
  withMethods,
  withState,
} from '@ngrx/signals';
import { withTimeline } from '../../store/with-timeline';

export interface ShapesState {
  readonly items: readonly string[];
  readonly selected: string | null;
}

export interface LayoutState {
  readonly zoom: number;
  readonly panel: 'open' | 'closed';
  readonly cursor: number;
}

export interface GuardState {
  readonly value: number;
}

export const initialShapes: ShapesState = { items: [], selected: null };
export const initialLayout: LayoutState = { zoom: 1, panel: 'open', cursor: 0 };
export const initialGuard: GuardState = { value: 0 };

export function createShapesStore(storeKey = 'shapes') {
  return signalStore(
    { providedIn: 'root', protectedState: false },
    withState(initialShapes),
    withTimeline({ group: true, storeKey }),
    withMethods((store) => ({
      add: (item: string) => patchState(store, (state) => ({ items: [...state.items, item] })),
      select: (selected: string | null) => patchState(store, { selected }),
    })),
  );
}

export function createLayoutStore(storeKey = 'layout') {
  return signalStore(
    { providedIn: 'root', protectedState: false },
    withState(initialLayout),
    withTimeline({ group: true, storeKey, skip: ['cursor'] }),
    withMethods((store) => ({
      setZoom: (zoom: number) => patchState(store, { zoom }),
      setPanel: (panel: 'open' | 'closed') => patchState(store, { panel }),
      moveCursor: (cursor: number) => patchState(store, { cursor }),
    })),
  );
}

export function createGuardStore(gate: { failOn: number | undefined }) {
  return signalStore(
    { providedIn: 'root', protectedState: false },
    withState(initialGuard),
    withTimeline({ group: true, storeKey: 'guard' }),
    withMethods((store) => ({
      setValue: (value: number) => patchState(store, { value }),
    })),
    withHooks({
      onInit(store) {
        watchState(store, (state) => {
          if (state.value === gate.failOn) {
            throw new Error(`rejected ${state.value}`);
          }
        });
      },
    }),
  );
}
