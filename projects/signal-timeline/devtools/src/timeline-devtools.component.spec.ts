import type { ComponentFixture } from '@angular/core/testing';
import { getState } from '@ngrx/signals';
import { TimelineDevtoolsComponent } from './timeline-devtools.component';
import {
  branchingStore,
  itemFor,
  mountDevtools,
  press,
  settle,
  treeItems,
  untouchedStore,
} from './testing/devtools-fixture';

function host(fixture: ComponentFixture<unknown>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function range(fixture: ComponentFixture<unknown>): HTMLInputElement {
  const input = host(fixture).querySelector<HTMLInputElement>('input[type="range"]');
  if (input === null) {
    throw new Error('no range input');
  }
  return input;
}

function buttonNamed(fixture: ComponentFixture<unknown>, name: string): HTMLButtonElement {
  const button = Array.from(host(fixture).querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (button === undefined) {
    throw new Error(`no button ${name}`);
  }
  return button;
}

describe('TimelineDevtoolsComponent', () => {
  describe('the tree and the ARIA tree pattern', () => {
    it('is a labelled tree of tree items', () => {
      const fixture = mountDevtools(branchingStore());
      const tree = host(fixture).querySelector('[role="tree"]');
      expect(tree?.getAttribute('aria-label')).toBe('History tree');
      expect(treeItems(host(fixture))).toHaveLength(4);
    });

    it('sets level, set size and position on every item, the active branch first', () => {
      const fixture = mountDevtools(branchingStore());
      const levelsOf = (id: number) => {
        const item = itemFor(host(fixture), id);
        return ['aria-level', 'aria-setsize', 'aria-posinset'].map((name) =>
          item.getAttribute(name),
        );
      };
      expect(levelsOf(1)).toEqual(['1', '1', '1']);
      expect(levelsOf(2)).toEqual(['2', '1', '1']);
      expect(levelsOf(4)).toEqual(['3', '2', '1']);
      expect(levelsOf(3)).toEqual(['3', '2', '2']);
    });

    it('marks parents with aria-expanded and leaves it off the leaves', () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const expanded = treeItems(host(fixture)).map((item) => item.getAttribute('aria-expanded'));
      expect(expanded).toEqual(['true', 'true', null, null]);
    });

    it('selects exactly the current entry and follows it', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const selected = () =>
        treeItems(host(fixture))
          .filter((item) => item.getAttribute('aria-selected') === 'true')
          .map((item) => item.getAttribute('data-node-id'));
      expect(selected()).toEqual([String(store.currentEntryId())]);
      expect(treeItems(host(fixture)).every((item) => item.hasAttribute('aria-selected'))).toBe(
        true,
      );
      store.undo();
      await settle(fixture);
      expect(selected()).toEqual([String(store.currentEntryId())]);
    });

    it('names an item by its label, its id and whether it is current', () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const name = itemFor(host(fixture), store.currentEntryId()).getAttribute('aria-label');
      expect(name).toContain(`Entry ${store.currentEntryId()}.`);
      expect(name).toContain('Current entry.');
      expect(name).toContain('Changed: title.');
      const other = itemFor(host(fixture), 1).getAttribute('aria-label');
      expect(other).toBe('Initial state. Entry 1.');
    });

    it('draws the current entry as a diamond and the others as circles', () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const current = itemFor(host(fixture), store.currentEntryId());
      expect(current.querySelector('rect.shape')).not.toBeNull();
      expect(current.querySelector('circle.shape')).toBeNull();
      const other = itemFor(host(fixture), 1);
      expect(other.querySelector('circle.shape')).not.toBeNull();
      expect(other.querySelector('rect.shape')).toBeNull();
    });

    it('describes the keys in a hint the tree points at', () => {
      const fixture = mountDevtools(branchingStore());
      const tree = host(fixture).querySelector('[role="tree"]');
      const hint = host(fixture).querySelector(`#${tree?.getAttribute('aria-describedby')}`);
      expect(hint?.textContent).toContain('Arrow keys');
    });
  });

  describe('roving tabindex and keys', () => {
    it('puts the only tab stop on the current entry', () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const stops = treeItems(host(fixture)).filter(
        (item) => item.getAttribute('tabindex') === '0',
      );
      expect(stops.map((item) => item.getAttribute('data-node-id'))).toEqual([
        String(store.currentEntryId()),
      ]);
    });

    it('moves focus and the tab stop with the arrow keys', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const items = treeItems(host(fixture));
      const start = itemFor(host(fixture), store.currentEntryId());
      start.focus();
      press(start, 'ArrowUp');
      await settle(fixture);
      const index = items.indexOf(start);
      expect(document.activeElement).toBe(items[index - 1]);
      expect(items[index - 1].getAttribute('tabindex')).toBe('0');
      expect(start.getAttribute('tabindex')).toBe('-1');
      press(items[index - 1], 'ArrowDown');
      expect(document.activeElement).toBe(start);
    });

    it('goes to the first and the last item with Home and End', () => {
      const fixture = mountDevtools(branchingStore());
      const items = treeItems(host(fixture));
      items[1].focus();
      press(items[1], 'End');
      expect(document.activeElement).toBe(items.at(-1));
      press(items.at(-1) as HTMLElement, 'Home');
      expect(document.activeElement).toBe(items[0]);
    });

    it('closes an open node with Left, opens it with Right and then enters it', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const first = itemFor(host(fixture), 2);
      store.jumpTo(2);
      await settle(fixture);
      first.focus();
      expect(treeItems(host(fixture))).toHaveLength(4);
      press(first, 'ArrowLeft');
      await settle(fixture);
      expect(treeItems(host(fixture))).toHaveLength(2);
      expect(first.getAttribute('aria-expanded')).toBe('false');
      press(first, 'ArrowRight');
      await settle(fixture);
      expect(treeItems(host(fixture))).toHaveLength(4);
      expect(first.getAttribute('aria-expanded')).toBe('true');
      press(first, 'ArrowRight');
      const children = treeItems(host(fixture));
      expect(document.activeElement).toBe(children[2]);
    });

    it('moves to the parent with Left from a leaf', () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const leaf = itemFor(host(fixture), store.currentEntryId());
      leaf.focus();
      press(leaf, 'ArrowLeft');
      expect(document.activeElement).toBe(itemFor(host(fixture), 2));
    });

    it('does not close a branch that leads to the current entry', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const root = itemFor(host(fixture), 1);
      root.focus();
      press(root, 'ArrowLeft');
      await settle(fixture);
      expect(treeItems(host(fixture))).toHaveLength(4);
      expect(root.getAttribute('aria-expanded')).toBe('true');
    });

    it('jumps with Enter and with Space', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      press(itemFor(host(fixture), 2), 'Enter');
      expect(store.currentEntryId()).toBe(2);
      press(itemFor(host(fixture), 1), ' ');
      expect(store.currentEntryId()).toBe(1);
      await settle(fixture);
      expect(itemFor(host(fixture), 1).getAttribute('aria-selected')).toBe('true');
    });

    it('jumps to another branch', () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      press(itemFor(host(fixture), 3), 'Enter');
      expect(store.currentEntryId()).toBe(3);
      expect(getState(store)).toMatchObject({ count: 2, title: 'start' });
    });

    it('jumps on click', () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      itemFor(host(fixture), 2).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(store.currentEntryId()).toBe(2);
    });

    it('ignores other keys and keys with modifiers', () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const current = itemFor(host(fixture), store.currentEntryId());
      current.focus();
      const plain = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
      current.dispatchEvent(plain);
      expect(plain.defaultPrevented).toBe(false);
      const modified = new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      current.dispatchEvent(modified);
      expect(modified.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(current);
    });

    it('hands the tab stop back to the current entry when focus leaves the tree', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const items = treeItems(host(fixture));
      items[0].focus();
      await settle(fixture);
      expect(items[0].getAttribute('tabindex')).toBe('0');
      items[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
      await settle(fixture);
      expect(items[0].getAttribute('tabindex')).toBe('-1');
      expect(itemFor(host(fixture), store.currentEntryId()).getAttribute('tabindex')).toBe('0');
    });

    it('keeps the tab stop when focus moves inside the tree', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const items = treeItems(host(fixture));
      items[0].focus();
      items[0].dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: items[1] }),
      );
      await settle(fixture);
      expect(items[0].getAttribute('tabindex')).toBe('0');
    });
  });

  describe('the scrubber', () => {
    it('spans the current branch and reports the step in aria-valuetext', () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const input = range(fixture);
      expect(input.min).toBe('0');
      expect(input.max).toBe('2');
      expect(input.value).toBe('2');
      expect(input.getAttribute('aria-valuetext')).toMatch(/^Step 2 of 2: /);
      expect(host(fixture).querySelector('.readout')?.textContent).toContain('Step 2 of 2');
    });

    it('jumps when the thumb moves', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const input = range(fixture);
      input.value = '0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(store.currentEntryId()).toBe(1);
      await settle(fixture);
      expect(input.value).toBe('0');
      expect(input.getAttribute('aria-valuetext')).toBe('Step 0 of 2: Initial state');
    });

    it('moves one step with the arrow keys and takes the keys the browser would', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const input = range(fixture);
      press(input, 'ArrowLeft');
      expect(store.currentEntryId()).toBe(2);
      await settle(fixture);
      press(input, 'ArrowDown');
      expect(store.currentEntryId()).toBe(1);
      await settle(fixture);
      press(input, 'ArrowRight');
      expect(store.currentEntryId()).toBe(2);
      await settle(fixture);
      press(input, 'ArrowUp');
      expect(store.currentEntryId()).toBe(store.entries().at(-1)?.id);
    });

    it('takes a second key press before the view has caught up with the first', () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const input = range(fixture);
      press(input, 'ArrowLeft');
      press(input, 'ArrowLeft');
      expect(store.currentEntryId()).toBe(1);
    });

    it('goes to the ends with Home and End and by ten with Page Up and Page Down', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const input = range(fixture);
      press(input, 'Home');
      expect(store.currentEntryId()).toBe(1);
      await settle(fixture);
      press(input, 'End');
      expect(store.currentEntryId()).toBe(store.entries().at(-1)?.id);
      await settle(fixture);
      press(input, 'PageDown');
      expect(store.currentEntryId()).toBe(1);
      await settle(fixture);
      press(input, 'PageUp');
      expect(store.currentEntryId()).toBe(store.entries().at(-1)?.id);
    });

    it('does not move past the ends and leaves other keys alone', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const input = range(fixture);
      const before = store.currentEntryId();
      press(input, 'ArrowRight');
      expect(store.currentEntryId()).toBe(before);
      const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
      input.dispatchEvent(other);
      expect(other.defaultPrevented).toBe(false);
      const shifted = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(shifted);
      expect(shifted.defaultPrevented).toBe(false);
      expect(store.currentEntryId()).toBe(before);
    });

    it('keeps the track under the thumb while scrubbing back and forth past a branch point', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const input = range(fixture);
      press(input, 'Home');
      await settle(fixture);
      press(input, 'ArrowRight');
      await settle(fixture);
      expect(store.currentEntryId()).toBe(2);
      press(input, 'ArrowRight');
      await settle(fixture);
      expect(store.currentEntryId()).toBe(4);
      expect(input.max).toBe('2');
    });

    it('follows the newest branch from a current entry that is off the old track', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      store.jumpTo(3);
      await settle(fixture);
      expect(range(fixture).max).toBe('2');
      expect(range(fixture).value).toBe('2');
      expect(range(fixture).getAttribute('aria-valuetext')).toContain(
        store.entries().find((entry) => entry.id === 3)?.label,
      );
    });

    it('is disabled when there is nothing to scrub', () => {
      const fixture = mountDevtools(untouchedStore());
      expect(range(fixture).disabled).toBe(true);
      expect(range(fixture).max).toBe('0');
      expect(treeItems(host(fixture))).toHaveLength(1);
    });
  });

  describe('the toolbar', () => {
    it('disables undo and first at the start and redo and last at the end', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      expect(buttonNamed(fixture, 'Undo').disabled).toBe(false);
      expect(buttonNamed(fixture, 'First').disabled).toBe(false);
      expect(buttonNamed(fixture, 'Redo').disabled).toBe(true);
      expect(buttonNamed(fixture, 'Last').disabled).toBe(true);
      buttonNamed(fixture, 'First').click();
      await settle(fixture);
      expect(store.currentEntryId()).toBe(1);
      expect(buttonNamed(fixture, 'Undo').disabled).toBe(true);
      expect(buttonNamed(fixture, 'First').disabled).toBe(true);
      expect(buttonNamed(fixture, 'Redo').disabled).toBe(false);
      expect(buttonNamed(fixture, 'Last').disabled).toBe(false);
    });

    it('undoes, redoes and goes to the last entry of the branch', async () => {
      const store = branchingStore();
      const fixture = mountDevtools(store);
      const tip = store.currentEntryId();
      buttonNamed(fixture, 'Undo').click();
      expect(store.currentEntryId()).toBe(2);
      await settle(fixture);
      buttonNamed(fixture, 'Redo').click();
      expect(store.currentEntryId()).toBe(tip);
      await settle(fixture);
      buttonNamed(fixture, 'First').click();
      await settle(fixture);
      buttonNamed(fixture, 'Last').click();
      expect(store.currentEntryId()).toBe(tip);
    });
  });

  describe('theme', () => {
    it('reflects the theme input on the host', async () => {
      const fixture = mountDevtools(branchingStore());
      expect(host(fixture).getAttribute('data-theme')).toBe('auto');
      fixture.componentRef.setInput('theme', 'dark');
      await settle(fixture);
      expect(host(fixture).getAttribute('data-theme')).toBe('dark');
    });
  });

  it('has a named region', () => {
    const fixture = mountDevtools(branchingStore());
    expect(host(fixture).querySelector('section')?.getAttribute('aria-label')).toBe(
      'Timeline devtools',
    );
    expect(fixture.componentInstance).toBeInstanceOf(TimelineDevtoolsComponent);
  });
});
