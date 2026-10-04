import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const projects = [
  'projects/signal-timeline/tsconfig.lib.json',
  'projects/signal-timeline/tsconfig.spec.json',
  'projects/signal-timeline/tsconfig.type-tests.json',
  'projects/signal-timeline/devtools/tsconfig.spec.json',
  'projects/demo/tsconfig.app.json',
  'projects/demo/tsconfig.spec.json',
  'bench/tsconfig.json',
  'tools/tsconfig.json',
  'e2e/tsconfig.json',
].filter((project) => existsSync(join(root, project)));

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
