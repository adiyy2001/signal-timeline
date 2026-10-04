import { kindLabel, type Connector, type Shape } from './model';

export interface EditorSnapshot {
  readonly shapeEntityMap: Record<string, Shape | undefined>;
  readonly connectorEntityMap: Record<string, Connector | undefined>;
}

export interface EditorChange {
  readonly before: EditorSnapshot;
  readonly after: EditorSnapshot;
}

function ids<T>(map: Record<string, T | undefined>): string[] {
  return Object.keys(map);
}

function describeShapeEdit(before: Shape, after: Shape): string {
  if (before.width !== after.width || before.height !== after.height) {
    return `Resize ${after.name}`;
  }
  if (before.x !== after.x || before.y !== after.y) {
    return `Move ${after.name}`;
  }
  if (before.fill !== after.fill) {
    return `Recolor ${after.name} ${after.fill}`;
  }
  return `Edit ${after.name}`;
}

function connectorName(connector: Connector, shapes: Record<string, Shape | undefined>): string {
  const from = shapes[connector.fromId]?.name ?? 'a shape';
  const to = shapes[connector.toId]?.name ?? 'a shape';
  return `connector from ${from} to ${to}`;
}

export function describeChange(change: EditorChange): string {
  const { before, after } = change;
  const addedShape = ids(after.shapeEntityMap).find(
    (id) => before.shapeEntityMap[id] === undefined,
  );
  if (addedShape !== undefined) {
    const shape = after.shapeEntityMap[addedShape];
    return shape === undefined ? 'Add shape' : `Add ${shape.name}`;
  }
  const removedShape = ids(before.shapeEntityMap).find(
    (id) => after.shapeEntityMap[id] === undefined,
  );
  if (removedShape !== undefined) {
    const shape = before.shapeEntityMap[removedShape];
    return shape === undefined ? 'Delete shape' : `Delete ${shape.name}`;
  }
  const editedShape = ids(after.shapeEntityMap).find(
    (id) => before.shapeEntityMap[id] !== after.shapeEntityMap[id],
  );
  if (editedShape !== undefined) {
    const was = before.shapeEntityMap[editedShape];
    const now = after.shapeEntityMap[editedShape];
    if (was !== undefined && now !== undefined) {
      return describeShapeEdit(was, now);
    }
  }
  const addedConnector = ids(after.connectorEntityMap).find(
    (id) => before.connectorEntityMap[id] === undefined,
  );
  if (addedConnector !== undefined) {
    const connector = after.connectorEntityMap[addedConnector];
    return connector === undefined
      ? 'Add connector'
      : `Add ${connectorName(connector, after.shapeEntityMap)}`;
  }
  const removedConnector = ids(before.connectorEntityMap).find(
    (id) => after.connectorEntityMap[id] === undefined,
  );
  if (removedConnector !== undefined) {
    const connector = before.connectorEntityMap[removedConnector];
    return connector === undefined
      ? 'Delete connector'
      : `Delete ${connectorName(connector, before.shapeEntityMap)}`;
  }
  return 'Edit drawing';
}

export function adjustmentKey(change: EditorChange): string | undefined {
  const { before, after } = change;
  const sameShapes =
    Object.keys(before.shapeEntityMap).length === Object.keys(after.shapeEntityMap).length &&
    before.connectorEntityMap === after.connectorEntityMap;
  const edited = sameShapes
    ? ids(after.shapeEntityMap).filter(
        (id) => before.shapeEntityMap[id] !== after.shapeEntityMap[id],
      )
    : [];
  const id = edited.length === 1 ? edited[0] : undefined;
  const was = id === undefined ? undefined : before.shapeEntityMap[id];
  const now = id === undefined ? undefined : after.shapeEntityMap[id];
  if (id === undefined || was === undefined || now === undefined) {
    return undefined;
  }
  if (was.width !== now.width || was.height !== now.height) {
    return `resize:${id}`;
  }
  if (was.x !== now.x || was.y !== now.y) {
    return `move:${id}`;
  }
  return was.fill === now.fill ? undefined : `recolor:${id}`;
}

export function nextShapeName(
  kind: Shape['kind'],
  shapes: Record<string, Shape | undefined>,
): string {
  const label = kindLabel[kind];
  const used = Object.values(shapes)
    .flatMap((shape) => (shape?.kind === kind ? [shape.name] : []))
    .map((name) => Number(name.slice(label.length + 1)))
    .filter((value) => Number.isInteger(value));
  return `${label} ${Math.max(0, ...used) + 1}`;
}
