import { createManualClock, type ManualClock } from '../clock';
import { TimelineEngine, type EngineOptions, type RecordResult } from '../engine';
import type { Patch } from '../patch';
import { createManualScheduler, type ManualScheduler } from './scheduler';

export interface Doc {
  readonly count: number;
  readonly items: readonly string[];
  readonly meta: { readonly title: string };
}

export const initialDoc: Doc = { count: 0, items: [], meta: { title: 'untitled' } };

export interface Fixture {
  readonly engine: TimelineEngine<Doc>;
  readonly clock: ManualClock;
  readonly scheduler: ManualScheduler;
  edit(changes: Partial<Doc>, label?: string, key?: string): RecordResult | undefined;
}

export function createFixture(options: EngineOptions = {}, initial: Doc = initialDoc): Fixture {
  const clock = createManualClock(1000);
  const scheduler = createManualScheduler();
  const engine = new TimelineEngine<Doc>(initial, {
    clock,
    schedule: (task) => scheduler.schedule(task),
    ...options,
  });
  return {
    engine,
    clock,
    scheduler,
    edit(changes, label = 'edit', key) {
      return engine.record({ ...engine.state, ...changes }, { label, key });
    },
  };
}

export function sabotagePatches(engine: TimelineEngine<Doc>, id: number): void {
  engine.materialize(id);
  const view = engine.node(id) as unknown as { forward?: Patch; inverse?: Patch };
  const broken: Patch = [{ op: 'remove', path: '/missing/path' }];
  view.forward = broken;
  view.inverse = broken;
}
