import { TestBed } from '@angular/core/testing';
import { EditorStore } from '../editor/editor.store';
import { ID_GENERATOR } from '../editor/id-generator';
import { ToolbarComponent } from './toolbar.component';

function setup() {
  sessionStorage.clear();
  TestBed.resetTestingModule();
  let counter = 0;
  TestBed.configureTestingModule({
    providers: [{ provide: ID_GENERATOR, useValue: (prefix: string) => `${prefix}-${++counter}` }],
  });
  const store = TestBed.inject(EditorStore);
  const fixture = TestBed.createComponent(ToolbarComponent);
  fixture.detectChanges();
  const buttons = (): HTMLButtonElement[] => [...fixture.nativeElement.querySelectorAll('button')];
  const button = (name: RegExp): HTMLButtonElement => {
    const found = buttons().find((candidate) => name.test(candidate.textContent ?? ''));
    if (found === undefined) {
      throw new Error(`No button ${name}`);
    }
    return found;
  };
  const click = (name: RegExp) => {
    button(name).click();
    TestBed.tick();
    fixture.detectChanges();
  };
  return { store, fixture, button, click };
}

describe('ToolbarComponent', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('shows the four tools and marks the active one as pressed', () => {
    const { button, click, store } = setup();
    expect(button(/^\s*Select/).getAttribute('aria-pressed')).toBe('true');
    click(/^\s*Ellipse/);
    expect(store.tool()).toBe('ellipse');
    expect(button(/^\s*Ellipse/).getAttribute('aria-pressed')).toBe('true');
    expect(button(/^\s*Select/).getAttribute('aria-pressed')).toBe('false');
    click(/^\s*Connector/);
    expect(store.tool()).toBe('connector');
  });

  it('adds shapes without a pointer, each at a new place', () => {
    const { click, store } = setup();
    click(/Add rectangle/);
    click(/Add ellipse/);
    click(/Add rectangle/);
    const positions = store.shapeEntities().map((shape) => `${shape.x},${shape.y}`);
    expect(new Set(positions).size).toBe(3);
    expect(store.shapeEntities().map((shape) => shape.kind)).toEqual([
      'rectangle',
      'ellipse',
      'rectangle',
    ]);
    expect(store.selectedShape()?.name).toBe('Rectangle 2');
  });

  it('disables undo, redo and delete until they apply', () => {
    const { button, click, store } = setup();
    expect(button(/Undo/).disabled).toBe(true);
    expect(button(/Redo/).disabled).toBe(true);
    expect(button(/Delete/).disabled).toBe(true);
    click(/Add rectangle/);
    expect(button(/Undo/).disabled).toBe(false);
    expect(button(/Delete/).disabled).toBe(false);
    click(/Undo/);
    expect(store.shapeEntities()).toHaveLength(0);
    expect(button(/Redo/).disabled).toBe(false);
    click(/Redo/);
    expect(store.shapeEntities()).toHaveLength(1);
    click(/Delete/);
    expect(store.shapeEntities()).toHaveLength(0);
  });

  it('shows the keyboard shortcut next to undo, redo and delete', () => {
    const { fixture } = setup();
    const hints = [...fixture.nativeElement.querySelectorAll('kbd')].map(
      (element: HTMLElement) => element.textContent,
    );
    expect(hints).toEqual(['Ctrl+Z', 'Ctrl+Shift+Z', 'Del']);
  });
});
