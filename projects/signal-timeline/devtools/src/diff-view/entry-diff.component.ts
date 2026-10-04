import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TimelineEntry, TimelineEntryPatches } from 'signal-timeline';
import { diffRows, formatPath } from './format-operation';

const rowLimit = 200;

@Component({
  selector: 'st-entry-diff',
  templateUrl: './entry-diff.component.html',
  styleUrl: './entry-diff.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntryDiffComponent {
  readonly entry = input<TimelineEntry | undefined>(undefined);
  readonly patches = input<TimelineEntryPatches | undefined>(undefined);

  protected readonly allRows = computed(() => {
    const patches = this.patches();
    return patches === undefined ? [] : diffRows(patches);
  });
  protected readonly rows = computed(() => this.allRows().slice(0, rowLimit));
  protected readonly hiddenRowCount = computed(() => this.allRows().length - this.rows().length);
  protected readonly time = computed(() => {
    const entry = this.entry();
    return entry === undefined || entry.parentId === undefined
      ? undefined
      : new Date(entry.timestamp).toLocaleTimeString('en-GB');
  });
  protected readonly touched = computed(() => this.entry()?.changedKeys.join(', ') ?? '');

  protected readonly formatPath = formatPath;
}
