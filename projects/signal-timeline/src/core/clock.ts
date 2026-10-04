export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface ManualClock extends Clock {
  advance(milliseconds: number): void;
  set(time: number): void;
}

export function createManualClock(start = 0): ManualClock {
  let time = start;
  return {
    now: () => time,
    advance(milliseconds: number): void {
      time += milliseconds;
    },
    set(next: number): void {
      time = next;
    },
  };
}
