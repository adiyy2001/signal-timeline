import { TimelineEngine, type EngineSnapshot } from '../core/engine';
import {
  currentFormat,
  parseSnapshot,
  PersistenceFormatError,
  serializeSnapshot,
  type Slices,
} from './format';

function buildSnapshot(): EngineSnapshot<Slices> {
  const engine = new TimelineEngine<Slices>(
    { a: { x: 1 }, b: [1, 2] },
    { schedule: (task) => task() },
  );
  engine.record({ ...engine.state, a: { x: 2 } }, { label: 'first' });
  engine.undo();
  engine.record({ ...engine.state, b: [1, 2, 3] }, { label: 'second' });
  return engine.snapshot();
}

const keys = ['a', 'b'];

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...JSON.parse(serializeSnapshot(buildSnapshot(), keys)), ...overrides };
}

function parse(value: unknown, options: Parameters<typeof parseSnapshot>[1] = { keys }) {
  return parseSnapshot(JSON.stringify(value), options);
}

describe('persistence format', () => {
  it('declares its format number and the sorted keys', () => {
    const parsed = JSON.parse(serializeSnapshot(buildSnapshot(), ['b', 'a']));
    expect(parsed.format).toBe(currentFormat);
    expect(parsed.keys).toEqual(['a', 'b']);
  });

  it('round trips a snapshot', () => {
    const snapshot = buildSnapshot();
    const parsed = parseSnapshot(serializeSnapshot(snapshot, keys), { keys });
    expect(parsed).toEqual(JSON.parse(JSON.stringify(snapshot)));
  });

  it('rebuilds an engine with the same states at every entry', () => {
    const original = TimelineEngine.restore(buildSnapshot());
    const restored = TimelineEngine.restore(
      parseSnapshot(serializeSnapshot(original.snapshot(), keys), { keys }),
    );
    for (const node of original.nodes()) {
      expect(restored.stateAt(node.id)).toEqual(original.stateAt(node.id));
    }
    expect(restored.currentId).toBe(original.currentId);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseSnapshot('{nope', { keys })).toThrow(PersistenceFormatError);
  });

  it.each([
    ['a number', 7],
    ['null', null],
    ['an array', []],
  ])('rejects %s as the payload', (_name, value) => {
    expect(() => parse(value)).toThrow(PersistenceFormatError);
  });

  it('rejects a payload without a format number', () => {
    expect(() => parse(payload({ format: undefined }))).toThrow(/no format number/);
    expect(() => parse(payload({ format: 'one' }))).toThrow(/no format number/);
  });

  it('rejects an unknown format when there is no migration', () => {
    expect(() => parse(payload({ format: 99 }))).toThrow(/format 99/);
  });

  it('rejects keys that differ from the store', () => {
    expect(() => parse(payload(), { keys: ['a'] })).toThrow(/do not match/);
    expect(() => parse(payload({ keys: 'a,b' }))).toThrow(/list of strings/);
    expect(() => parse(payload({ keys: [1, 2] }))).toThrow(/list of strings/);
  });

  it('rejects a root state with other keys than the store', () => {
    const base = payload();
    const root = { ...(base['root'] as object), state: { a: { x: 1 } } };
    expect(() => parse({ ...base, root })).toThrow(/root.state keys/);
  });

  it.each([
    ['root', { root: 5 }, /root must be an object/],
    ['nodes', { nodes: {} }, /nodes must be an array/],
    ['current id', { currentId: -1 }, /currentId/],
    ['next id', { nextId: 1.5 }, /nextId/],
  ])('rejects a bad %s', (_name, overrides, message) => {
    expect(() => parse(payload(overrides))).toThrow(message);
  });

  it('rejects malformed root fields', () => {
    const base = payload();
    const root = base['root'] as Record<string, unknown>;
    expect(() => parse({ ...base, root: { ...root, label: 4 } })).toThrow(/root.label/);
    expect(() => parse({ ...base, root: { ...root, timestamp: 'x' } })).toThrow(/root.timestamp/);
    expect(() => parse({ ...base, root: { ...root, id: 'x' } })).toThrow(/root.id/);
  });

  it('rejects malformed nodes and operations', () => {
    const base = payload();
    const nodes = base['nodes'] as Record<string, unknown>[];
    const withFirst = (changes: Record<string, unknown>) => ({
      ...base,
      nodes: [{ ...nodes[0], ...changes }, ...nodes.slice(1)],
    });
    expect(() => parse(withFirst({ id: 'x' }))).toThrow(/nodes\[0\].id/);
    expect(() => parse(withFirst({ label: 1 }))).toThrow(/nodes\[0\].label/);
    expect(() => parse(withFirst({ forward: {} }))).toThrow(/forward must be an array/);
    expect(() => parse(withFirst({ forward: [7] }))).toThrow(/forward\[0\] must be an object/);
    expect(() => parse(withFirst({ forward: [{ op: 'move', path: '/a' }] }))).toThrow(
      /unknown operation/,
    );
    expect(() => parse(withFirst({ forward: [{ op: 'add', path: '/a' }] }))).toThrow(/no value/);
    expect(() => parse(withFirst({ forward: [{ op: 'remove', path: 3 }] }))).toThrow(/path/);
    expect(() => parse(withFirst({ lastVisitedChild: 'x' }))).toThrow(/lastVisitedChild/);
  });

  it('accepts a missing lastVisitedChild and a remove operation', () => {
    const base = payload();
    const nodes = base['nodes'] as Record<string, unknown>[];
    const first = {
      ...nodes[0],
      lastVisitedChild: undefined,
      forward: [{ op: 'remove', path: '/a/x' }],
    };
    expect(parse({ ...base, nodes: [first, ...nodes.slice(1)] }).nodes[0]?.forward).toEqual([
      { op: 'remove', path: '/a/x' },
    ]);
  });

  describe('migration', () => {
    const old = (): Record<string, unknown> => payload({ format: 0 });

    it('runs the migration for another format and validates the result', () => {
      const migrate = vi.fn((value: unknown) => ({ ...(value as object), format: currentFormat }));
      const parsed = parse(old(), { keys, migrate });
      expect(migrate).toHaveBeenCalledWith(expect.objectContaining({ format: 0 }), 0);
      expect(parsed.nodes).toHaveLength(2);
    });

    it('does not run the migration for the current format', () => {
      const migrate = vi.fn();
      parse(payload(), { keys, migrate });
      expect(migrate).not.toHaveBeenCalled();
    });

    it('wraps an error thrown by the migration', () => {
      const migrate = () => {
        throw new Error('boom');
      };
      expect(() => parse(old(), { keys, migrate })).toThrow(/Migrating format 0 failed: boom/);
    });

    it('reports a thrown value that is not an error', () => {
      const migrate = () => {
        throw 'text';
      };
      expect(() => parse(old(), { keys, migrate })).toThrow(/failed: text/);
    });

    it('rejects a migration that does not declare the current format', () => {
      const migrate = (value: unknown) => value;
      expect(() => parse(old(), { keys, migrate })).toThrow(/current format/);
    });

    it('rejects a migration result that is not valid', () => {
      const migrate = () => ({ format: currentFormat, keys });
      expect(() => parse(old(), { keys, migrate })).toThrow(PersistenceFormatError);
    });
  });
});
