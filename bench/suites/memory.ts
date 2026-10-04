import { getState } from '@ngrx/signals';
import { TimelineEngine } from '../../projects/signal-timeline/src/core/engine';
import {
  parseSnapshot,
  serializeSnapshot,
} from '../../projects/signal-timeline/src/persistence/format';
import type { TimelinePersistenceAdapter } from 'signal-timeline';
import {
  hasGarbageCollector,
  round,
  settleHeap,
  type BenchContext,
  type Row,
  type SuiteResult,
} from '../harness';
import {
  applyEdit,
  createPlainStore,
  createTimelineStore,
  makeShapes,
  type PlainBenchStore,
  type TimelineBenchStore,
} from '../stores';

const megabytes = 1024 * 1024;
const defaultCheckpointInterval = 50;

type Slices = Record<string, unknown>;

function sliceOf(store: PlainBenchStore | TimelineBenchStore): Slices {
  const state = getState(store);
  return {
    entityMap: state.entityMap,
    ids: state.ids,
    counter: state.counter,
    settings: state.settings,
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function retainedBy(build: () => unknown): Promise<number> {
  const before = await settleHeap();
  const held = build();
  const after = await settleHeap();
  void held;
  return after - before;
}

function editedPlainStore(edits: number, entityCount: number): PlainBenchStore {
  const store = createPlainStore(makeShapes(entityCount, 'string'));
  for (let index = 0; index < edits; index += 1) {
    applyEdit(store, index, entityCount, 'string');
  }
  return store;
}

interface HistoryMeasurement {
  readonly retainedBytes: number;
  readonly serializedCharacters: number;
}

async function measureHistory(
  edits: number,
  entityCount: number,
  checkpointEvery: number,
): Promise<HistoryMeasurement> {
  let serializedCharacters = 0;
  const adapter: TimelinePersistenceAdapter = {
    load: () => null,
    save: (value) => {
      serializedCharacters = value.length;
    },
    remove: () => undefined,
  };
  const retainedBytes = await retainedBy(() => {
    const store = createTimelineStore(makeShapes(entityCount, 'string'), {
      checkpointEvery,
      persistence: { adapter, debounceMs: 0 },
    });
    for (let index = 0; index < edits; index += 1) {
      applyEdit(store, index, entityCount, 'string');
    }
    return store;
  }).then(async (bytes) => {
    await wait(20);
    return bytes;
  });
  return { retainedBytes, serializedCharacters };
}

async function measureSnapshots(edits: number, entityCount: number): Promise<HistoryMeasurement> {
  const snapshots: Slices[] = [];
  const retainedBytes = await retainedBy(() => {
    const store = createPlainStore(makeShapes(entityCount, 'string'));
    snapshots.push(sliceOf(store));
    for (let index = 0; index < edits; index += 1) {
      applyEdit(store, index, entityCount, 'string');
      snapshots.push(sliceOf(store));
    }
    return store;
  });
  let serializedCharacters = 0;
  for (const snapshot of snapshots) {
    serializedCharacters += JSON.stringify(snapshot).length;
  }
  snapshots.length = 0;
  return { retainedBytes, serializedCharacters };
}

async function sizeRow(context: BenchContext, entityCount: number): Promise<Row> {
  const { historyEdits: edits } = context.settings;
  const plain = await retainedBy(() => editedPlainStore(edits, entityCount));
  const snapshots = await measureSnapshots(edits, entityCount);
  const history = await measureHistory(edits, entityCount, defaultCheckpointInterval);
  const snapshotHeap = snapshots.retainedBytes - plain;
  const historyHeap = history.retainedBytes - plain;
  const row: Row = {
    kind: 'size and heap',
    edits,
    entities: entityCount,
    checkpointEvery: defaultCheckpointInterval,
    historySerializedCharacters: history.serializedCharacters,
    snapshotsSerializedCharacters: snapshots.serializedCharacters,
    serializedRatio: round(snapshots.serializedCharacters / history.serializedCharacters, 1),
    historyHeapMb: round(historyHeap / megabytes, 2),
    snapshotsHeapMb: round(snapshotHeap / megabytes, 2),
    heapRatio: round(snapshotHeap / historyHeap, 1),
  };
  context.log(
    `${entityCount} entities: serialized ratio ${row['serializedRatio']}, heap ratio ${row['heapRatio']} (history ${row['historyHeapMb']} MB, snapshots ${row['snapshotsHeapMb']} MB)`,
  );
  return row;
}

async function checkpointRows(context: BenchContext): Promise<Row[]> {
  const { settings } = context;
  const edits = settings.historyEdits;
  const entityCount = settings.checkpointEntityCount;
  const plain = await retainedBy(() => editedPlainStore(edits, entityCount));
  const rows: Row[] = [];
  for (const checkpointEvery of settings.checkpointIntervals) {
    const history = await measureHistory(edits, entityCount, checkpointEvery);
    rows.push({
      kind: 'checkpoint heap',
      checkpointEvery,
      edits,
      entities: entityCount,
      historyHeapMb: round((history.retainedBytes - plain) / megabytes, 2),
      serializedCharacters: history.serializedCharacters,
    });
    context.log(`checkpointEvery ${checkpointEvery}: ${rows.at(-1)?.['historyHeapMb']} MB`);
  }
  return rows;
}

interface Burst {
  readonly engine: TimelineEngine<Slices>;
  readonly flush: () => void;
  readonly durationMs: number;
}

function burstOfEdits(
  edits: number,
  entityCount: number,
  pendingLimit: number,
  deferFlush: boolean,
): Burst {
  const store = createPlainStore(makeShapes(entityCount, 'string'));
  const queued: (() => void)[] = [];
  const engine = new TimelineEngine<Slices>(sliceOf(store), {
    pendingLimit,
    schedule: deferFlush ? (task) => queued.push(task) : (task) => queueMicrotask(task),
  });
  const start = performance.now();
  for (let index = 0; index < edits; index += 1) {
    applyEdit(store, index, entityCount, 'string');
    engine.record(sliceOf(store), { label: `edit ${index}` });
  }
  const durationMs = performance.now() - start;
  return { engine, flush: () => queued.splice(0).forEach((task) => task()), durationMs };
}

async function measurePendingLimit(
  context: BenchContext,
  pendingLimit: number,
  edits: number,
  entityCount: number,
): Promise<Row> {
  await settleHeap();
  const burst = burstOfEdits(edits, entityCount, pendingLimit, true);
  const withPending = await settleHeap();
  burst.flush();
  const flushed = await settleHeap();
  void burst.engine;
  const row: Row = {
    kind: 'pending limit',
    pendingLimit,
    edits,
    entities: entityCount,
    burstMsPerEdit: round(burst.durationMs / edits, 4),
    pendingHeapMb: round((withPending - flushed) / megabytes, 2),
  };
  context.log(
    `pending limit ${pendingLimit}: ${row['burstMsPerEdit']} ms per edit including the edit itself, ${row['pendingHeapMb']} MB held by pending entries`,
  );
  return row;
}

async function pendingLimitRows(context: BenchContext): Promise<Row[]> {
  const { settings } = context;
  const edits = settings.smoke ? 200 : 2_000;
  const limits = settings.smoke ? [0, 64] : [0, 16, 64, 256, 1024];
  const rows: Row[] = [];
  for (const pendingLimit of limits) {
    rows.push(
      await measurePendingLimit(context, pendingLimit, edits, settings.checkpointEntityCount),
    );
  }
  return rows;
}

function serializationRow(context: BenchContext, edits: number): Row {
  const { settings } = context;
  const entityCount = settings.checkpointEntityCount;
  const { engine } = burstOfEdits(edits, entityCount, 64, false);
  engine.materializeAll();
  const keys = Object.keys(engine.state).sort();
  const rounds = settings.smoke ? 1 : 5;
  const saveTimes: number[] = [];
  const loadTimes: number[] = [];
  let characters = 0;
  for (let attempt = 0; attempt < rounds; attempt += 1) {
    const saveStart = performance.now();
    const text = serializeSnapshot(engine.snapshot(), keys);
    saveTimes.push(performance.now() - saveStart);
    characters = text.length;
    const loadStart = performance.now();
    TimelineEngine.restore(parseSnapshot(text, { keys }));
    loadTimes.push(performance.now() - loadStart);
  }
  const row: Row = {
    kind: 'serialization',
    historyEntries: edits,
    entities: entityCount,
    serializedCharacters: characters,
    saveMs: round(Math.min(...saveTimes), 2),
    loadMs: round(Math.min(...loadTimes), 2),
  };
  context.log(
    `serialization at ${edits} entries: save ${row['saveMs']} ms, load ${row['loadMs']} ms, ${characters} characters`,
  );
  return row;
}

export async function runMemorySuite(context: BenchContext): Promise<SuiteResult> {
  const { settings } = context;
  if (!hasGarbageCollector()) {
    throw new Error('The memory suite needs a runtime started with garbage collection exposed');
  }
  const rows: Row[] = [];
  for (const entityCount of settings.memoryEntityCounts) {
    rows.push(await sizeRow(context, entityCount));
  }
  rows.push(...(await checkpointRows(context)));
  rows.push(...(await pendingLimitRows(context)));
  for (const edits of settings.smoke ? [100] : [1_000, 10_000]) {
    rows.push(serializationRow(context, edits));
  }
  return {
    description: `History after ${settings.historyEdits} small edits (70 percent entity moves, 20 percent counter, 10 percent nested view changes), compared with keeping a full snapshot of the tracked state after every edit. Serialized size is counted in characters of JSON (the content is ASCII, so characters are bytes). Heap is the retained size after forced collections, with the same store and edits without the feature subtracted. A snapshot is the set of references to the tracked slices after the edit, which is what a snapshot stack keeps. The checkpoint rows, the pending limit rows and the serialization rows use ${settings.checkpointEntityCount} entities.`,
    notes: [
      'Each updateEntity copies the whole entity map, so every snapshot keeps its own copy of the map. The history keeps one map per checkpoint instead.',
      'The size and heap ratios are the snapshot figure divided by the history figure.',
      'The pending heap is what the pending entries of a burst hold before their patches exist: the heap with them minus the heap after the flush.',
      'Serialization rows time engine.snapshot plus JSON text for the save, and parse, validate and restore for the load, best of five.',
    ],
    rows,
  };
}
