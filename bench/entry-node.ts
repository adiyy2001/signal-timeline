import { writeFileSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';
import { runBench } from './entry';

const requiredHeapBytes = 3 * 1024 ** 3;

function assertHeapLimitFor(mode: string | undefined, suites: readonly string[]): void {
  const runsMemorySuite = suites.length === 0 || suites.includes('memory');
  if (mode === 'smoke' || !runsMemorySuite) {
    return;
  }
  const limit = getHeapStatistics().heap_size_limit;
  if (limit < requiredHeapBytes) {
    throw new Error(
      `The memory suite needs about 3.5 GB of heap and this process allows ${Math.round(limit / 1024 ** 2)} MB. Start it through node bench/run.mjs or pass --max-old-space-size=3584.`,
    );
  }
}

async function main(): Promise<void> {
  const [, , outputPath, mode, ...suites] = process.argv;
  assertHeapLimitFor(mode, suites);
  const output = await runBench({ smoke: mode === 'smoke', suites });
  writeFileSync(outputPath, JSON.stringify(output));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
