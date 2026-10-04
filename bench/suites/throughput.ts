import { applyPatch } from '../../projects/signal-timeline/src/core/apply';
import { diffPair } from '../../projects/signal-timeline/src/core/diff';
import type { Patch } from '../../projects/signal-timeline/src/core/patch';
import {
  createBench,
  latencyOf,
  round,
  type BenchContext,
  type Row,
  type SuiteResult,
} from '../harness';

type Entities = Record<string, { id: string; x: number; color: string }>;

function entityMap(count: number, integerKeys: boolean): Entities {
  const map: Entities = {};
  for (let index = 0; index < count; index += 1) {
    const id = integerKeys ? String(index) : `shape-${index}`;
    map[id] = { id, x: index, color: index % 2 === 0 ? 'red' : 'blue' };
  }
  return map;
}

function withMovedEntity(map: Entities, key: string, x: number): Entities {
  return { ...map, [key]: { ...map[key], x } };
}

function nestedDocument(depth: number, leaf: number): Record<string, unknown> {
  let node: Record<string, unknown> = { leaf, sibling: 'stable' };
  for (let level = 0; level < depth; level += 1) {
    node = { level, child: node, other: { a: 1, b: [1, 2, 3] } };
  }
  return node;
}

function numberedArray(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

interface Case {
  readonly name: string;
  readonly run: () => unknown;
}

function diffCases(entityCount: number): Case[] {
  const small = { a: 1, b: 'two', c: true, d: null, e: [1, 2, 3], f: { g: 1 } };
  const smallAfter = { ...small, a: 2 };
  const stringMap = entityMap(entityCount, false);
  const stringMapAfter = withMovedEntity(stringMap, `shape-${entityCount >> 1}`, -1);
  const integerMap = entityMap(entityCount, true);
  const integerMapAfter = withMovedEntity(integerMap, String(entityCount >> 1), -1);
  const smallMap = entityMap(1000, false);
  const smallMapAfter = withMovedEntity(smallMap, 'shape-500', -1);
  const deepBefore = nestedDocument(12, 1);
  const deepAfter = nestedDocument(12, 2);
  const longArray = numberedArray(1000);
  const appended = [...longArray, 1000];
  const edited = longArray.map((value, index) => (index === 500 ? -1 : value));
  return [
    { name: 'diff, 6 key object, 1 change', run: () => diffPair(small, smallAfter) },
    { name: 'diff, 12 levels deep, 1 change', run: () => diffPair(deepBefore, deepAfter) },
    { name: 'diff, 1,000 entity map, 1 change', run: () => diffPair(smallMap, smallMapAfter) },
    {
      name: `diff, ${entityCount} entity map, string keys, 1 change`,
      run: () => diffPair(stringMap, stringMapAfter),
    },
    {
      name: `diff, ${entityCount} entity map, integer keys, 1 change`,
      run: () => diffPair(integerMap, integerMapAfter),
    },
    { name: 'diff, array of 1,000, append', run: () => diffPair(longArray, appended) },
    { name: 'diff, array of 1,000, 1 edit', run: () => diffPair(longArray, edited) },
    {
      name: 'diff, unchanged same reference',
      run: () => diffPair(stringMap, stringMap),
    },
  ];
}

function applyCases(entityCount: number): Case[] {
  const stringMap = entityMap(entityCount, false);
  const key = `shape-${entityCount >> 1}`;
  const replaceOne: Patch = [{ op: 'replace', path: `/${key}/x`, value: -1 }];
  const deep = nestedDocument(12, 1);
  const deepPath = `${'/child'.repeat(12)}/leaf`;
  const deepPatch: Patch = [{ op: 'replace', path: deepPath, value: 2 }];
  const hundredOps: Patch = Array.from({ length: 100 }, (_, index) => ({
    op: 'replace' as const,
    path: `/shape-${index}/x`,
    value: -index,
  }));
  return [
    {
      name: `apply, ${entityCount} entity map, 1 replace`,
      run: () => applyPatch(stringMap, replaceOne),
    },
    { name: 'apply, 12 levels deep, 1 replace', run: () => applyPatch(deep, deepPatch) },
    {
      name: `apply, ${entityCount} entity map, 100 replaces in one call`,
      run: () => applyPatch(stringMap, hundredOps),
    },
  ];
}

export async function runThroughputSuite(context: BenchContext): Promise<SuiteResult> {
  const count = context.settings.entityCount;
  const bench = createBench(context, 'throughput');
  for (const entry of [...diffCases(count), ...applyCases(count)]) {
    bench.add(entry.name, () => {
      entry.run();
    });
  }
  await bench.run();
  const rows: Row[] = bench.tasks.map((task) => {
    const latency = latencyOf(task);
    return {
      operation: task.name,
      p50Ms: round(latency.p50Ms, 5),
      p99Ms: round(latency.p99Ms, 5),
      operationsPerSecond: Math.round(1000 / latency.meanMs),
      samples: latency.samples,
    };
  });
  for (const row of rows) {
    context.log(`throughput ${row['operation']}: p50 ${row['p50Ms']} ms`);
  }
  return {
    description:
      'Throughput of the structural diff (forward and inverse patch in one pass) and of applyPatch, called directly on plain data. Every diff pair shares the unchanged subtrees by reference.',
    notes: [
      'The 100 operation patch replaces one field in each of the first 100 entities of the map, in one call.',
    ],
    rows,
  };
}
