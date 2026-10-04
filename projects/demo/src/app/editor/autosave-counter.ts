import { effect, inject, Injectable, signal } from '@angular/core';
import { skipReplay } from 'signal-timeline';
import { EditorStore } from './editor.store';

@Injectable({ providedIn: 'root' })
export class AutosaveCounter {
  private readonly store = inject(EditorStore);
  private readonly counted = signal(0);
  private lastShapes = this.store.shapeEntityMap();
  private lastConnectors = this.store.connectorEntityMap();

  readonly runs = this.counted.asReadonly();

  constructor() {
    effect(() => {
      const shapes = this.store.shapeEntityMap();
      const connectors = this.store.connectorEntityMap();
      const changed = shapes !== this.lastShapes || connectors !== this.lastConnectors;
      this.lastShapes = shapes;
      this.lastConnectors = connectors;
      if (changed) {
        skipReplay(this.store, () => this.counted.update((count) => count + 1));
      }
    });
  }
}
