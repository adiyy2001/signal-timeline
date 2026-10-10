import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const replayFile = 'projects/signal-timeline/src/store/replay.ts';
const replaySpecs = ['store/replay.spec.ts', 'store/replay.zone.spec.ts'];

const mutations = [
  {
    name: 'skipReplay runs its callback during a replay',
    file: replayFile,
    find: 'if (!untracked(store.isReplaying)) {',
    replace: 'if (true || !untracked(store.isReplaying)) {',
  },
  {
    name: 'ignoreReplays lets replayed values through',
    file: replayFile,
    find: 'return filter(() => !untracked(store.isReplaying));',
    replace: 'return filter(() => true || !untracked(store.isReplaying));',
  },
  {
    name: 'the replay window never opens',
    file: replayFile,
    find: '    this.open.set(true);',
    replace: '    this.open.set(false);',
  },
];

const originals = new Map();

function restoreAll() {
  for (const [file, text] of originals) {
    writeFileSync(join(root, file), text);
  }
  originals.clear();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    restoreAll();
    process.exit(130);
  });
}

function runReplaySpecs() {
  const include = replaySpecs.flatMap((spec) => ['--include', spec]);
  return spawnSync('pnpm', ['exec', 'ng', 'test', 'signal-timeline', '--no-watch', ...include], {
    cwd: root,
    encoding: 'utf8',
  });
}

function failedCount(output) {
  const match = /(\d+) failed/u.exec(output);
  return match === null ? 0 : Number(match[1]);
}

function applyMutation({ file, find, replace }) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  if (!text.includes(find)) {
    throw new Error(`${file} no longer contains: ${find}`);
  }
  originals.set(file, text);
  writeFileSync(path, text.replace(find, replace));
}

const baseline = runReplaySpecs();
if (baseline.status !== 0) {
  console.error('the replay specs fail without any mutation');
  process.exit(1);
}
console.log('baseline: the replay specs pass');

let escaped = 0;
try {
  for (const mutation of mutations) {
    applyMutation(mutation);
    const run = runReplaySpecs();
    restoreAll();
    const failed = failedCount(`${run.stdout}${run.stderr}`);
    const caught = run.status !== 0 && failed > 0;
    console.log(`${caught ? 'caught' : 'NOT CAUGHT'}  ${mutation.name} (${failed} failing tests)`);
    escaped += caught ? 0 : 1;
  }
} finally {
  restoreAll();
}
process.exit(escaped === 0 ? 0 : 1);
