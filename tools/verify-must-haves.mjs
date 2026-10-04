import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serveDemo } from './serve-demo.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const results = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function check(area, name, run) {
  try {
    await run();
    results.push({ area, name, passed: true });
    console.log(`PASS  ${area}: ${name}`);
  } catch (error) {
    results.push({ area, name, passed: false });
    console.log(`FAIL  ${area}: ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function equal(actual, expected, message) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function extractTarball() {
  const packDirectory = join(root, 'tmp', 'pack');
  const tarball = existsSync(packDirectory)
    ? readdirSync(packDirectory).find((name) => name.endsWith('.tgz'))
    : undefined;
  if (tarball === undefined) {
    console.error('no tarball in tmp/pack, run pnpm pack:lib first');
    process.exit(2);
  }
  const target = join(root, 'tmp', 'verify');
  const packageDirectory = join(target, 'node_modules', 'signal-timeline');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(packageDirectory, { recursive: true });
  const result = spawnSync(
    'tar',
    ['-xzf', join(packDirectory, tarball), '-C', packageDirectory, '--strip-components=1'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(result.stderr);
    process.exit(2);
  }
  return { tarball, packageDirectory };
}

async function runPackageChecks(packageDirectory) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  for (const key of [
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
  ]) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    });
  }
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

  const area = 'store';

  await check(area, 'undo, redo, canUndo and canRedo', async () => {
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
  });

  await check(area, 'entries signal lists the initial state and every change', async () => {
    const { get } = await application();
    const store = get(counterStore({ label: (change) => `n is ${change.after.n}` }));
    store.inc();
    store.inc();
    equal(
      store.entries().map((entry) => entry.label),
      ['Initial state', 'n is 1', 'n is 2'],
      'labels from the label function',
    );
  });

  await check(area, 'track and skip choose the recorded keys', async () => {
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
  });

  await check(area, 'maxEntries bounds the history', async () => {
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
  });

  await check(area, 'coalescing by window merges quick changes into one entry', async () => {
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
  });

  await check(area, 'coalescing by key merges changes of one kind', async () => {
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
  });

  await check(area, 'a transaction creates exactly one entry and rolls back on error', async () => {
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
  });

  await check(area, 'a change after an undo starts a branch and redo can choose it', async () => {
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
  });

  await check(
    area,
    'jumpTo reaches any entry on any branch and clear drops the history',
    async () => {
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
  );

  await check(area, 'forward and inverse patches are exact inverses', async () => {
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
  });

  await check(area, 'checkpoints keep jumpTo exact on a long history', async () => {
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
  });

  await check(area, 'works with withEntities and nested state', async () => {
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
  });

  await check('replay', 'isReplaying is true after an undo and clears after a render', async () => {
    const { get, tick } = await application();
    const store = get(counterStore());
    store.inc();
    assert(!store.isReplaying(), 'not replaying after a normal change');
    store.undo();
    assert(store.isReplaying(), 'replaying right after undo');
    tick();
    assert(!store.isReplaying(), 'the flag closes after the next render');
  });

  await check(
    'replay',
    'effects with skipReplay do not run during undo, redo or jumps',
    async () => {
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
  );

  await check('replay', 'rxMethod with ignoreReplays drops replayed values', async () => {
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
  });

  await check(
    'persistence',
    'history survives a reload through the sessionStorage adapter',
    async () => {
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
  );

  await check('group', 'one undo reverts an action that touched two stores', async () => {
    const First = signalStore(
      { providedIn: 'root' },
      withState({ n: 0 }),
      withTimeline({ group: true, storeKey: 'first' }),
      withMethods((store) => ({ inc: () => patchState(store, (s) => ({ n: s.n + 1 })) })),
    );
    const Second = signalStore(
      { providedIn: 'root' },
      withState({ m: 0 }),
      withTimeline({ group: true, storeKey: 'second' }),
      withMethods((store) => ({ inc: () => patchState(store, (s) => ({ m: s.m + 1 })) })),
    );
    const { get } = await application([provideTimelineGroup()]);
    const first = get(First);
    const second = get(Second);
    const group = get(TimelineGroup);
    group.transaction('both stores', () => {
      first.inc();
      second.inc();
    });
    equal(group.entries().length, 2, 'one entry for the action');
    equal(
      [...group.entries()[1].changedKeys].sort(),
      ['first', 'second'],
      'the entry names both stores',
    );
    group.undo();
    equal([first.n(), second.m()], [0, 0], 'one undo reverts both stores');
    group.redo();
    equal([first.n(), second.m()], [1, 1], 'one redo restores both');
    first.undo();
    equal([first.n(), second.m()], [0, 0], 'a member store undoes through the shared history');
  });
}

function runStaticChecks(tarball, packageDirectory) {
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
  return Promise.all([
    check('package', `tarball ${tarball} exposes both entry points`, async () => {
      assert(manifest.exports['.'] !== undefined, 'missing the main entry point');
      assert(manifest.exports['./devtools'] !== undefined, 'missing the devtools entry point');
      for (const file of [
        'fesm2022/signal-timeline.mjs',
        'fesm2022/signal-timeline-devtools.mjs',
        'types/signal-timeline.d.ts',
        'types/signal-timeline-devtools.d.ts',
        'LICENSE',
        'README.md',
      ]) {
        assert(existsSync(join(packageDirectory, file)), `missing ${file}`);
      }
    }),
    check('package', 'the peers and the only dependency are as documented', async () => {
      equal(Object.keys(manifest.dependencies), ['tslib'], 'dependencies');
      equal(
        Object.keys(manifest.peerDependencies).sort(),
        ['@angular/core', '@ngrx/signals', 'rxjs'],
        'peers',
      );
    }),
    check('docs', 'TypeDoc output and the assembled site exist', async () => {
      for (const file of [
        'docs/api/index.html',
        'docs/api/modules/signal-timeline.html',
        'docs/api/modules/signal-timeline_devtools.html',
        'site/index.html',
        'site/api/index.html',
      ]) {
        assert(
          existsSync(join(root, file)),
          `missing ${file}, run pnpm docs:api and pnpm build:site`,
        );
      }
    }),
  ]);
}

async function runBrowserChecks() {
  const { chromium } = await import('playwright-core');
  const demoDirectory = join(root, 'dist', 'demo', 'browser');
  if (!existsSync(demoDirectory)) {
    await check('demo', 'the production build exists', async () => {
      throw new Error('run pnpm build:demo first');
    });
    return;
  }
  const { url, close } = await serveDemo({ directory: demoDirectory });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));

  async function point(x, y) {
    const box = await page.locator('svg.surface').boundingBox();
    return { x: box.x + (x / 960) * box.width, y: box.y + (y / 600) * box.height };
  }
  async function drag(from, to) {
    const start = await point(from[0], from[1]);
    const end = await point(to[0], to[1]);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
  }
  async function draw(tool, from, to) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    await drag(from, to);
  }
  const shapes = () => page.locator('[data-shape-id]').count();
  const connectors = () => page.locator('[data-connector-id]').count();
  const treeItems = () => page.locator('st-branch-tree [role="treeitem"]').count();
  async function settle(expected, read, message) {
    const deadline = Date.now() + 4000;
    let value = await read();
    while (value !== expected && Date.now() < deadline) {
      await sleep(50);
      value = await read();
    }
    equal(value, expected, message);
  }

  try {
    await page.goto(url);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.locator('svg.surface').waitFor();

    await check(
      'demo',
      'draws a rectangle, an ellipse and a connector, one entry each',
      async () => {
        await draw('Rectangle', [80, 120], [260, 220]);
        await draw('Ellipse', [520, 100], [700, 200]);
        await draw('Connector', [170, 170], [610, 150]);
        await settle(2, shapes, 'shapes');
        await settle(1, connectors, 'connectors');
        await settle(4, treeItems, 'tree items');
      },
    );
    await check('demo', 'moves, recolors and deletes shapes', async () => {
      await page.getByRole('button', { name: 'Select', exact: true }).click();
      await drag([170, 170], [220, 250]);
      await settle(5, treeItems, 'tree items after a move');
      await page.getByRole('button', { name: 'rose' }).click();
      await settle(6, treeItems, 'tree items after a recolor');
      await page.locator('[data-shape-id]').first().focus();
      await page.keyboard.press('Delete');
      await settle(1, shapes, 'shapes after delete');
      await settle(0, connectors, 'the connector goes with its shape');
      await settle(7, treeItems, 'delete is one entry');
    });
    await check('demo', 'undo and redo with the keyboard', async () => {
      await page.keyboard.press('Control+z');
      await settle(2, shapes, 'shapes after undo');
      await settle(1, connectors, 'connector after undo');
      await page.keyboard.press('Control+Shift+z');
      await settle(1, shapes, 'shapes after redo');
    });
    await check('demo', 'a change after an undo creates a branch', async () => {
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+z');
      await draw('Rectangle', [400, 380], [560, 470]);
      await settle(
        2,
        () => page.locator('st-branch-tree [role="treeitem"][aria-setsize="2"]').count(),
        'sibling nodes at the branch point',
      );
      await settle(8, treeItems, 'both branches stay in the tree');
    });
    await check('demo', 'jumps between branches from the tree', async () => {
      await page.locator('st-branch-tree [role="treeitem"][aria-label^="Recolor"]').first().click();
      await settle(2, shapes, 'shapes on the old branch');
      await page.locator('st-branch-tree [role="treeitem"]').last().click();
      await settle(3, shapes, 'shapes on the new branch');
    });
    await check('demo', 'scrubs the timeline with the arrow keys, Home and End', async () => {
      const scrubber = page.locator('st-timeline-scrubber input[type="range"]');
      await scrubber.focus();
      await page.keyboard.press('Home');
      await settle(0, shapes, 'shapes at the start');
      await page.keyboard.press('End');
      await settle(3, shapes, 'shapes at the end');
      await page.keyboard.press('ArrowLeft');
      await settle(2, shapes, 'one step back removes the last shape');
    });
    await check('demo', 'the tree follows the ARIA tree pattern', async () => {
      equal(await page.locator('st-branch-tree svg[role="tree"]').count(), 1, 'one tree');
      const item = page.locator('st-branch-tree [role="treeitem"]').first();
      for (const attribute of ['aria-level', 'aria-setsize', 'aria-posinset', 'aria-selected']) {
        assert((await item.getAttribute(attribute)) !== null, `treeitem lacks ${attribute}`);
      }
      assert(
        (await page.locator('st-branch-tree [role="treeitem"][aria-expanded]').count()) > 0,
        'branching nodes expose aria-expanded',
      );
      const focusable = await page
        .locator('st-branch-tree [role="treeitem"][tabindex="0"]')
        .count();
      equal(focusable, 1, 'exactly one tab stop in the tree');
    });
    await check('demo', 'the diff view shows the operations of the selected entry', async () => {
      await page.locator('st-branch-tree [role="treeitem"]').nth(1).click();
      assert((await page.locator('st-entry-diff table tbody tr').count()) > 0, 'no operation rows');
    });
    await check('demo', 'autosave runs for edits but not for undo, redo or jumps', async () => {
      const counter = page.locator('[data-test="autosave-count"]');
      const before = await counter.textContent();
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+Shift+z');
      await page.locator('st-branch-tree [role="treeitem"]').first().click();
      await sleep(300);
      equal(await counter.textContent(), before, 'the counter after replays');
    });
    await check('demo', 'the drawing and the whole history survive a reload', async () => {
      await page.locator('st-branch-tree [role="treeitem"]').last().click();
      await sleep(500);
      const items = await treeItems();
      const drawn = await shapes();
      await page.reload();
      await page.locator('svg.surface').waitFor();
      await settle(drawn, shapes, 'shapes after reload');
      await settle(items, treeItems, 'tree items after reload');
    });
    await check('demo', 'no console errors or uncaught exceptions during the run', async () => {
      equal(problems, [], 'browser problems');
    });
  } finally {
    await browser.close();
    await close();
  }
}

const { tarball, packageDirectory } = extractTarball();
await runStaticChecks(tarball, packageDirectory);
await runPackageChecks(packageDirectory);
await runBrowserChecks();

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
