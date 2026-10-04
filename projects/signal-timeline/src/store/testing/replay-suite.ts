import { effect, Injector, signal, type EnvironmentProviders, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, watchState, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, tap } from 'rxjs';
import { ignoreReplays, skipReplay } from '../replay';
import { withTimeline } from '../with-timeline';

const Store = signalStore(
  { providedIn: 'root' },
  withState({ count: 0, other: 0 }),
  withTimeline(),
  withMethods((store) => ({
    setCount: (count: number) => patchState(store, { count }),
    setOther: (other: number) => patchState(store, { other }),
  })),
);

export function defineReplaySuite(
  name: string,
  providers: (Provider | EnvironmentProviders)[],
): void {
  describe(`replay marker, ${name}`, () => {
    beforeEach(() => {
      TestBed.configureTestingModule({ providers });
    });

    it('keeps an effect from firing its side effect during undo, redo and jumpTo', () => {
      const store = TestBed.inject(Store);
      const seen: number[] = [];
      TestBed.runInInjectionContext(() =>
        effect(() => {
          const count = store.count();
          skipReplay(store, () => seen.push(count));
        }),
      );
      TestBed.tick();
      store.setCount(1);
      store.setCount(2);
      TestBed.tick();
      expect(seen).toEqual([0, 2]);
      store.undo();
      TestBed.tick();
      store.redo();
      TestBed.tick();
      store.jumpTo(2);
      TestBed.tick();
      expect(store.count()).toBe(1);
      expect(seen).toEqual([0, 2]);
    });

    it('fires the effect again on the next live change', () => {
      const store = TestBed.inject(Store);
      const seen: number[] = [];
      TestBed.runInInjectionContext(() =>
        effect(() => {
          const count = store.count();
          skipReplay(store, () => seen.push(count));
        }),
      );
      TestBed.tick();
      store.setCount(1);
      TestBed.tick();
      store.undo();
      TestBed.tick();
      store.setCount(7);
      TestBed.tick();
      expect(seen).toEqual([0, 1, 7]);
    });

    it('is replaying until the render that flushes the effects, then not', () => {
      const store = TestBed.inject(Store);
      store.setCount(1);
      expect(store.isReplaying()).toBe(false);
      store.undo();
      expect(store.isReplaying()).toBe(true);
      TestBed.tick();
      expect(store.isReplaying()).toBe(false);
    });

    it('closes the window at once when a live change arrives in the same tick', () => {
      const store = TestBed.inject(Store);
      const seen: number[] = [];
      TestBed.runInInjectionContext(() =>
        effect(() => {
          const count = store.count();
          skipReplay(store, () => seen.push(count));
        }),
      );
      TestBed.tick();
      store.setCount(1);
      TestBed.tick();
      store.undo();
      store.setCount(9);
      expect(store.isReplaying()).toBe(false);
      TestBed.tick();
      expect(seen).toEqual([0, 1, 9]);
    });

    it('keeps an rxMethod from firing during replays', () => {
      const store = TestBed.inject(Store);
      const sent: number[] = [];
      TestBed.runInInjectionContext(() => {
        const send = rxMethod<number>(
          pipe(
            ignoreReplays(store),
            tap((value) => sent.push(value)),
          ),
        );
        send(store.count);
      });
      TestBed.tick();
      store.setCount(1);
      TestBed.tick();
      store.undo();
      TestBed.tick();
      store.redo();
      TestBed.tick();
      expect(sent).toEqual([0, 1]);
      store.setCount(3);
      TestBed.tick();
      expect(sent).toEqual([0, 1, 3]);
    });

    it('keeps a signalMethod from firing during replays', async () => {
      const { signalMethod } = await import('@ngrx/signals');
      const store = TestBed.inject(Store);
      const sent: number[] = [];
      TestBed.runInInjectionContext(() => {
        const send = signalMethod<number>((value) => skipReplay(store, () => sent.push(value)));
        send(store.count);
      });
      TestBed.tick();
      store.setCount(1);
      TestBed.tick();
      store.undo();
      TestBed.tick();
      expect(sent).toEqual([0, 1]);
      store.setCount(4);
      TestBed.tick();
      expect(sent).toEqual([0, 1, 4]);
    });

    it('shows replays to a watchState callback synchronously', () => {
      const store = TestBed.inject(Store);
      const flags: boolean[] = [];
      watchState(store, () => flags.push(store.isReplaying()), {
        injector: TestBed.inject(Injector),
      });
      store.setCount(1);
      store.undo();
      store.redo();
      expect(flags).toEqual([false, false, true, true]);
    });

    it('does not depend on the replay flag, so closing the window runs no effect', () => {
      const store = TestBed.inject(Store);
      let runs = 0;
      TestBed.runInInjectionContext(() =>
        effect(() => {
          store.count();
          skipReplay(store, () => undefined);
          runs += 1;
        }),
      );
      TestBed.tick();
      store.setCount(1);
      TestBed.tick();
      store.undo();
      TestBed.tick();
      const afterReplay = runs;
      TestBed.tick();
      expect(runs).toBe(afterReplay);
    });

    it('leaves other signals writable during a replay window', () => {
      const store = TestBed.inject(Store);
      const mirror = signal(0);
      store.setCount(1);
      store.undo();
      mirror.set(store.count());
      expect(mirror()).toBe(0);
    });
  });
}
