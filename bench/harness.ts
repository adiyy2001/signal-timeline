import { Bench, type Task } from 'tinybench';

export interface Settings {
  readonly smoke: boolean;
  readonly taskTimeMs: number;
  readonly warmupMs: number;
  readonly rounds: number;
  readonly pairsPerRound: number;
  readonly entityCount: number;
  readonly historyEdits: number;
  readonly historyEntityCount: number;
  readonly memoryEntityCounts: readonly number[];
  readonly checkpointEntityCount: number;
  readonly largeState: {
    readonly entities: number;
    readonly edits: number;
    readonly intervals: readonly number[];
  };
  readonly checkpointIntervals: readonly number[];
  readonly scalingCounts: readonly number[];
}

export function settingsFor(smoke: boolean): Settings {
  if (smoke) {
    return {
      smoke,
      taskTimeMs: 5,
      warmupMs: 0,
      rounds: 1,
      pairsPerRound: 8,
      entityCount: 300,
      historyEdits: 300,
      historyEntityCount: 100,
      memoryEntityCounts: [100],
      checkpointEntityCount: 100,
      largeState: { entities: 200, edits: 200, intervals: [10, 50] },
      checkpointIntervals: [10, 50],
      scalingCounts: [100],
    };
  }
  return {
    smoke,
    taskTimeMs: 250,
    warmupMs: 80,
    rounds: 5,
    pairsPerRound: 80,
    entityCount: 10_000,
    historyEdits: 10_000,
    historyEntityCount: 1_000,
    memoryEntityCounts: [100, 1_000, 10_000],
    checkpointEntityCount: 1_000,
    largeState: { entities: 10_000, edits: 3_000, intervals: [25, 50, 100, 250, 1000] },
    checkpointIntervals: [10, 25, 50, 100, 250, 1000],
    scalingCounts: [1_000, 50_000],
  };
}

export interface Latency {
  readonly p50Ms: number;
  readonly meanMs: number;
  readonly p99Ms: number;
  readonly samples: number;
}

export type Row = Record<string, string | number | boolean>;

export interface SuiteResult {
  readonly description: string;
  readonly notes: readonly string[];
  readonly rows: readonly Row[];
}

export interface BenchContext {
  readonly settings: Settings;
  log(message: string): void;
}

interface Collectable {
  gc?: () => void;
}

interface ChromiumMemory {
  readonly usedJSHeapSize: number;
}

export function createBench(context: BenchContext, name: string): Bench {
  const { settings } = context;
  return new Bench({
    name,
    time: settings.taskTimeMs,
    warmupTime: settings.warmupMs,
    warmup: settings.warmupMs > 0,
    iterations: settings.smoke ? 3 : 32,
    warmupIterations: settings.smoke ? 0 : 8,
  });
}

export function latencyOf(task: Task | undefined): Latency {
  const result = task?.result;
  if (result === undefined || !('latency' in result)) {
    throw new Error(`The task ${task?.name ?? 'unknown'} produced no result`);
  }
  return {
    p50Ms: result.latency.p50,
    meanMs: result.latency.mean,
    p99Ms: result.latency.p99,
    samples: result.latency.samplesCount,
  };
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function timed(operation: () => void): () => Promise<{ overriddenDuration: number }> {
  return async () => {
    const start = performance.now();
    operation();
    return { overriddenDuration: performance.now() - start };
  };
}

export function timedThenFlush(
  operation: () => void,
): () => Promise<{ overriddenDuration: number }> {
  return async () => {
    const start = performance.now();
    operation();
    await Promise.resolve();
    return { overriddenDuration: performance.now() - start };
  };
}

export function timedWithSetup(
  before: () => void,
  operation: () => void,
  after: () => void = () => undefined,
): () => Promise<{ overriddenDuration: number }> {
  return async () => {
    before();
    const start = performance.now();
    operation();
    const duration = performance.now() - start;
    after();
    return { overriddenDuration: duration };
  };
}

export function heapBytes(): number {
  const memory = (performance as unknown as { memory?: ChromiumMemory }).memory;
  if (memory !== undefined) {
    return memory.usedJSHeapSize;
  }
  return process.memoryUsage().heapUsed;
}

export async function settleHeap(): Promise<number> {
  const collector = globalThis as Collectable;
  for (let pass = 0; pass < 4; pass += 1) {
    collector.gc?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  return heapBytes();
}

export function hasGarbageCollector(): boolean {
  return typeof (globalThis as Collectable).gc === 'function';
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
