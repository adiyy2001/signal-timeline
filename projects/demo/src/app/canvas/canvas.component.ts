import { DOCUMENT } from '@angular/common';
import type {
  ElementRef} from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { EditorStore } from '../editor/editor.store';
import {
  centerOf,
  centeredRect,
  clampRectToWorld,
  connectorSegment,
  corners,
  cornerPoint,
  hitTest,
  moveRect,
  normalizeRect,
  resizeRect,
  type Corner,
  type Segment,
} from '../editor/geometry';
import {
  defaultSize,
  kindLabel,
  minimumSize,
  world,
  type Point,
  type Rect,
  type Shape,
  type ShapeKind,
} from '../editor/model';

type Interaction =
  | { readonly kind: 'move'; readonly id: string; readonly origin: Rect; readonly start: Point }
  | {
      readonly kind: 'resize';
      readonly id: string;
      readonly corner: Corner;
      readonly origin: Rect;
      readonly start: Point;
    }
  | { readonly kind: 'draw'; readonly shape: ShapeKind; readonly start: Point }
  | { readonly kind: 'connect'; readonly fromId: string };

interface ShapeView {
  readonly shape: Shape;
  readonly label: string;
  readonly selected: boolean;
  readonly pending: boolean;
  readonly showName: boolean;
  readonly center: Point;
}

interface ConnectorView {
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
  readonly segment: Segment;
}

const keyboardStep = 10;
const fineKeyboardStep = 2;
const handleSize = 14;

const arrowDirections: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

@Component({
  selector: 'demo-canvas',
  templateUrl: './canvas.component.html',
  styleUrl: './canvas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CanvasComponent {
  protected readonly store = inject(EditorStore);
  private readonly surface = viewChild.required<ElementRef<SVGSVGElement>>('surface');
  private readonly view = inject(DOCUMENT).defaultView;

  protected readonly world = world;
  protected readonly corners = corners;
  protected readonly handleSize = handleSize;
  protected readonly gridSize = 40;
  protected readonly cornerPoint = cornerPoint;

  protected readonly drawing = signal<
    { readonly kind: ShapeKind; readonly rect: Rect } | undefined
  >(undefined);
  protected readonly connectorPreview = signal<Segment | undefined>(undefined);
  protected readonly pendingFrom = signal<string | undefined>(undefined);

  private interaction: Interaction | undefined;

  protected readonly shapeViews = computed<readonly ShapeView[]>(() => {
    const selectedId = this.store.selectedId();
    const pendingId = this.pendingFrom();
    return this.store.shapeEntities().map((shape) => ({
      shape,
      label: `${shape.name}, ${shape.fill}, ${shape.width} by ${shape.height} at ${Math.round(shape.x)}, ${Math.round(shape.y)}`,
      selected: shape.id === selectedId,
      pending: shape.id === pendingId,
      showName: shape.width >= 80 && shape.height >= 36,
      center: centerOf(shape),
    }));
  });

  protected readonly connectorViews = computed<readonly ConnectorView[]>(() => {
    const shapes = this.store.shapeEntityMap();
    const selectedId = this.store.selectedId();
    return this.store.connectorEntities().flatMap((connector) => {
      const from = shapes[connector.fromId];
      const to = shapes[connector.toId];
      const segment =
        from === undefined || to === undefined ? undefined : connectorSegment(from, to);
      return from === undefined || to === undefined || segment === undefined
        ? []
        : [
            {
              id: connector.id,
              label: `Connector from ${from.name} to ${to.name}`,
              selected: connector.id === selectedId,
              segment,
            },
          ];
    });
  });

  protected readonly selectedRect = computed(() => this.store.selectedShape());

  protected readonly hint = computed(() => {
    const tool = this.store.tool();
    if (tool === 'connector') {
      return this.pendingFrom() === undefined
        ? 'Connector: pick the shape the connector starts from, then the one it ends at. Escape cancels.'
        : 'Connector: now pick the shape it ends at. Escape cancels.';
    }
    if (tool !== 'select') {
      return `${kindLabel[tool]}: drag on the canvas to draw it, or click to place one. Escape cancels.`;
    }
    return 'Select: click a shape, or Tab to it. Arrow keys move it by 10 (Shift: 2), plus and minus resize it, Delete removes it.';
  });

  protected readonly isEmpty = computed(
    () => this.store.shapeIds().length === 0 && this.drawing() === undefined,
  );

  constructor() {
    effect(() => {
      if (this.store.tool() !== 'connector') {
        this.pendingFrom.set(undefined);
      }
    });
    inject(DestroyRef).onDestroy(() => this.stopListening());
  }

  protected viewBox(): string {
    return `0 0 ${world.width} ${world.height}`;
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.interaction !== undefined) {
      return;
    }
    const point = this.toWorld(event);
    const corner = this.cornerOf(event.target);
    const selected = this.store.selectedShape();
    if (corner !== undefined && selected !== undefined) {
      this.startInteraction(
        { kind: 'resize', id: selected.id, corner, origin: selected, start: point },
        selected.id,
        'resize',
      );
      return;
    }
    const hit = hitTest(this.store.shapeEntities(), point);
    const tool = this.store.tool();
    if (tool === 'select') {
      this.pointerDownInSelectTool(event, hit, point);
    } else if (tool === 'connector') {
      this.pointerDownInConnectorTool(hit);
    } else {
      this.startInteraction({ kind: 'draw', shape: tool, start: point });
      this.drawing.set({ kind: tool, rect: normalizeRect(point, point) });
    }
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || !(event.target instanceof Element)) {
      return;
    }
    const holder = event.target.closest('[data-shape-id], [data-connector-id]');
    const shapeId = holder?.getAttribute('data-shape-id');
    const connectorId = holder?.getAttribute('data-connector-id');
    if (shapeId !== null && shapeId !== undefined) {
      this.onShapeKey(event, shapeId);
    } else if (connectorId !== null && connectorId !== undefined) {
      this.onConnectorKey(event, connectorId);
    }
  }

  protected focusShape(id: string): void {
    if (this.store.tool() === 'select') {
      this.store.select(id);
    }
  }

  protected focusConnector(id: string): void {
    if (this.store.tool() === 'select') {
      this.store.select(id);
    }
  }

  private pointerDownInSelectTool(event: PointerEvent, hit: Shape | undefined, point: Point): void {
    if (hit !== undefined) {
      this.startInteraction(
        { kind: 'move', id: hit.id, origin: hit, start: point },
        hit.id,
        'move',
      );
      this.store.select(hit.id);
      return;
    }
    const connectorId =
      event.target instanceof Element
        ? event.target.closest('[data-connector-id]')?.getAttribute('data-connector-id')
        : undefined;
    this.store.select(connectorId ?? null);
  }

  private pointerDownInConnectorTool(hit: Shape | undefined): void {
    if (hit === undefined) {
      this.pendingFrom.set(undefined);
      return;
    }
    const from = this.pendingFrom();
    this.pickForConnector(hit.id);
    if (from === undefined) {
      this.startInteraction({ kind: 'connect', fromId: hit.id });
    }
  }

  private pickForConnector(id: string): void {
    const from = this.pendingFrom();
    if (from === undefined) {
      this.pendingFrom.set(id);
      return;
    }
    if (from !== id) {
      this.pendingFrom.set(undefined);
      this.store.connect(from, id);
    }
  }

  private onShapeKey(event: KeyboardEvent, id: string): void {
    const direction = arrowDirections[event.key];
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (this.store.tool() === 'connector') {
        this.pickForConnector(id);
      } else {
        this.store.select(id);
      }
    } else if (direction !== undefined) {
      event.preventDefault();
      const step = event.shiftKey ? fineKeyboardStep : keyboardStep;
      this.store.select(id);
      this.store.nudge(id, direction.x * step, direction.y * step);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.store.select(id);
      this.store.grow(id, keyboardStep);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      this.store.select(id);
      this.store.grow(id, -keyboardStep);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.store.select(id);
      this.deleteSelectedAndRefocus();
    }
  }

  private onConnectorKey(event: KeyboardEvent, id: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.store.select(id);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.store.select(id);
      this.deleteSelectedAndRefocus();
    }
  }

  private deleteSelectedAndRefocus(): void {
    this.store.deleteSelected();
    this.surface().nativeElement.focus();
  }

  private cancel(): void {
    this.stopInteraction();
    if (this.pendingFrom() !== undefined) {
      this.pendingFrom.set(undefined);
    } else if (this.store.tool() !== 'select') {
      this.store.selectTool('select');
    } else {
      this.store.select(null);
    }
  }

  private startInteraction(
    interaction: Interaction,
    dragId?: string,
    gesture?: 'move' | 'resize',
  ): void {
    this.interaction = interaction;
    if (dragId !== undefined && gesture !== undefined) {
      this.store.beginDrag(dragId, gesture);
    }
    this.view?.addEventListener('pointermove', this.handleMove);
    this.view?.addEventListener('pointerup', this.handleUp);
    this.view?.addEventListener('pointercancel', this.handleCancel);
  }

  private readonly handleMove = (event: PointerEvent): void => {
    const interaction = this.interaction;
    if (interaction === undefined) {
      return;
    }
    const point = this.toWorld(event);
    switch (interaction.kind) {
      case 'move':
        this.store.setGeometry(
          interaction.id,
          moveRect(
            interaction.origin,
            point.x - interaction.start.x,
            point.y - interaction.start.y,
          ),
        );
        break;
      case 'resize':
        this.store.setGeometry(
          interaction.id,
          resizeRect(
            interaction.origin,
            interaction.corner,
            point.x - interaction.start.x,
            point.y - interaction.start.y,
          ),
        );
        break;
      case 'draw':
        this.drawing.set({
          kind: interaction.shape,
          rect: normalizeRect(interaction.start, point),
        });
        break;
      case 'connect': {
        const from = this.store.shapeEntityMap()[interaction.fromId];
        if (from !== undefined) {
          const center = centerOf(from);
          this.connectorPreview.set({ x1: center.x, y1: center.y, x2: point.x, y2: point.y });
        }
        break;
      }
    }
  };

  private readonly handleUp = (event: PointerEvent): void => {
    const interaction = this.interaction;
    this.stopInteraction();
    if (interaction === undefined) {
      return;
    }
    const point = this.toWorld(event);
    if (interaction.kind === 'draw') {
      this.commitDrawing(interaction.shape, interaction.start, point);
    } else if (interaction.kind === 'connect') {
      const target = hitTest(this.store.shapeEntities(), point);
      if (target !== undefined && target.id !== interaction.fromId) {
        this.pickForConnector(target.id);
      }
    }
  };

  private readonly handleCancel = (): void => {
    this.stopInteraction();
  };

  private commitDrawing(kind: ShapeKind, start: Point, end: Point): void {
    const dragged = normalizeRect(start, end);
    const tooSmall = dragged.width < minimumSize || dragged.height < minimumSize;
    this.store.addShape(
      kind,
      tooSmall ? centeredRect(end, defaultSize[kind]) : clampRectToWorld(dragged),
    );
  }

  private stopInteraction(): void {
    if (this.interaction?.kind === 'move' || this.interaction?.kind === 'resize') {
      this.store.endDrag();
    }
    this.interaction = undefined;
    this.drawing.set(undefined);
    this.connectorPreview.set(undefined);
    this.stopListening();
  }

  private stopListening(): void {
    this.view?.removeEventListener('pointermove', this.handleMove);
    this.view?.removeEventListener('pointerup', this.handleUp);
    this.view?.removeEventListener('pointercancel', this.handleCancel);
  }

  private cornerOf(target: EventTarget | null): Corner | undefined {
    const name = target instanceof Element ? target.getAttribute('data-corner') : null;
    return corners.find((corner) => corner === name);
  }

  private toWorld(event: MouseEvent): Point {
    const box = this.surface().nativeElement.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - box.left) * world.width) / (box.width || world.width)),
      y: Math.round(((event.clientY - box.top) * world.height) / (box.height || world.height)),
    };
  }
}
