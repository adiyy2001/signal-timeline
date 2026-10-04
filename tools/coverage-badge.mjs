import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const coverageRoot = join(root, 'coverage');
const outputPath = join(root, 'docs', 'media', 'coverage.svg');

function linesOfEveryProject() {
  return readdirSync(coverageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(coverageRoot, entry.name, 'coverage-summary.json'))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')).total.lines);
}

function colorFor(percent) {
  if (percent >= 90) {
    return '#2f7d32';
  }
  return percent >= 80 ? '#a16207' : '#b42318';
}

function textWidth(text) {
  return Math.round(text.length * 6.6 + 12);
}

function badge(label, value, color) {
  const labelWidth = textWidth(label);
  const valueWidth = textWidth(value);
  const width = labelWidth + valueWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <rect width="${labelWidth}" height="20" fill="#555"/>
  <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
  <rect width="${width}" height="20" rx="3" fill="none" stroke="rgba(0,0,0,0.15)"/>
  <g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>
`;
}

const lines = linesOfEveryProject();
const total = lines.reduce((sum, entry) => sum + entry.total, 0);
const covered = lines.reduce((sum, entry) => sum + entry.covered, 0);
const percent = (covered / total) * 100;
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, badge('coverage', `${percent.toFixed(1)}%`, colorFor(percent)));
console.log(`coverage badge written: ${percent.toFixed(2)} percent of ${total} lines`);
