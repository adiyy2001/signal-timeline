import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EditorStore } from '../editor/editor.store';
import { clampRectToWorld } from '../editor/geometry';
import { paletteKeys, type PaletteKey, type Rect, type Shape } from '../editor/model';

type Field = keyof Rect;

interface FieldInput {
  readonly field: Field;
  readonly label: string;
}

@Component({
  selector: 'demo-inspector',
  templateUrl: './inspector.component.html',
  styleUrl: './inspector.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorComponent {
  protected readonly store = inject(EditorStore);
  protected readonly palette = paletteKeys;
  protected readonly fields: readonly FieldInput[] = [
    { field: 'x', label: 'X' },
    { field: 'y', label: 'Y' },
    { field: 'width', label: 'Width' },
    { field: 'height', label: 'Height' },
  ];

  protected setFill(shape: Shape, fill: PaletteKey): void {
    this.store.setFill(shape.id, fill);
  }

  protected setField(shape: Shape, field: Field, event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const value = Number(input.value);
    if (input.value.trim() !== '' && Number.isFinite(value)) {
      this.store.setGeometry(shape.id, clampRectToWorld({ ...shape, [field]: Math.round(value) }));
    }
    const next = this.store.shapeEntityMap()[shape.id];
    input.value = String(next === undefined ? shape[field] : next[field]);
  }
}
