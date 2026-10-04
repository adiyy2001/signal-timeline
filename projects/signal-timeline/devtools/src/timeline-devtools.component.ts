import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import type { TimelineSource } from 'signal-timeline';
import { indexEntries, pathFromRoot, resolveTip } from './active-path';
import { EntryDiffComponent } from './diff-view/entry-diff.component';
import {
  TimelineScrubberComponent,
  resolveMove,
  type ScrubberMove,
} from './scrubber/timeline-scrubber.component';
import { BranchTreeComponent } from './tree/branch-tree.component';

/**
 * Colors the panel uses. `auto` follows `prefers-color-scheme`.
 */
export type TimelineDevtoolsTheme = 'auto' | 'light' | 'dark';

/**
 * A time travel panel for a timeline: a scrubber over the current branch, the tree of all
 * branches, and the operations of the selected entry. It works with any store that has
 * `withTimeline`, and with a `TimelineGroup`.
 *
 * Keyboard: the scrubber takes arrow keys, Page Up, Page Down, Home and End. The tree follows
 * the W3C tree view pattern. Arrow keys move, Right and Left open and close a branch, and Enter
 * or Space jumps to the focused entry. The diff shows the entry that holds focus in the tree.
 *
 * Colors come from the `--st-*` custom properties on the element, which an app can override.
 *
 * @example
 * ```html
 * <st-devtools [timeline]="store" />
 * ```
 */
@Component({
  selector: 'st-devtools',
  imports: [TimelineScrubberComponent, BranchTreeComponent, EntryDiffComponent],
  templateUrl: './timeline-devtools.component.html',
  styleUrl: './timeline-devtools.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-theme]': 'theme()' },
})
export class TimelineDevtoolsComponent {
  /** The store or group to show. Only the members of `TimelineSource` are used. */
  readonly timeline = input.required<TimelineSource>();
  /** Forces the light or the dark colors. */
  readonly theme = input<TimelineDevtoolsTheme>('auto');

  protected readonly entries = computed(() => this.timeline().entries());
  protected readonly currentId = computed(() => this.timeline().currentEntryId());
  private readonly byId = computed(() => indexEntries(this.entries()));

  protected readonly tipId = linkedSignal<
    { readonly byId: ReturnType<typeof indexEntries>; readonly currentId: number },
    number
  >({
    source: () => ({ byId: this.byId(), currentId: this.currentId() }),
    computation: (source, previous) => resolveTip(source.byId, source.currentId, previous?.value),
  });

  protected readonly activePath = computed(() => pathFromRoot(this.byId(), this.tipId()));
  protected readonly branchEntries = computed(() =>
    this.activePath().flatMap((id) => this.byId().get(id) ?? []),
  );
  protected readonly atStart = computed(() => !this.timeline().canUndo());
  protected readonly atEnd = computed(() => this.currentId() === this.tipId());

  private readonly inspectedId = linkedSignal(() => this.currentId());
  protected readonly inspectedEntry = computed(
    () => this.byId().get(this.inspectedId()) ?? this.byId().get(this.currentId()),
  );
  protected readonly inspectedPatches = computed(() => {
    this.entries();
    const entry = this.inspectedEntry();
    return entry === undefined ? undefined : this.timeline().entryPatch(entry.id);
  });

  protected jumpTo(entryId: number): void {
    this.timeline().jumpTo(entryId);
  }

  protected inspect(entryId: number): void {
    this.inspectedId.set(entryId);
  }

  protected moveAlongBranch(move: ScrubberMove): void {
    const path = this.activePath();
    const index = Math.max(path.indexOf(this.timeline().currentEntryId()), 0);
    const target = resolveMove(move, index, path.length - 1);
    const entryId = path[target];
    if (entryId !== undefined && target !== index) {
      this.timeline().jumpTo(entryId);
    }
  }

  protected jumpToFirst(): void {
    const first = this.activePath()[0];
    if (first !== undefined) {
      this.timeline().jumpTo(first);
    }
  }

  protected jumpToLast(): void {
    this.timeline().jumpTo(this.tipId());
  }
}
