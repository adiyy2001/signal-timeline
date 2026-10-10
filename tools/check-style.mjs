import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const dashPattern = new RegExp(String.raw`[\u2013\u2014]`, 'u');
const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/u;
const processWords = /\bthe brief\b|\bAdrian\b|\bmilestones?\b|PLAN\.md/iu;
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
  return output
    .split('\0')
    .filter(Boolean)
    .filter((file) => existsSync(join(root, file)));
}

function lineOf(text, position) {
  return text.slice(0, position).split('\n').length;
}

function isLibrarySource(file) {
  const isSource = !/\.(spec|type-spec)\.ts$/u.test(file) && !file.includes('/testing/');
  return isSource && publicApiRoots.some((prefix) => file.startsWith(prefix));
}

function statementOf(declaration) {
  return ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration;
}

function statementKey(statement) {
  return `${relative(root, statement.getSourceFile().fileName)}:${statement.getStart()}`;
}

function collectPublicStatements() {
  const entryFiles = publicApiRoots.map((prefix) => join(root, prefix, 'public-api.ts'));
  const program = ts.createProgram(entryFiles, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const statements = new Set();
  const pending = [];
  const reachable = (declaration) => {
    const statement = statementOf(declaration);
    if (!statements.has(statementKey(statement))) {
      statements.add(statementKey(statement));
      pending.push(statement);
    }
  };
  const isHidden = (node) =>
    ts.isBlock(node) ||
    ts.isDecorator(node) ||
    (ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) =>
          [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind),
        ));
  const follow = (node) => {
    if (isHidden(node)) {
      return;
    }
    if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
      const target = ts.isTypeReferenceNode(node) ? node.typeName : node.expression;
      const symbol = checker.getSymbolAtLocation(target);
      const resolved =
        symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      for (const declaration of resolved?.declarations ?? []) {
        if (isLibrarySource(relative(root, declaration.getSourceFile().fileName))) {
          reachable(declaration);
        }
      }
    }
    ts.forEachChild(node, follow);
  };
  for (const entry of entryFiles) {
    const source = program.getSourceFile(entry);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    for (const exported of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
      const resolved =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      for (const declaration of resolved.declarations ?? []) {
        reachable(declaration);
      }
    }
  }
  while (pending.length > 0) {
    follow(pending.pop());
  }
  return statements;
}

const publicStatements = collectPublicStatements();

function topLevelStatement(node) {
  let current = node;
  while (current.parent && !ts.isSourceFile(current.parent)) {
    current = current.parent;
  }
  return current;
}

function isPublicStatement(file, statement) {
  return publicStatements.has(`${file}:${statement.getStart()}`);
}

function commentRanges(file, text) {
  const kind = file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found = new Map();
  const collect = (ranges, owner) => {
    for (const range of ranges ?? []) {
      found.set(range.pos, { range, owner });
    }
  };
  const visit = (node) => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()), node);
    collect(ts.getTrailingCommentRanges(text, node.getEnd()), undefined);
    ts.forEachChild(node, visit);
  };
  visit(source);
  collect(ts.getLeadingCommentRanges(text, source.endOfFileToken.getFullStart()), undefined);
  return [...found.values()];
}

function isPublicTsDoc(file, text, { range, owner }) {
  if (!isLibrarySource(file) || !text.startsWith('/**', range.pos) || owner === undefined) {
    return false;
  }
  if (file.endsWith('/public-api.ts')) {
    return true;
  }
  return isPublicStatement(file, topLevelStatement(owner));
}

function scriptProblems(file, text) {
  return commentRanges(file, text)
    .filter((comment) => !isPublicTsDoc(file, text, comment))
    .map(({ range }) => `${file}:${lineOf(text, range.pos)} comment is not allowed`);
}

function markupProblems(file, text) {
  const pattern = extname(file) === '.html' ? /<!--/gu : /\/\*/gu;
  return [...text.matchAll(pattern)].map(
    (match) => `${file}:${lineOf(text, match.index)} comment is not allowed`,
  );
}

function isPublishedProse(file) {
  return file.endsWith('.md') && (file === 'README.md' || file.startsWith('docs/'));
}

function textProblems(file, text) {
  const problems = [];
  text.split('\n').forEach((line, index) => {
    if (dashPattern.test(line)) {
      problems.push(`${file}:${index + 1} contains an em dash or an en dash`);
    }
    if (isPublishedProse(file) && processWords.test(line)) {
      problems.push(
        `${file}:${index + 1} mentions the brief, a milestone, PLAN.md or Adrian by name`,
      );
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
