import {
  createBench,
  latencyOf,
  round,
  timed,
  timedWithSetup,
  type BenchContext,
  type Row,
  type SuiteResult,
} from '../harness';
import { applyEdit, createTimelineStore, makeShapes, type TimelineBenchStore } from '../stores';

function buildHistory(
  context: BenchContext,
  checkpointEvery: number,
): { store: TimelineBenchStore; entityCount: number } {
  const { historyEdits, historyEntityCount } = context.settings;
  const store = createTimelineStore(makeShapes(historyEntityCount, 'string'), { checkpointEvery });
  for (let index = 0; index < historyEdits; index += 1) {
    applyEdit(store, index, historyEntityCount, 'string');
  }
  return { store, entityCount: historyEntityCount };
}

function jumpDistances(historyEdits: number): readonly number[] {
  return [10, 100, 1000, 5000, historyEdits].filter((distance) => distance <= historyEdits);
}

async function measureCheckpointInterval(
  context: BenchContext,
  checkpointEvery: number,
): Promise<Row[]> {
  const { store } = buildHistory(context, checkpointEvery);
  await Promise.resolve();
  const entries = store.entries();
  const tipId = store.currentEntryId();
  const rootId = entries[0].id;
  const idAtDistance = (distance: number) =>
    tipId - distance < rootId ? rootId : tipId - distance;
  const bench = createBench(context, `navigation, checkpointEvery ${checkpointEvery}`);
  bench
    .add(
      'undo',
      timedWithSetup(
        () => undefined,
        () => store.undo(),
        () => store.redo(),
      ),
    )
    .add(
      'redo',
      timedWithSetup(
        () => store.undo(),
        () => store.redo(),
      ),
    );
  for (const distance of jumpDistances(context.settings.historyEdits)) {
    const target = idAtDistance(distance);
    bench.add(
      `jump ${distance}`,
      timedWithSetup(
        () => undefined,
        () => store.jumpTo(target),
        () => store.jumpTo(tipId),
      ),
    );
  }
  await bench.run();
  const rows: Row[] = [];
  for (const task of bench.tasks) {
    const latency = latencyOf(task);
    rows.push({
      checkpointEvery,
      operation: task.name,
      p50Ms: round(latency.p50Ms, 4),
      p99Ms: round(latency.p99Ms, 4),
      samples: latency.samples,
    });
  }
  context.log(
    `navigation checkpointEvery ${checkpointEvery}: ${rows.map((row) => `${row['operation']} ${row['p50Ms']} ms`).join(', ')}`,
  );
  return rows;
}

async function measureEntriesSignal(context: BenchContext): Promise<Row> {
  const { store } = buildHistory(context, 50);
  await Promise.resolve();
  let counter = 0;
  const bench = createBench(context, 'entries signal');
  bench.add(
    'entries after one edit',
    timed(() => {
      counter += 1;
      store.bump(counter);
      store.entries();
    }),
  );
  await bench.run();
  const latency = latencyOf(bench.getTask('entries after one edit'));
  return {
    checkpointEvery: 50,
    operation: 'edit then read entries',
    p50Ms: round(latency.p50Ms, 4),
    p99Ms: round(latency.p99Ms, 4),
    samples: latency.samples,
  };
}

export async function runNavigationSuite(context: BenchContext): Promise<SuiteResult> {
  const rows: Row[] = [];
  for (const checkpointEvery of context.settings.checkpointIntervals) {
    rows.push(...(await measureCheckpointInterval(context, checkpointEvery)));
  }
  rows.push(await measureEntriesSignal(context));
  return {
    description: `Latency of undo, redo and jumpTo on a linear history of ${context.settings.historyEdits} entries over ${context.settings.historyEntityCount} entities with string ids, for several checkpoint intervals. A jump goes from the newest entry back by the given number of entries (the last one is the initial state), and the return trip is outside the timed region. The last row is one edit followed by reading the entries signal with the whole history in place.`,
    notes: [
      'Latencies include the patchState call that writes the target state back into the store and the watchers it triggers.',
    ],
    rows,
  };
}
