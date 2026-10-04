import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EditorStore } from '../editor/editor.store';
import { cascadeCenter, centeredRect } from '../editor/geometry';
import { defaultSize, toolLabel, type ShapeKind, type Tool } from '../editor/model';

interface ToolButton {
  readonly tool: Tool;
  readonly name: string;
}

@Component({
  selector: 'demo-toolbar',
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolbarComponent {
  protected readonly store = inject(EditorStore);

  protected readonly tools: readonly ToolButton[] = (
    ['select', 'rectangle', 'ellipse', 'connector'] as const
  ).map((tool) => ({ tool, name: toolLabel[tool] }));

  protected selectTool(tool: Tool): void {
    this.store.selectTool(tool);
  }

  protected addShape(kind: ShapeKind): void {
    const center = cascadeCenter(this.store.shapeIds().length);
    this.store.addShape(kind, centeredRect(center, defaultSize[kind]));
  }

  protected hasSelection(): boolean {
    return this.store.selectedId() !== null;
  }
}
