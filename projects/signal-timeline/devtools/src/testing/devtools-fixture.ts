import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { withTimeline, type TimelineSource } from 'signal-timeline';
import { TimelineDevtoolsComponent } from '../timeline-devtools.component';
import { createCounterStore } from '../../../src/store/testing/stores';

export function mountDevtools(
  timeline: TimelineSource,
): ComponentFixture<TimelineDevtoolsComponent> {
  const fixture = TestBed.createComponent(TimelineDevtoolsComponent);
  fixture.componentRef.setInput('timeline', timeline);
  fixture.detectChanges();
  return fixture;
}

export async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

export function branchingStore() {
  TestBed.configureTestingModule({});
  const store = TestBed.inject(createCounterStore());
  store.setCount(1);
  store.setCount(2);
  store.undo();
  store.setTitle('other');
  return store;
}

export function treeItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
}

export function itemFor(root: HTMLElement, entryId: number): HTMLElement {
  const item = root.querySelector<HTMLElement>(`[role="treeitem"][data-node-id="${entryId}"]`);
  if (item === null) {
    throw new Error(`no tree item for entry ${entryId}`);
  }
  return item;
}

export function press(element: Element, key: string, init: KeyboardEventInit = {}): void {
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );
}

export function untouchedStore() {
  TestBed.configureTestingModule({});
  return TestBed.inject(createCounterStore());
}

export interface ListState {
  readonly items: readonly string[];
  readonly meta: { readonly note?: string };
  readonly title: string;
}

export function createListStore() {
  return signalStore(
    { providedIn: 'root', protectedState: false },
    withState<ListState>({ items: [], meta: {}, title: 'list' }),
    withTimeline(),
    withMethods((store) => ({
      addItem: (item: string) => patchState(store, (state) => ({ items: [...state.items, item] })),
      removeLastItem: () => patchState(store, (state) => ({ items: state.items.slice(0, -1) })),
      setNote: (note: string) => patchState(store, (state) => ({ meta: { ...state.meta, note } })),
      clearNote: () => patchState(store, () => ({ meta: {} })),
      setTitle: (title: string) => patchState(store, { title }),
    })),
  );
}
