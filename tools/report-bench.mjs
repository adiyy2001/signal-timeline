import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const resultsDirectory = join(root, 'bench', 'results');
const recordingTargetMs = 0.1;
const sizeTargetRatio = 10;

function loadResults() {
  return ['node', 'chromium']
    .map((runtime) => join(resultsDirectory, `${runtime}.json`))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')));
}

function table(headers, rows) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function hardwareLine(result) {
  const { hardware } = result;
  return `${result.engine} on ${hardware.cpu}, ${hardware.cores} cores, ${hardware.memoryGb} GB RAM, ${hardware.os}`;
}

function rowsOf(result, suite, predicate = () => true) {
  return result.suites[suite].rows.filter(predicate);
}

function recordingSection(result) {
  const rows = rowsOf(result, 'recording', (row) => row.entities === 10000).map((row) => [
    row.scenario,
    row.ids,
    row.baselineMs.toFixed(3),
    `${row.synchronousOverheadMs.toFixed(3)} (rounds ${row.synchronousOverheadRoundMinMs.toFixed(3)} to ${row.synchronousOverheadRoundMaxMs.toFixed(3)}, mean ${row.synchronousOverheadMeanMs.toFixed(3)}, p90 ${row.synchronousOverheadP90Ms.toFixed(3)})`,
    row.totalOverheadMs.toFixed(3),
  ]);
  const scaling = rowsOf(
    result,
    'recording',
    (row) => row.scenario === 'updateEntity' && row.ids === 'string',
  ).map((row) => [
    String(row.entities),
    row.baselineMs.toFixed(3),
    row.synchronousOverheadMs.toFixed(3),
    row.totalOverheadMs.toFixed(3),
  ]);
  return [
    '### Recording overhead',
    '',
    'Milliseconds per operation on a state with 10,000 entities. Synchronous overhead is the median of paired differences, each pair timing the patchState call with and without the feature back to back in alternating order. Total overhead also includes computing the patches.',
    '',
    table(['operation', 'ids', 'plain store', 'synchronous overhead', 'total overhead'], rows),
    '',
    'Updating one entity by number of entities (string ids):',
    '',
    table(['entities', 'plain store', 'synchronous overhead', 'total overhead'], scaling),
  ].join('\n');
}

function resolutionNote(result) {
  if (result.runtime === 'node') {
    return '';
  }
  return ' Chromium rounds timers to 0.1 ms here, so values under that read as zero and the Node numbers are the precise ones.';
}

function recordingVerdict(result) {
  const row = rowsOf(
    result,
    'recording',
    (candidate) =>
      candidate.scenario === 'updateEntity' &&
      candidate.ids === 'string' &&
      candidate.entities === 10000,
  )[0];
  if (row === undefined) {
    return 'No updateEntity row at 10,000 entities.';
  }
  const verdict = row.synchronousOverheadMs < recordingTargetMs ? 'met' : 'missed';
  return `Recording target (under ${recordingTargetMs} ms on the patchState call, 10,000 entities with string ids, updateEntity): ${verdict}, median ${row.synchronousOverheadMs.toFixed(3)} ms, worst round ${row.synchronousOverheadRoundMaxMs.toFixed(3)} ms. Computing the patches afterwards adds ${row.totalOverheadMs.toFixed(2)} ms.${resolutionNote(result)}`;
}

function sizeSection(result) {
  const rows = rowsOf(result, 'memory', (row) => row.kind === 'size and heap').map((row) => [
    String(row.entities),
    String(row.edits),
    String(row.historySerializedCharacters),
    String(row.snapshotsSerializedCharacters),
    `${row.serializedRatio}`,
    `${row.historyHeapMb} MB`,
    `${row.snapshotsHeapMb} MB`,
    `${row.heapRatio}`,
  ]);
  const verdicts = rowsOf(result, 'memory', (row) => row.kind === 'size and heap').map(
    (row) =>
      `${row.entities} entities: serialized ${row.serializedRatio >= sizeTargetRatio ? 'meets' : 'misses'} the ${sizeTargetRatio} times target (${row.serializedRatio}), heap ${row.heapRatio >= sizeTargetRatio ? 'meets' : 'misses'} it (${row.heapRatio}).`,
  );
  return [
    '### History size against full snapshots',
    '',
    table(
      [
        'entities',
        'edits',
        'history (chars)',
        'snapshots (chars)',
        'size ratio',
        'history heap',
        'snapshots heap',
        'heap ratio',
      ],
      rows,
    ),
    '',
    ...verdicts.map((line) => `- ${line}`),
  ].join('\n');
}

function navigationTable(rows) {
  const intervals = [...new Set(rows.map((row) => row.checkpointEvery))];
  const operations = [...new Set(rows.map((row) => row.operation))];
  const body = operations.map((operation) => [
    operation,
    ...intervals.map((interval) => {
      const match = rows.find(
        (row) => row.operation === operation && row.checkpointEvery === interval,
      );
      return match === undefined ? '' : `${match.p50Ms.toFixed(3)} / ${match.p99Ms.toFixed(3)}`;
    }),
  ]);
  return table(['operation', ...intervals.map((interval) => `every ${interval}`)], body);
}

function navigationSection(result) {
  const rows = rowsOf(result, 'navigation');
  const shapes = [...new Set(rows.map((row) => `${row.entities}|${row.edits}`))];
  const parts = shapes.map((shape) => {
    const [entities, edits] = shape.split('|');
    const matching = rows.filter((row) => `${row.entities}|${row.edits}` === shape);
    return [
      `History of ${edits} entries over ${entities} entities, p50 / p99 in milliseconds, by checkpoint interval.`,
      '',
      navigationTable(matching),
    ].join('\n');
  });
  return ['### Undo, redo and jumpTo', '', ...parts.flatMap((part) => [part, ''])].join('\n');
}

function checkpointSection(result) {
  const rows = rowsOf(result, 'memory', (row) => row.kind === 'checkpoint heap').map((row) => [
    String(row.entities),
    String(row.edits),
    String(row.checkpointEvery),
    `${row.historyHeapMb} MB`,
  ]);
  return [
    '### Heap by checkpoint interval',
    '',
    table(['entities', 'edits', 'checkpoint every', 'history heap'], rows),
  ].join('\n');
}

function serializationSection(result) {
  const rows = rowsOf(result, 'memory', (row) => row.kind === 'serialization').map((row) => [
    String(row.historyEntries),
    String(row.serializedCharacters),
    `${row.saveMs} ms`,
    `${row.loadMs} ms`,
  ]);
  return [
    '### Saving and loading the whole history',
    '',
    table(['entries', 'characters', 'save', 'load'], rows),
  ].join('\n');
}

function pendingSection(result) {
  const rows = rowsOf(result, 'memory', (row) => row.kind === 'pending limit').map((row) => [
    String(row.pendingLimit),
    String(row.edits),
    row.burstMsPerEdit.toFixed(3),
    `${row.pendingHeapMb} MB`,
  ]);
  return [
    '### Pending limit',
    '',
    'A burst of edits before the patches are computed, 1,000 entities.',
    '',
    table(['pending limit', 'edits', 'ms per edit', 'held by pending entries'], rows),
  ].join('\n');
}

function throughputSection(result) {
  const rows = rowsOf(result, 'throughput').map((row) => [
    row.operation,
    row.p50Ms.toFixed(4),
    String(row.operationsPerSecond),
  ]);
  return [
    '### Diff and apply',
    '',
    table(['operation', 'p50 ms', 'operations per second'], rows),
  ].join('\n');
}

function render(result) {
  return [
    `## ${result.runtime === 'node' ? 'Node' : 'Chromium'}`,
    '',
    `Hardware: ${hardwareLine(result)}. Run on ${result.generatedAt}, command \`${result.command}\`.`,
    '',
    recordingVerdict(result),
    '',
    recordingSection(result),
    '',
    sizeSection(result),
    '',
    navigationSection(result),
    '',
    checkpointSection(result),
    '',
    serializationSection(result),
    '',
    pendingSection(result),
    '',
    throughputSection(result),
  ].join('\n');
}

const results = loadResults();
if (results.length === 0) {
  console.error('No results found. Run pnpm bench first.');
  process.exit(1);
}
const report = `# Benchmark results\n\nGenerated by tools/report-bench.mjs from bench/results.\n\n${results.map(render).join('\n\n')}\n`;
if (process.argv.includes('--write')) {
  writeFileSync(join(resultsDirectory, 'summary.md'), report);
  console.log(`wrote ${join(resultsDirectory, 'summary.md')}`);
} else {
  console.log(report);
}
