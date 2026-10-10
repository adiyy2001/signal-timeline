import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const site = join(root, 'site');
const pagesHost = 'signal-timeline.adrianturbinski.pl';
const skipBuild = process.argv.includes('--skip-build');

function run(args) {
  const result = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!skipBuild) {
  run(['build']);
  run(['build:demo']);
  run(['docs:api']);
}

const demo = join(root, 'dist', 'demo', 'browser');
const api = join(root, 'docs', 'api');
for (const folder of [demo, api]) {
  if (!existsSync(folder)) {
    console.error(`missing ${folder}`);
    process.exit(1);
  }
}

rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
cpSync(demo, site, { recursive: true });
cpSync(api, join(site, 'api'), { recursive: true });
writeFileSync(join(site, '.nojekyll'), '');
writeFileSync(join(site, 'CNAME'), `${pagesHost}\n`);

const indexHtml = readFileSync(join(site, 'index.html'), 'utf8');
if (!indexHtml.includes('<base href="/">')) {
  console.error('site/index.html must carry <base href="/"> for the custom domain');
  process.exit(1);
}
console.log('site/ holds the demo at / and the API reference at /api/');
