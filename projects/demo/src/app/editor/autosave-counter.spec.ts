import { TestBed } from '@angular/core/testing';
import { AutosaveCounter } from './autosave-counter';
import { EditorStore } from './editor.store';
import { ID_GENERATOR } from './id-generator';

const box = { x: 100, y: 100, width: 140, height: 90 };

function open() {
  TestBed.resetTestingModule();
  let counter = 0;
  TestBed.configureTestingModule({
    providers: [{ provide: ID_GENERATOR, useValue: (prefix: string) => `${prefix}-${++counter}` }],
  });
  return { store: TestBed.inject(EditorStore), autosave: TestBed.inject(AutosaveCounter) };
}

describe('AutosaveCounter', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('starts at zero and counts every change the user makes', () => {
    const { store, autosave } = open();
    TestBed.tick();
    expect(autosave.runs()).toBe(0);
    const id = store.addShape('rectangle', box);
    TestBed.tick();
    expect(autosave.runs()).toBe(1);
    store.setFill(id, 'rose');
    TestBed.tick();
    expect(autosave.runs()).toBe(2);
  });

  it('does not count undo, redo or a jump', () => {
    const { store, autosave } = open();
    const id = store.addShape('rectangle', box);
    TestBed.tick();
    store.setFill(id, 'rose');
    TestBed.tick();
    const baseline = autosave.runs();

    store.undo();
    TestBed.tick();
    store.redo();
    TestBed.tick();
    store.jumpTo(store.entries()[1]?.id ?? -1);
    TestBed.tick();
    expect(autosave.runs()).toBe(baseline);

    store.setFill(id, 'amber');
    TestBed.tick();
    expect(autosave.runs()).toBe(baseline + 1);
  });

  it('does not count selection or tool changes', () => {
    const { store, autosave } = open();
    const id = store.addShape('rectangle', box);
    TestBed.tick();
    const baseline = autosave.runs();
    store.select(null);
    store.select(id);
    store.selectTool('connector');
    TestBed.tick();
    expect(autosave.runs()).toBe(baseline);
  });
});
