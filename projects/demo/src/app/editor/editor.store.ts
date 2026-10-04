import { DestroyRef, computed, inject } from '@angular/core';
import { patchState, signalStore, type, withComputed, withMethods, withState } from '@ngrx/signals';
import {
  addEntity,
  removeEntities,
  removeEntity,
  updateEntity,
  withEntities,
} from '@ngrx/signals/entities';
import { createSessionStorageAdapter, withTimeline } from 'signal-timeline';
import { describeChange, nextShapeName } from './describe-change';
import { ID_GENERATOR } from './id-generator';
import { growRect, moveRect } from './geometry';
import type { Connector, PaletteKey, Rect, Shape, ShapeKind, Tool } from './model';

export const historyStorageKey = 'signal-timeline-demo-history';

const nudgeIdleMs = 600;

interface EditorState {
  readonly selectedId: string | null;
  readonly tool: Tool;
}

const initialState: EditorState = { selectedId: null, tool: 'select' };

const defaultFill: Record<ShapeKind, PaletteKey> = { rectangle: 'sky', ellipse: 'mint' };

function sameRect(shape: Rect, rect: Rect): boolean {
  return (
    shape.x === rect.x &&
    shape.y === rect.y &&
    shape.width === rect.width &&
    shape.height === rect.height
  );
}

export const EditorStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withEntities({ entity: type<Shape>(), collection: 'shape' }),
  withEntities({ entity: type<Connector>(), collection: 'connector' }),
  withTimeline({
    skip: ['selectedId', 'tool'],
    label: describeChange,
    persistence: { adapter: createSessionStorageAdapter(historyStorageKey) },
  }),
  withComputed((store) => ({
    selectedShape: computed(() => {
      const id = store.selectedId();
      return id === null ? undefined : store.shapeEntityMap()[id];
    }),
    selectedConnector: computed(() => {
      const id = store.selectedId();
      return id === null ? undefined : store.connectorEntityMap()[id];
    }),
  })),
  withMethods((store) => {
    const newId = inject(ID_GENERATOR);
    let activeGesture: string | undefined;
    let nudgeTimer: ReturnType<typeof setTimeout> | undefined;

    const finishGesture = (): void => {
      if (nudgeTimer !== undefined) {
        clearTimeout(nudgeTimer);
        nudgeTimer = undefined;
      }
      if (activeGesture !== undefined) {
        activeGesture = undefined;
        store.endCoalescing();
      }
    };

    const startGesture = (key: string): void => {
      if (activeGesture === key) {
        return;
      }
      finishGesture();
      store.beginCoalescing(key);
      activeGesture = key;
    };

    inject(DestroyRef).onDestroy(finishGesture);

    const setGeometry = (id: string, rect: Rect): void => {
      const shape = store.shapeEntityMap()[id];
      if (shape === undefined || sameRect(shape, rect)) {
        return;
      }
      const { x, y, width, height } = rect;
      patchState(
        store,
        updateEntity({ id, changes: { x, y, width, height } }, { collection: 'shape' }),
      );
    };

    const editFromKeyboard = (
      id: string,
      gesture: 'nudge' | 'grow',
      compute: (shape: Shape) => Rect,
    ): void => {
      const shape = store.shapeEntityMap()[id];
      if (shape === undefined) {
        return;
      }
      startGesture(`${gesture}:${id}`);
      setGeometry(id, compute(shape));
      if (nudgeTimer !== undefined) {
        clearTimeout(nudgeTimer);
      }
      nudgeTimer = setTimeout(finishGesture, nudgeIdleMs);
    };

    return {
      selectTool(tool: Tool): void {
        patchState(store, { tool, selectedId: tool === 'select' ? store.selectedId() : null });
      },

      select(id: string | null): void {
        patchState(store, { selectedId: id });
      },

      addShape(kind: ShapeKind, rect: Rect): string {
        const id = newId('shape');
        const shape: Shape = {
          id,
          kind,
          name: nextShapeName(kind, store.shapeEntityMap()),
          ...rect,
          fill: defaultFill[kind],
        };
        patchState(store, addEntity(shape, { collection: 'shape' }), {
          selectedId: id,
          tool: 'select',
        });
        return id;
      },

      setGeometry,

      setFill(id: string, fill: PaletteKey): void {
        const shape = store.shapeEntityMap()[id];
        if (shape !== undefined && shape.fill !== fill) {
          patchState(store, updateEntity({ id, changes: { fill } }, { collection: 'shape' }));
        }
      },

      connect(fromId: string, toId: string): string | undefined {
        const shapes = store.shapeEntityMap();
        const alreadyJoined = store
          .connectorEntities()
          .some(
            (connector) =>
              (connector.fromId === fromId && connector.toId === toId) ||
              (connector.fromId === toId && connector.toId === fromId),
          );
        if (fromId === toId || shapes[fromId] === undefined || shapes[toId] === undefined) {
          return undefined;
        }
        if (alreadyJoined) {
          return undefined;
        }
        const id = newId('connector');
        patchState(store, addEntity({ id, fromId, toId }, { collection: 'connector' }), {
          selectedId: id,
          tool: 'select',
        });
        return id;
      },

      deleteSelected(): void {
        finishGesture();
        const shape = store.selectedShape();
        if (shape !== undefined) {
          const attached = store
            .connectorEntities()
            .filter((connector) => connector.fromId === shape.id || connector.toId === shape.id)
            .map((connector) => connector.id);
          const suffix =
            attached.length === 0
              ? ''
              : ` and ${attached.length} ${attached.length === 1 ? 'connector' : 'connectors'}`;
          store.transaction(`Delete ${shape.name}${suffix}`, () => {
            if (attached.length > 0) {
              patchState(store, removeEntities(attached, { collection: 'connector' }));
            }
            patchState(store, removeEntity(shape.id, { collection: 'shape' }), {
              selectedId: null,
            });
          });
          return;
        }
        const connector = store.selectedConnector();
        if (connector !== undefined) {
          patchState(store, removeEntity(connector.id, { collection: 'connector' }), {
            selectedId: null,
          });
        }
      },

      beginDrag(id: string, gesture: 'move' | 'resize'): void {
        startGesture(`${gesture}:${id}`);
      },

      endDrag(): void {
        finishGesture();
      },

      nudge(id: string, dx: number, dy: number): void {
        editFromKeyboard(id, 'nudge', (shape) => moveRect(shape, dx, dy));
      },

      grow(id: string, amount: number): void {
        editFromKeyboard(id, 'grow', (shape) => growRect(shape, amount));
      },

      resetHistory(): void {
        finishGesture();
        store.clear();
      },
    };
  }),
);

export type EditorStoreType = InstanceType<typeof EditorStore>;
