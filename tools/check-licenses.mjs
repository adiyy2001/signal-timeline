import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const allowed = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Python-2.0',
  'MIT-0',
  'Unlicense',
]);
const namedExceptions = new Map([
  ['axe-core', 'MPL-2.0'],
  ['lightningcss', 'MPL-2.0'],
  ['lightningcss-linux-x64-gnu', 'MPL-2.0'],
  ['caniuse-lite', 'CC-BY-4.0'],
]);

function readManifest(directory) {
  const path = join(directory, 'package.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
}

function licenseText(manifest) {
  if (typeof manifest.license === 'string') {
    return manifest.license;
  }
  if (manifest.license !== undefined && typeof manifest.license.type === 'string') {
    return manifest.license.type;
  }
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses.map((entry) => entry.type).join(' OR ');
  }
  return 'UNKNOWN';
}

function tokenize(expression) {
  return expression.match(/\(|\)|[^\s()]+/g) ?? [];
}

function evaluate(expression) {
  const tokens = tokenize(expression);
  let position = 0;

  function parseOr() {
    let result = parseAnd();
    while (tokens[position] === 'OR') {
      position += 1;
      const next = parseAnd();
      result = result || next;
    }
    return result;
  }

  function parseAnd() {
    let result = parseTerm();
    while (tokens[position] === 'AND') {
      position += 1;
      const next = parseTerm();
      result = result && next;
    }
    return result;
  }

  function parseTerm() {
    const token = tokens[position];
    position += 1;
    if (token === '(') {
      const inner = parseOr();
      position += 1;
      return inner;
    }
    return allowed.has(token ?? '');
  }

  return parseOr();
}

function installedPackages() {
  const store = join(root, 'node_modules', '.pnpm');
  const found = new Map();
  for (const folder of readdirSync(store)) {
    const modules = join(store, folder, 'node_modules');
    if (!existsSync(modules)) {
      continue;
    }
    for (const entry of readdirSync(modules)) {
      const directories = entry.startsWith('@')
        ? readdirSync(join(modules, entry)).map((name) => join(modules, entry, name))
        : [join(modules, entry)];
      for (const directory of directories) {
        const manifest = readManifest(directory);
        if (manifest?.name !== undefined && manifest.version !== undefined) {
          found.set(`${manifest.name}@${manifest.version}`, manifest);
        }
      }
    }
  }
  return found;
}

const packages = installedPackages();
const failures = [];
const exceptions = [];
for (const [id, manifest] of packages) {
  const license = licenseText(manifest);
  const exception = namedExceptions.get(manifest.name);
  if (exception !== undefined && license === exception) {
    exceptions.push(`${id} (${license})`);
  } else if (!evaluate(license)) {
    failures.push(`${id}: ${license}`);
  }
}

console.log(`checked ${packages.size} installed packages`);
for (const exception of exceptions) {
  console.log(`named exception: ${exception}`);
}
if (failures.length > 0) {
  console.error(`licenses outside the policy:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('every license is inside the policy');
