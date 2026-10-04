import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { TimelineDevtoolsComponent } from 'signal-timeline/devtools';
import { CanvasComponent } from './canvas/canvas.component';
import { AutosaveCounter } from './editor/autosave-counter';
import { EditorStore } from './editor/editor.store';
import { InspectorComponent } from './panel/inspector.component';
import { ToolbarComponent } from './panel/toolbar.component';
import { ThemeService } from './theme.service';

@Component({
  selector: 'demo-root',
  imports: [TimelineDevtoolsComponent, CanvasComponent, ToolbarComponent, InspectorComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly store = inject(EditorStore);
  protected readonly autosave = inject(AutosaveCounter);
  protected readonly theme = inject(ThemeService);

  @HostListener('document:keydown', ['$event'])
  protected onShortcut(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();
    const redo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey);
    if (redo) {
      event.preventDefault();
      this.store.redo();
    } else if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.store.undo();
    }
  }

  protected clearHistory(): void {
    this.store.resetHistory();
  }
}
