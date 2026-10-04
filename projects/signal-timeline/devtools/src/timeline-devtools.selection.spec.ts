import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import {
  branchingStore,
  createListStore,
  itemFor,
  mountDevtools,
  press,
  settle,
} from './testing/devtools-fixture';
import { createCounterStore } from '../../src/store/testing/stores';

function host(fixture: ComponentFixture<unknown>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function rowsOf(fixture: ComponentFixture<unknown>): string[][] {
  return Array.from(host(fixture).querySelectorAll('tbody tr')).map((row) =>
    Array.from(row.querySelectorAll('td')).map(
      (cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    ),
  );
}

function titleOf(fixture: ComponentFixture<unknown>): string {
  return host(fixture).querySelector('st-entry-diff .title')?.textContent?.trim() ?? '';
}

describe('the diff of the selected entry', () => {
  it('shows operation, path, before and after of a replace', () => {
    const store = branchingStore();
    const fixture = mountDevtools(store);
    expect(titleOf(fixture)).toBe(
      `Entry ${store.currentEntryId()}: ${store.entries().at(-1)?.label}`,
    );
    expect(rowsOf(fixture)).toEqual([['replace', '/title', '"start"', '"other"']]);
  });

  it('shows an add with no before value and a remove with no after value', async () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(createListStore());
    store.addItem('first');
    store.setNote('hello');
    store.clearNote();
    store.removeLastItem();
    const fixture = mountDevtools(store);
    const entries = store.entries();
    const idOf = (index: number) => entries[index]?.id ?? -1;

    itemFor(host(fixture), idOf(1)).focus();
    await settle(fixture);
    expect(rowsOf(fixture)).toEqual([['add', '/items/0', 'none', '"first"']]);

    itemFor(host(fixture), idOf(2)).focus();
    await settle(fixture);
    expect(rowsOf(fixture)).toEqual([['add', '/meta/note', 'none', '"hello"']]);

    itemFor(host(fixture), idOf(3)).focus();
    await settle(fixture);
    expect(rowsOf(fixture)).toEqual([['remove', '/meta/note', '"hello"', 'none']]);

    itemFor(host(fixture), idOf(4)).focus();
    await settle(fixture);
    expect(rowsOf(fixture)).toEqual([['remove', '/items/0', '"first"', 'none']]);
  });

  it('follows the entry that has focus in the tree, and the current entry after a jump', async () => {
    const store = branchingStore();
    const fixture = mountDevtools(store);
    itemFor(host(fixture), 2).focus();
    await settle(fixture);
    expect(titleOf(fixture)).toContain('Entry 2:');
    expect(rowsOf(fixture)).toEqual([['replace', '/count', '0', '1']]);
    press(itemFor(host(fixture), 1), 'Enter');
    await settle(fixture);
    expect(titleOf(fixture)).toBe('Entry 1: Initial state');
  });

  it('says so for the initial state', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(createCounterStore());
    const fixture = mountDevtools(store);
    expect(host(fixture).querySelector('st-entry-diff .note')?.textContent).toContain(
      'initial state',
    );
    expect(host(fixture).querySelector('table')).toBeNull();
  });

  it('says so for an entry without operations', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(createCounterStore());
    store.setDeep(1);
    const fixture = mountDevtools(store);
    expect(host(fixture).querySelector('st-entry-diff .note')?.textContent).toContain(
      'no operations',
    );
  });

  it('shows when the entry was made and what it touched', () => {
    const fixture = mountDevtools(branchingStore());
    const meta = host(fixture).querySelector('st-entry-diff .meta')?.textContent ?? '';
    expect(meta).toContain('Touched: title');
    expect(meta).toMatch(/at \d\d:\d\d:\d\d/);
  });

  it('cuts a long value and keeps the whole one in a details element', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(createListStore());
    store.setTitle('x'.repeat(300));
    const fixture = mountDevtools(store);
    const cells = host(fixture).querySelectorAll('tbody td');
    const after = cells[3];
    expect(after.querySelector('code')?.textContent?.endsWith('...')).toBe(true);
    expect(after.querySelector('code')?.getAttribute('title')).toContain('x'.repeat(300));
    expect(after.querySelector('details pre')?.textContent).toContain('x'.repeat(300));
    expect(cells[2].querySelector('details')).toBeNull();
  });

  it('limits the rows and says how many are left', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(createListStore());
    for (let index = 0; index < 5; index += 1) {
      store.addItem(`item ${index}`);
    }
    store.transaction('Many', () => {
      for (let index = 0; index < 250; index += 1) {
        store.addItem(`more ${index}`);
      }
    });
    const fixture = mountDevtools(store);
    expect(rowsOf(fixture)).toHaveLength(200);
    expect(host(fixture).querySelector('st-entry-diff .note')?.textContent).toContain(
      '50 more operations',
    );
  });
});
