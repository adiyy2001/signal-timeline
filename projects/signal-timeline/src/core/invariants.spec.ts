import { InvariantViolation, assertTreeInvariants } from './invariants';
import type { Patch } from './patch';
import { createFixture, type Doc } from './testing/engine-fixture';

interface Mutable {
  id: number;
  parentId: number | undefined;
  depth: number;
  children: number[];
  lastVisitedChild: number | undefined;
  forward: Patch | undefined;
  inverse: Patch | undefined;
  pending: { before: Doc; after: Doc } | undefined;
  checkpoint: Doc | undefined;
}

function build(interval = 2) {
  const fixture = createFixture({ checkpointEvery: interval });
  fixture.edit({ count: 1 }, 'a');
  fixture.edit({ count: 2 }, 'b');
  fixture.edit({ count: 3 }, 'c');
  fixture.scheduler.flush();
  return fixture;
}

function mutable(fixture: ReturnType<typeof build>, id: number): Mutable {
  return fixture.engine.node(id) as unknown as Mutable;
}

describe('assertTreeInvariants', () => {
  it('accepts healthy engines, including pending and branched ones', () => {
    const fixture = build();
    assertTreeInvariants(fixture.engine, 2);
    fixture.engine.undo();
    fixture.edit({ count: 10 }, 'branch');
    assertTreeInvariants(fixture.engine, 2);
  });

  it('reports a child that does not point back to its parent', () => {
    const fixture = build();
    const tip = fixture.engine.currentId;
    mutable(fixture, tip).parentId = fixture.engine.rootId;
    expect(() => assertTreeInvariants(fixture.engine, 2)).toThrow(InvariantViolation);
  });

  it('reports a node that is listed by two parents', () => {
    const fixture = build();
    const root = mutable(fixture, fixture.engine.rootId);
    root.children.push(fixture.engine.currentId);
    expect(() => assertTreeInvariants(fixture.engine, 2)).toThrow(/does not point back|listed by/);
  });

  it('reports a duplicated child entry', () => {
    const fixture = build();
    const root = mutable(fixture, fixture.engine.rootId);
    root.children.push(root.children[0]);
    expect(() => assertTreeInvariants(fixture.engine, 2)).toThrow('lists a child twice');
  });

  it('reports a missing child', () => {
    const fixture = build();
    mutable(fixture, fixture.engine.rootId).children.push(4242);
    expect(() => assertTreeInvariants(fixture.engine, 2)).toThrow('missing child');
  });

  it('reports an invalid last visited child', () => {
    const fixture = build();
    mutable(fixture, fixture.engine.rootId).lastVisitedChild = 4242;
    expect(() => assertTreeInvariants(fixture.engine, 2)).toThrow('last visited child');
    mutable(fixture, fixture.engine.rootId).lastVisitedChild = undefined;
    expect(() => assertTreeInvariants(fixture.engine, 2)).toThrow('last visited child');
  });

  it('reports a wrong depth', () => {
    const fixture = build();
    mutable(fixture, fixture.engine.currentId).depth = 9;
    expect(() => assertTreeInvariants(fixture.engine, 2)).toThrow('wrong depth');
  });

  it('reports a second root', () => {
    const fixture = build();
    mutable(fixture, fixture.engine.currentId).parentId = undefined;
    expect(() => assertTreeInvariants(fixture.engine, 2)).toThrow('exactly one root');
  });

  it('reports misplaced checkpoints', () => {
    const fixture = build();
    const first = fixture.engine.node(fixture.engine.rootId)?.children[0] ?? -1;
    mutable(fixture, first).checkpoint = fixture.engine.state;
    expect(() => assertTreeInvariants(fixture.engine, 2)).toThrow('checkpoint placement');
  });

  it('reports a checkpoint that differs from the replayed state', () => {
    const fixture = build();
    const second = fixture.engine.node(fixture.engine.currentId)?.parentId ?? -1;
    mutable(fixture, second).checkpoint = { ...fixture.engine.state, count: 99 };
    expect(() => assertTreeInvariants(fixture.engine, 2)).toThrow(
      'differs from the replayed state',
    );
  });

  it('reports an inverse patch that does not restore the parent', () => {
    const fixture = build();
    mutable(fixture, fixture.engine.currentId).inverse = [];
    expect(() => assertTreeInvariants(fixture.engine, 2)).toThrow('does not restore');
  });

  it('reports a node without patches and without a pending change', () => {
    const fixture = build();
    const node = mutable(fixture, fixture.engine.currentId);
    node.forward = undefined;
    expect(() => assertTreeInvariants(fixture.engine, 2)).toThrow('has no patches');
  });

  it('reports a pending change recorded from another state', () => {
    const fixture = createFixture();
    fixture.edit({ count: 1 });
    const node = mutable(fixture, fixture.engine.currentId);
    node.pending = { before: { ...fixture.engine.state, count: 50 }, after: fixture.engine.state };
    expect(() => assertTreeInvariants(fixture.engine, 50)).toThrow('another state');
  });

  it('reports an engine state that differs from its current node', () => {
    const fixture = createFixture();
    fixture.edit({ count: 1 });
    const node = mutable(fixture, fixture.engine.currentId);
    node.pending = {
      before: node.pending?.before as Doc,
      after: { ...fixture.engine.state, count: 7 },
    };
    expect(() => assertTreeInvariants(fixture.engine, 50)).toThrow('engine state differs');
  });
});
