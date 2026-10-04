import { resolveMove } from './timeline-scrubber.component';

describe('resolveMove', () => {
  it('moves by steps and stays inside the track', () => {
    expect(resolveMove({ kind: 'by', steps: -1 }, 2, 4)).toBe(1);
    expect(resolveMove({ kind: 'by', steps: 10 }, 2, 4)).toBe(4);
    expect(resolveMove({ kind: 'by', steps: -10 }, 2, 4)).toBe(0);
  });

  it('goes to an index, the start and the end', () => {
    expect(resolveMove({ kind: 'index', index: 3 }, 0, 4)).toBe(3);
    expect(resolveMove({ kind: 'index', index: 9 }, 0, 4)).toBe(4);
    expect(resolveMove({ kind: 'start' }, 3, 4)).toBe(0);
    expect(resolveMove({ kind: 'end' }, 1, 4)).toBe(4);
  });

  it('stays at zero on a track with one entry', () => {
    expect(resolveMove({ kind: 'by', steps: 1 }, 0, 0)).toBe(0);
  });
});
