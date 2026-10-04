import { Bench } from 'tinybench';
import { describeHardware } from './hardware';
import { createPlainStore, createTimelineStore, makeShapes } from './stores';

const entityCount = 10_000;

function meanMs(bench: Bench, name: string): number {
  const result = bench.getTask(name)?.result;
  if (result === undefined || !('latency' in result)) {
    throw new Error(`No result for ${name}`);
  }
  return result.latency.mean;
}

async function main(): Promise<void> {
  const shapes = makeShapes(entityCount);
  const plain = createPlainStore(shapes);
  const timeline = createTimelineStore(shapes);
  let counter = 0;
  const bench = new Bench({ time: 400, warmupTime: 150, name: 'recording overhead probe' });
  const hot = (operation: () => void) => async () => {
    const start = performance.now();
    operation();
    return { overriddenDuration: performance.now() - start };
  };
  const total = (operation: () => void) => async () => {
    const start = performance.now();
    operation();
    await Promise.resolve();
    return { overriddenDuration: performance.now() - start };
  };
  const moveEntity = (): void => {
    counter += 1;
    plain.move('shape-5000', counter);
  };
  const moveEntityRecorded = (): void => {
    counter += 1;
    timeline.move('shape-5000', counter);
  };
  const bumpSlice = (): void => {
    counter += 1;
    plain.bump(counter);
  };
  const bumpSliceRecorded = (): void => {
    counter += 1;
    timeline.bump(counter);
  };
  bench
    .add('entity update, no timeline', hot(moveEntity))
    .add('entity update, timeline, synchronous part', hot(moveEntityRecorded))
    .add('entity update, timeline, including patches', total(moveEntityRecorded))
    .add('small slice update, no timeline', hot(bumpSlice))
    .add('small slice update, timeline, synchronous part', hot(bumpSliceRecorded))
    .add('small slice update, timeline, including patches', total(bumpSliceRecorded));
  await bench.run();

  const hardware = describeHardware();
  console.log(`hardware: ${JSON.stringify(hardware)}`);
  console.log(`state: ${entityCount} entities with string ids`);
  console.table(bench.table());
  const entityBase = meanMs(bench, 'entity update, no timeline');
  const smallBase = meanMs(bench, 'small slice update, no timeline');
  const rows = [
    ['entity update, timeline, synchronous part', entityBase],
    ['entity update, timeline, including patches', entityBase],
    ['small slice update, timeline, synchronous part', smallBase],
    ['small slice update, timeline, including patches', smallBase],
  ] as const;
  for (const [name, base] of rows) {
    const overhead = meanMs(bench, name) - base;
    console.log(
      `overhead ${name}: ${overhead.toFixed(4)} ms (mean of timeline minus mean of baseline)`,
    );
  }
  console.log(`history entries after the run: ${timeline.entries().length}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
