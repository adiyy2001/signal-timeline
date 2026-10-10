import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { TimelineEntry } from 'signal-timeline';

const pageStep = 10;

export type ScrubberMove =
  | { readonly kind: 'by'; readonly steps: number }
  | { readonly kind: 'index'; readonly index: number }
  | { readonly kind: 'start' }
  | { readonly kind: 'end' };

function moveForKey(key: string): ScrubberMove | undefined {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return { kind: 'by', steps: -1 };
    case 'ArrowRight':
    case 'ArrowUp':
      return { kind: 'by', steps: 1 };
    case 'PageDown':
      return { kind: 'by', steps: -pageStep };
    case 'PageUp':
      return { kind: 'by', steps: pageStep };
    case 'Home':
      return { kind: 'start' };
    case 'End':
      return { kind: 'end' };
    default:
      return undefined;
  }
}

export function resolveMove(move: ScrubberMove, index: number, lastIndex: number): number {
  const requested =
    move.kind === 'by'
      ? index + move.steps
      : move.kind === 'index'
        ? move.index
        : move.kind === 'start'
          ? 0
          : lastIndex;
  return Math.min(Math.max(requested, 0), lastIndex);
}

@Component({
  selector: 'st-timeline-scrubber',
  templateUrl: './timeline-scrubber.component.html',
  styleUrl: './timeline-scrubber.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineScrubberComponent {
  readonly path = input.required<readonly TimelineEntry[]>();
  readonly currentId = input.required<number>();
  readonly move = output<ScrubberMove>();

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
      this.move.emit({ kind: 'index', index: Math.round(Number(event.target.value)) });
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const move = moveForKey(event.key);
    if (move !== undefined) {
      event.preventDefault();
      this.move.emit(move);
    }
  }
}
