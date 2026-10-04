import { median, round, type BenchContext, type Row, type SuiteResult } from '../harness';
import {
  createPlainStore,
  createTimelineStore,
  makeShapes,
  shapeId,
  type IdKind,
  type PlainBenchStore,
  type TimelineBenchStore,
} from '../stores';

interface Scenario {
  readonly name: string;
  readonly maxEntries?: number;
  readonly baseline: (store: PlainBenchStore, step: number) => void;
  readonly recorded: (store: TimelineBenchStore, step: number) => void;
}

function scenarios(entityCount: number, kind: IdKind): readonly Scenario[] {
  const target = shapeId(Math.floor(entityCount / 2), kind);
  const fresh = (step: number) => ({
    id: kind === 'string' ? `fresh-${step}` : entityCount + 10 + step,
    x: step,
    color: 'green',
  });
  const tenIds = Array.from({ length: 10 }, (_, index) => shapeId(index * 7, kind));
  return [
    {
      name: 'scalar patch',
      baseline: (store, step) => store.bump(step),
      recorded: (store, step) => store.bump(step),
    },
    {
      name: 'nested patch',
      baseline: (store, step) => store.zoom(1 + (step % 100) / 100),
      recorded: (store, step) => store.zoom(1 + (step % 100) / 100),
    },
    {
      name: 'updateEntity',
      baseline: (store, step) => store.move(target, step),
      recorded: (store, step) => store.move(target, step),
    },
    {
      name: 'addEntity',
      baseline: (store, step) => store.add(fresh(step)),
      recorded: (store, step) => store.add(fresh(step)),
    },
    {
      name: 'removeEntity',
      baseline: (store, step) => store.remove(shapeId(step % entityCount, kind)),
      recorded: (store, step) => store.remove(shapeId(step % entityCount, kind)),
    },
    {
      name: 'updateEntity, history full at maxEntries 100',
      maxEntries: fullHistoryLimit,
      baseline: (store, step) => store.move(target, step),
      recorded: (store, step) => store.move(target, step),
    },
    {
      name: 'transaction of ten updates',
      baseline: (store, step) => tenIds.forEach((id) => store.move(id, step)),
      recorded: (store, step) =>
        store.transaction('ten moves', () => tenIds.forEach((id) => store.move(id, step))),
    },
  ];
}

const clearEvery = 400;
const fullHistoryLimit = 100;

interface Pairs {
  readonly baseline: number[];
  readonly synchronous: number[];
  readonly total: number[];
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function measurePairs(
  scenario: Scenario,
  entityCount: number,
  kind: IdKind,
  pairCount: number,
): Promise<Pairs> {
  const shapes = makeShapes(entityCount, kind);
  const plain = createPlainStore(shapes);
  const recorded = createTimelineStore(shapes, { maxEntries: scenario.maxEntries });
  const bounded = scenario.maxEntries !== undefined;
  for (let index = 0; bounded && index < fullHistoryLimit + 10; index += 1) {
    recorded.bump(index);
  }
  await Promise.resolve();
  const pairs: Pairs = { baseline: [], synchronous: [], total: [] };
  const warmup = Math.min(20, pairCount);
  for (let step = 1; step <= pairCount + warmup; step += 1) {
    if (!bounded && step % clearEvery === 0) {
      recorded.clear();
    }
    const plainFirst = step % 2 === 0;
    let plainDuration = 0;
    let recordedDuration = 0;
    let flushDuration = 0;
    for (const turn of plainFirst ? ['plain', 'recorded'] : ['recorded', 'plain']) {
      const start = performance.now();
      if (turn === 'plain') {
        scenario.baseline(plain, step);
        plainDuration = performance.now() - start;
        await Promise.resolve();
      } else {
        scenario.recorded(recorded, step);
        recordedDuration = performance.now() - start;
        await Promise.resolve();
        flushDuration = performance.now() - start - recordedDuration;
      }
    }
    if (step > warmup) {
      pairs.baseline.push(plainDuration);
      pairs.synchronous.push(recordedDuration - plainDuration);
      pairs.total.push(recordedDuration + flushDuration - plainDuration);
    }
  }
  return pairs;
}

async function measureScenario(
  context: BenchContext,
  scenario: Scenario,
  entityCount: number,
  kind: IdKind,
): Promise<Row> {
  const { settings } = context;
  const pairCount = settings.smoke ? 8 : settings.pairsPerRound;
  const rounds: Pairs[] = [];
  for (let attempt = 0; attempt < settings.rounds; attempt += 1) {
    rounds.push(await measurePairs(scenario, entityCount, kind, pairCount));
  }
  const synchronous = rounds.flatMap((entry) => entry.synchronous);
  const total = rounds.flatMap((entry) => entry.total);
  const medians = rounds.map((entry) => median(entry.synchronous));
  const row: Row = {
    scenario: scenario.name,
    ids: kind,
    entities: entityCount,
    baselineMs: round(median(rounds.flatMap((entry) => entry.baseline)), 4),
    synchronousOverheadMs: round(median(synchronous), 4),
    synchronousOverheadMeanMs: round(mean(synchronous), 4),
    synchronousOverheadP90Ms: round(percentile(synchronous, 0.9), 4),
    synchronousOverheadRoundMinMs: round(Math.min(...medians), 4),
    synchronousOverheadRoundMaxMs: round(Math.max(...medians), 4),
    totalOverheadMs: round(median(total), 4),
    totalOverheadMeanMs: round(mean(total), 4),
    pairs: synchronous.length,
  };
  context.log(
    `recording ${scenario.name} (${kind} ids, ${entityCount}): baseline ${row['baselineMs']} ms, synchronous overhead median ${row['synchronousOverheadMs']} ms mean ${row['synchronousOverheadMeanMs']} ms, total overhead median ${row['totalOverheadMs']} ms`,
  );
  return row;
}

export async function runRecordingSuite(context: BenchContext): Promise<SuiteResult> {
  const { settings } = context;
  const rows: Row[] = [];
  for (const kind of ['string', 'integer'] as const) {
    for (const scenario of scenarios(settings.entityCount, kind)) {
      rows.push(await measureScenario(context, scenario, settings.entityCount, kind));
    }
  }
  for (const count of settings.scalingCounts) {
    for (const kind of ['string'] as const) {
      const scenario = scenarios(count, kind).find((entry) => entry.name === 'updateEntity');
      if (scenario !== undefined) {
        rows.push(await measureScenario(context, scenario, count, kind));
      }
    }
  }
  return {
    description:
      'Cost of recording one change. Every pair applies the same operation to a store without the feature and to a store with it, back to back, and alternates which one goes first. The overhead of a pair is the difference of the two durations: synchronous is the time of the patchState call, total also includes the microtask that computes the patches. Pairs from all rounds are pooled and the median and mean are reported. The two stores are timed in the same loop because two separate timing runs differ by more than the effect (the plain operation takes milliseconds and varies with garbage collection).',
    notes: [
      'The timeline store is cleared every 400 operations outside the timed region to keep the history short, except in the history full scenario.',
      'A transaction computes its patch when it commits, so its synchronous and total overhead are the same work.',
      'Median hides the occasional pause. The mean and the 90th percentile of the pairs are in the result file.',
    ],
    rows,
  };
}
