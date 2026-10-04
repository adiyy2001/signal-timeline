import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const coverageRoot = join(root, 'coverage');
const thresholds = [
  { name: 'core', matches: (file) => file.includes('/src/core/'), minimum: 90 },
  { name: 'everything else', matches: () => true, minimum: 80 },
];

function loadSummaries() {
  return readdirSync(coverageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(coverageRoot, entry.name, 'coverage-summary.json'))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')));
}

function collectFiles(summaries) {
  return summaries.flatMap((summary) =>
    Object.entries(summary)
      .filter(([name]) => name !== 'total')
      .map(([name, metrics]) => ({ file: relative(root, name), lines: metrics.lines })),
  );
}

function groupFiles(files) {
  const groups = thresholds.map((threshold) => ({ ...threshold, files: [] }));
  for (const entry of files) {
    const group = groups.find((candidate) => candidate.matches(`/${entry.file}`));
    group.files.push(entry);
  }
  return groups;
}

function percentage(files) {
  const total = files.reduce((sum, entry) => sum + entry.lines.total, 0);
  const covered = files.reduce((sum, entry) => sum + entry.lines.covered, 0);
  return total === 0 ? 100 : (covered / total) * 100;
}

const groups = groupFiles(collectFiles(loadSummaries()));
let failed = false;
for (const group of groups) {
  if (group.files.length === 0) {
    continue;
  }
  const actual = percentage(group.files);
  const status = actual >= group.minimum ? 'ok' : 'FAIL';
  failed ||= status === 'FAIL';
  console.log(
    `coverage ${group.name}: ${actual.toFixed(2)} percent of lines in ${group.files.length} files, needs ${group.minimum} (${status})`,
  );
}
process.exit(failed ? 1 : 0);
