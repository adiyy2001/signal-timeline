import { TestBed } from '@angular/core/testing';
import { EditorStore } from '../editor/editor.store';
import { ID_GENERATOR } from '../editor/id-generator';
import { InspectorComponent } from './inspector.component';

const box = { x: 100, y: 100, width: 140, height: 90 };

function setup() {
  sessionStorage.clear();
  TestBed.resetTestingModule();
  let counter = 0;
  TestBed.configureTestingModule({
    providers: [{ provide: ID_GENERATOR, useValue: (prefix: string) => `${prefix}-${++counter}` }],
  });
  const store = TestBed.inject(EditorStore);
  const fixture = TestBed.createComponent(InspectorComponent);
  const render = () => {
    TestBed.tick();
    fixture.detectChanges();
  };
  render();
  const inputs = (): HTMLInputElement[] => [...fixture.nativeElement.querySelectorAll('input')];
  const type = (index: number, value: string) => {
    render();
    const input = inputs()[index];
    if (input === undefined) {
      throw new Error('No input');
    }
    input.value = value;
    input.dispatchEvent(new Event('change'));
    render();
  };
  return { store, fixture, render, inputs, type };
}

describe('InspectorComponent', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('asks for a selection when nothing is selected', () => {
    const { fixture } = setup();
    expect(fixture.nativeElement.textContent).toContain('Nothing is selected');
  });

  it('shows the selected shape with its geometry and the current color', () => {
    const { store, render, fixture, inputs } = setup();
    store.addShape('rectangle', box);
    render();
    expect(fixture.nativeElement.textContent).toContain('Rectangle 1');
    expect(inputs().map((input) => input.value)).toEqual(['100', '100', '140', '90']);
    const pressed = fixture.nativeElement.querySelector('.swatch[aria-pressed="true"]');
    expect(pressed.textContent).toContain('sky');
  });

  it('changes the geometry from the fields as one entry each', () => {
    const { store, type } = setup();
    store.addShape('rectangle', box);
    type(2, '200');
    type(3, '120');
    type(0, '10');
    expect(store.selectedShape()).toMatchObject({ x: 10, y: 100, width: 200, height: 120 });
    expect(
      store
        .entries()
        .map((entry) => entry.label)
        .slice(-3),
    ).toEqual(['Resize Rectangle 1', 'Resize Rectangle 1', 'Move Rectangle 1']);
  });

  it('clamps a value that is too large and puts the clamped number back in the field', () => {
    const { store, type, inputs } = setup();
    store.addShape('rectangle', box);
    type(2, '99999');
    expect(store.selectedShape()?.width).toBe(960);
    expect(inputs()[2]?.value).toBe('960');
  });

  it('ignores text that is not a number and restores the field', () => {
    const { store, type, inputs } = setup();
    store.addShape('rectangle', box);
    type(0, '');
    type(1, 'abc');
    expect(store.entries()).toHaveLength(2);
    expect(inputs()[0]?.value).toBe('100');
    expect(inputs()[1]?.value).toBe('100');
  });

  it('recolors with the swatches', () => {
    const { store, fixture, render } = setup();
    store.addShape('rectangle', box);
    render();
    const rose: HTMLButtonElement = [...fixture.nativeElement.querySelectorAll('.swatch')].find(
      (element: HTMLElement) => element.textContent?.includes('rose'),
    );
    rose.click();
    render();
    expect(store.selectedShape()?.fill).toBe('rose');
    expect(rose.getAttribute('aria-pressed')).toBe('true');
  });

  it('describes a selected connector', () => {
    const { store, fixture, render } = setup();
    const first = store.addShape('rectangle', { ...box, x: 40 });
    const second = store.addShape('ellipse', { ...box, x: 600 });
    store.connect(first, second);
    render();
    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');
    expect(text).toContain('Connector from Rectangle 1 to Ellipse 1');
  });
});
