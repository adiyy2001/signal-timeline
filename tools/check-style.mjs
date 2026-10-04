import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const dashPattern = new RegExp(String.raw`[\u2013\u2014]`, 'u');
const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/u;
const publicApiRoots = ['projects/signal-timeline/src/', 'projects/signal-timeline/devtools/src/'];
const textExtensions = new Set([
  '.ts',
  '.mjs',
  '.js',
  '.cjs',
  '.json',
  '.md',
  '.html',
  '.css',
  '.scss',
  '.yml',
  '.yaml',
  '.txt',
]);
const scriptExtensions = new Set(['.ts', '.mjs', '.js', '.cjs']);
const skippedFiles = new Set(['pnpm-lock.yaml', 'BRIEF.md']);

function listFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  return output.split('\0').filter(Boolean);
}

function lineOf(text, position) {
  return text.slice(0, position).split('\n').length;
}

function isPublicApiFile(file) {
  const isSource = !/\.(spec|type-spec)\.ts$/u.test(file) && !file.includes('/testing/');
  return isSource && publicApiRoots.some((prefix) => file.startsWith(prefix));
}

function commentRanges(file, text) {
  const kind = file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found = new Map();
  const collect = (ranges) => {
    for (const range of ranges ?? []) {
      found.set(range.pos, range);
    }
  };
  const visit = (node) => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.getEnd()));
    ts.forEachChild(node, visit);
  };
  visit(source);
  collect(ts.getLeadingCommentRanges(text, source.endOfFileToken.getFullStart()));
  return [...found.values()];
}

function scriptProblems(file, text) {
  const allowTsDoc = isPublicApiFile(file);
  return commentRanges(file, text)
    .filter((range) => !(allowTsDoc && text.startsWith('/**', range.pos)))
    .map((range) => `${file}:${lineOf(text, range.pos)} comment is not allowed`);
}

function markupProblems(file, text) {
  const pattern = extname(file) === '.html' ? /<!--/gu : /\/\*/gu;
  return [...text.matchAll(pattern)].map(
    (match) => `${file}:${lineOf(text, match.index)} comment is not allowed`,
  );
}

function textProblems(file, text) {
  const problems = [];
  text.split('\n').forEach((line, index) => {
    if (dashPattern.test(line)) {
      problems.push(`${file}:${index + 1} contains an em dash or an en dash`);
    }
    if (emailPattern.test(line)) {
      problems.push(`${file}:${index + 1} contains an e-mail address`);
    }
  });
  return problems;
}

function check(file) {
  const extension = extname(file);
  if (!textExtensions.has(extension) || skippedFiles.has(file.split('/').at(-1))) {
    return [];
  }
  const text = readFileSync(join(root, file), 'utf8');
  const problems = textProblems(file, text);
  if (scriptExtensions.has(extension)) {
    problems.push(...scriptProblems(file, text));
  } else if (['.html', '.css', '.scss'].includes(extension)) {
    problems.push(...markupProblems(file, text));
  }
  return problems;
}

const problems = listFiles().flatMap(check);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`check-style: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('check-style: ok');
