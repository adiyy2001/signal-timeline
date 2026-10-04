import { describeChange, nextShapeName, type EditorSnapshot } from './describe-change';
import type { Connector, Shape } from './model';

function shape(id: string, overrides: Partial<Shape> = {}): Shape {
  return {
    id,
    kind: 'rectangle',
    name: `Rectangle ${id}`,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    fill: 'sky',
    ...overrides,
  };
}

function snapshot(shapes: Shape[], connectors: Connector[] = []): EditorSnapshot {
  return {
    shapeEntityMap: Object.fromEntries(shapes.map((entry) => [entry.id, entry])),
    connectorEntityMap: Object.fromEntries(connectors.map((entry) => [entry.id, entry])),
  };
}

describe('describeChange', () => {
  const one = shape('1');
  const two = shape('2', { name: 'Ellipse 1', kind: 'ellipse' });

  it('names an added and a deleted shape', () => {
    expect(describeChange({ before: snapshot([]), after: snapshot([one]) })).toBe(
      'Add Rectangle 1',
    );
    expect(describeChange({ before: snapshot([one]), after: snapshot([]) })).toBe(
      'Delete Rectangle 1',
    );
  });

  it('tells a resize from a move and a recolor', () => {
    const before = snapshot([one]);
    expect(describeChange({ before, after: snapshot([{ ...one, width: 120 }]) })).toBe(
      'Resize Rectangle 1',
    );
    expect(describeChange({ before, after: snapshot([{ ...one, x: 4 }]) })).toBe(
      'Move Rectangle 1',
    );
    expect(describeChange({ before, after: snapshot([{ ...one, fill: 'rose' }]) })).toBe(
      'Recolor Rectangle 1 rose',
    );
    expect(describeChange({ before, after: snapshot([{ ...one, name: 'Renamed' }]) })).toBe(
      'Edit Renamed',
    );
  });

  it('names connectors by the shapes they join', () => {
    const connector: Connector = { id: 'c', fromId: '1', toId: '2' };
    const shapes = [one, two];
    expect(describeChange({ before: snapshot(shapes), after: snapshot(shapes, [connector]) })).toBe(
      'Add connector from Rectangle 1 to Ellipse 1',
    );
    expect(describeChange({ before: snapshot(shapes, [connector]), after: snapshot(shapes) })).toBe(
      'Delete connector from Rectangle 1 to Ellipse 1',
    );
  });

  it('falls back to a generic label', () => {
    const state = snapshot([one]);
    expect(describeChange({ before: state, after: state })).toBe('Edit drawing');
  });
});

describe('nextShapeName', () => {
  it('numbers shapes of one kind after the highest number in use', () => {
    const shapes = Object.fromEntries(
      [
        shape('a', { name: 'Rectangle 1' }),
        shape('b', { name: 'Rectangle 3' }),
        shape('c', { name: 'Ellipse 7', kind: 'ellipse' }),
      ].map((entry) => [entry.id, entry]),
    );
    expect(nextShapeName('rectangle', shapes)).toBe('Rectangle 4');
    expect(nextShapeName('ellipse', shapes)).toBe('Ellipse 8');
    expect(nextShapeName('rectangle', {})).toBe('Rectangle 1');
  });
});
