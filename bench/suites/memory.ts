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

function memoryAdapter(): TimelinePersistenceAdapter & { text: string } {
  const adapter = {
    text: '',
    load: () => null,
    save: (value: string) => {
      adapter.text = value;
    },
    remove: () => undefined,
  };
  return adapter;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface HeapReading {
  readonly retained: number;
}

async function retainedBy(build: () => unknown): Promise<HeapReading> {
  const before = await settleHeap();
  const held = build();
  const after = await settleHeap();
  void held;
  return { retained: after - before };
}

async function historyHeap(
  context: BenchContext,
  checkpointEvery: number,
  edits: number,
  entityCount: number,
): Promise<number> {
  const shapes = makeShapes(entityCount, 'string');
  const plain = await retainedBy(() => {
    const store = createPlainStore(shapes);
    for (let index = 0; index < edits; index += 1) {
      applyEdit(store, index, entityCount, 'string');
    }
    return store;
  });
  const timeline = await retainedBy(() => {
    const store = createTimelineStore(shapes, { checkpointEvery });
    for (let index = 0; index < edits; index += 1) {
      applyEdit(store, index, entityCount, 'string');
    }
    return store;
  });
  context.log(
    `heap, checkpointEvery ${checkpointEvery}: ${round((timeline.retained - plain.retained) / megabytes, 2)} MB`,
  );
  return timeline.retained - plain.retained;
}

async function snapshotHeapAndSize(
  edits: number,
  entityCount: number,
): Promise<{ heapBytes: number; serializedCharacters: number }> {
  const shapes = makeShapes(entityCount, 'string');
  const plain = await retainedBy(() => {
    const store = createPlainStore(shapes);
    for (let index = 0; index < edits; index += 1) {
      applyEdit(store, index, entityCount, 'string');
    }
    return store;
  });
  let serializedCharacters = 0;
  const snapshots: Slices[] = [];
  const withSnapshots = await retainedBy(() => {
    const store = createPlainStore(shapes);
    snapshots.push(sliceOf(store));
    for (let index = 0; index < edits; index += 1) {
      applyEdit(store, index, entityCount, 'string');
      snapshots.push(sliceOf(store));
    }
    return store;
  });
  for (const snapshot of snapshots) {
    serializedCharacters += JSON.stringify(snapshot).length;
  }
  snapshots.length = 0;
  return {
    heapBytes: withSnapshots.retained - plain.retained,
    serializedCharacters,
  };
}

async function historySerializedSize(edits: number, entityCount: number): Promise<number> {
  const adapter = memoryAdapter();
  const store = createTimelineStore(makeShapes(entityCount, 'string'), {
    persistence: { adapter, debounceMs: 0 },
  });
  for (let index = 0; index < edits; index += 1) {
    applyEdit(store, index, entityCount, 'string');
  }
  await wait(50);
  if (adapter.text === '') {
    throw new Error('The history was not saved');
  }
  return adapter.text.length;
}

function engineWithHistory(
  edits: number,
  entityCount: number,
  pendingLimit: number,
  deferFlush: boolean,
): { engine: TimelineEngine<Slices>; flush: () => void; durationMs: number } {
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

async function pendingLimitRows(context: BenchContext): Promise<Row[]> {
  const { settings } = context;
  const edits = settings.smoke ? 200 : 2_000;
  const entityCount = settings.memoryEntityCount;
  const limits = settings.smoke ? [0, 64] : [0, 16, 64, 256, 1024];
  const rows: Row[] = [];
  for (const pendingLimit of limits) {
    const baseline = await settleHeap();
    const burst = engineWithHistory(edits, entityCount, pendingLimit, true);
    const heldBeforeFlush = (await settleHeap()) - baseline;
    burst.flush();
    burst.engine.materializeAll();
    rows.push({
      pendingLimit,
      edits,
      entities: entityCount,
      burstMsPerEdit: round(burst.durationMs / edits, 4),
      heapBeforeFlushMb: round(heldBeforeFlush / megabytes, 2),
    });
    context.log(
      `pending limit ${pendingLimit}: ${rows.at(-1)?.['burstMsPerEdit']} ms per edit, ${rows.at(-1)?.['heapBeforeFlushMb']} MB held before the flush`,
    );
  }
  return rows;
}

async function serializationRows(context: BenchContext): Promise<Row[]> {
  const { settings } = context;
  const sizes = settings.smoke ? [100] : [1_000, 10_000];
  const rows: Row[] = [];
  for (const edits of sizes) {
    const { engine } = engineWithHistory(edits, settings.memoryEntityCount, 64, false);
    engine.materializeAll();
    const keys = Object.keys(engine.state).sort();
    const rounds = settings.smoke ? 1 : 5;
    const saveTimes: number[] = [];
    const loadTimes: number[] = [];
    let characters = 0;
    for (let round = 0; round < rounds; round += 1) {
      const saveStart = performance.now();
      const text = serializeSnapshot(engine.snapshot(), keys);
      saveTimes.push(performance.now() - saveStart);
      characters = text.length;
      const loadStart = performance.now();
      TimelineEngine.restore(parseSnapshot(text, { keys }));
      loadTimes.push(performance.now() - loadStart);
    }
    rows.push({
      historyEntries: edits,
      entities: settings.memoryEntityCount,
      serializedCharacters: characters,
      saveMs: round(Math.min(...saveTimes), 2),
      loadMs: round(Math.min(...loadTimes), 2),
    });
    context.log(
      `serialization at ${edits} entries: save ${rows.at(-1)?.['saveMs']} ms, load ${rows.at(-1)?.['loadMs']} ms, ${characters} characters`,
    );
  }
  return rows;
}

export async function runMemorySuite(context: BenchContext): Promise<SuiteResult> {
  const { settings } = context;
  if (!hasGarbageCollector()) {
    throw new Error('The memory suite needs a runtime started with garbage collection exposed');
  }
  const edits = settings.historyEdits;
  const entityCount = settings.memoryEntityCount;
  const sizeRows: Row[] = [];
  const history = await historySerializedSize(edits, entityCount);
  const snapshot = await snapshotHeapAndSize(edits, entityCount);
  const defaultHeap = await historyHeap(context, 50, edits, entityCount);
  sizeRows.push({
    kind: 'size and heap',
    edits,
    entities: entityCount,
    historySerializedCharacters: history,
    snapshotsSerializedCharacters: snapshot.serializedCharacters,
    serializedRatio: round(snapshot.serializedCharacters / history, 1),
    historyHeapMb: round(defaultHeap / megabytes, 2),
    snapshotsHeapMb: round(snapshot.heapBytes / megabytes, 2),
    heapRatio: round(snapshot.heapBytes / defaultHeap, 1),
  });
  context.log(
    `serialized ratio ${sizeRows[0]['serializedRatio']}, heap ratio ${sizeRows[0]['heapRatio']}`,
  );
  const checkpointRows: Row[] = [];
  for (const checkpointEvery of settings.checkpointIntervals) {
    const bytes = await historyHeap(context, checkpointEvery, edits, entityCount);
    checkpointRows.push({
      kind: 'checkpoint heap',
      checkpointEvery,
      edits,
      entities: entityCount,
      historyHeapMb: round(bytes / megabytes, 2),
    });
  }
  const pendingRows = await pendingLimitRows(context);
  const serialization = await serializationRows(context);
  return {
    description: `History after ${edits} small edits over ${entityCount} entities (70 percent entity moves, 20 percent counter, 10 percent nested view changes), compared with keeping a full snapshot of the tracked state after every edit. Serialized size is counted in characters of JSON (the content is ASCII, so characters are bytes). Heap is the retained size after a forced collection, with the same store without the feature subtracted. A snapshot is the references to the tracked slices after the edit, which is what a snapshot stack keeps.`,
    notes: [
      'Each updateEntity copies the whole entity map, so every snapshot keeps its own copy of the map. The history keeps one map per checkpoint instead.',
      'The size and heap ratios are the snapshot figure divided by the history figure.',
    ],
    rows: [
      ...sizeRows,
      ...checkpointRows,
      ...pendingRows.map((row) => ({ kind: 'pending limit', ...row })),
      ...serialization.map((row) => ({ kind: 'serialization', ...row })),
    ],
  };
}
