import { assert, equal, sleep } from './runner.mjs';

export const storeChecks = [
  {
    area: 'store',
    name: 'undo, redo, canUndo and canRedo',
    run: async (context) => {
      const { application, counterStore } = context;
      const { get } = await application();
      const store = get(counterStore());
      assert(!store.canUndo() && !store.canRedo(), 'a fresh store has nothing to undo or redo');
      store.inc();
      store.inc();
      assert(store.canUndo() && !store.canRedo(), 'flags after two changes');
      store.undo();
      equal(store.n(), 1, 'undo');
      assert(store.canRedo(), 'canRedo after undo');
      store.redo();
      equal(store.n(), 2, 'redo');
    },
  },
  {
    area: 'store',
    name: 'entries signal lists the initial state and every change',
    run: async (context) => {
      const { application, counterStore } = context;
      const { get } = await application();
      const store = get(counterStore({ label: (change) => `n is ${change.after.n}` }));
      store.inc();
      store.inc();
      equal(
        store.entries().map((entry) => entry.label),
        ['Initial state', 'n is 1', 'n is 2'],
        'labels from the label function',
      );
    },
  },
  {
    area: 'store',
    name: 'track and skip choose the recorded keys',
    run: async (context) => {
      const { TimelineError, application, counterStore } = context;
      const skipping = (await application()).get(counterStore({ skip: ['other'] }));
      skipping.bump();
      equal(skipping.entries().length, 1, 'a skipped key adds no entry');
      skipping.inc();
      equal(skipping.entries().length, 2, 'a tracked key adds an entry');
      const tracking = (await application()).get(counterStore({ track: ['n'] }));
      tracking.bump();
      equal(tracking.entries().length, 1, 'an untracked key adds no entry');
      let thrown = false;
      try {
        (await application()).get(counterStore({ track: ['missing'] }));
      } catch (error) {
        thrown = error instanceof TimelineError;
      }
      assert(thrown, 'an unknown state key throws a TimelineError');
    },
  },
  {
    area: 'store',
    name: 'maxEntries bounds the history',
    run: async (context) => {
      const { application, counterStore } = context;
      const { get } = await application();
      const store = get(counterStore({ maxEntries: 5 }));
      for (let step = 0; step < 20; step += 1) {
        store.inc();
      }
      assert(
        store.entries().length <= 6,
        `kept ${store.entries().length} entries, expected at most 6`,
      );
      equal(store.n(), 20, 'the live state is untouched by trimming');
    },
  },
  {
    area: 'store',
    name: 'coalescing by window merges quick changes into one entry',
    run: async (context) => {
      const { application, counterStore } = context;
      const { get } = await application();
      const store = get(counterStore({ coalesce: { windowMs: 40 } }));
      store.inc();
      store.inc();
      store.inc();
      equal(store.entries().length, 2, 'three quick changes make one entry');
      await sleep(120);
      store.inc();
      equal(store.entries().length, 3, 'a change after the window starts a new entry');
      store.undo();
      equal(store.n(), 3, 'undo reverts the merged entry as a whole');
    },
  },
  {
    area: 'store',
    name: 'coalescing by key merges changes of one kind',
    run: async (context) => {
      const { application, counterStore } = context;
      const { get } = await application();
      const store = get(
        counterStore({
          coalesce: { key: (change) => (change.changedKeys.includes('n') ? 'n' : undefined) },
        }),
      );
      store.inc();
      store.inc();
      store.inc();
      equal(store.entries().length, 2, 'three changes with one key make one entry');
      store.bump();
      store.bump();
      equal(store.entries().length, 4, 'changes without a key stay separate');
    },
  },
  {
    area: 'store',
    name: 'a transaction creates exactly one entry and rolls back on error',
    run: async (context) => {
      const { application, counterStore } = context;
      const { get } = await application();
      const store = get(counterStore());
      store.transaction('three changes', () => {
        store.inc();
        store.inc();
        store.bump();
      });
      equal(store.entries().length, 2, 'one entry');
      equal(store.entries()[1].label, 'three changes', 'its label');
      store.undo();
      equal([store.n(), store.other()], [0, 0], 'one undo reverts the whole transaction');
      store.redo();
      let message = '';
      try {
        store.transaction('fails', () => {
          store.inc();
          throw new Error('boom');
        });
      } catch (error) {
        message = error.message;
      }
      equal(message, 'boom', 'the error is rethrown');
      equal(store.n(), 2, 'the state is put back');
      equal(store.entries().length, 2, 'no entry for the failed transaction');
    },
  },
  {
    area: 'store',
    name: 'a change after an undo starts a branch and redo can choose it',
    run: async (context) => {
      const { application, counterStore } = context;
      const { get } = await application();
      const store = get(counterStore());
      store.inc();
      store.inc();
      const oldBranch = store.currentEntryId();
      store.undo();
      store.bump();
      const newBranch = store.currentEntryId();
      equal(store.entries().length, 4, 'both branches are kept');
      store.undo();
      equal([...store.redoBranches()].sort(), [oldBranch, newBranch].sort(), 'two redo branches');
      store.redo(oldBranch);
      equal([store.n(), store.other()], [2, 0], 'redo to the old branch');
      store.undo();
      store.redo(newBranch);
      equal([store.n(), store.other()], [1, 1], 'redo to the new branch');
    },
  },
  {
    area: 'store',
    name: 'jumpTo reaches any entry on any branch and clear drops the history',
    run: async (context) => {
      const { application, counterStore } = context;
      const { get } = await application();
      const store = get(counterStore());
      store.inc();
      store.inc();
      const second = store.currentEntryId();
      store.undo();
      store.undo();
      store.bump();
      store.jumpTo(second);
      equal([store.n(), store.other()], [2, 0], 'jump across branches');
      store.jumpTo(store.entries()[0].id);
      equal([store.n(), store.other()], [0, 0], 'jump to the initial state');
      store.clear();
      equal(store.entries().length, 1, 'clear leaves the initial entry');
      assert(!store.canUndo() && !store.canRedo(), 'nothing to undo or redo after clear');
    },
  },
  {
    area: 'store',
    name: 'forward and inverse patches are exact inverses',
    run: async (context) => {
      const { getState, applyPatch, clone, application, counterStore } = context;
      const { get } = await application();
      const store = get(counterStore());
      const states = [clone(getState(store))];
      for (let step = 0; step < 6; step += 1) {
        if (step % 2 === 0) {
          store.inc();
        } else {
          store.bump();
        }
        states.push(clone(getState(store)));
      }
      const entries = store.entries();
      for (let index = 1; index < entries.length; index += 1) {
        const patches = store.entryPatch(entries[index].id);
        const forward = clone(states[index - 1]);
        applyPatch(forward, clone(patches.forward));
        equal(forward, states[index], `forward patch of entry ${index}`);
        const inverse = clone(states[index]);
        applyPatch(inverse, clone(patches.inverse));
        equal(inverse, states[index - 1], `inverse patch of entry ${index}`);
      }
    },
  },
  {
    area: 'store',
    name: 'checkpoints keep jumpTo exact on a long history',
    run: async (context) => {
      const { application, counterStore } = context;
      const { get } = await application();
      const store = get(counterStore({ checkpointEvery: 10 }));
      for (let step = 0; step < 120; step += 1) {
        store.inc();
      }
      const entries = store.entries();
      for (const target of [37, 0, 119, 64, 10, 100]) {
        store.jumpTo(entries[target].id);
        equal(store.n(), target, `state after jumping to entry ${target}`);
      }
    },
  },
  {
    area: 'store',
    name: 'works with withEntities and nested state',
    run: async (context) => {
      const {
        signalStore,
        withState,
        withMethods,
        patchState,
        addEntity,
        removeEntity,
        updateEntity,
        withEntities,
        withTimeline,
        application,
      } = context;
      const Store = signalStore(
        { providedIn: 'root' },
        withState({ doc: { layers: [{ name: 'base', visible: true }], meta: { title: 'one' } } }),
        withEntities(),
        withTimeline(),
        withMethods((store) => ({
          add: (id) => patchState(store, addEntity({ id, label: `item ${id}` })),
          rename: (id) => patchState(store, updateEntity({ id, changes: { label: 'renamed' } })),
          remove: (id) => patchState(store, removeEntity(id)),
          hideLayer: () =>
            patchState(store, (state) => ({
              doc: { ...state.doc, layers: [{ ...state.doc.layers[0], visible: false }] },
            })),
        })),
      );
      const { get } = await application();
      const store = get(Store);
      store.add(1);
      store.add(2);
      store.rename(1);
      store.remove(2);
      store.hideLayer();
      equal(store.ids(), [1], 'entities after the edits');
      store.undo();
      equal(store.doc().layers[0].visible, true, 'nested change undone');
      store.undo();
      equal(store.ids(), [1, 2], 'removed entity restored');
      store.undo();
      equal(store.entityMap()[1].label, 'item 1', 'updated entity restored');
    },
  },
];
