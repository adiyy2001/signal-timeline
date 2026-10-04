import { settingsFor, type BenchContext, type SuiteResult } from './harness';
import { runMemorySuite } from './suites/memory';
import { runNavigationSuite } from './suites/navigation';
import { runRecordingSuite } from './suites/recording';
import { runThroughputSuite } from './suites/throughput';

export interface RunOptions {
  readonly smoke: boolean;
  readonly suites: readonly string[];
}

export interface RunOutput {
  readonly suites: Record<string, SuiteResult>;
  readonly durationsMs: Record<string, number>;
}

const available: Record<string, (context: BenchContext) => Promise<SuiteResult>> = {
  recording: runRecordingSuite,
  navigation: runNavigationSuite,
  throughput: runThroughputSuite,
  memory: runMemorySuite,
};

export const suiteNames: readonly string[] = Object.keys(available);

export async function runBench(
  options: RunOptions,
  log: (message: string) => void = (message) => console.log(message),
): Promise<RunOutput> {
  const context: BenchContext = { settings: settingsFor(options.smoke), log };
  const suites: Record<string, SuiteResult> = {};
  const durationsMs: Record<string, number> = {};
  for (const name of options.suites.length > 0 ? options.suites : suiteNames) {
    const run = available[name];
    if (run === undefined) {
      throw new Error(`Unknown suite ${name}`);
    }
    log(`suite ${name}`);
    const start = performance.now();
    suites[name] = await run(context);
    durationsMs[name] = Math.round(performance.now() - start);
  }
  return { suites, durationsMs };
}
