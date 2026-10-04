import { Injector } from '@angular/core';
import { closeAfterNextRender, ReplayController } from './replay';

function manualController() {
  const closers: (() => void)[] = [];
  const controller = new ReplayController((close) => closers.push(close));
  return { controller, closers };
}

describe('ReplayController', () => {
  it('opens the window for the duration of a write and keeps it open afterwards', () => {
    const { controller } = manualController();
    expect(controller.isReplaying()).toBe(false);
    controller.run(() => {
      expect(controller.applying).toBe(true);
      expect(controller.isReplaying()).toBe(true);
    });
    expect(controller.applying).toBe(false);
    expect(controller.isReplaying()).toBe(true);
    expect(controller.windowOpen).toBe(true);
  });

  it('closes the window when the scheduled closer runs', () => {
    const { controller, closers } = manualController();
    controller.run(() => undefined);
    closers[0]?.();
    expect(controller.isReplaying()).toBe(false);
  });

  it('schedules one closer for several writes in the same window', () => {
    const { controller, closers } = manualController();
    controller.run(() => undefined);
    controller.run(() => undefined);
    controller.run(() => undefined);
    expect(closers).toHaveLength(1);
  });

  it('closes at once and ignores the closer that was already scheduled', () => {
    const { controller, closers } = manualController();
    controller.run(() => undefined);
    controller.closeNow();
    expect(controller.isReplaying()).toBe(false);
    controller.run(() => undefined);
    expect(closers).toHaveLength(2);
    closers[0]?.();
    expect(controller.isReplaying()).toBe(true);
    closers[1]?.();
    expect(controller.isReplaying()).toBe(false);
  });

  it('leaves the applying flag clean when the write throws', () => {
    const { controller } = manualController();
    expect(() =>
      controller.run(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(controller.applying).toBe(false);
  });

  it('nests writes', () => {
    const { controller } = manualController();
    controller.run(() => {
      controller.run(() => undefined);
      expect(controller.applying).toBe(true);
    });
    expect(controller.applying).toBe(false);
  });
});

describe('closeAfterNextRender', () => {
  it('falls back to a microtask when the injector cannot schedule a render hook', async () => {
    const closer = closeAfterNextRender(Injector.create({ providers: [] }));
    const close = vi.fn();
    closer(close);
    expect(close).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
