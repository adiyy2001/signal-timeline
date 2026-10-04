import type { TimelineEntry } from 'signal-timeline';

export type EntriesById = ReadonlyMap<number, TimelineEntry>;

export function indexEntries(entries: readonly TimelineEntry[]): EntriesById {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

export function isAncestorOrSelf(byId: EntriesById, ancestorId: number, id: number): boolean {
  let cursor: number | undefined = id;
  while (cursor !== undefined) {
    if (cursor === ancestorId) {
      return true;
    }
    cursor = byId.get(cursor)?.parentId;
  }
  return false;
}

function followLastChild(byId: EntriesById, startId: number): number {
  let cursor = startId;
  for (;;) {
    const children = byId.get(cursor)?.children ?? [];
    const last = children.at(-1);
    if (last === undefined || !byId.has(last)) {
      return cursor;
    }
    cursor = last;
  }
}

/**
 * Picks the last entry of the branch the scrubber shows. While the current entry stays on the
 * branch shown before, that branch is kept, so scrubbing backwards does not swap the track under
 * the thumb. Otherwise the branch continues from the current entry along the newest children.
 */
export function resolveTip(
  byId: EntriesById,
  currentId: number,
  previousTipId: number | undefined,
): number {
  if (
    previousTipId !== undefined &&
    byId.has(previousTipId) &&
    isAncestorOrSelf(byId, currentId, previousTipId)
  ) {
    return previousTipId;
  }
  return followLastChild(byId, currentId);
}

export function pathFromRoot(byId: EntriesById, tipId: number): readonly number[] {
  const reversed: number[] = [];
  let cursor: number | undefined = tipId;
  while (cursor !== undefined && byId.has(cursor)) {
    reversed.push(cursor);
    cursor = byId.get(cursor)?.parentId;
  }
  return reversed.reverse();
}
