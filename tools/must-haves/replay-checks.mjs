import { assert, equal, sleep } from './runner.mjs';

export const replayChecks = [
  {
    area: 'replay',
    name: 'isReplaying is true after an undo and clears after a render',
    run: async (context) => {
      const { application, counterStore } = context;
      const { get, tick } = await application();
      const store = get(counterStore());
      store.inc();
      assert(!store.isReplaying(), 'not replaying after a normal change');
      store.undo();
      assert(store.isReplaying(), 'replaying right after undo');
      tick();
      assert(!store.isReplaying(), 'the flag closes after the next render');
    },
  },
  {
    area: 'replay',
    name: 'effects with skipReplay do not run during undo, redo or jumps',
    run: async (context) => {
      const { effect, skipReplay, application, counterStore } = context;
      const { get, tick, run } = await application();
      const store = get(counterStore());
      let runs = 0;
      run(() =>
        effect(() => {
          store.n();
          skipReplay(store, () => {
            runs += 1;
          });
        }),
      );
      tick();
      const baseline = runs;
      store.inc();
      tick();
      equal(runs, baseline + 1, 'a normal change runs the effect');
      store.undo();
      tick();
      store.redo();
      tick();
      store.jumpTo(store.entries()[0].id);
      tick();
      equal(runs, baseline + 1, 'replays do not run the effect');
      store.inc();
      tick();
      equal(runs, baseline + 2, 'the next normal change runs it again');
    },
  },
  {
    area: 'replay',
    name: 'rxMethod with ignoreReplays drops replayed values',
    run: async (context) => {
      const { rxMethod, pipe, tap, ignoreReplays, application, counterStore } = context;
      const { get, tick, run } = await application();
      const store = get(counterStore());
      const seen = [];
      const record = run(() =>
        rxMethod(
          pipe(
            ignoreReplays(store),
            tap((value) => seen.push(value)),
          ),
        ),
      );
      run(() => record(store.n));
      tick();
      store.inc();
      tick();
      store.undo();
      tick();
      equal(seen, [0, 1], 'the initial value and the normal change, not the replayed 0');
    },
  },
  {
    area: 'persistence',
    name: 'history survives a reload through the sessionStorage adapter',
    run: async (context) => {
      const { dom, createSessionStorageAdapter, application, counterStore } = context;
      dom.window.sessionStorage.clear();
      const options = {
        persistence: { adapter: createSessionStorageAdapter('verify-must-haves'), debounceMs: 10 },
      };
      const first = (await application()).get(counterStore(options));
      first.inc();
      first.inc();
      first.undo();
      first.bump();
      await sleep(150);
      assert(
        dom.window.sessionStorage.getItem('verify-must-haves') !== null,
        'something was saved',
      );
      const second = (await application()).get(counterStore(options));
      await sleep(150);
      equal([second.n(), second.other()], [1, 1], 'the state comes back');
      equal(second.entries().length, 4, 'every entry comes back');
      second.undo();
      equal([second.n(), second.other()], [1, 0], 'undo works on the restored history');
      const branch = second.redoBranches();
      equal(branch.length, 2, 'the branch comes back');
    },
  },
];
