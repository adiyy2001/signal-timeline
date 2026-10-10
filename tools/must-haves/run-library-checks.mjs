import { check } from './runner.mjs';
import { groupChecks } from './group-checks.mjs';
import { loadLibraryContext } from './library-context.mjs';
import { replayChecks } from './replay-checks.mjs';
import { storeChecks } from './store-checks.mjs';

export async function runLibraryChecks(packageDirectory) {
  const context = await loadLibraryContext(packageDirectory);
  for (const { area, name, run } of [...storeChecks, ...replayChecks, ...groupChecks]) {
    await check(area, name, () => run(context));
  }
}
