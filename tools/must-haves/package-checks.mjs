import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, check, equal } from './runner.mjs';

const root = join(import.meta.dirname, '..', '..');

const requiredPackageFiles = [
  'fesm2022/signal-timeline.mjs',
  'fesm2022/signal-timeline-devtools.mjs',
  'types/signal-timeline.d.ts',
  'types/signal-timeline-devtools.d.ts',
  'LICENSE',
  'README.md',
];

const requiredSiteFiles = [
  'docs/api/index.html',
  'docs/api/modules/signal-timeline.html',
  'docs/api/modules/signal-timeline_devtools.html',
  'site/index.html',
  'site/CNAME',
  'site/api/index.html',
];

const customDomain = 'signal-timeline.adrianturbinski.pl';

function checkEntryPoints(manifest, packageDirectory) {
  assert(manifest.exports['.'] !== undefined, 'missing the main entry point');
  assert(manifest.exports['./devtools'] !== undefined, 'missing the devtools entry point');
  for (const file of requiredPackageFiles) {
    assert(existsSync(join(packageDirectory, file)), `missing ${file}`);
  }
}

function checkDependencies(manifest) {
  equal(Object.keys(manifest.dependencies), ['tslib'], 'dependencies');
  equal(
    Object.keys(manifest.peerDependencies).sort(),
    ['@angular/core', '@ngrx/signals', 'rxjs'],
    'peers',
  );
}

function checkSiteFiles() {
  for (const file of requiredSiteFiles) {
    assert(existsSync(join(root, file)), `missing ${file}, run pnpm docs:api and pnpm build:site`);
  }
}

function checkCustomDomain() {
  const index = readFileSync(join(root, 'site', 'index.html'), 'utf8');
  assert(index.includes('<base href="/">'), 'site/index.html must have <base href="/">');
  equal(readFileSync(join(root, 'site', 'CNAME'), 'utf8').trim(), customDomain, 'site/CNAME');
}

export async function runPackageChecks(tarball, packageDirectory) {
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
  await check('package', `tarball ${tarball} exposes both entry points`, () =>
    checkEntryPoints(manifest, packageDirectory),
  );
  await check('package', 'the peers and the only dependency are as documented', () =>
    checkDependencies(manifest),
  );
  await check('docs', 'TypeDoc output and the assembled site exist', checkSiteFiles);
  await check('docs', 'the site is built for the custom domain at the root', checkCustomDomain);
}
