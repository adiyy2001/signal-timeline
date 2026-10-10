import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { TimelineEntry } from 'signal-timeline';
import { indexEntries } from '../active-path';
import { buildTreeModel, type TreeNodeView } from './tree-model';
import { navigateTree } from './tree-navigation';

const columnWidth = 168;
const rowHeight = 44;
const padding = 24;
const labelLimit = 20;
const focusBoxWidth = columnWidth - 16;
const focusBoxHeight = 30;

interface PlacedView {
  readonly node: TreeNodeView;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly name: string;
}

interface EdgeView {
  readonly key: string;
  readonly active: boolean;
  readonly d: string;
}

let nextTreeId = 0;

function shortLabel(label: string): string {
  return label.length > labelLimit ? `${label.slice(0, labelLimit - 3)}...` : label;
}

function accessibleName(node: TreeNodeView): string {
  const touched = node.changedKeys.length > 0 ? ` Changed: ${node.changedKeys.join(', ')}.` : '';
  return `${node.label}. Entry ${node.id}.${touched}${node.current ? ' Current entry.' : ''}`;
}

function edgePath(from: PlacedView, to: PlacedView): string {
  if (from.x === to.x) {
    return `M ${from.x} ${from.y} V ${to.y}`;
  }
  const bend = to.y - rowHeight / 2;
  return `M ${from.x} ${from.y} V ${bend} H ${to.x} V ${to.y}`;
}

@Component({
  selector: 'st-branch-tree',
  templateUrl: './branch-tree.component.html',
  styleUrl: './branch-tree.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchTreeComponent {
  readonly entries = input.required<readonly TimelineEntry[]>();
  readonly currentId = input.required<number>();
  readonly activePath = input.required<readonly number[]>();
  readonly activate = output<number>();
  readonly inspect = output<number>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly collapsed = signal<ReadonlySet<number>>(new Set());
  private readonly focusedId = signal<number | undefined>(undefined);

  protected readonly hintId = `st-tree-hint-${nextTreeId++}`;
  protected readonly focusBox = { width: focusBoxWidth, height: focusBoxHeight };

  private readonly model = computed(() =>
    buildTreeModel(
      this.entries(),
      indexEntries(this.entries()),
      this.currentId(),
      this.activePath(),
      this.collapsed(),
    ),
  );

  protected readonly views = computed((): readonly PlacedView[] =>
    this.model().nodes.map((node) => ({
      node,
      x: padding + node.column * columnWidth,
      y: padding + node.row * rowHeight,
      text: shortLabel(node.label),
      name: accessibleName(node),
    })),
  );

  protected readonly edges = computed((): readonly EdgeView[] => {
    const byId = new Map(this.views().map((view) => [view.node.id, view]));
    return this.model().edges.flatMap((edge): EdgeView[] => {
      const from = byId.get(edge.fromId);
      const to = byId.get(edge.toId);
      return from === undefined || to === undefined
        ? []
        : [{ key: `${edge.fromId}-${edge.toId}`, active: edge.active, d: edgePath(from, to) }];
    });
  });

  protected readonly width = computed(
    () => padding * 2 + Math.max(this.model().columns - 1, 0) * columnWidth + columnWidth,
  );
  protected readonly height = computed(
    () => padding * 2 + Math.max(this.model().rows - 1, 0) * rowHeight,
  );

  protected readonly tabStopId = computed(() => {
    const nodes = this.model().nodes;
    const has = (id: number | undefined) => id !== undefined && nodes.some((n) => n.id === id);
    const focused = this.focusedId();
    if (has(focused)) {
      return focused;
    }
    return has(this.currentId()) ? this.currentId() : nodes[0]?.id;
  });

  constructor() {
    afterRenderEffect(() => {
      const current = this.views().find((view) => view.node.current);
      if (current !== undefined) {
        this.reveal(current.x, current.y);
      }
    });
  }

  protected onFocus(id: number): void {
    this.focusedId.set(id);
    this.inspect.emit(id);
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !this.host.nativeElement.contains(next)) {
      this.focusedId.set(undefined);
    }
  }

  protected onKeydown(event: KeyboardEvent, id: number): void {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const action = navigateTree(event.key, this.model().nodes, id);
    if (action.kind === 'none') {
      return;
    }
    event.preventDefault();
    switch (action.kind) {
      case 'focus':
        this.focusNode(action.id);
        break;
      case 'expand':
        this.setCollapsed(action.id, false);
        break;
      case 'collapse':
        this.setCollapsed(action.id, true);
        break;
      case 'activate':
        this.activate.emit(action.id);
        break;
    }
  }

  protected onClick(id: number): void {
    this.focusedId.set(id);
    this.activate.emit(id);
  }

  private setCollapsed(id: number, collapsed: boolean): void {
    this.collapsed.update((previous) => {
      const next = new Set(previous);
      if (collapsed) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  private focusNode(id: number): void {
    this.host.nativeElement.querySelector<SVGGElement>(`[data-node-id="${id}"]`)?.focus();
  }

  private reveal(x: number, y: number): void {
    const scroller = this.host.nativeElement.querySelector<HTMLElement>('.scroller');
    if (scroller === null) {
      return;
    }
    const margin = padding;
    const right = x + columnWidth;
    const bottom = y + rowHeight;
    if (x - margin < scroller.scrollLeft) {
      scroller.scrollLeft = Math.max(x - margin, 0);
    } else if (right > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = right - scroller.clientWidth;
    }
    if (y - margin < scroller.scrollTop) {
      scroller.scrollTop = Math.max(y - margin, 0);
    } else if (bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = bottom - scroller.clientHeight;
    }
  }
}
