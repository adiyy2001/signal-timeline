import * as fc from 'fast-check';
import { applyPatch } from '../apply';
import { createManualClock, type ManualClock } from '../clock';
import { deepEqual } from '../equal';
import { TimelineEngine, type EngineOptions } from '../engine';
import { assertTreeInvariants } from '../invariants';
import type { JsonValue } from '../patch';
import { createManualScheduler, type ManualScheduler } from './scheduler';
import { applyRandomEdit, randomEditArbitrary, type RandomEdit } from './random-edit';

export type Slice = 'a' | 'b' | 'c';

export interface ModelState {
  readonly a: JsonValue;
  readonly b: JsonValue;
  readonly c: JsonValue;
}

export const initialModelState: ModelState = { a: { x: 1 }, b: [1, 2], c: 'start' };

export interface SliceEdit {
  readonly slice: Slice;
  readonly edit: RandomEdit;
}

export type Command =
  | {
      readonly kind: 'record';
      readonly change: SliceEdit;
      readonly advance: number;
      readonly key: number;
    }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo'; readonly pick: number }
  | { readonly kind: 'jump'; readonly pick: number }
  | {
      readonly kind: 'transaction';
      readonly changes: readonly SliceEdit[];
      readonly nested: boolean;
      readonly rollback: boolean;
    }
  | { readonly kind: 'gesture'; readonly changes: readonly SliceEdit[]; readonly key: string }
  | { readonly kind: 'undoRedo'; readonly steps: number }
  | { readonly kind: 'seal' }
  | { readonly kind: 'flush' }
  | { readonly kind: 'materialize'; readonly pick: number }
  | { readonly kind: 'snapshot' };

export interface ModelConfig {
  readonly checkpointEvery: number;
  readonly maxEntries: number | undefined;
  readonly coalesceWindowMs: number | undefined;
  readonly pendingLimit: number;
}

const sliceArbitrary = fc.constantFrom<Slice>('a', 'b', 'c');

const sliceEditArbitrary: fc.Arbitrary<SliceEdit> = fc.record({
  slice: sliceArbitrary,
  edit: randomEditArbitrary,
});

export const configArbitrary: fc.Arbitrary<ModelConfig> = fc.record({
  checkpointEvery: fc.constantFrom(1, 2, 3, 7, 50),
  maxEntries: fc.constantFrom(undefined, 2, 4, 9),
  coalesceWindowMs: fc.constantFrom(undefined, 0, 50),
  pendingLimit: fc.constantFrom(0, 2, 64),
});

export const unboundedConfigArbitrary: fc.Arbitrary<ModelConfig> = fc.record({
  checkpointEvery: fc.constantFrom(1, 2, 3, 7, 50),
  maxEntries: fc.constant(undefined),
  coalesceWindowMs: fc.constantFrom(undefined, 0, 50),
  pendingLimit: fc.constantFrom(0, 2, 64),
});

const recordCommand: fc.Arbitrary<Command> = fc.record({
  kind: fc.constant('record' as const),
  change: sliceEditArbitrary,
  advance: fc.constantFrom(0, 10, 60, 200),
  key: fc.constantFrom(0, 0, 0, 1, 2),
});

const transactionCommand: fc.Arbitrary<Command> = fc.record({
  kind: fc.constant('transaction' as const),
  changes: fc.array(sliceEditArbitrary, { maxLength: 4 }),
  nested: fc.boolean(),
  rollback: fc.boolean(),
});

const gestureCommand: fc.Arbitrary<Command> = fc.record({
  kind: fc.constant('gesture' as const),
  changes: fc.array(sliceEditArbitrary, { minLength: 1, maxLength: 4 }),
  key: fc.constantFrom('drag', 'resize'),
});

export const commandArbitrary: fc.Arbitrary<Command> = fc.oneof(
  { weight: 6, arbitrary: recordCommand },
  { weight: 3, arbitrary: fc.constant<Command>({ kind: 'undo' }) },
  { weight: 2, arbitrary: fc.nat(5).map((pick): Command => ({ kind: 'redo', pick })) },
  { weight: 2, arbitrary: fc.nat(40).map((pick): Command => ({ kind: 'jump', pick })) },
  { weight: 2, arbitrary: transactionCommand },
  { weight: 2, arbitrary: gestureCommand },
  {
    weight: 1,
    arbitrary: fc
      .integer({ min: 1, max: 8 })
      .map((steps): Command => ({ kind: 'undoRedo', steps })),
  },
  { weight: 1, arbitrary: fc.constant<Command>({ kind: 'seal' }) },
  { weight: 1, arbitrary: fc.constant<Command>({ kind: 'flush' }) },
  { weight: 1, arbitrary: fc.nat(40).map((pick): Command => ({ kind: 'materialize', pick })) },
  { weight: 1, arbitrary: fc.constant<Command>({ kind: 'snapshot' }) },
);

export const commandListArbitrary = fc.array(commandArbitrary, {
  minLength: 6,
  maxLength: 40,
  size: 'max',
});

function sameJson(left: unknown, right: unknown, message: string): void {
  if (!deepEqual(left, right)) {
    throw new Error(`${message}: ${JSON.stringify(left)} differs from ${JSON.stringify(right)}`);
  }
}

function require(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export class ModelHarness {
  engine: TimelineEngine<ModelState>;
  live: ModelState = initialModelState;
  readonly expected = new Map<number, ModelState>();
  readonly clock: ManualClock = createManualClock(0);
  readonly scheduler: ManualScheduler = createManualScheduler();
  private counter = 0;

  constructor(private readonly config: ModelConfig) {
    this.engine = new TimelineEngine<ModelState>(initialModelState, this.options());
    this.expected.set(this.engine.rootId, initialModelState);
  }

  private options(): EngineOptions {
    return {
      checkpointEvery: this.config.checkpointEvery,
      maxEntries: this.config.maxEntries,
      coalesceWindowMs: this.config.coalesceWindowMs,
      pendingLimit: this.config.pendingLimit,
      clock: this.clock,
      schedule: (task) => this.scheduler.schedule(task),
    };
  }

  run(commands: readonly Command[]): void {
    this.verify();
    for (const command of commands) {
      this.execute(command);
      this.verify();
    }
    this.verifyPatches();
  }

  private change(edit: SliceEdit): ModelState {
    return { ...this.live, [edit.slice]: applyRandomEdit(this.live[edit.slice], edit.edit) };
  }

  private recordLive(next: ModelState, key: string | undefined): void {
    this.counter += 1;
    this.live = next;
    const result = this.engine.record(next, { label: `edit ${this.counter}`, key });
    if (result !== undefined) {
      this.expected.set(result.id, next);
    }
  }

  private syncLive(): void {
    this.live = this.engine.state;
  }

  private execute(command: Command): void {
    switch (command.kind) {
      case 'record':
        this.clock.advance(command.advance);
        this.recordLive(
          this.change(command.change),
          command.key === 0 ? undefined : `k${command.key}`,
        );
        break;
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo(command.pick);
        break;
      case 'jump':
        this.jump(command.pick);
        break;
      case 'transaction':
        this.transaction(command);
        break;
      case 'gesture':
        this.gesture(command);
        break;
      case 'undoRedo':
        this.undoRedo(command.steps);
        break;
      case 'seal':
        this.engine.seal();
        break;
      case 'flush':
        this.scheduler.flush();
        break;
      case 'materialize':
        this.materialize(command.pick);
        break;
      case 'snapshot':
        this.roundTripSnapshot();
        break;
    }
  }

  private undo(): void {
    const move = this.engine.undo();
    this.syncLive();
    if (move !== undefined) {
      require(move.to === this.engine.node(move.from)?.parentId, 'undo did not move to the parent');
    }
  }

  private redo(pick: number): void {
    const branches = this.engine.redoBranches();
    const choice = pick % (branches.length + 1);
    const move =
      choice === branches.length ? this.engine.redo() : this.engine.redo(branches[choice]);
    this.syncLive();
    if (move !== undefined) {
      require(this.engine.node(move.to)?.parentId === move.from, 'redo did not move to a child');
    }
  }

  private jump(pick: number): void {
    const ids = this.engine.nodes().map((node) => node.id);
    const target = ids[pick % ids.length];
    this.engine.jumpTo(target);
    this.syncLive();
    if (this.engine.node(target) === undefined) {
      return;
    }
    require(this.engine.currentId === target, 'jumpTo did not reach its target');
    sameJson(
      this.engine.state,
      this.replayFromRoot(target),
      'jumpTo differs from replaying from the root',
    );
  }

  private replayFromRoot(target: number): ModelState {
    const path: number[] = [];
    for (
      let id: number | undefined = target;
      id !== undefined;
      id = this.engine.node(id)?.parentId
    ) {
      path.unshift(id);
    }
    const root = this.engine.node(path[0]);
    require(root?.checkpoint !== undefined, 'the root lost its checkpoint');
    return path.slice(1).reduce((state, id) => {
      const pair = this.engine.patchOf(id);
      require(pair !== undefined, `entry ${id} has no patch`);
      return applyPatch(state, pair?.forward ?? []);
    }, root?.checkpoint as ModelState);
  }

  private transaction(command: Extract<Command, { kind: 'transaction' }>): void {
    const start = this.live;
    const nextIdBefore = this.engine.nextId;
    this.engine.begin(start);
    const half = Math.floor(command.changes.length / 2);
    command.changes.slice(0, half).forEach((edit) => (this.live = this.change(edit)));
    if (command.nested) {
      this.engine.begin(this.live);
    }
    command.changes.slice(half).forEach((edit) => (this.live = this.change(edit)));
    if (command.rollback) {
      this.rollbackTransaction(command.nested, start, nextIdBefore);
    } else {
      this.commitTransaction(command.nested, start, nextIdBefore);
    }
  }

  private rollbackTransaction(nested: boolean, start: ModelState, nextIdBefore: number): void {
    if (nested) {
      this.engine.rollback();
    }
    this.live = this.engine.rollback();
    require(this.live === start, 'rollback did not return the start state');
    require(this.engine.nextId === nextIdBefore, 'a rolled back transaction created an entry');
  }

  private commitTransaction(nested: boolean, start: ModelState, nextIdBefore: number): void {
    if (nested) {
      require(this.engine.commit('inner', this.live) ===
        undefined, 'an inner commit created an entry');
    }
    const created = this.engine.commit('transaction', this.live);
    if (deepEqual(start, this.live)) {
      require(created === undefined, 'a transaction without a net change created an entry');
      require(this.engine.nextId === nextIdBefore, 'a transaction without a net change used an id');
      return;
    }
    require(created !== undefined, 'a transaction with a net change created no entry');
    require(this.engine.nextId === nextIdBefore + 1, 'a transaction created more than one entry');
    this.expected.set(created ?? -1, this.live);
    this.engine.undo();
    sameJson(this.engine.state, start, 'undoing a transaction did not restore the start state');
    this.engine.redo();
    sameJson(this.engine.state, this.live, 'redoing a transaction did not restore the end state');
  }

  private gesture(command: Extract<Command, { kind: 'gesture' }>): void {
    const nextIdBefore = this.engine.nextId;
    this.engine.beginCoalescing(command.key);
    command.changes.forEach((edit) => this.recordLive(this.change(edit), undefined));
    this.engine.endCoalescing();
    require(this.engine.nextId <= nextIdBefore + 1, 'a gesture created more than one entry');
  }

  private undoRedo(steps: number): void {
    this.engine.seal();
    const startId = this.engine.currentId;
    const startState = this.engine.state;
    let moved = 0;
    for (; moved < steps && this.engine.undo() !== undefined; moved += 1);
    for (let index = 0; index < moved; index += 1) {
      require(this.engine.redo() !== undefined, 'redo ran out of entries');
    }
    require(this.engine.currentId === startId, 'undo then redo did not return to the start entry');
    sameJson(this.engine.state, startState, 'undo then redo did not return the same state');
    this.syncLive();
  }

  private materialize(pick: number): void {
    const ids = this.engine.nodes().map((node) => node.id);
    this.engine.materialize(ids[pick % ids.length]);
  }

  private roundTripSnapshot(): void {
    const copy = TimelineEngine.restore(this.engine.snapshot(), this.options());
    sameJson(copy.state, this.engine.state, 'a restored engine has another state');
    require(copy.currentId ===
      this.engine.currentId, 'a restored engine has another current entry');
    const original = this.engine.nodes().map((node) => node.id);
    require(JSON.stringify(copy.nodes().map((node) => node.id)) ===
      JSON.stringify(original), 'a restored engine has other entries');
    for (const id of original) {
      sameJson(copy.patchOf(id), this.engine.patchOf(id), `restored patches of entry ${id}`);
    }
    this.engine = copy;
  }

  private verify(): void {
    const present = new Set(this.engine.nodes().map((node) => node.id));
    for (const id of [...this.expected.keys()]) {
      if (!present.has(id)) {
        this.expected.delete(id);
      }
    }
    sameJson(this.engine.state, this.live, 'the engine state differs from the live state');
    sameJson(
      this.engine.state,
      this.expected.get(this.engine.currentId),
      'the engine state differs from the recorded state',
    );
    assertTreeInvariants(this.engine, this.config.checkpointEvery);
    for (const id of present) {
      sameJson(this.engine.stateAt(id), this.expected.get(id), `the state at entry ${id}`);
    }
  }

  private verifyPatches(): void {
    for (const node of this.engine.nodes()) {
      const pair = this.engine.patchOf(node.id);
      if (pair === undefined || node.parentId === undefined) {
        continue;
      }
      const parentState = this.engine.stateAt(node.parentId);
      const state = this.engine.stateAt(node.id);
      sameJson(applyPatch(parentState, pair.forward), state, `forward patch of entry ${node.id}`);
      sameJson(applyPatch(state, pair.inverse), parentState, `inverse patch of entry ${node.id}`);
    }
  }
}
