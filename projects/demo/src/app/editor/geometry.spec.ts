import {
  centeredRect,
  centerOf,
  clamp,
  clampRectToWorld,
  connectorSegment,
  containsPoint,
  cornerPoint,
  growRect,
  hitTest,
  moveRect,
  normalizeRect,
  resizeRect,
} from './geometry';
import { minimumSize, world, type Shape } from './model';

function shape(overrides: Partial<Shape> = {}): Shape {
  return {
    id: 's',
    kind: 'rectangle',
    name: 'Rectangle 1',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    fill: 'sky',
    ...overrides,
  };
}

describe('geometry', () => {
  it('clamps a number into a range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('normalizes a rectangle dragged in any direction', () => {
    const expected = { x: 10, y: 20, width: 30, height: 40 };
    expect(normalizeRect({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual(expected);
    expect(normalizeRect({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual(expected);
    expect(normalizeRect({ x: 40, y: 20 }, { x: 10, y: 60 })).toEqual(expected);
  });

  it('keeps a rectangle inside the world and above the minimum size', () => {
    expect(clampRectToWorld({ x: -50, y: -50, width: 10, height: 10 })).toEqual({
      x: 0,
      y: 0,
      width: minimumSize,
      height: minimumSize,
    });
    const far = clampRectToWorld({ x: 5000, y: 5000, width: 100, height: 100 });
    expect(far.x + far.width).toBe(world.width);
    expect(far.y + far.height).toBe(world.height);
    const huge = clampRectToWorld({ x: 0, y: 0, width: 9999, height: 9999 });
    expect(huge).toEqual({ x: 0, y: 0, width: world.width, height: world.height });
  });

  it('centers a rectangle on a point and keeps it inside', () => {
    expect(centeredRect({ x: 200, y: 200 }, { width: 100, height: 60 })).toEqual({
      x: 150,
      y: 170,
      width: 100,
      height: 60,
    });
    expect(centeredRect({ x: 0, y: 0 }, { width: 100, height: 60 }).x).toBe(0);
  });

  it('moves a rectangle and stops at the border', () => {
    const rect = { x: 10, y: 10, width: 100, height: 100 };
    expect(moveRect(rect, 5, -3)).toEqual({ x: 15, y: 7, width: 100, height: 100 });
    expect(moveRect(rect, -50, -50)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  describe('resizing from a corner', () => {
    const rect = { x: 100, y: 100, width: 200, height: 100 };

    it('moves the south east corner and keeps the north west one', () => {
      expect(resizeRect(rect, 'se', 20, 10)).toEqual({ x: 100, y: 100, width: 220, height: 110 });
    });

    it('moves the north west corner and keeps the south east one', () => {
      expect(resizeRect(rect, 'nw', -20, -10)).toEqual({ x: 80, y: 90, width: 220, height: 110 });
    });

    it('moves the north east and south west corners', () => {
      expect(resizeRect(rect, 'ne', 10, -10)).toEqual({ x: 100, y: 90, width: 210, height: 110 });
      expect(resizeRect(rect, 'sw', -10, 10)).toEqual({ x: 90, y: 100, width: 210, height: 110 });
    });

    it('never goes below the minimum size and keeps the opposite corner in place', () => {
      const shrunk = resizeRect(rect, 'se', -500, -500);
      expect(shrunk).toEqual({ x: 100, y: 100, width: minimumSize, height: minimumSize });
      const fromNorthWest = resizeRect(rect, 'nw', 500, 500);
      expect(fromNorthWest.x + fromNorthWest.width).toBe(300);
      expect(fromNorthWest.y + fromNorthWest.height).toBe(200);
      expect(fromNorthWest.width).toBe(minimumSize);
    });

    it('stops at the border of the world', () => {
      const grown = resizeRect(rect, 'se', 5000, 5000);
      expect(grown.x + grown.width).toBeLessThanOrEqual(world.width);
      expect(grown.y + grown.height).toBeLessThanOrEqual(world.height);
    });
  });

  it('grows and shrinks around the center', () => {
    expect(growRect({ x: 100, y: 100, width: 100, height: 60 }, 20)).toEqual({
      x: 90,
      y: 90,
      width: 120,
      height: 80,
    });
    expect(growRect({ x: 100, y: 100, width: 30, height: 30 }, -20).width).toBe(minimumSize);
  });

  it('reports the corner points of a rectangle', () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    expect(cornerPoint(rect, 'nw')).toEqual({ x: 10, y: 20 });
    expect(cornerPoint(rect, 'ne')).toEqual({ x: 110, y: 20 });
    expect(cornerPoint(rect, 'sw')).toEqual({ x: 10, y: 70 });
    expect(cornerPoint(rect, 'se')).toEqual({ x: 110, y: 70 });
  });

  describe('hit testing', () => {
    it('includes the border of a rectangle and excludes the outside', () => {
      const box = shape();
      expect(containsPoint(box, { x: 100, y: 100 })).toBe(true);
      expect(containsPoint(box, { x: 300, y: 200 })).toBe(true);
      expect(containsPoint(box, { x: 301, y: 150 })).toBe(false);
    });

    it('treats the corner of an ellipse bounding box as outside', () => {
      const oval = shape({ kind: 'ellipse' });
      expect(containsPoint(oval, centerOf(oval))).toBe(true);
      expect(containsPoint(oval, { x: 105, y: 105 })).toBe(false);
      expect(containsPoint(oval, { x: 200, y: 101 })).toBe(true);
    });

    it('returns the topmost shape, the last one drawn', () => {
      const lower = shape({ id: 'lower' });
      const upper = shape({ id: 'upper', x: 150 });
      expect(hitTest([lower, upper], { x: 200, y: 150 })?.id).toBe('upper');
      expect(hitTest([lower, upper], { x: 110, y: 150 })?.id).toBe('lower');
      expect(hitTest([lower, upper], { x: 5, y: 5 })).toBeUndefined();
    });
  });

  describe('connector routing', () => {
    it('joins the facing edges of two rectangles', () => {
      const left = shape({ id: 'l', x: 0, y: 0, width: 100, height: 100 });
      const right = shape({ id: 'r', x: 300, y: 0, width: 100, height: 100 });
      expect(connectorSegment(left, right)).toEqual({ x1: 100, y1: 50, x2: 300, y2: 50 });
      expect(connectorSegment(right, left)).toEqual({ x1: 300, y1: 50, x2: 100, y2: 50 });
    });

    it('joins vertically stacked shapes', () => {
      const top = shape({ id: 't', x: 0, y: 0, width: 100, height: 100 });
      const bottom = shape({ id: 'b', x: 0, y: 300, width: 100, height: 100 });
      expect(connectorSegment(top, bottom)).toEqual({ x1: 50, y1: 100, x2: 50, y2: 300 });
    });

    it('stops on the curve of an ellipse', () => {
      const oval = shape({ id: 'o', kind: 'ellipse', x: 0, y: 0, width: 100, height: 60 });
      const box = shape({ id: 'b', x: 300, y: 0, width: 100, height: 60 });
      const segment = connectorSegment(oval, box);
      expect(segment?.x1).toBeCloseTo(100);
      expect(segment?.y1).toBeCloseTo(30);
    });

    it('follows a diagonal and ends on the boundary of both shapes', () => {
      const first = shape({ id: 'a', x: 0, y: 0, width: 100, height: 100 });
      const second = shape({ id: 'b', x: 300, y: 300, width: 100, height: 100 });
      expect(connectorSegment(first, second)).toEqual({ x1: 100, y1: 100, x2: 300, y2: 300 });
    });

    it('draws nothing for overlapping shapes', () => {
      const first = shape({ id: 'a', x: 0, y: 0, width: 100, height: 100 });
      const second = shape({ id: 'b', x: 50, y: 0, width: 100, height: 100 });
      expect(connectorSegment(first, second)).toBeUndefined();
    });

    it('draws nothing for shapes with the same center', () => {
      const first = shape({ id: 'a' });
      expect(connectorSegment(first, shape({ id: 'b' }))).toBeUndefined();
    });
  });
});
