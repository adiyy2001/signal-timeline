import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { withTimeline } from '../with-timeline';
import type { TimelineOptions } from '../options';

export interface CounterState {
  readonly count: number;
  readonly title: string;
  readonly tags: readonly string[];
  readonly nested: { readonly deep: { readonly value: number } };
}

export const initialCounter: CounterState = {
  count: 0,
  title: 'start',
  tags: [],
  nested: { deep: { value: 1 } },
};

export function createCounterStore(options: TimelineOptions<CounterState> = {}) {
  return signalStore(
    { providedIn: 'root' },
    withState(initialCounter),
    withComputed(({ count }) => ({ double: computed(() => count() * 2) })),
    withTimeline(options),
    withMethods((store) => ({
      setCount: (count: number) => patchState(store, { count }),
      setTitle: (title: string) => patchState(store, { title }),
      addTag: (tag: string) => patchState(store, (state) => ({ tags: [...state.tags, tag] })),
      setDeep: (value: number) => patchState(store, { nested: { deep: { value } } }),
      both: (count: number, title: string) => patchState(store, { count, title }),
    })),
  );
}
