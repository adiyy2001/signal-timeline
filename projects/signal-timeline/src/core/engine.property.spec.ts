import * as fc from 'fast-check';
import {
  commandListArbitrary,
  configArbitrary,
  ModelHarness,
  unboundedConfigArbitrary,
} from './testing/engine-model';
import { assertProperty } from './testing/property';

describe('timeline engine properties', () => {
  it('matches a model that stores a full state per entry, after every command', () => {
    assertProperty(
      fc.property(configArbitrary, commandListArbitrary, (config, commands) => {
        new ModelHarness(config).run(commands);
      }),
    );
  });

  it('holds for histories that are never pruned, with every checkpoint interval', () => {
    assertProperty(
      fc.property(unboundedConfigArbitrary, commandListArbitrary, (config, commands) => {
        new ModelHarness(config).run(commands);
      }),
    );
  });

  it('survives long command sequences', () => {
    assertProperty(
      fc.property(
        configArbitrary,
        fc.array(
          commandListArbitrary.map((list) => list),
          { minLength: 2, maxLength: 3 },
        ),
        (config, lists) => {
          new ModelHarness(config).run(lists.flat());
        },
      ),
      { numRuns: Math.max(20, Math.floor(Number(process.env['FC_NUM_RUNS'] ?? 200) / 5)) },
    );
  });
});
