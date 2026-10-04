import {
  createBench,
  latencyOf,
  median,
  round,
  timed,
  timedThenFlush,
  type BenchContext,
  type Row,
  type SuiteResult,
} from '../harness';
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
      name: 'transaction of ten updates',
      baseline: (store, step) => tenIds.forEach((id) => store.move(id, step)),
      recorded: (store, step) =>
        store.transaction('ten moves', () => tenIds.forEach((id) => store.move(id, step))),
    },
  ];
}

const clearEvery = 400;

async function measureRound(
  context: BenchContext,
  scenario: Scenario,
  entityCount: number,
  kind: IdKind,
): Promise<{ baseline: number; synchronous: number; total: number; totalMean: number }> {
  const shapes = makeShapes(entityCount, kind);
  const plain = createPlainStore(shapes);
  const recorded = createTimelineStore(shapes);
  const counters = { baseline: 0, synchronous: 0, total: 0 };
  const run = (key: keyof typeof counters, operation: () => void) => {
    counters[key] += 1;
    if (counters[key] % clearEvery === 0) {
      recorded.clear();
    }
    operation();
  };
  const bench = createBench(context, `recording ${scenario.name}`);
  bench
    .add(
      'baseline',
      timed(() => run('baseline', () => scenario.baseline(plain, counters.baseline))),
    )
    .add(
      'synchronous',
      timed(() => run('synchronous', () => scenario.recorded(recorded, counters.synchronous))),
    )
    .add(
      'total',
      timedThenFlush(() => run('total', () => scenario.recorded(recorded, counters.total))),
    );
  await bench.run();
  return {
    baseline: latencyOf(bench.getTask('baseline')).p50Ms,
    synchronous: latencyOf(bench.getTask('synchronous')).p50Ms,
    total: latencyOf(bench.getTask('total')).p50Ms,
    totalMean: latencyOf(bench.getTask('total')).meanMs,
  };
}

async function measureScenario(
  context: BenchContext,
  scenario: Scenario,
  entityCount: number,
  kind: IdKind,
): Promise<Row> {
  const rounds = [];
  for (let round = 0; round < context.settings.rounds; round += 1) {
    rounds.push(await measureRound(context, scenario, entityCount, kind));
  }
  const synchronousDeltas = rounds.map((round) => round.synchronous - round.baseline);
  const totalDeltas = rounds.map((round) => round.total - round.baseline);
  const row: Row = {
    scenario: scenario.name,
    ids: kind,
    entities: entityCount,
    baselineMs: round(median(rounds.map((entry) => entry.baseline)), 4),
    synchronousOverheadMs: round(median(synchronousDeltas), 4),
    synchronousOverheadMinMs: round(Math.min(...synchronousDeltas), 4),
    synchronousOverheadMaxMs: round(Math.max(...synchronousDeltas), 4),
    totalOverheadMs: round(median(totalDeltas), 4),
    rounds: rounds.length,
  };
  context.log(
    `recording ${scenario.name} (${kind} ids, ${entityCount}): baseline ${row['baselineMs']} ms, synchronous overhead ${row['synchronousOverheadMs']} ms, total overhead ${row['totalOverheadMs']} ms`,
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
      'Cost of recording one change. Each round runs the same operation on a store without the feature (baseline) and on a store with it, in one tinybench run. Synchronous overhead is the p50 on the patchState call minus the baseline p50, total overhead also includes the microtask that computes the patches. The reported value is the median over the rounds.',
    notes: [
      'The timeline store is cleared every 400 operations outside the timed region to keep the history short.',
      'A transaction computes its patch when it commits, so its synchronous and total overhead are the same work.',
    ],
    rows,
  };
}
