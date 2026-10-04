import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const major = process.argv[2];
const releaseBuild = process.argv.includes('--release');
const toolchains = JSON.parse(readFileSync(join(root, 'tools', 'toolchains.json'), 'utf8'));

if (major === undefined || toolchains[major] === undefined) {
  console.error(
    `usage: node tools/compat.mjs <${Object.keys(toolchains).join(' | ')}> [--release]`,
  );
  process.exit(2);
}

const target = join(root, '.compat', `ng${major}`);
mkdirSync(target, { recursive: true });

for (const entry of readdirSync(target)) {
  if (entry !== 'node_modules') {
    rmSync(join(target, entry), { recursive: true, force: true });
  }
}

const listing = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
});
const files = listing.stdout
  .split('\n')
  .filter((file) => file !== '' && file !== 'pnpm-lock.yaml' && existsSync(join(root, file)));
for (const file of files) {
  const destination = join(target, file);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(root, file), destination);
}

const manifestPath = join(target, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
Object.assign(manifest.devDependencies, toolchains[major].devDependencies);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const verification = [
  ['install', ['install', '--no-frozen-lockfile']],
  ['unit tests', ['exec', 'ng', 'test', 'signal-timeline', '--no-watch']],
  ['type tests', ['run', 'test:types']],
  ['library build', ['run', 'build']],
];
const releaseSteps = [
  ['install', ['install', '--no-frozen-lockfile']],
  ['library build', ['run', 'build']],
];
const steps = releaseBuild ? releaseSteps : verification;

for (const [name, args] of steps) {
  console.log(`compat ng${major}: ${name}`);
  const result = spawnSync('pnpm', args, { cwd: target, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`compat ng${major}: ${name} failed`);
    process.exit(result.status ?? 1);
  }
}
if (releaseBuild) {
  const builtLibrary = join(target, 'dist', 'signal-timeline');
  const releaseDirectory = join(root, 'dist', 'signal-timeline');
  rmSync(releaseDirectory, { recursive: true, force: true });
  mkdirSync(dirname(releaseDirectory), { recursive: true });
  cpSync(builtLibrary, releaseDirectory, { recursive: true });
  console.log(`compat ng${major}: copied the build to dist/signal-timeline`);
}
console.log(`compat ng${major}: green`);
