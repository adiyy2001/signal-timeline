import * as fc from 'fast-check';

export const numRuns = Number(process.env['FC_NUM_RUNS'] ?? 200);

export function assertProperty<Ts extends unknown[]>(
  property: fc.IPropertyWithHooks<Ts>,
  overrides: fc.Parameters<Ts> = {},
): void {
  fc.assert(property, { numRuns, ...overrides });
}
