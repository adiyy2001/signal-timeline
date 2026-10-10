export const results = [];

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function check(area, name, run) {
  try {
    await run();
    results.push({ area, name, passed: true });
    console.log(`PASS  ${area}: ${name}`);
  } catch (error) {
    results.push({ area, name, passed: false });
    console.log(`FAIL  ${area}: ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function equal(actual, expected, message) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}
