import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const fixtures = join(root, 'tools', 'consumer-fixture');
const major = process.argv[2];
const keep = process.argv.includes('--keep');
const tarballArgument = process.argv.find((argument) => argument.startsWith('--tarball='));

if (major === undefined || !/^\d+$/.test(major)) {
  console.error('usage: node tools/consumer-smoke.mjs <angular major> [--tarball=<path>] [--keep]');
  process.exit(2);
}

function findTarball() {
  if (tarballArgument !== undefined) {
    return tarballArgument.slice('--tarball='.length);
  }
  const directory = join(root, 'tmp', 'pack');
  const name = existsSync(directory)
    ? readdirSync(directory).find((file) => file.endsWith('.tgz'))
    : undefined;
  if (name === undefined) {
    console.error('no tarball found, run pnpm pack:lib first or pass --tarball=<path>');
    process.exit(2);
  }
  return join(directory, name);
}

const tarball = findTarball();
const workspace = join(tmpdir(), 'signal-timeline-consumer');
const app = join(workspace, `ng${major}`);

function run(name, command, args, cwd) {
  console.log(`consumer ng${major}: ${name}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`consumer ng${major}: ${name} failed`);
    process.exit(result.status ?? 1);
  }
}

rmSync(app, { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });

run(
  'generate a fresh app',
  'npx',
  [
    '--yes',
    `@angular/cli@${major}`,
    'new',
    `ng${major}`,
    '--defaults',
    '--skip-git',
    '--skip-install',
    '--ssr=false',
    '--style=css',
    '--package-manager=npm',
  ],
  workspace,
);

const source = join(app, 'src', 'app');
for (const file of ['app.ts', 'app.html', 'app.css', 'app.spec.ts']) {
  rmSync(join(source, file), { force: true });
}
copyFileSync(join(fixtures, 'app.ts.fixture'), join(source, 'app.ts'));
copyFileSync(join(fixtures, 'app.spec.ts.fixture'), join(source, 'app.spec.ts'));

run('install the app', 'npm', ['install', '--no-audit', '--no-fund'], app);
run(
  'install the tarball and NgRx',
  'npm',
  ['install', '--no-audit', '--no-fund', tarball, `@ngrx/signals@${major}`],
  app,
);
run(
  'check that peers resolve',
  'npm',
  ['ls', 'signal-timeline', '@ngrx/signals', '@angular/core'],
  app,
);
run('production build', 'npx', ['ng', 'build', '--configuration', 'production'], app);
run('unit tests', 'npx', ['ng', 'test', '--no-watch'], app);

if (!keep) {
  rmSync(app, { recursive: true, force: true });
}
console.log(`consumer ng${major}: green${keep ? `, kept at ${app}` : ''}`);
