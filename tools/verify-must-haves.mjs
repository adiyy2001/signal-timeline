import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBrowserChecks } from './must-haves/browser-checks.mjs';
import { runLibraryChecks } from './must-haves/run-library-checks.mjs';
import { runPackageChecks } from './must-haves/package-checks.mjs';
import { results } from './must-haves/runner.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');

function extractTarball() {
  const packDirectory = join(root, 'tmp', 'pack');
  const tarball = existsSync(packDirectory)
    ? readdirSync(packDirectory).find((name) => name.endsWith('.tgz'))
    : undefined;
  if (tarball === undefined) {
    console.error('no tarball in tmp/pack, run pnpm pack:lib first');
    process.exit(2);
  }
  const target = join(root, 'tmp', 'verify');
  const packageDirectory = join(target, 'node_modules', 'signal-timeline');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(packageDirectory, { recursive: true });
  const result = spawnSync(
    'tar',
    ['-xzf', join(packDirectory, tarball), '-C', packageDirectory, '--strip-components=1'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(result.stderr);
    process.exit(2);
  }
  return { tarball, packageDirectory };
}

const { tarball, packageDirectory } = extractTarball();
await runPackageChecks(tarball, packageDirectory);
await runLibraryChecks(packageDirectory);
await runBrowserChecks();

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
