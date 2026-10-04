import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const suite = process.argv[2] ?? 'probe';
const entry = join(root, 'bench', `${suite}.ts`);
const outfile = join(root, 'tmp', 'bench', `${suite}.mjs`);
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  define: { ngDevMode: 'false' },
  tsconfig: join(root, 'tsconfig.json'),
  alias: { 'signal-timeline': join(root, 'projects', 'signal-timeline', 'src', 'public-api.ts') },
  external: ['tinybench'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

const result = spawnSync(process.execPath, ['--expose-gc', outfile], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
