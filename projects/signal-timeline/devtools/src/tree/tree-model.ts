import type { TimelineEntry } from 'signal-timeline';
import type { EntriesById } from '../active-path';
import { layoutTree, type LayoutEntry, type PlacedNode } from './layout-tree';

export interface TreeNodeView extends PlacedNode {
  readonly label: string;
  readonly current: boolean;
  readonly onActivePath: boolean;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly lockedOpen: boolean;
  readonly changedKeys: readonly string[];
}

export interface TreeEdge {
  readonly fromId: number;
  readonly toId: number;
  readonly active: boolean;
}

export interface TreeModel {
  readonly nodes: readonly TreeNodeView[];
  readonly edges: readonly TreeEdge[];
  readonly columns: number;
  readonly rows: number;
}

function strictAncestors(byId: EntriesById, id: number): ReadonlySet<number> {
  const ancestors = new Set<number>();
  let cursor = byId.get(id)?.parentId;
  while (cursor !== undefined && !ancestors.has(cursor)) {
    ancestors.add(cursor);
    cursor = byId.get(cursor)?.parentId;
  }
  return ancestors;
}

function visibleLayoutEntries(
  entries: readonly TimelineEntry[],
  byId: EntriesById,
  collapsed: ReadonlySet<number>,
): readonly LayoutEntry[] {
  const roots = entries.filter(
    (entry) => entry.parentId === undefined || !byId.has(entry.parentId),
  );
  const visible: LayoutEntry[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) {
      continue;
    }
    const isCollapsed = collapsed.has(entry.id);
    visible.push({
      id: entry.id,
      parentId: entry.parentId,
      children: isCollapsed ? [] : entry.children,
    });
    if (!isCollapsed) {
      for (const childId of entry.children) {
        const child = byId.get(childId);
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
  return visible;
}

export function buildTreeModel(
  entries: readonly TimelineEntry[],
  byId: EntriesById,
  currentId: number,
  activePath: readonly number[],
  collapsed: ReadonlySet<number>,
): TreeModel {
  const locked = strictAncestors(byId, currentId);
  const effectiveCollapsed = new Set([...collapsed].filter((id) => !locked.has(id)));
  const layout = layoutTree(visibleLayoutEntries(entries, byId, effectiveCollapsed), activePath);
  const active = new Set(activePath);
  const nodes = layout.nodes.flatMap((placed): TreeNodeView[] => {
    const entry = byId.get(placed.id);
    if (entry === undefined) {
      return [];
    }
    const expandable = entry.children.length > 0;
    return [
      {
        ...placed,
        label: entry.label,
        current: entry.id === currentId,
        onActivePath: active.has(entry.id),
        expandable,
        expanded: expandable && !effectiveCollapsed.has(entry.id),
        lockedOpen: locked.has(entry.id),
        changedKeys: entry.changedKeys,
      },
    ];
  });
  const edges = nodes.flatMap((node): TreeEdge[] =>
    node.parentId === undefined
      ? []
      : [{ fromId: node.parentId, toId: node.id, active: node.onActivePath }],
  );
  return { nodes, edges, columns: layout.columns, rows: layout.rows };
}
