import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const projects = [
  'projects/signal-timeline/tsconfig.lib.json',
  'projects/signal-timeline/tsconfig.spec.json',
  'projects/signal-timeline/tsconfig.type-tests.json',
  'projects/signal-timeline/devtools/tsconfig.lib.json',
  'projects/demo/tsconfig.app.json',
  'projects/demo/tsconfig.spec.json',
  'bench/tsconfig.json',
  'tools/tsconfig.json',
  'e2e/tsconfig.json',
].filter((project) => existsSync(join(root, project)));

if (!existsSync(join(root, 'dist', 'signal-timeline', 'package.json'))) {
  console.log('building the library, the demo type checks against the built package');
  const build = spawnSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

let failed = false;
for (const project of projects) {
  console.log(`typecheck ${project}`);
  const result = spawnSync('pnpm', ['exec', 'ngc', '-p', project, '--noEmit'], {
    cwd: root,
    stdio: 'inherit',
  });
  failed ||= result.status !== 0;
}
process.exit(failed ? 1 : 0);
