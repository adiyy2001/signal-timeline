import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const skipArgument = process.argv.find((argument) => argument.startsWith('--skip='));
const skipped = new Set(skipArgument === undefined ? [] : skipArgument.slice(7).split(','));

const steps = [
  ['lint', ['pnpm', 'lint']],
  ['typecheck', ['pnpm', 'typecheck']],
  ['unit', ['pnpm', 'test:coverage']],
  ['types', ['pnpm', 'test:types']],
  ['build', ['pnpm', 'build']],
  ['tarball', ['node', 'tools/check-tarball.mjs']],
  ['demo', ['pnpm', 'build:demo']],
  ['e2e', ['node', 'tools/run-e2e.mjs', '--skip-build']],
  ['lighthouse', ['node', 'tools/lighthouse.mjs']],
  ['licenses', ['node', 'tools/check-licenses.mjs']],
  ['docs', ['pnpm', 'docs:api']],
  ['site', ['node', 'tools/build-site.mjs', '--skip-build']],
  ['must-haves', ['node', 'tools/verify-must-haves.mjs']],
];

const report = [];
for (const [name, [command, ...args]] of steps) {
  if (skipped.has(name)) {
    report.push({ name, outcome: 'skipped', seconds: 0 });
    continue;
  }
  console.log(`\n=== ${name}: ${[command, ...args].join(' ')}`);
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  const seconds = Math.round((Date.now() - started) / 1000);
  report.push({ name, outcome: result.status === 0 ? 'passed' : 'FAILED', seconds });
  if (result.status !== 0) {
    break;
  }
}

console.log('\nverify summary');
for (const { name, outcome, seconds } of report) {
  console.log(`  ${name.padEnd(12)} ${outcome.padEnd(8)} ${seconds}s`);
}
process.exit(report.some((entry) => entry.outcome === 'FAILED') ? 1 : 0);
