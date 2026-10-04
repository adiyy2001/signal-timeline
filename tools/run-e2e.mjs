import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDemo } from './serve-demo.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const browser = process.env.E2E_BROWSER ?? 'chrome';
const specArgument = args.find((argument) => argument.startsWith('--spec='));

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!skipBuild) {
  run('pnpm', ['build']);
  run('pnpm', ['build:demo']);
}

const { url, close } = await serveDemo();
console.log(`serving the production build at ${url}`);

const cypressArgs = [
  'exec',
  'cypress',
  'run',
  '--project',
  'e2e',
  '--browser',
  browser,
  '--config',
  `baseUrl=${url}`,
];
if (specArgument !== undefined) {
  cypressArgs.push('--spec', specArgument.slice('--spec='.length));
}

const cypress = spawn('pnpm', cypressArgs, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CYPRESS_BASE_URL: url },
});

const status = await new Promise((resolve) => cypress.on('close', resolve));
await close();
process.exit(status ?? 1);
