import { minimumSize, world, type Point, type Rect, type Shape } from './model';

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

export const corners: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export function normalizeRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

export function clampRectToWorld(rect: Rect): Rect {
  const width = clamp(rect.width, minimumSize, world.width);
  const height = clamp(rect.height, minimumSize, world.height);
  return {
    x: clamp(rect.x, 0, world.width - width),
    y: clamp(rect.y, 0, world.height - height),
    width,
    height,
  };
}

export function centeredRect(center: Point, size: Pick<Rect, 'width' | 'height'>): Rect {
  return clampRectToWorld({
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
  });
}

export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  return clampRectToWorld({ ...rect, x: rect.x + dx, y: rect.y + dy });
}

export function resizeRect(rect: Rect, corner: Corner, dx: number, dy: number): Rect {
  const movesWest = corner === 'nw' || corner === 'sw';
  const movesNorth = corner === 'nw' || corner === 'ne';
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const left = movesWest ? Math.min(rect.x + dx, right - minimumSize) : rect.x;
  const top = movesNorth ? Math.min(rect.y + dy, bottom - minimumSize) : rect.y;
  const nextRight = movesWest ? right : Math.max(right + dx, rect.x + minimumSize);
  const nextBottom = movesNorth ? bottom : Math.max(bottom + dy, rect.y + minimumSize);
  return clampRectToWorld({
    x: left,
    y: top,
    width: nextRight - left,
    height: nextBottom - top,
  });
}

export function growRect(rect: Rect, amount: number): Rect {
  return clampRectToWorld({
    x: rect.x - amount / 2,
    y: rect.y - amount / 2,
    width: rect.width + amount,
    height: rect.height + amount,
  });
}

export function containsPoint(shape: Shape, point: Point): boolean {
  if (shape.kind === 'ellipse') {
    const dx = (point.x - (shape.x + shape.width / 2)) / (shape.width / 2);
    const dy = (point.y - (shape.y + shape.height / 2)) / (shape.height / 2);
    return dx * dx + dy * dy <= 1;
  }
  return (
    point.x >= shape.x &&
    point.x <= shape.x + shape.width &&
    point.y >= shape.y &&
    point.y <= shape.y + shape.height
  );
}

export function hitTest(shapes: readonly Shape[], point: Point): Shape | undefined {
  return [...shapes].reverse().find((shape) => containsPoint(shape, point));
}

export function centerOf(shape: Shape): Point {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

function boundaryPoint(shape: Shape, towards: Point): Point {
  const center = centerOf(shape);
  const dx = towards.x - center.x;
  const dy = towards.y - center.y;
  if (dx === 0 && dy === 0) {
    return center;
  }
  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  const scale =
    shape.kind === 'ellipse'
      ? 1 / Math.hypot(dx / halfWidth, dy / halfHeight)
      : Math.min(
          dx === 0 ? Infinity : halfWidth / Math.abs(dx),
          dy === 0 ? Infinity : halfHeight / Math.abs(dy),
        );
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

export function connectorSegment(from: Shape, to: Shape): Segment | undefined {
  const start = boundaryPoint(from, centerOf(to));
  const end = boundaryPoint(to, centerOf(from));
  const centers = { x: centerOf(to).x - centerOf(from).x, y: centerOf(to).y - centerOf(from).y };
  const drawn = { x: end.x - start.x, y: end.y - start.y };
  const pointsTheSameWay = drawn.x * centers.x + drawn.y * centers.y > 0;
  return pointsTheSameWay ? { x1: start.x, y1: start.y, x2: end.x, y2: end.y } : undefined;
}

export function cornerPoint(rect: Rect, corner: Corner): Point {
  return {
    x: corner === 'nw' || corner === 'sw' ? rect.x : rect.x + rect.width,
    y: corner === 'nw' || corner === 'ne' ? rect.y : rect.y + rect.height,
  };
}

export function cascadeCenter(index: number): Point {
  const slot = index % 12;
  return { x: 200 + (slot % 4) * 180, y: 140 + Math.floor(slot / 4) * 150 };
}
