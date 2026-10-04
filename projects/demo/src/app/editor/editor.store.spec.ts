import { TestBed } from '@angular/core/testing';
import { getState } from '@ngrx/signals';
import { EditorStore, historyStorageKey } from './editor.store';
import { ID_GENERATOR } from './id-generator';
import type { Rect } from './model';

const box: Rect = { x: 100, y: 100, width: 140, height: 90 };

function open() {
  TestBed.resetTestingModule();
  let counter = 0;
  TestBed.configureTestingModule({
    providers: [{ provide: ID_GENERATOR, useValue: (prefix: string) => `${prefix}-${++counter}` }],
  });
  return TestBed.inject(EditorStore);
}

function labels(store: ReturnType<typeof open>): string[] {
  return store.entries().map((entry) => entry.label);
}

describe('EditorStore', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  describe('drawing', () => {
    it('adds a selected shape as one entry and returns to the select tool', () => {
      const store = open();
      store.selectTool('rectangle');
      const id = store.addShape('rectangle', box);
      expect(store.shapeEntities()).toHaveLength(1);
      expect(store.selectedId()).toBe(id);
      expect(store.tool()).toBe('select');
      expect(labels(store)).toEqual(['Initial state', 'Add Rectangle 1']);
    });

    it('numbers shapes of each kind', () => {
      const store = open();
      store.addShape('rectangle', box);
      store.addShape('rectangle', box);
      store.addShape('ellipse', box);
      expect(store.shapeEntities().map((shape) => shape.name)).toEqual([
        'Rectangle 1',
        'Rectangle 2',
        'Ellipse 1',
      ]);
    });

    it('records no entry for selection or tool changes', () => {
      const store = open();
      const id = store.addShape('rectangle', box);
      store.selectTool('connector');
      store.selectTool('select');
      store.select(id);
      store.select(null);
      expect(store.entries()).toHaveLength(2);
    });

    it('clears the selection when a drawing tool is picked', () => {
      const store = open();
      store.addShape('rectangle', box);
      store.selectTool('ellipse');
      expect(store.selectedId()).toBeNull();
      expect(store.tool()).toBe('ellipse');
    });
  });

  describe('editing', () => {
    it('recolors a shape and ignores the same color', () => {
      const store = open();
      const id = store.addShape('rectangle', box);
      store.setFill(id, 'rose');
      store.setFill(id, 'rose');
      expect(store.selectedShape()?.fill).toBe('rose');
      expect(labels(store)).toEqual([
        'Initial state',
        'Add Rectangle 1',
        'Recolor Rectangle 1 rose',
      ]);
      store.undo();
      expect(store.selectedShape()?.fill).toBe('sky');
    });

    it('sets the geometry once and skips an identical rectangle', () => {
      const store = open();
      const id = store.addShape('ellipse', box);
      store.setGeometry(id, { ...box, width: 200 });
      store.setGeometry(id, { ...box, width: 200 });
      store.setGeometry('missing', box);
      expect(store.entries()).toHaveLength(3);
      expect(labels(store).at(-1)).toBe('Resize Ellipse 1');
    });

    it('ignores edits of unknown shapes', () => {
      const store = open();
      store.setFill('missing', 'rose');
      store.nudge('missing', 10, 0);
      store.grow('missing', 10);
      expect(store.entries()).toHaveLength(1);
    });
  });

  describe('gestures', () => {
    it('turns a whole drag into one entry', () => {
      const store = open();
      const id = store.addShape('rectangle', box);
      store.beginDrag(id, 'move');
      for (let step = 1; step <= 20; step += 1) {
        store.setGeometry(id, { ...box, x: box.x + step * 5 });
      }
      store.endDrag();
      expect(store.entries()).toHaveLength(3);
      expect(labels(store).at(-1)).toBe('Move Rectangle 1');
      expect(store.selectedShape()?.x).toBe(200);
      store.undo();
      expect(store.selectedShape()?.x).toBe(100);
    });

    it('keeps two drags as two entries', () => {
      const store = open();
      const id = store.addShape('rectangle', box);
      store.beginDrag(id, 'move');
      store.setGeometry(id, { ...box, x: 150 });
      store.endDrag();
      store.beginDrag(id, 'move');
      store.setGeometry(id, { ...box, x: 200 });
      store.endDrag();
      expect(store.entries()).toHaveLength(4);
    });

    it('leaves no entry for a drag that ends where it started', () => {
      const store = open();
      const id = store.addShape('rectangle', box);
      store.beginDrag(id, 'move');
      store.setGeometry(id, { ...box, x: 300 });
      store.setGeometry(id, box);
      store.endDrag();
      expect(store.entries()).toHaveLength(2);
    });

    it('ends a drag that was never started without an error', () => {
      const store = open();
      expect(() => store.endDrag()).not.toThrow();
    });

    it('merges repeated key presses into one entry until the idle time passes', () => {
      vi.useFakeTimers();
      const store = open();
      const id = store.addShape('rectangle', box);
      store.nudge(id, 10, 0);
      store.nudge(id, 10, 0);
      store.nudge(id, 0, 10);
      expect(store.entries()).toHaveLength(3);
      expect(store.selectedShape()).toMatchObject({ x: 120, y: 110 });
      vi.advanceTimersByTime(700);
      store.nudge(id, 10, 0);
      expect(store.entries()).toHaveLength(4);
    });

    it('merges repeated growing into one entry', () => {
      vi.useFakeTimers();
      const store = open();
      const id = store.addShape('rectangle', box);
      store.grow(id, 10);
      store.grow(id, 10);
      expect(store.entries()).toHaveLength(3);
      expect(store.selectedShape()).toMatchObject({ width: 160, height: 110 });
    });

    it('seals a key press run before a delete', () => {
      vi.useFakeTimers();
      const store = open();
      const id = store.addShape('rectangle', box);
      store.nudge(id, 10, 0);
      store.deleteSelected();
      expect(labels(store).at(-1)).toBe('Delete Rectangle 1');
      expect(store.entries()).toHaveLength(4);
    });

    it('closes an open run when the store is destroyed', () => {
      vi.useFakeTimers();
      const store = open();
      const id = store.addShape('rectangle', box);
      store.nudge(id, 10, 0);
      expect(() => TestBed.resetTestingModule()).not.toThrow();
      expect(store.entries().length).toBeGreaterThan(0);
    });
  });

  describe('connectors', () => {
    function twoShapes() {
      const store = open();
      const first = store.addShape('rectangle', { ...box, x: 40 });
      const second = store.addShape('ellipse', { ...box, x: 400 });
      return { store, first, second };
    }

    it('joins two shapes with one entry', () => {
      const { store, first, second } = twoShapes();
      const id = store.connect(first, second);
      expect(id).toBeDefined();
      expect(store.connectorEntities()).toHaveLength(1);
      expect(store.selectedConnector()?.id).toBe(id);
      expect(labels(store).at(-1)).toBe('Add connector from Rectangle 1 to Ellipse 1');
    });

    it('refuses a connector to the same shape, to a missing shape and a duplicate', () => {
      const { store, first, second } = twoShapes();
      expect(store.connect(first, first)).toBeUndefined();
      expect(store.connect(first, 'missing')).toBeUndefined();
      expect(store.connect(first, second)).toBeDefined();
      expect(store.connect(first, second)).toBeUndefined();
      expect(store.connect(second, first)).toBeUndefined();
      expect(store.connectorEntities()).toHaveLength(1);
    });

    it('deletes a selected connector on its own', () => {
      const { store, first, second } = twoShapes();
      store.connect(first, second);
      store.deleteSelected();
      expect(store.connectorEntities()).toHaveLength(0);
      expect(store.shapeEntities()).toHaveLength(2);
      expect(labels(store).at(-1)).toBe('Delete connector from Rectangle 1 to Ellipse 1');
    });
  });

  describe('deleting', () => {
    it('removes a shape and its connectors in one entry that undo restores whole', () => {
      const store = open();
      const first = store.addShape('rectangle', { ...box, x: 40 });
      const second = store.addShape('ellipse', { ...box, x: 400 });
      const third = store.addShape('rectangle', { ...box, x: 700 });
      store.connect(first, second);
      store.connect(second, third);
      const before = getState(store);
      const entriesBefore = store.entries().length;
      store.select(second);
      store.deleteSelected();
      expect(store.entries()).toHaveLength(entriesBefore + 1);
      expect(labels(store).at(-1)).toBe('Delete Ellipse 1 and 2 connectors');
      expect(store.shapeEntities()).toHaveLength(2);
      expect(store.connectorEntities()).toHaveLength(0);
      expect(store.selectedId()).toBeNull();
      store.undo();
      expect(store.shapeEntities()).toHaveLength(3);
      expect(store.connectorEntities()).toHaveLength(2);
      expect(getState(store).shapeEntityMap).toEqual(before.shapeEntityMap);
      expect(getState(store).connectorEntityMap).toEqual(before.connectorEntityMap);
      store.redo();
      expect(store.shapeEntities()).toHaveLength(2);
    });

    it('names a single removed connector in the label', () => {
      const store = open();
      const first = store.addShape('rectangle', { ...box, x: 40 });
      const second = store.addShape('ellipse', { ...box, x: 400 });
      store.connect(first, second);
      store.select(first);
      store.deleteSelected();
      expect(labels(store).at(-1)).toBe('Delete Rectangle 1 and 1 connector');
    });

    it('does nothing without a selection', () => {
      const store = open();
      store.addShape('rectangle', box);
      store.select(null);
      store.deleteSelected();
      expect(store.entries()).toHaveLength(2);
    });
  });

  describe('history', () => {
    it('branches when a change follows an undo, and keeps both branches', () => {
      const store = open();
      const id = store.addShape('rectangle', box);
      store.setFill(id, 'rose');
      store.undo();
      store.setFill(id, 'amber');
      const branchPoint = store.entries().find((entry) => entry.children.length > 1);
      expect(branchPoint?.label).toBe('Add Rectangle 1');
      store.undo();
      expect(store.redoBranches()).toHaveLength(2);
      const roseEntry = store.entries().find((entry) => entry.label === 'Recolor Rectangle 1 rose');
      store.jumpTo(roseEntry?.id ?? -1);
      expect(store.selectedShape()?.fill).toBe('rose');
    });

    it('clears the history and keeps the drawing', () => {
      const store = open();
      store.addShape('rectangle', box);
      store.resetHistory();
      expect(store.entries()).toHaveLength(1);
      expect(store.shapeEntities()).toHaveLength(1);
    });

    it('keeps the history and the drawing across a reload', () => {
      const first = open();
      const id = first.addShape('rectangle', box);
      first.setFill(id, 'violet');
      window.dispatchEvent(new Event('pagehide'));
      expect(sessionStorage.getItem(historyStorageKey)).not.toBeNull();

      const reloaded = open();
      expect(reloaded.shapeEntities()).toHaveLength(1);
      expect(reloaded.shapeEntities()[0]?.fill).toBe('violet');
      expect(reloaded.entries().map((entry) => entry.label)).toEqual([
        'Initial state',
        'Add Rectangle 1',
        'Recolor Rectangle 1 violet',
      ]);
      reloaded.undo();
      expect(reloaded.shapeEntities()[0]?.fill).toBe('sky');
    });
  });
});
