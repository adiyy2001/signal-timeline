import type { TreeNodeView } from './tree-model';

export type TreeAction =
  | { readonly kind: 'focus'; readonly id: number }
  | { readonly kind: 'expand'; readonly id: number }
  | { readonly kind: 'collapse'; readonly id: number }
  | { readonly kind: 'activate'; readonly id: number }
  | { readonly kind: 'none' };

const none: TreeAction = { kind: 'none' };

function focusAt(nodes: readonly TreeNodeView[], index: number): TreeAction {
  const target = nodes[Math.min(Math.max(index, 0), nodes.length - 1)];
  return target === undefined ? none : { kind: 'focus', id: target.id };
}

function onArrowRight(nodes: readonly TreeNodeView[], index: number): TreeAction {
  const node = nodes[index];
  if (!node.expandable) {
    return none;
  }
  if (!node.expanded) {
    return { kind: 'expand', id: node.id };
  }
  const firstChild = nodes[index + 1];
  return firstChild !== undefined && firstChild.parentId === node.id
    ? { kind: 'focus', id: firstChild.id }
    : none;
}

function onArrowLeft(nodes: readonly TreeNodeView[], index: number): TreeAction {
  const node = nodes[index];
  if (node.expanded && !node.lockedOpen) {
    return { kind: 'collapse', id: node.id };
  }
  return node.parentId === undefined ? none : { kind: 'focus', id: node.parentId };
}

export function navigateTree(
  key: string,
  nodes: readonly TreeNodeView[],
  focusedId: number,
): TreeAction {
  const index = nodes.findIndex((node) => node.id === focusedId);
  if (index < 0) {
    return none;
  }
  switch (key) {
    case 'ArrowDown':
      return focusAt(nodes, index + 1);
    case 'ArrowUp':
      return focusAt(nodes, index - 1);
    case 'Home':
      return focusAt(nodes, 0);
    case 'End':
      return focusAt(nodes, nodes.length - 1);
    case 'ArrowRight':
      return onArrowRight(nodes, index);
    case 'ArrowLeft':
      return onArrowLeft(nodes, index);
    case 'Enter':
    case ' ':
      return { kind: 'activate', id: focusedId };
    default:
      return none;
  }
}
