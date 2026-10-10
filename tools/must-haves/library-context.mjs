import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const domGlobals = [
  'window',
  'document',
  'Node',
  'HTMLElement',
  'Element',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'sessionStorage',
  'localStorage',
  'requestAnimationFrame',
  'getComputedStyle',
];

async function installDom() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  for (const key of domGlobals) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    });
  }
  return dom;
}

export async function loadLibraryContext(packageDirectory) {
  const dom = await installDom();
  await import('@angular/compiler');
  const { provideZonelessChangeDetection, effect, runInInjectionContext } =
    await import('@angular/core');
  const { createApplication } = await import('@angular/platform-browser');
  const { signalStore, withState, withMethods, patchState, getState } =
    await import('@ngrx/signals');
  const { addEntity, removeEntity, updateEntity, withEntities } =
    await import('@ngrx/signals/entities');
  const { rxMethod } = await import('@ngrx/signals/rxjs-interop');
  const { applyPatch } = await import('rfc6902');
  const { pipe, tap } = await import('rxjs');
  const library = await import(
    pathToFileURL(join(packageDirectory, 'fesm2022', 'signal-timeline.mjs')).href
  );
  const {
    TimelineError,
    TimelineGroup,
    createSessionStorageAdapter,
    ignoreReplays,
    provideTimelineGroup,
    skipReplay,
    withTimeline,
  } = library;

  const clone = (value) => JSON.parse(JSON.stringify(value));

  async function application(providers = []) {
    const app = await createApplication({
      providers: [provideZonelessChangeDetection(), ...providers],
    });
    return {
      app,
      get: (token) => app.injector.get(token),
      tick: () => app.tick(),
      run: (fn) => runInInjectionContext(app.injector, fn),
    };
  }

  function counterStore(options = {}) {
    return signalStore(
      { providedIn: 'root' },
      withState({ n: 0, other: 0 }),
      withTimeline(options),
      withMethods((store) => ({
        inc: () => patchState(store, (state) => ({ n: state.n + 1 })),
        bump: () => patchState(store, (state) => ({ other: state.other + 1 })),
      })),
    );
  }

  return {
    dom,
    provideZonelessChangeDetection,
    effect,
    runInInjectionContext,
    createApplication,
    signalStore,
    withState,
    withMethods,
    patchState,
    getState,
    addEntity,
    removeEntity,
    updateEntity,
    withEntities,
    rxMethod,
    applyPatch,
    pipe,
    tap,
    TimelineError,
    TimelineGroup,
    createSessionStorageAdapter,
    ignoreReplays,
    provideTimelineGroup,
    skipReplay,
    withTimeline,
    clone,
    application,
    counterStore,
  };
}
