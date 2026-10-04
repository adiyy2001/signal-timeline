export type ShapeKind = 'rectangle' | 'ellipse';

export type Tool = 'select' | ShapeKind | 'connector';

export const paletteKeys = ['sky', 'mint', 'amber', 'rose', 'violet', 'slate'] as const;

export type PaletteKey = (typeof paletteKeys)[number];

export interface Shape {
  readonly id: string;
  readonly kind: ShapeKind;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: PaletteKey;
}

export interface Connector {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const world = { width: 960, height: 600 } as const;

export const minimumSize = 24;

export const defaultSize: Record<ShapeKind, { readonly width: number; readonly height: number }> = {
  rectangle: { width: 140, height: 90 },
  ellipse: { width: 130, height: 90 },
};

export const kindLabel: Record<ShapeKind, string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
};

export const toolLabel: Record<Tool, string> = {
  select: 'Select',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  connector: 'Connector',
};

export function isPaletteKey(value: string): value is PaletteKey {
  return (paletteKeys as readonly string[]).includes(value);
}
