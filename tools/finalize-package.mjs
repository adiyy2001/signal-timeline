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
const repositoryPath = new URL(manifest.repository.url.replace(/^git\+/u, '')).pathname
  .replace(/\.git$/u, '')
  .slice(1);
const blobBase = `https://github.com/${repositoryPath}/blob/main/`;
const rawBase = `https://raw.githubusercontent.com/${repositoryPath}/main/`;

function absolutizeLinks(markdown) {
  return markdown.replace(
    /(!?)(\[[^\]]*\])\((?!https?:|#|mailto:)([^)\s]+)\)/gu,
    (_, bang, text, target) => {
      const base = bang === '!' ? rawBase : blobBase;
      return `${bang}${text}(${base}${target.replace(/^\.?\//u, '')})`;
    },
  );
}

function absolutizeBadgeLinks(markdown) {
  return markdown.replace(
    /\)\]\((?!https?:|#|mailto:)([^)\s]+)\)/gu,
    (_, target) => `)](${blobBase}${target})`,
  );
}

const readme = readFileSync(join(root, 'README.md'), 'utf8');
writeFileSync(
  join(root, 'dist', 'signal-timeline', 'README.md'),
  absolutizeBadgeLinks(absolutizeLinks(readme)),
);
copyFileSync(join(root, 'LICENSE'), join(root, 'dist', 'signal-timeline', 'LICENSE'));
console.log(
  'finalized dist/signal-timeline: manifest cleaned, README.md with absolute links and LICENSE copied',
);
