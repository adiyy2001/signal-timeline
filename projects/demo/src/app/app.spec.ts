import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { EditorStore } from './editor/editor.store';
import { ID_GENERATOR } from './editor/id-generator';

const box = { x: 100, y: 100, width: 140, height: 90 };

function setup() {
  sessionStorage.clear();
  TestBed.resetTestingModule();
  let counter = 0;
  TestBed.configureTestingModule({
    providers: [{ provide: ID_GENERATOR, useValue: (prefix: string) => `${prefix}-${++counter}` }],
  });
  const fixture = TestBed.createComponent(App);
  const store = TestBed.inject(EditorStore);
  const render = () => {
    TestBed.tick();
    fixture.detectChanges();
  };
  render();
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    document.dispatchEvent(event);
    render();
    return event;
  };
  return { fixture, store, render, press };
}

describe('App', () => {
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders the editor, the inspector and the devtools panel side by side', () => {
    const { fixture } = setup();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('h1')?.textContent).toContain('signal-timeline');
    expect(root.querySelector('demo-toolbar')).not.toBeNull();
    expect(root.querySelector('demo-canvas')).not.toBeNull();
    expect(root.querySelector('demo-inspector')).not.toBeNull();
    expect(root.querySelector('st-devtools')).not.toBeNull();
  });

  it('undoes and redoes with the keyboard shortcuts', () => {
    const { store, press } = setup();
    store.addShape('rectangle', box);
    expect(press('z', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(store.shapeEntities()).toHaveLength(0);
    press('z', { ctrlKey: true, shiftKey: true });
    expect(store.shapeEntities()).toHaveLength(1);
    press('z', { metaKey: true });
    expect(store.shapeEntities()).toHaveLength(0);
    press('y', { ctrlKey: true });
    expect(store.shapeEntities()).toHaveLength(1);
  });

  it('ignores keys without a modifier and combinations it does not own', () => {
    const { store, press } = setup();
    store.addShape('rectangle', box);
    press('z');
    press('z', { ctrlKey: true, altKey: true });
    press('a', { ctrlKey: true });
    press('y', { ctrlKey: true, shiftKey: true });
    expect(store.shapeEntities()).toHaveLength(1);
  });

  it('shows the autosave count and does not move it on undo', () => {
    const { fixture, store, render, press } = setup();
    const count = () =>
      fixture.nativeElement.querySelector('[data-test="autosave-count"]').textContent;
    expect(count()).toBe('0');
    store.addShape('rectangle', box);
    render();
    expect(count()).toBe('1');
    expect(fixture.nativeElement.querySelector('.autosave').textContent).toContain('1 time.');
    press('z', { ctrlKey: true });
    expect(count()).toBe('1');
  });

  it('cycles the theme and passes it to the devtools panel', () => {
    const { fixture, render } = setup();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.theme-button');
    expect(button.textContent).toContain('auto');
    button.click();
    render();
    expect(button.textContent).toContain('light');
    expect(fixture.nativeElement.querySelector('st-devtools').getAttribute('data-theme')).toBe(
      'light',
    );
  });

  it('clears the history and keeps the drawing', () => {
    const { fixture, store, render } = setup();
    store.addShape('rectangle', box);
    render();
    const clear: HTMLButtonElement = fixture.nativeElement.querySelector('.clear');
    expect(clear.disabled).toBe(false);
    clear.click();
    render();
    expect(store.entries()).toHaveLength(1);
    expect(store.shapeEntities()).toHaveLength(1);
    expect(clear.disabled).toBe(true);
  });
});
