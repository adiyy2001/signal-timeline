import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { EditorStore, historyStorageKey } from '../editor/editor.store';
import { ID_GENERATOR } from '../editor/id-generator';
import type { Rect } from '../editor/model';
import { CanvasComponent } from './canvas.component';

const box: Rect = { x: 100, y: 100, width: 140, height: 90 };

interface Harness {
  readonly fixture: ComponentFixture<CanvasComponent>;
  readonly store: InstanceType<typeof EditorStore>;
  readonly surface: SVGSVGElement;
  down(x: number, y: number, target?: Element, button?: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
  drag(from: [number, number], to: [number, number]): void;
  key(target: Element, key: string, init?: KeyboardEventInit): KeyboardEvent;
  shape(id: string): Element;
  render(): void;
}

function setup(): Harness {
  sessionStorage.clear();
  TestBed.resetTestingModule();
  let counter = 0;
  TestBed.configureTestingModule({
    providers: [{ provide: ID_GENERATOR, useValue: (prefix: string) => `${prefix}-${++counter}` }],
  });
  const store = TestBed.inject(EditorStore);
  const fixture = TestBed.createComponent(CanvasComponent);
  fixture.detectChanges();
  const surface: SVGSVGElement = fixture.nativeElement.querySelector('svg.surface');
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 960, 600));
  const render = () => {
    TestBed.tick();
    fixture.detectChanges();
  };
  const pointer = (type: string, x: number, y: number, button = 0) =>
    new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
  return {
    fixture,
    store,
    surface,
    render,
    down: (x, y, target = surface, button = 0) => {
      target.dispatchEvent(pointer('pointerdown', x, y, button));
      render();
    },
    move: (x, y) => {
      window.dispatchEvent(pointer('pointermove', x, y));
      render();
    },
    up: (x, y) => {
      window.dispatchEvent(pointer('pointerup', x, y));
      render();
    },
    drag(from, to) {
      this.down(from[0], from[1]);
      this.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
      this.move(to[0], to[1]);
      this.up(to[0], to[1]);
    },
    key: (target, key, init = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      render();
      return event;
    },
    shape: (id) => {
      render();
      const element = fixture.nativeElement.querySelector(`[data-shape-id="${id}"]`);
      if (element === null) {
        throw new Error(`No shape ${id}`);
      }
      return element;
    },
  };
}

function labels(harness: Harness): string[] {
  return harness.store.entries().map((entry) => entry.label);
}

describe('CanvasComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.removeItem(historyStorageKey);
  });

  describe('drawing', () => {
    it('draws a rectangle from a drag as one entry and shows a preview while dragging', () => {
      const harness = setup();
      harness.store.selectTool('rectangle');
      harness.down(100, 100);
      harness.move(260, 200);
      expect(harness.fixture.nativeElement.querySelector('rect.draft')).not.toBeNull();
      harness.up(260, 200);
      expect(harness.fixture.nativeElement.querySelector('rect.draft')).toBeNull();
      expect(harness.store.shapeEntities()).toMatchObject([
        { kind: 'rectangle', x: 100, y: 100, width: 160, height: 100 },
      ]);
      expect(labels(harness)).toEqual(['Initial state', 'Add Rectangle 1']);
      expect(harness.store.tool()).toBe('select');
    });

    it('draws an ellipse in any drag direction', () => {
      const harness = setup();
      harness.store.selectTool('ellipse');
      harness.down(300, 300);
      harness.move(200, 240);
      expect(harness.fixture.nativeElement.querySelector('ellipse.draft')).not.toBeNull();
      harness.up(200, 240);
      expect(harness.store.shapeEntities()).toMatchObject([
        { kind: 'ellipse', x: 200, y: 240, width: 100, height: 60 },
      ]);
    });

    it('places a default sized shape for a click', () => {
      const harness = setup();
      harness.store.selectTool('rectangle');
      harness.down(400, 300);
      harness.up(400, 300);
      expect(harness.store.shapeEntities()).toMatchObject([
        { x: 330, y: 255, width: 140, height: 90 },
      ]);
    });

    it('cancels a drawing on pointercancel', () => {
      const harness = setup();
      harness.store.selectTool('rectangle');
      harness.down(100, 100);
      harness.move(200, 200);
      window.dispatchEvent(new Event('pointercancel'));
      harness.render();
      expect(harness.store.shapeEntities()).toHaveLength(0);
      expect(harness.fixture.nativeElement.querySelector('rect.draft')).toBeNull();
    });

    it('shows a hint for the empty canvas and hides it after the first shape', () => {
      const harness = setup();
      expect(harness.fixture.nativeElement.querySelector('text.empty')).not.toBeNull();
      harness.store.addShape('rectangle', box);
      harness.render();
      expect(harness.fixture.nativeElement.querySelector('text.empty')).toBeNull();
    });

    it('ignores a secondary button', () => {
      const harness = setup();
      harness.store.selectTool('rectangle');
      harness.down(100, 100, harness.surface, 2);
      harness.up(100, 100);
      expect(harness.store.shapeEntities()).toHaveLength(0);
    });
  });

  describe('selecting and moving', () => {
    it('selects the shape under the pointer and deselects on empty canvas', () => {
      const harness = setup();
      const id = harness.store.addShape('rectangle', box);
      harness.store.select(null);
      harness.down(150, 140);
      harness.up(150, 140);
      expect(harness.store.selectedId()).toBe(id);
      harness.down(700, 500);
      harness.up(700, 500);
      expect(harness.store.selectedId()).toBeNull();
    });

    it('moves a shape with a drag and records one entry', () => {
      const harness = setup();
      const id = harness.store.addShape('rectangle', box);
      harness.drag([150, 140], [250, 200]);
      expect(harness.store.shapeEntityMap()[id]).toMatchObject({ x: 200, y: 160 });
      expect(labels(harness)).toEqual(['Initial state', 'Add Rectangle 1', 'Move Rectangle 1']);
      harness.store.undo();
      expect(harness.store.shapeEntityMap()[id]).toMatchObject({ x: 100, y: 100 });
    });

    it('keeps a moved shape inside the canvas', () => {
      const harness = setup();
      const id = harness.store.addShape('rectangle', box);
      harness.drag([150, 140], [5000, 5000]);
      expect(harness.store.shapeEntityMap()[id]).toMatchObject({ x: 820, y: 510 });
    });

    it('records no entry for a click without movement', () => {
      const harness = setup();
      harness.store.addShape('rectangle', box);
      harness.down(150, 140);
      harness.up(150, 140);
      expect(harness.store.entries()).toHaveLength(2);
    });

    it('stops a drag on pointercancel and keeps what was moved', () => {
      const harness = setup();
      const id = harness.store.addShape('rectangle', box);
      harness.down(150, 140);
      harness.move(180, 140);
      window.dispatchEvent(new Event('pointercancel'));
      harness.move(400, 400);
      expect(harness.store.shapeEntityMap()[id]).toMatchObject({ x: 130 });
      expect(harness.store.entries()).toHaveLength(3);
    });

    it('selects a connector by clicking it', () => {
      const harness = setup();
      const first = harness.store.addShape('rectangle', { ...box, x: 40 });
      const second = harness.store.addShape('rectangle', { ...box, x: 600 });
      const connector = harness.store.connect(first, second);
      harness.store.select(null);
      harness.render();
      const line = harness.fixture.nativeElement.querySelector('.connector-hit');
      harness.down(400, 145, line);
      harness.up(400, 145);
      expect(harness.store.selectedId()).toBe(connector);
    });
  });

  describe('resizing', () => {
    it('resizes from a corner handle as one entry', () => {
      const harness = setup();
      const id = harness.store.addShape('rectangle', box);
      harness.render();
      const handle = harness.fixture.nativeElement.querySelector('[data-corner="se"]');
      harness.down(240, 190, handle);
      harness.move(260, 210);
      harness.move(280, 230);
      harness.up(280, 230);
      expect(harness.store.shapeEntityMap()[id]).toMatchObject({
        x: 100,
        y: 100,
        width: 180,
        height: 130,
      });
      expect(labels(harness).at(-1)).toBe('Resize Rectangle 1');
      expect(harness.store.entries()).toHaveLength(3);
    });

    it('resizes from the north west corner', () => {
      const harness = setup();
      const id = harness.store.addShape('rectangle', box);
      harness.render();
      const handle = harness.fixture.nativeElement.querySelector('[data-corner="nw"]');
      harness.down(100, 100, handle);
      harness.move(80, 90);
      harness.up(80, 90);
      expect(harness.store.shapeEntityMap()[id]).toMatchObject({
        x: 80,
        y: 90,
        width: 160,
        height: 100,
      });
    });
  });

  describe('connectors', () => {
    function twoShapes() {
      const harness = setup();
      const first = harness.store.addShape('rectangle', { ...box, x: 40 });
      const second = harness.store.addShape('ellipse', { ...box, x: 600 });
      harness.store.selectTool('connector');
      harness.render();
      return { harness, first, second };
    }

    it('connects two shapes with a drag and shows a preview line', () => {
      const { harness } = twoShapes();
      harness.down(100, 140);
      harness.move(300, 145);
      expect(harness.fixture.nativeElement.querySelector('line.draft-line')).not.toBeNull();
      harness.up(660, 145);
      expect(harness.store.connectorEntities()).toHaveLength(1);
      expect(labels(harness).at(-1)).toBe('Add connector from Rectangle 1 to Ellipse 1');
      expect(harness.store.tool()).toBe('select');
      expect(harness.fixture.nativeElement.querySelector('.connector')).not.toBeNull();
    });

    it('connects with two clicks and marks the first shape as pending', () => {
      const { harness, first } = twoShapes();
      harness.down(100, 140);
      harness.up(100, 140);
      expect(harness.shape(first).classList).toContain('pending');
      expect(harness.fixture.nativeElement.querySelector('.hint').textContent).toContain('ends at');
      harness.down(660, 145);
      expect(harness.store.connectorEntities()).toHaveLength(1);
    });

    it('drops the pending shape when empty canvas is clicked', () => {
      const { harness, first } = twoShapes();
      harness.down(100, 140);
      harness.up(100, 140);
      harness.down(500, 500);
      expect(harness.shape(first).classList).not.toContain('pending');
    });

    it('does not connect a shape to itself', () => {
      const { harness } = twoShapes();
      harness.drag([100, 140], [160, 150]);
      expect(harness.store.connectorEntities()).toHaveLength(0);
    });

    it('connects with the keyboard', () => {
      const { harness, first, second } = twoShapes();
      harness.key(harness.shape(first), 'Enter');
      harness.key(harness.shape(second), ' ');
      expect(harness.store.connectorEntities()).toHaveLength(1);
    });

    it('cancels the pending shape, then the tool', () => {
      const { harness, first } = twoShapes();
      harness.key(harness.shape(first), 'Enter');
      harness.key(harness.shape(first), 'Escape');
      expect(harness.shape(first).classList).not.toContain('pending');
      expect(harness.store.tool()).toBe('connector');
      harness.key(harness.shape(first), 'Escape');
      expect(harness.store.tool()).toBe('select');
    });

    it('hides a connector between overlapping shapes', () => {
      const harness = setup();
      const first = harness.store.addShape('rectangle', box);
      const second = harness.store.addShape('rectangle', { ...box, x: 150 });
      harness.store.connect(first, second);
      harness.render();
      expect(harness.fixture.nativeElement.querySelector('.connector')).toBeNull();
    });
  });

  describe('keyboard', () => {
    it('moves a shape with the arrow keys and merges a run into one entry', () => {
      const harness = setup();
      const id = harness.store.addShape('rectangle', box);
      const element = harness.shape(id);
      const event = harness.key(element, 'ArrowRight');
      expect(event.defaultPrevented).toBe(true);
      harness.key(element, 'ArrowRight');
      harness.key(element, 'ArrowDown');
      harness.key(element, 'ArrowLeft', { shiftKey: true });
      expect(harness.store.shapeEntityMap()[id]).toMatchObject({ x: 118, y: 110 });
      expect(harness.store.entries()).toHaveLength(3);
      expect(harness.store.selectedId()).toBe(id);
    });

    it('does not move a shape for arrow keys with modifiers', () => {
      const harness = setup();
      const id = harness.store.addShape('rectangle', box);
      harness.key(harness.shape(id), 'ArrowRight', { ctrlKey: true });
      harness.key(harness.shape(id), 'ArrowRight', { altKey: true });
      expect(harness.store.shapeEntityMap()[id]).toMatchObject({ x: 100 });
    });

    it('resizes with plus and minus', () => {
      const harness = setup();
      const id = harness.store.addShape('rectangle', box);
      harness.key(harness.shape(id), '+');
      harness.key(harness.shape(id), '=');
      harness.key(harness.shape(id), '-');
      harness.key(harness.shape(id), '_');
      expect(harness.store.shapeEntityMap()[id]).toMatchObject({ width: 140, height: 90 });
    });

    it('selects with Enter and Space', () => {
      const harness = setup();
      const first = harness.store.addShape('rectangle', box);
      const second = harness.store.addShape('rectangle', { ...box, x: 400 });
      harness.key(harness.shape(first), 'Enter');
      expect(harness.store.selectedId()).toBe(first);
      harness.key(harness.shape(second), ' ');
      expect(harness.store.selectedId()).toBe(second);
    });

    it('deletes with Delete and Backspace and moves focus to the canvas', () => {
      const harness = setup();
      const first = harness.store.addShape('rectangle', box);
      const second = harness.store.addShape('rectangle', { ...box, x: 400 });
      harness.key(harness.shape(first), 'Delete');
      expect(harness.store.shapeEntities().map((shape) => shape.id)).toEqual([second]);
      harness.key(harness.shape(second), 'Backspace');
      expect(harness.store.shapeEntities()).toHaveLength(0);
      expect(document.activeElement).toBe(harness.surface);
    });

    it('deletes a connector with the keyboard', () => {
      const harness = setup();
      const first = harness.store.addShape('rectangle', { ...box, x: 40 });
      const second = harness.store.addShape('rectangle', { ...box, x: 600 });
      const connector = harness.store.connect(first, second);
      harness.render();
      const element = harness.fixture.nativeElement.querySelector(
        `[data-connector-id="${connector}"]`,
      );
      harness.store.select(null);
      harness.key(element, 'Enter');
      expect(harness.store.selectedId()).toBe(connector);
      harness.key(element, 'Delete');
      expect(harness.store.connectorEntities()).toHaveLength(0);
      expect(harness.store.shapeEntities()).toHaveLength(2);
    });

    it('leaves other keys alone', () => {
      const harness = setup();
      const id = harness.store.addShape('rectangle', box);
      const event = harness.key(harness.shape(id), 'a');
      expect(event.defaultPrevented).toBe(false);
      harness.key(harness.surface, 'ArrowRight');
      expect(harness.store.entries()).toHaveLength(2);
    });

    it('clears the selection with Escape in the select tool', () => {
      const harness = setup();
      const id = harness.store.addShape('rectangle', box);
      harness.key(harness.shape(id), 'Escape');
      expect(harness.store.selectedId()).toBeNull();
    });

    it('cancels a drawing tool with Escape', () => {
      const harness = setup();
      harness.store.selectTool('ellipse');
      harness.key(harness.surface, 'Escape');
      expect(harness.store.tool()).toBe('select');
    });
  });

  describe('accessibility', () => {
    it('gives every shape a name, a role and a pressed state', () => {
      const harness = setup();
      const id = harness.store.addShape('ellipse', box);
      harness.store.select(null);
      harness.render();
      const element = harness.shape(id);
      expect(element.getAttribute('role')).toBe('button');
      expect(element.getAttribute('tabindex')).toBe('0');
      expect(element.getAttribute('aria-label')).toBe('Ellipse 1, mint, 140 by 90 at 100, 100');
      expect(element.getAttribute('aria-pressed')).toBe('false');
      harness.store.select(id);
      harness.render();
      expect(element.getAttribute('aria-pressed')).toBe('true');
    });

    it('selects a shape when it receives focus in the select tool only', () => {
      const harness = setup();
      const id = harness.store.addShape('rectangle', box);
      harness.store.select(null);
      harness.render();
      harness.shape(id).dispatchEvent(new FocusEvent('focus'));
      expect(harness.store.selectedId()).toBe(id);
      harness.store.selectTool('connector');
      harness.shape(id).dispatchEvent(new FocusEvent('focus'));
      expect(harness.store.selectedId()).toBeNull();
    });

    it('describes the active tool', () => {
      const harness = setup();
      const hint = () => harness.fixture.nativeElement.querySelector('.hint').textContent;
      expect(hint()).toContain('Tab to it');
      harness.store.selectTool('rectangle');
      harness.render();
      expect(hint()).toContain('Rectangle: drag');
      harness.store.selectTool('connector');
      harness.render();
      expect(hint()).toContain('starts from');
    });

    it('shows the name only on shapes that are large enough', () => {
      const harness = setup();
      harness.store.addShape('rectangle', { x: 10, y: 10, width: 60, height: 30 });
      harness.store.addShape('rectangle', { x: 300, y: 10, width: 120, height: 60 });
      harness.render();
      expect(harness.fixture.nativeElement.querySelectorAll('text.name')).toHaveLength(1);
    });
  });
});
