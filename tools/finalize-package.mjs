import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const manifestPath = join(root, 'dist', 'signal-timeline', 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.publishConfig !== undefined) {
  delete manifest.publishConfig.directory;
  if (Object.keys(manifest.publishConfig).length === 0) {
    delete manifest.publishConfig;
  }
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
for (const file of ['README.md', 'LICENSE']) {
  copyFileSync(join(root, file), join(root, 'dist', 'signal-timeline', file));
}
console.log('finalized dist/signal-timeline: manifest cleaned, README.md and LICENSE copied');
