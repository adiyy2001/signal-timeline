import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const packDirectory = join(root, 'tmp', 'pack');
const required = [
  'package.json',
  'fesm2022/signal-timeline.mjs',
  'fesm2022/signal-timeline-devtools.mjs',
  'types/signal-timeline.d.ts',
  'types/signal-timeline-devtools.d.ts',
];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

rmSync(packDirectory, { recursive: true, force: true });
mkdirSync(packDirectory, { recursive: true });
run('npm', ['pack', './dist/signal-timeline', '--pack-destination', packDirectory]);
const tarball = readdirSync(packDirectory).find((name) => name.endsWith('.tgz'));
if (tarball === undefined) {
  console.error('npm pack produced no tarball');
  process.exit(1);
}
const listing = run('tar', ['-tzf', join(packDirectory, tarball)])
  .split('\n')
  .map((line) => line.replace(/^package\//, ''))
  .filter(Boolean);
const missing = required.filter((file) => !listing.includes(file));
if (missing.length > 0) {
  console.error(`tarball ${tarball} is missing: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`tarball ${tarball} lists ${listing.length} files, including both entry points`);
console.log(
  run('pnpm', ['exec', 'publint', 'run', join(packDirectory, tarball), '--level', 'suggestion']),
);
