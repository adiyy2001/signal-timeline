import { runBench, type RunOptions } from './entry';

interface BenchHost {
  runBench: (options: RunOptions) => ReturnType<typeof runBench>;
}

(globalThis as unknown as BenchHost).runBench = (options) =>
  runBench(options, (message) => console.log(message));
