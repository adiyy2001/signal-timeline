import { writeFileSync } from 'node:fs';
import { runBench } from './entry';

async function main(): Promise<void> {
  const [, , outputPath, mode, ...suites] = process.argv;
  const output = await runBench({ smoke: mode === 'smoke', suites });
  writeFileSync(outputPath, JSON.stringify(output));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
