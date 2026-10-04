import { SnapshotError, TimelineEngine, TimelineError } from './engine';
import { assertTreeInvariants } from './invariants';
import { createFixture, initialDoc, sabotagePatches, type Doc } from './testing/engine-fixture';

describe('TimelineEngine basics', () => {
  it('starts at an initial state with nothing to undo or redo', () => {
    const { engine } = createFixture();
    expect(engine.state).toBe(initialDoc);
    expect(engine.size).toBe(0);
    expect(engine.canUndo).toBe(false);
    expect(engine.canRedo).toBe(false);
    expect(engine.node(engine.rootId)?.label).toBe('Initial state');
    expect(engine.undo()).toBeUndefined();
    expect(engine.redo()).toBeUndefined();
  });

  it('records an entry with its label and timestamp', () => {
    const { engine, edit } = createFixture();
    const result = edit({ count: 1 }, 'Increment');
    expect(result).toEqual({ id: engine.currentId, merged: false });
    expect(engine.state.count).toBe(1);
    expect(engine.size).toBe(1);
    expect(engine.node(engine.currentId)).toMatchObject({
      label: 'Increment',
      timestamp: 1000,
      depth: 1,
      parentId: engine.rootId,
    });
    expect(engine.canUndo).toBe(true);
  });

  it('ignores a record that keeps every root slice', () => {
    const { engine } = createFixture();
    expect(engine.record({ ...engine.state }, { label: 'noop' })).toBeUndefined();
    expect(engine.size).toBe(0);
  });

  it('treats a record with a different set of keys as a change', () => {
    const { engine } = createFixture();
    const wider = { ...engine.state, extra: 1 } as Doc;
    expect(engine.record(wider, { label: 'widen' })).toBeDefined();
  });

  it('undoes and redoes, reporting the move', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 });
    const recorded = engine.state;
    const undone = engine.undo();
    expect(undone).toMatchObject({ from: expect.any(Number), to: engine.rootId });
    expect(undone?.before).toBe(recorded);
    expect(engine.state).toEqual(initialDoc);
    expect(engine.canRedo).toBe(true);
    const redone = engine.redo();
    expect(redone?.after).toEqual(recorded);
    expect(engine.state).toEqual(recorded);
  });

  it('keeps unchanged slices by identity across undo of a materialized entry', () => {
    const { engine, edit, scheduler } = createFixture();
    edit({ count: 1 });
    edit({ items: ['a'] });
    scheduler.flush();
    const meta = engine.state.meta;
    engine.undo();
    engine.undo();
    expect(engine.state.meta).toBe(meta);
    engine.redo();
    engine.redo();
    expect(engine.state.items).toEqual(['a']);
    expect(engine.state.meta).toBe(meta);
  });

  it('notifies subscribers and bumps the version on every change', () => {
    const { engine, edit } = createFixture();
    const seen: number[] = [];
    const stop = engine.subscribe(() => seen.push(engine.version));
    edit({ count: 1 });
    engine.undo();
    stop();
    edit({ count: 2 });
    expect(seen).toEqual([1, 2]);
    expect(engine.version).toBe(3);
  });

  it('rejects invalid options', () => {
    expect(() => createFixture({ checkpointEvery: 0 })).toThrow(TimelineError);
    expect(() => createFixture({ checkpointEvery: 1.5 })).toThrow('checkpointEvery');
    expect(() => createFixture({ maxEntries: 0 })).toThrow('maxEntries');
    expect(() => createFixture({ coalesceWindowMs: -1 })).toThrow('coalesceWindowMs');
    expect(() => createFixture({ pendingLimit: -1 })).toThrow('pendingLimit');
  });

  it('uses the system clock and a microtask scheduler by default', async () => {
    const engine = new TimelineEngine<Doc>(initialDoc);
    engine.record({ ...initialDoc, count: 1 }, { label: 'one' });
    expect(engine.pendingCount).toBe(1);
    await Promise.resolve();
    expect(engine.pendingCount).toBe(0);
    expect(engine.node(engine.currentId)?.timestamp).toBeGreaterThan(0);
  });
});

describe('pending entries', () => {
  it('undoes and redoes a pending entry without computing a patch', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 });
    expect(engine.pendingCount).toBe(1);
    engine.undo();
    engine.redo();
    expect(engine.pendingCount).toBe(1);
    expect(engine.state.count).toBe(1);
  });

  it('materializes sealed entries in a scheduled batch', () => {
    const { engine, edit, scheduler } = createFixture();
    edit({ count: 1 });
    edit({ count: 2 });
    expect(scheduler.queued).toBe(1);
    scheduler.flush();
    expect(engine.pendingCount).toBe(0);
    expect(engine.patchOf(engine.currentId)).toEqual({
      forward: [{ op: 'replace', path: '/count', value: 2 }],
      inverse: [{ op: 'replace', path: '/count', value: 1 }],
    });
  });

  it('materializes synchronously once the pending burst passes the limit', () => {
    const { engine, edit, scheduler } = createFixture({ pendingLimit: 2 });
    edit({ count: 1 });
    edit({ count: 2 });
    expect(engine.pendingCount).toBe(2);
    edit({ count: 3 });
    expect(engine.pendingCount).toBe(0);
    scheduler.flush();
    expect(engine.state.count).toBe(3);
  });

  it('skips entries that were removed before the scheduled batch ran', () => {
    const { engine, edit, scheduler } = createFixture({ maxEntries: 1 });
    edit({ count: 1 });
    edit({ count: 2 });
    scheduler.flush();
    expect(engine.size).toBe(1);
    assertTreeInvariants(engine, 50);
  });

  it('materializes on demand', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 });
    edit({ count: 2 });
    const first = engine.node(engine.currentId)?.parentId ?? engine.rootId;
    engine.materialize(first);
    expect(engine.node(first)?.pending).toBeUndefined();
    engine.materialize(9999);
    engine.materializeAll();
    expect(engine.pendingCount).toBe(0);
  });

  it('returns no patch for the root or an unknown entry', () => {
    const { engine } = createFixture();
    expect(engine.patchOf(engine.rootId)).toBeUndefined();
    expect(engine.patchOf(99)).toBeUndefined();
  });

  it('does not cache patches of an open entry', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 }, 'drag', 'drag');
    const pair = engine.patchOf(engine.currentId);
    expect(pair?.forward).toEqual([{ op: 'replace', path: '/count', value: 1 }]);
    expect(engine.node(engine.currentId)?.pending).toBeDefined();
    engine.materialize(engine.currentId);
    expect(engine.node(engine.currentId)?.pending).toBeDefined();
  });
});

describe('branches', () => {
  it('starts a branch instead of dropping the redo history', () => {
    const { engine, edit } = createFixture();
    const first = edit({ count: 1 }, 'A')?.id ?? -1;
    engine.undo();
    const second = edit({ count: 2 }, 'B')?.id ?? -1;
    expect(engine.node(engine.rootId)?.children).toEqual([first, second]);
    engine.undo();
    expect(engine.redoBranches()).toEqual([first, second]);
    expect(engine.redo()?.to).toBe(second);
    expect(engine.state.count).toBe(2);
  });

  it('redoes along the branch that was left most recently', () => {
    const { engine, edit } = createFixture();
    const first = edit({ count: 1 }, 'A')?.id ?? -1;
    engine.undo();
    edit({ count: 2 }, 'B');
    engine.jumpTo(first);
    engine.undo();
    expect(engine.redo()?.to).toBe(first);
  });

  it('lets redo choose a branch and rejects a stranger', () => {
    const { engine, edit } = createFixture();
    const first = edit({ count: 1 }, 'A')?.id ?? -1;
    const grandchild = edit({ count: 11 }, 'A2')?.id ?? -1;
    engine.jumpTo(engine.rootId);
    edit({ count: 2 }, 'B');
    engine.undo();
    expect(engine.redo(first)?.to).toBe(first);
    expect(engine.state.count).toBe(1);
    expect(() => engine.redo(grandchild + 50)).toThrow('not a redo branch');
    engine.undo();
    expect(() => engine.redo(grandchild)).toThrow(TimelineError);
  });
});

describe('jumpTo', () => {
  it('moves across branches through the common ancestor', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 }, 'A');
    const leftTip = edit({ items: ['x'] }, 'A2')?.id ?? -1;
    engine.jumpTo(engine.rootId);
    edit({ count: 5 }, 'B');
    const rightTip = edit({ items: ['y'] }, 'B2')?.id ?? -1;
    const move = engine.jumpTo(leftTip);
    expect(move).toMatchObject({ to: leftTip, from: rightTip });
    expect(engine.state).toEqual({ count: 1, items: ['x'], meta: initialDoc.meta });
    expect(engine.jumpTo(rightTip)?.after).toEqual({
      count: 5,
      items: ['y'],
      meta: initialDoc.meta,
    });
    assertTreeInvariants(engine, 50);
  });

  it('does nothing when the target is the current entry and rejects unknown ids', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 });
    expect(engine.jumpTo(engine.currentId)).toBeUndefined();
    expect(() => engine.jumpTo(999)).toThrow('Unknown entry');
  });

  it('reaches the root and the tip of a long history from either end', () => {
    const { engine, edit, scheduler } = createFixture({ checkpointEvery: 4 });
    const ids: number[] = [engine.rootId];
    for (let value = 1; value <= 30; value += 1) {
      ids.push(edit({ count: value })?.id ?? -1);
    }
    scheduler.flush();
    engine.jumpTo(engine.rootId);
    expect(engine.state.count).toBe(0);
    engine.jumpTo(ids[30]);
    expect(engine.state.count).toBe(30);
    engine.jumpTo(ids[13]);
    expect(engine.state.count).toBe(13);
    assertTreeInvariants(engine, 4);
  });

  it('replays from a checkpoint when that is shorter than walking', () => {
    const { engine, edit, scheduler } = createFixture({ checkpointEvery: 2 });
    const ids: number[] = [engine.rootId];
    for (let value = 1; value <= 7; value += 1) {
      ids.push(edit({ count: value })?.id ?? -1);
    }
    scheduler.flush();
    sabotagePatches(engine, ids[6]);
    sabotagePatches(engine, ids[7]);
    expect(engine.jumpTo(ids[4])?.after.count).toBe(4);
    expect(engine.state.count).toBe(4);
  });

  it('walks the path when the checkpoint is farther away', () => {
    const { engine, edit, scheduler } = createFixture({ checkpointEvery: 50 });
    const ids: number[] = [engine.rootId];
    for (let value = 1; value <= 5; value += 1) {
      ids.push(edit({ count: value })?.id ?? -1);
    }
    scheduler.flush();
    expect(engine.jumpTo(ids[3])?.after.count).toBe(3);
  });

  it('leaves the engine unchanged when a patch fails to apply', () => {
    const { engine, edit, scheduler } = createFixture({ checkpointEvery: 50 });
    const first = edit({ count: 1 })?.id ?? -1;
    edit({ count: 2 });
    scheduler.flush();
    sabotagePatches(engine, engine.currentId);
    const current = engine.currentId;
    expect(() => engine.undo()).toThrow();
    expect(engine.currentId).toBe(current);
    expect(engine.state.count).toBe(2);
    expect(first).toBeGreaterThan(0);
  });

  it('computes the state at any entry', () => {
    const { engine, edit, scheduler } = createFixture({ checkpointEvery: 3 });
    const ids = [1, 2, 3, 4, 5, 6, 7].map((value) => edit({ count: value })?.id ?? -1);
    scheduler.flush();
    ids.forEach((id, index) => {
      expect(engine.stateAt(id).count).toBe(index + 1);
    });
    expect(engine.stateAt(engine.rootId)).toEqual(initialDoc);
    expect(() => engine.stateAt(999)).toThrow(RangeError);
  });
});

describe('coalescing by window', () => {
  it('merges changes inside the window and keeps the first label', () => {
    const { engine, edit, clock } = createFixture({ coalesceWindowMs: 100 });
    edit({ count: 1 }, 'first');
    clock.advance(60);
    const merged = edit({ count: 2 }, 'second');
    clock.advance(60);
    edit({ count: 3 }, 'third');
    expect(merged?.merged).toBe(true);
    expect(engine.size).toBe(1);
    expect(engine.node(engine.currentId)).toMatchObject({ label: 'first', timestamp: 1120 });
    engine.undo();
    expect(engine.state).toEqual(initialDoc);
    engine.redo();
    expect(engine.state.count).toBe(3);
  });

  it('starts a new entry once the window has passed', () => {
    const { engine, edit, clock } = createFixture({ coalesceWindowMs: 100 });
    edit({ count: 1 });
    clock.advance(101);
    const next = edit({ count: 2 });
    expect(next?.merged).toBe(false);
    expect(engine.size).toBe(2);
  });

  it('keeps the entry before the first change and the state after the last', () => {
    const { engine, edit, clock, scheduler } = createFixture({ coalesceWindowMs: 100 });
    edit({ count: 1 });
    clock.advance(10);
    edit({ items: ['a'] });
    engine.seal();
    scheduler.flush();
    expect(engine.patchOf(engine.currentId)?.forward).toEqual([
      { op: 'replace', path: '/count', value: 1 },
      { op: 'add', path: '/items/0', value: 'a' },
    ]);
  });

  it('seals the open entry on undo, redo and jump', () => {
    const { engine, edit, clock } = createFixture({ coalesceWindowMs: 100 });
    edit({ count: 1 });
    engine.undo();
    engine.redo();
    clock.advance(10);
    const next = edit({ count: 2 });
    expect(next?.merged).toBe(false);
    expect(engine.size).toBe(2);
  });

  it('moves the checkpoint along with a merged entry', () => {
    const { engine, edit, clock } = createFixture({ coalesceWindowMs: 100, checkpointEvery: 1 });
    edit({ count: 1 });
    clock.advance(10);
    edit({ count: 2 });
    expect(engine.node(engine.currentId)?.checkpoint).toBe(engine.state);
    assertTreeInvariants(engine, 1);
  });

  it('drops an entry whose merged changes cancel out', () => {
    const { engine, edit, clock } = createFixture({ coalesceWindowMs: 100 });
    edit({ count: 1 });
    clock.advance(10);
    edit({ count: 0 });
    const live = engine.state;
    engine.seal();
    expect(engine.size).toBe(0);
    expect(engine.currentId).toBe(engine.rootId);
    expect(engine.state).toBe(live);
    expect(engine.canUndo).toBe(false);
    assertTreeInvariants(engine, 50);
  });
});

describe('coalescing by key', () => {
  it('merges consecutive changes with the same key', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 }, 'drag', 'shape-1');
    edit({ count: 2 }, 'drag', 'shape-1');
    edit({ count: 3 }, 'drag', 'shape-1');
    expect(engine.size).toBe(1);
    engine.undo();
    expect(engine.state.count).toBe(0);
  });

  it('starts a new entry for another key or for a change without a key', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 }, 'a', 'one');
    edit({ count: 2 }, 'b', 'two');
    edit({ count: 3 }, 'c');
    edit({ count: 4 }, 'd', 'two');
    expect(engine.size).toBe(4);
  });

  it('does not merge a keyed change into an unkeyed window entry', () => {
    const { engine, edit } = createFixture({ coalesceWindowMs: 100 });
    edit({ count: 1 });
    edit({ count: 2 }, 'keyed', 'k');
    expect(engine.size).toBe(2);
  });

  it('seals a keyed entry on undo so the next change is a new entry', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 }, 'a', 'k');
    engine.undo();
    engine.redo();
    edit({ count: 2 }, 'a', 'k');
    expect(engine.size).toBe(2);
  });

  it('merges the whole gesture between beginCoalescing and endCoalescing', () => {
    const { engine, edit } = createFixture();
    engine.beginCoalescing('drag');
    edit({ count: 1 });
    edit({ count: 2 });
    edit({ count: 3 });
    engine.endCoalescing();
    expect(engine.size).toBe(1);
    engine.beginCoalescing('drag');
    edit({ count: 4 });
    engine.endCoalescing();
    expect(engine.size).toBe(2);
  });

  it('lets the innermost gesture key win and seals when it ends', () => {
    const { engine, edit } = createFixture();
    engine.beginCoalescing('outer');
    edit({ count: 1 });
    engine.beginCoalescing('inner');
    edit({ count: 2 });
    engine.endCoalescing();
    edit({ count: 3 });
    engine.endCoalescing();
    expect(engine.size).toBe(3);
  });

  it('rejects ending a gesture that never began', () => {
    const { engine } = createFixture();
    expect(() => engine.endCoalescing()).toThrow('No coalescing gesture');
  });

  it('drops a gesture that ends where it started', () => {
    const { engine, edit } = createFixture();
    engine.beginCoalescing('drag');
    edit({ items: ['a'] });
    edit({ items: [] });
    engine.endCoalescing();
    expect(engine.size).toBe(0);
  });
});

describe('jumping to an open entry that sealing removes', () => {
  it('returns without a move and keeps the state', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 }, 'first');
    edit({ items: ['a'] }, 'open', 'drag');
    edit({ items: [] }, 'open', 'drag');
    const openId = engine.currentId;
    expect(engine.jumpTo(openId)).toBeUndefined();
    expect(engine.node(openId)).toBeUndefined();
    expect(engine.state).toEqual({ ...initialDoc, count: 1 });
    expect(engine.node(engine.currentId)?.label).toBe('first');
  });

  it('still rejects an id that never existed', () => {
    const { engine } = createFixture();
    expect(() => engine.jumpTo(999)).toThrow('Unknown entry 999');
  });
});

describe('transactions', () => {
  it('turns several changes into one entry', () => {
    const { engine, edit } = createFixture();
    engine.begin(engine.state);
    const start = engine.state;
    expect(engine.transactionDepth).toBe(1);
    const end: Doc = { ...start, count: 5, items: ['a', 'b'] };
    expect(engine.commit('Batch', end)).toBe(engine.currentId);
    expect(engine.size).toBe(1);
    expect(engine.node(engine.currentId)?.label).toBe('Batch');
    expect(engine.state).toBe(end);
    engine.undo();
    expect(engine.state).toEqual(initialDoc);
    edit({ count: 9 });
    expect(engine.size).toBe(2);
  });

  it('creates nothing when the transaction changes nothing', () => {
    const { engine } = createFixture();
    engine.begin(engine.state);
    expect(engine.commit('nothing', engine.state)).toBeUndefined();
    expect(engine.size).toBe(0);
  });

  it('creates nothing when the changes cancel out, and adopts the live state', () => {
    const { engine } = createFixture();
    engine.begin(engine.state);
    const live: Doc = { ...engine.state, items: [], meta: { title: 'untitled' } };
    expect(engine.commit('cancel', live)).toBeUndefined();
    expect(engine.size).toBe(0);
    expect(engine.state).toBe(live);
  });

  it('joins nested transactions into the outer entry', () => {
    const { engine } = createFixture();
    engine.begin(engine.state);
    engine.begin({ ...engine.state, count: 1 });
    expect(engine.transactionDepth).toBe(2);
    expect(engine.commit('inner', { ...engine.state, count: 2 })).toBeUndefined();
    expect(engine.size).toBe(0);
    engine.commit('outer', { ...engine.state, count: 3 });
    expect(engine.size).toBe(1);
    expect(engine.node(engine.currentId)?.label).toBe('outer');
  });

  it('rolls back to the start state of the level', () => {
    const { engine } = createFixture();
    const start = engine.state;
    engine.begin(start);
    expect(engine.rollback()).toBe(start);
    expect(engine.transactionDepth).toBe(0);
    expect(engine.size).toBe(0);
  });

  it('refuses to move through history, record or clear inside a transaction', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 });
    engine.begin(engine.state);
    expect(() => engine.undo()).toThrow('inside a transaction');
    expect(() => engine.redo()).toThrow(TimelineError);
    expect(() => engine.jumpTo(engine.rootId)).toThrow(TimelineError);
    expect(() => engine.record({ ...engine.state, count: 2 }, { label: 'x' })).toThrow(
      TimelineError,
    );
    expect(() => engine.clear()).toThrow(TimelineError);
    expect(() => engine.snapshot()).toThrow(TimelineError);
  });

  it('rejects a commit or rollback without a transaction', () => {
    const { engine } = createFixture();
    expect(() => engine.commit('x', engine.state)).toThrow('No transaction to commit');
    expect(() => engine.rollback()).toThrow('No transaction to roll back');
  });

  it('seals an open entry before the transaction starts', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 }, 'drag', 'k');
    engine.begin(engine.state);
    engine.commit('batch', { ...engine.state, count: 2 });
    expect(engine.size).toBe(2);
  });
});

describe('pruning', () => {
  it('advances the root of a linear history', () => {
    const { engine, edit } = createFixture({ maxEntries: 3 });
    for (let value = 1; value <= 6; value += 1) {
      edit({ count: value });
    }
    expect(engine.size).toBe(3);
    expect(engine.node(engine.rootId)?.label).toBe('Initial state');
    expect(engine.stateAt(engine.rootId).count).toBe(3);
    engine.jumpTo(engine.rootId);
    expect(engine.state.count).toBe(3);
    assertTreeInvariants(engine, 50);
  });

  it('removes the oldest leaves that are not the current entry first', () => {
    const { engine, edit } = createFixture({ maxEntries: 4 });
    const a = edit({ count: 1 })?.id ?? -1;
    engine.undo();
    const b = edit({ count: 2 })?.id ?? -1;
    engine.undo();
    const c = edit({ count: 3 })?.id ?? -1;
    engine.undo();
    const d = edit({ count: 4 })?.id ?? -1;
    expect(engine.size).toBe(4);
    const e = edit({ items: ['x'] })?.id ?? -1;
    expect(engine.node(a)).toBeUndefined();
    expect(engine.node(b)).toBeDefined();
    expect(engine.node(c)).toBeDefined();
    expect(engine.node(d)).toBeDefined();
    expect(engine.currentId).toBe(e);
    assertTreeInvariants(engine, 50);
  });

  it('drops the redo tail of the current entry before touching the past', () => {
    const { engine, edit } = createFixture({ maxEntries: 3 });
    edit({ count: 1 });
    edit({ count: 2 });
    const tip = edit({ count: 3 })?.id ?? -1;
    engine.undo();
    engine.undo();
    edit({ items: ['branch'] });
    expect(engine.node(tip)).toBeUndefined();
    expect(engine.size).toBe(3);
    assertTreeInvariants(engine, 50);
  });

  it('keeps ids increasing after pruning', () => {
    const { engine, edit } = createFixture({ maxEntries: 1 });
    const first = edit({ count: 1 })?.id ?? -1;
    const second = edit({ count: 2 })?.id ?? -1;
    expect(second).toBeGreaterThan(first);
    expect(engine.size).toBe(1);
    expect(engine.rootId).toBe(first);
  });
});

describe('clear and snapshots', () => {
  it('clears the history and keeps the state', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 });
    const before = engine.state;
    const oldRoot = engine.rootId;
    const nextId = engine.nextId;
    engine.clear();
    expect(engine.size).toBe(0);
    expect(engine.state).toBe(before);
    expect(engine.rootId).toBeGreaterThanOrEqual(nextId);
    expect(engine.rootId).not.toBe(oldRoot);
    expect(engine.canUndo).toBe(false);
    assertTreeInvariants(engine, 50);
  });

  it('round trips a snapshot with branches, pending and open entries', () => {
    const { engine, edit, clock } = createFixture({ checkpointEvery: 2, coalesceWindowMs: 100 });
    edit({ count: 1 }, 'a');
    clock.advance(500);
    const second = edit({ count: 2 }, 'b')?.id ?? -1;
    clock.advance(500);
    edit({ count: 3 }, 'c');
    engine.jumpTo(second);
    clock.advance(500);
    edit({ items: ['x'] }, 'd');
    const snapshot = engine.snapshot();
    const copy = TimelineEngine.restore(snapshot, { checkpointEvery: 2, clock });
    expect(copy.state).toEqual(engine.state);
    expect(copy.currentId).toBe(engine.currentId);
    expect(copy.size).toBe(engine.size);
    expect(copy.nextId).toBe(engine.nextId);
    expect(copy.redoBranches()).toEqual(engine.redoBranches());
    for (const node of engine.nodes()) {
      expect(copy.stateAt(node.id)).toEqual(engine.stateAt(node.id));
      expect(copy.node(node.id)?.lastVisitedChild).toBe(node.lastVisitedChild);
    }
    assertTreeInvariants(copy, 2);
    copy.undo();
    expect(copy.state.items).toEqual([]);
  });

  it('keeps an open entry open after a snapshot', () => {
    const { engine, edit } = createFixture();
    edit({ count: 1 }, 'drag', 'k');
    engine.snapshot();
    edit({ count: 2 }, 'drag', 'k');
    expect(engine.size).toBe(1);
  });

  it('restores a re-rooted history', () => {
    const { engine, edit } = createFixture({ maxEntries: 2 });
    for (let value = 1; value <= 5; value += 1) {
      edit({ count: value });
    }
    const copy = TimelineEngine.restore(engine.snapshot(), { maxEntries: 2 });
    expect(copy.rootId).toBe(engine.rootId);
    expect(copy.stateAt(copy.rootId)).toEqual(engine.stateAt(engine.rootId));
    expect(copy.state).toEqual(engine.state);
  });

  it('prunes a restored history that exceeds the new maxEntries', () => {
    const { engine, edit } = createFixture();
    for (let value = 1; value <= 6; value += 1) {
      edit({ count: value });
    }
    const copy = TimelineEngine.restore(engine.snapshot(), { maxEntries: 2 });
    expect(copy.size).toBe(2);
    expect(copy.state.count).toBe(6);
    assertTreeInvariants(copy, 50);
  });
});

describe('invalid snapshots', () => {
  function validSnapshot() {
    const { engine, edit } = createFixture();
    edit({ count: 1 }, 'a');
    edit({ count: 2 }, 'b');
    return engine.snapshot();
  }

  it('rejects an entry whose parent is missing', () => {
    const snapshot = validSnapshot();
    const broken = {
      ...snapshot,
      nodes: [{ ...snapshot.nodes[0], parentId: 77 }, snapshot.nodes[1]],
    };
    expect(() => TimelineEngine.restore(broken)).toThrow(SnapshotError);
  });

  it('rejects an entry that is older than its parent', () => {
    const snapshot = validSnapshot();
    const broken = {
      ...snapshot,
      nodes: [{ ...snapshot.nodes[0], parentId: snapshot.nodes[1].id }, snapshot.nodes[1]],
    };
    expect(() => TimelineEngine.restore(broken)).toThrow('no valid parent');
  });

  it('rejects an id at or above nextId', () => {
    const snapshot = validSnapshot();
    expect(() => TimelineEngine.restore({ ...snapshot, nextId: 2 })).toThrow(SnapshotError);
  });

  it('rejects duplicate ids', () => {
    const snapshot = validSnapshot();
    const broken = { ...snapshot, nodes: [snapshot.nodes[0], snapshot.nodes[0]] };
    expect(() => TimelineEngine.restore(broken)).toThrow(SnapshotError);
  });

  it('rejects a patch that does not apply', () => {
    const snapshot = validSnapshot();
    const broken = {
      ...snapshot,
      nodes: [
        { ...snapshot.nodes[0], forward: [{ op: 'remove' as const, path: '/nowhere/at/all' }] },
        snapshot.nodes[1],
      ],
    };
    expect(() => TimelineEngine.restore(broken)).toThrow('does not apply');
  });

  it('rejects a last visited child that is not a child', () => {
    const snapshot = validSnapshot();
    const broken = {
      ...snapshot,
      root: { ...snapshot.root, lastVisitedChild: snapshot.nodes[1].id },
    };
    expect(() => TimelineEngine.restore(broken)).toThrow('is not a child');
  });

  it('rejects a current entry that does not exist', () => {
    const snapshot = validSnapshot();
    expect(() => TimelineEngine.restore({ ...snapshot, currentId: 500 })).toThrow('does not exist');
  });
});
