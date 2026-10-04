import type { EngineSnapshot, SnapshotNode } from '../core/engine';
import { TimelineError } from '../core/engine';
import type { Operation, Patch } from '../core/patch';
import { isPlainObject } from '../core/values';

export const currentFormat = 1;

export type Slices = Record<string, unknown>;

export class PersistenceFormatError extends TimelineError {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceFormatError';
  }
}

export interface ParseOptions {
  readonly keys: readonly string[];
  readonly migrate?: (payload: unknown, fromFormat: number) => unknown;
}

function fail(message: string): never {
  throw new PersistenceFormatError(message);
}

function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    return fail(`${what} must be an object`);
  }
  return value;
}

function requireInteger(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return fail(`${what} must be a non-negative integer`);
  }
  return value;
}

function optionalInteger(value: unknown, what: string): number | undefined {
  return value === undefined || value === null ? undefined : requireInteger(value, what);
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    return fail(`${what} must be a string`);
  }
  return value;
}

function requireTimestamp(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(`${what} must be a finite number`);
  }
  return value;
}

function requireOperation(value: unknown, what: string): Operation {
  const operation = requireObject(value, what);
  const path = requireString(operation['path'], `${what} path`);
  switch (operation['op']) {
    case 'remove':
      return { op: 'remove', path };
    case 'add':
    case 'replace':
      if (!Object.hasOwn(operation, 'value')) {
        return fail(`${what} has no value`);
      }
      return { op: operation['op'], path, value: operation['value'] };
    default:
      return fail(`${what} has an unknown operation`);
  }
}

function requirePatch(value: unknown, what: string): Patch {
  if (!Array.isArray(value)) {
    return fail(`${what} must be an array`);
  }
  return value.map((operation, index) => requireOperation(operation, `${what}[${index}]`));
}

function requireStringList(value: unknown, what: string): readonly string[] {
  if (!Array.isArray(value) || value.some((key) => typeof key !== 'string')) {
    return fail(`${what} must be a list of strings`);
  }
  return value as string[];
}

function requireKeys(value: unknown, expected: readonly string[], what: string): void {
  const stored = [...requireStringList(value, what)].sort();
  const wanted = [...expected].sort();
  if (stored.length !== wanted.length || stored.some((key, index) => key !== wanted[index])) {
    return fail(`${what} (${stored.join(', ')}) do not match the store (${wanted.join(', ')})`);
  }
}

function requireSlices(value: unknown, expected: readonly string[], what: string): Slices {
  const slices = requireObject(value, what);
  requireKeys(Object.keys(slices), expected, `${what} keys`);
  return slices;
}

function requireNode(value: unknown, index: number): SnapshotNode {
  const what = `nodes[${index}]`;
  const node = requireObject(value, what);
  return {
    id: requireInteger(node['id'], `${what}.id`),
    parentId: requireInteger(node['parentId'], `${what}.parentId`),
    label: requireString(node['label'], `${what}.label`),
    timestamp: requireTimestamp(node['timestamp'], `${what}.timestamp`),
    forward: requirePatch(node['forward'], `${what}.forward`),
    inverse: requirePatch(node['inverse'], `${what}.inverse`),
    changedKeys: requireStringList(node['changedKeys'], `${what}.changedKeys`),
    lastVisitedChild: optionalInteger(node['lastVisitedChild'], `${what}.lastVisitedChild`),
  };
}

function validate(
  payload: Record<string, unknown>,
  keys: readonly string[],
): EngineSnapshot<Slices> {
  requireKeys(payload['keys'], keys, 'The stored keys');
  const root = requireObject(payload['root'], 'root');
  const nodes = payload['nodes'];
  if (!Array.isArray(nodes)) {
    return fail('nodes must be an array');
  }
  return {
    root: {
      id: requireInteger(root['id'], 'root.id'),
      label: requireString(root['label'], 'root.label'),
      timestamp: requireTimestamp(root['timestamp'], 'root.timestamp'),
      state: requireSlices(root['state'], keys, 'root.state'),
      lastVisitedChild: optionalInteger(root['lastVisitedChild'], 'root.lastVisitedChild'),
    },
    nodes: nodes.map((node, index) => requireNode(node, index)),
    currentId: requireInteger(payload['currentId'], 'currentId'),
    nextId: requireInteger(payload['nextId'], 'nextId'),
  };
}

export function serializeSnapshot(
  snapshot: EngineSnapshot<Slices>,
  keys: readonly string[],
): string {
  return JSON.stringify({
    format: currentFormat,
    keys: [...keys].sort(),
    root: snapshot.root,
    nodes: snapshot.nodes,
    currentId: snapshot.currentId,
    nextId: snapshot.nextId,
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return fail('The stored history is not valid JSON');
  }
}

function migrated(payload: Record<string, unknown>, options: ParseOptions): unknown {
  const format = payload['format'];
  if (typeof format !== 'number' || !Number.isInteger(format)) {
    return fail('The stored history has no format number');
  }
  if (format === currentFormat) {
    return payload;
  }
  if (options.migrate === undefined) {
    return fail(
      `The stored history has format ${format}, this version reads format ${currentFormat}`,
    );
  }
  try {
    return options.migrate(payload, format);
  } catch (error) {
    return fail(
      `Migrating format ${format} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function parseSnapshot(text: string, options: ParseOptions): EngineSnapshot<Slices> {
  const payload = requireObject(parseJson(text), 'The stored history');
  const current = requireObject(migrated(payload, options), 'The migrated history');
  if (current['format'] !== currentFormat) {
    return fail('The migrated history must declare the current format');
  }
  return validate(current, options.keys);
}
