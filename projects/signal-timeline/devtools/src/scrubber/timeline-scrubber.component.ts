import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { TimelineEntry } from 'signal-timeline';

const pageStep = 10;

@Component({
  selector: 'st-timeline-scrubber',
  templateUrl: './timeline-scrubber.component.html',
  styleUrl: './timeline-scrubber.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineScrubberComponent {
  readonly path = input.required<readonly TimelineEntry[]>();
  readonly currentId = input.required<number>();
  readonly jump = output<number>();

  protected readonly lastIndex = computed(() => Math.max(this.path().length - 1, 0));
  protected readonly index = computed(() =>
    Math.max(
      this.path().findIndex((entry) => entry.id === this.currentId()),
      0,
    ),
  );
  protected readonly currentLabel = computed(() => this.path()[this.index()]?.label ?? '');
  protected readonly valueText = computed(
    () => `Step ${this.index()} of ${this.lastIndex()}: ${this.currentLabel()}`,
  );
  protected readonly disabled = computed(() => this.path().length < 2);

  protected onInput(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.moveTo(Math.round(Number(event.target.value)));
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const target = this.targetIndexFor(event.key);
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    this.moveTo(target);
  }

  private targetIndexFor(key: string): number | undefined {
    switch (key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        return this.index() - 1;
      case 'ArrowRight':
      case 'ArrowUp':
        return this.index() + 1;
      case 'PageDown':
        return this.index() - pageStep;
      case 'PageUp':
        return this.index() + pageStep;
      case 'Home':
        return 0;
      case 'End':
        return this.lastIndex();
      default:
        return undefined;
    }
  }

  private moveTo(requested: number): void {
    const clamped = Math.min(Math.max(requested, 0), this.lastIndex());
    const entry = this.path()[clamped];
    if (entry !== undefined && clamped !== this.index()) {
      this.jump.emit(entry.id);
    }
  }
}
