import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, signal } from '@angular/core';

export type ThemeChoice = 'auto' | 'light' | 'dark';

const storageKey = 'signal-timeline-demo-theme';
const order: readonly ThemeChoice[] = ['auto', 'light', 'dark'];

function isThemeChoice(value: string | null): value is ThemeChoice {
  return order.some((choice) => choice === value);
}

function readStored(): ThemeChoice {
  try {
    const stored = localStorage.getItem(storageKey);
    return isThemeChoice(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

function writeStored(choice: ThemeChoice): void {
  try {
    localStorage.setItem(storageKey, choice);
  } catch {
    return;
  }
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly current = signal<ThemeChoice>(readStored());

  readonly choice = this.current.asReadonly();

  constructor() {
    effect(() => {
      const choice = this.current();
      if (choice === 'auto') {
        this.root.removeAttribute('data-theme');
      } else {
        this.root.setAttribute('data-theme', choice);
      }
      writeStored(choice);
    });
  }

  next(): void {
    const index = order.indexOf(this.current());
    this.current.set(order[(index + 1) % order.length] ?? 'auto');
  }
}
