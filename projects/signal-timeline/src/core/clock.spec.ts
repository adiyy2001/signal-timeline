import { createManualClock, systemClock } from './clock';

describe('clock', () => {
  it('reads the wall clock', () => {
    const before = Date.now();
    const reading = systemClock.now();
    expect(reading).toBeGreaterThanOrEqual(before);
    expect(reading).toBeLessThanOrEqual(Date.now());
  });

  it('moves a manual clock only when told to', () => {
    const clock = createManualClock(10);
    expect(clock.now()).toBe(10);
    clock.advance(5);
    expect(clock.now()).toBe(15);
    clock.set(100);
    expect(clock.now()).toBe(100);
  });

  it('starts a manual clock at zero by default', () => {
    expect(createManualClock().now()).toBe(0);
  });
});
