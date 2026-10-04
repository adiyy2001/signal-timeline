import {
  adjustmentKey,
  describeChange,
  nextShapeName,
  type EditorSnapshot,
} from './describe-change';
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

describe('adjustmentKey', () => {
  const one = shape('1');
  const two = shape('2');
  const both = snapshot([one, two]);
  const withShapes = (shapes: Shape[]): EditorSnapshot => ({
    shapeEntityMap: snapshot(shapes).shapeEntityMap,
    connectorEntityMap: both.connectorEntityMap,
  });

  it('names a move, a resize and a recolor of one shape', () => {
    expect(adjustmentKey({ before: both, after: withShapes([{ ...one, x: 5 }, two]) })).toBe(
      'move:1',
    );
    expect(adjustmentKey({ before: both, after: withShapes([one, { ...two, height: 5 }]) })).toBe(
      'resize:2',
    );
    expect(
      adjustmentKey({ before: both, after: withShapes([{ ...one, fill: 'rose' }, two]) }),
    ).toBe('recolor:1');
  });

  it('has no key when shapes were added, removed or several changed', () => {
    expect(adjustmentKey({ before: both, after: withShapes([one]) })).toBeUndefined();
    expect(adjustmentKey({ before: withShapes([one]), after: both })).toBeUndefined();
    expect(
      adjustmentKey({
        before: both,
        after: withShapes([
          { ...one, x: 5 },
          { ...two, x: 5 },
        ]),
      }),
    ).toBeUndefined();
    expect(adjustmentKey({ before: both, after: both })).toBeUndefined();
  });

  it('has no key when a connector changed or the shape was replaced', () => {
    const connector: Connector = { id: 'c', fromId: '1', toId: '2' };
    expect(
      adjustmentKey({ before: both, after: snapshot([{ ...one, x: 5 }, two], [connector]) }),
    ).toBeUndefined();
    expect(adjustmentKey({ before: withShapes([one]), after: withShapes([two]) })).toBeUndefined();
  });

  it('has no key for an edit that only renames', () => {
    expect(
      adjustmentKey({ before: both, after: withShapes([{ ...one, name: 'Other' }, two]) }),
    ).toBeUndefined();
  });
});
