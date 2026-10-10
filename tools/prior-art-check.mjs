import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const packageSpec = process.argv[2] ?? '@ngrx-toolkit/core@22.0.1';

function fetchToolkit() {
  const work = mkdtempSync(join(tmpdir(), 'signal-timeline-prior-art-'));
  const packed = spawnSync('npm', ['pack', packageSpec, '--silent'], {
    cwd: work,
    encoding: 'utf8',
  });
  if (packed.status !== 0) {
    console.error(packed.stderr);
    process.exit(2);
  }
  const tarball = readdirSync(work).find((name) => name.endsWith('.tgz'));
  spawnSync('tar', ['-xzf', tarball], { cwd: work });
  const target = join(root, 'tmp', 'prior-art');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const file = join(target, 'toolkit.mjs');
  copyFileSync(join(work, 'package', 'fesm2022', 'ngrx-toolkit-core.mjs'), file);
  rmSync(work, { recursive: true, force: true });
  return file;
}

async function installDomGlobals() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  for (const key of ['window', 'document', 'Node', 'HTMLElement', 'Element', 'Event']) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    });
  }
}

async function main() {
  const file = fetchToolkit();
  await installDomGlobals();
  await import('@angular/compiler');
  const { provideZonelessChangeDetection } = await import('@angular/core');
  const { createApplication } = await import('@angular/platform-browser');
  const { signalStore, withState, withMethods, patchState } = await import('@ngrx/signals');
  const { withUndoRedo } = await import(pathToFileURL(file).href);

  const maxStackSize = 3;
  const edits = 20;
  const Store = signalStore(
    { providedIn: 'root' },
    withState({ filter: 0 }),
    withUndoRedo({ maxStackSize, keys: ['filter'] }),
    withMethods((store) => ({ set: (filter) => patchState(store, { filter }) })),
  );
  const app = await createApplication({ providers: [provideZonelessChangeDetection()] });
  const store = app.injector.get(Store);
  for (let value = 1; value <= edits; value++) {
    store.set(value);
  }
  let undos = 0;
  while (store.canUndo()) {
    store.undo();
    undos++;
  }
  console.log(`package ${packageSpec}`);
  console.log(
    `maxStackSize ${maxStackSize}, ${edits} edits, then undo until canUndo is false: ${undos} undos`,
  );
  console.log(`the limit is ${undos <= maxStackSize ? 'respected' : 'not applied'}`);

  store.set(100);
  store.undo();
  store.set(200);
  console.log(`after undo and a new edit canRedo is ${store.canRedo()}`);
  app.destroy();
}

await main();
