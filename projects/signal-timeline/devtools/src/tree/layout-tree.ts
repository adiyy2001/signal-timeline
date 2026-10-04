export interface LayoutEntry {
  readonly id: number;
  readonly parentId: number | undefined;
  readonly children: readonly number[];
}

export interface PlacedNode {
  readonly id: number;
  readonly parentId: number | undefined;
  readonly column: number;
  readonly row: number;
  readonly setSize: number;
  readonly positionInSet: number;
  readonly childIds: readonly number[];
}

export interface TreeLayout {
  readonly nodes: readonly PlacedNode[];
  readonly columns: number;
  readonly rows: number;
}

interface Working {
  readonly id: number;
  readonly parentId: number | undefined;
  readonly childIds: readonly number[];
  readonly row: number;
  readonly setSize: number;
  readonly positionInSet: number;
  width: number;
  column: number;
}

function activeFirst(ids: readonly number[], active: ReadonlySet<number>): readonly number[] {
  return [...ids.filter((id) => active.has(id)), ...ids.filter((id) => !active.has(id))];
}

function findRoots(entries: readonly LayoutEntry[], byId: ReadonlyMap<number, LayoutEntry>) {
  return entries
    .filter((entry) => entry.parentId === undefined || !byId.has(entry.parentId))
    .map((entry) => entry.id);
}

function preorder(
  rootIds: readonly number[],
  byId: ReadonlyMap<number, LayoutEntry>,
  active: ReadonlySet<number>,
): Working[] {
  const order: Working[] = [];
  const seen = new Set<number>();
  const stack = [...activeFirst(rootIds, active)].reverse().map((id, index, all) => ({
    id,
    row: 0,
    setSize: all.length,
    positionInSet: all.length - index,
  }));
  while (stack.length > 0) {
    const next = stack.pop();
    const entry = next === undefined ? undefined : byId.get(next.id);
    if (next === undefined || entry === undefined || seen.has(next.id)) {
      continue;
    }
    seen.add(next.id);
    const childIds = activeFirst(
      [...new Set(entry.children)].filter((id) => byId.get(id)?.parentId === entry.id),
      active,
    );
    order.push({
      id: next.id,
      parentId:
        entry.parentId !== undefined && byId.has(entry.parentId) ? entry.parentId : undefined,
      childIds,
      row: next.row,
      setSize: next.setSize,
      positionInSet: next.positionInSet,
      width: 1,
      column: 0,
    });
    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      stack.push({
        id: childIds[index],
        row: next.row + 1,
        setSize: childIds.length,
        positionInSet: index + 1,
      });
    }
  }
  return order;
}

function measureWidths(order: readonly Working[]): void {
  const byId = new Map(order.map((node) => [node.id, node]));
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const node = order[index];
    const total = node.childIds.reduce((sum, id) => sum + (byId.get(id)?.width ?? 1), 0);
    node.width = Math.max(1, total);
  }
}

function assignColumns(order: readonly Working[]): void {
  const byId = new Map(order.map((node) => [node.id, node]));
  let nextRootColumn = 0;
  for (const node of order) {
    if (node.parentId === undefined) {
      node.column = nextRootColumn;
      nextRootColumn += node.width;
    }
    let running = node.column;
    for (const childId of node.childIds) {
      const child = byId.get(childId);
      if (child !== undefined) {
        child.column = running;
        running += child.width;
      }
    }
  }
}

/**
 * Places the nodes of a history tree on a grid. A node sits one row below its parent. The
 * nodes of `activePath` come first among their siblings, so the active branch stays in the
 * first column of its subtree and the layout never crosses it. Nodes are returned in
 * depth-first order with the active child first, which is the order the keyboard follows.
 */
export function layoutTree(
  entries: readonly LayoutEntry[],
  activePath: readonly number[],
): TreeLayout {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const active = new Set(activePath);
  const order = preorder(findRoots(entries, byId), byId, active);
  measureWidths(order);
  assignColumns(order);
  const nodes = order.map((node): PlacedNode => ({
    id: node.id,
    parentId: node.parentId,
    column: node.column,
    row: node.row,
    setSize: node.setSize,
    positionInSet: node.positionInSet,
    childIds: node.childIds,
  }));
  const rootsWidth = order
    .filter((node) => node.parentId === undefined)
    .reduce((sum, node) => sum + node.width, 0);
  return {
    nodes,
    columns: rootsWidth,
    rows: order.reduce((deepest, node) => Math.max(deepest, node.row + 1), 0),
  };
}
