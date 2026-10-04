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

const defaultCheckpointInterval = 250;

interface HistoryShape {
  readonly edits: number;
  readonly entities: number;
}

function buildHistory(shape: HistoryShape, checkpointEvery: number): { store: TimelineBenchStore } {
  const store = createTimelineStore(makeShapes(shape.entities, 'string'), { checkpointEvery });
  for (let index = 0; index < shape.edits; index += 1) {
    applyEdit(store, index, shape.entities, 'string');
  }
  return { store };
}

function seededSequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

interface JumpCase {
  readonly name: string;
  readonly targets: readonly number[];
}

function jumpCases(
  rootId: number,
  tipId: number,
  checkpointEvery: number,
  count: number,
): readonly JumpCase[] {
  const random = seededSequence(20261004);
  const span = tipId - rootId;
  const anywhere = Array.from(
    { length: count },
    () => rootId + 1 + Math.floor(random() * (span - 1)),
  );
  const nearTip = Array.from(
    { length: count },
    () => tipId - 1 - Math.floor(random() * Math.min(100, span - 1)),
  );
  const farthestFromCheckpoint = Array.from({ length: count }, (_, index) => {
    const checkpointDepth = Math.max(
      1,
      Math.floor(((index + 1) / count) * (span / checkpointEvery)),
    );
    return Math.min(tipId - 1, rootId + checkpointDepth * checkpointEvery - 1);
  });
  return [
    { name: 'jump to a random entry', targets: anywhere },
    { name: 'jump to an entry within 100 of the newest', targets: nearTip },
    { name: 'jump to the entry just before a checkpoint', targets: farthestFromCheckpoint },
    { name: 'jump to the initial state', targets: [rootId] },
  ];
}

async function measureCheckpointInterval(
  context: BenchContext,
  shape: HistoryShape,
  checkpointEvery: number,
): Promise<Row[]> {
  const { store } = buildHistory(shape, checkpointEvery);
  await Promise.resolve();
  const entries = store.entries();
  const tipId = store.currentEntryId();
  const rootId = entries[0].id;
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
  for (const jump of jumpCases(rootId, tipId, checkpointEvery, 200)) {
    let position = 0;
    bench.add(
      jump.name,
      timedWithSetup(
        () => {
          position += 1;
        },
        () => store.jumpTo(jump.targets[position % jump.targets.length]),
        () => store.jumpTo(tipId),
      ),
    );
  }
  await bench.run();
  const rows: Row[] = [];
  for (const task of bench.tasks) {
    const latency = latencyOf(task);
    rows.push({
      entities: shape.entities,
      edits: shape.edits,
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
  const { store } = buildHistory(
    { edits: context.settings.historyEdits, entities: context.settings.historyEntityCount },
    defaultCheckpointInterval,
  );
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
    entities: context.settings.historyEntityCount,
    edits: context.settings.historyEdits,
    checkpointEvery: defaultCheckpointInterval,
    operation: 'edit then read entries',
    p50Ms: round(latency.p50Ms, 4),
    p99Ms: round(latency.p99Ms, 4),
    samples: latency.samples,
  };
}

export async function runNavigationSuite(context: BenchContext): Promise<SuiteResult> {
  const rows: Row[] = [];
  const { settings } = context;
  const standard = { edits: settings.historyEdits, entities: settings.historyEntityCount };
  for (const checkpointEvery of settings.checkpointIntervals) {
    rows.push(...(await measureCheckpointInterval(context, standard, checkpointEvery)));
  }
  for (const checkpointEvery of settings.largeState.intervals) {
    rows.push(...(await measureCheckpointInterval(context, settings.largeState, checkpointEvery)));
  }
  rows.push(await measureEntriesSignal(context));
  return {
    description: `Latency of undo, redo and jumpTo on a linear history of ${context.settings.historyEdits} entries over ${context.settings.historyEntityCount} entities with string ids, for several checkpoint intervals. Every jump starts at the newest entry and the return trip is outside the timed region. Targets come from a fixed pseudo random sequence (200 entries anywhere, 200 within 100 of the newest), from the entry just before each checkpoint (the worst alignment for the checkpoint route), and the initial state. The last row is one edit followed by reading the entries signal with the whole history in place.`,
    notes: [
      'Latencies include the patchState call that writes the target state back into the store and the watchers it triggers.',
    ],
    rows,
  };
}
