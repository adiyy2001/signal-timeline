import type { TimelineEntry } from 'signal-timeline';

export function entriesFromParents(
  parentIds: readonly number[],
  labelOf: (id: number) => string = (id) => `Entry ${id}`,
): readonly TimelineEntry[] {
  const children = new Map<number, number[]>();
  parentIds.forEach((parentId, index) => {
    children.set(parentId, [...(children.get(parentId) ?? []), index + 2]);
  });
  const depths = new Map<number, number>([[1, 0]]);
  const entries: TimelineEntry[] = [
    {
      id: 1,
      parentId: undefined,
      label: 'Initial state',
      timestamp: 0,
      children: children.get(1) ?? [],
      depth: 0,
      changedKeys: [],
    },
  ];
  parentIds.forEach((parentId, index) => {
    const id = index + 2;
    const depth = (depths.get(parentId) ?? 0) + 1;
    depths.set(id, depth);
    entries.push({
      id,
      parentId,
      label: labelOf(id),
      timestamp: id * 1000,
      children: children.get(id) ?? [],
      depth,
      changedKeys: ['count'],
    });
  });
  return entries;
}

export const treeParents = [1, 2, 2, 3, 1, 6] as const;
