import { joinPointer } from './json-pointer';
import type { Operation, Patch } from './patch';
import { hasOwn, isPlainObject, type PlainObject } from './values';

/**
 * A patch that turns one state into another, and the patch that turns it back.
 */
export interface PatchPair {
  readonly forward: Patch;
  readonly inverse: Patch;
}

interface RemovedEntry {
  readonly path: string;
  readonly oldValue: unknown;
}

class PairBuilder {
  forward: Operation[] = [];
  inverse: Operation[] = [];

  get length(): number {
    return this.forward.length;
  }

  insertRemovals(index: number, removed: readonly RemovedEntry[]): void {
    this.forward = [
      ...this.forward.slice(0, index),
      ...removed.map((entry): Operation => ({ op: 'remove', path: entry.path })),
      ...this.forward.slice(index),
    ];
    this.inverse = [
      ...this.inverse.slice(0, index),
      ...removed.map((entry): Operation => ({
        op: 'add',
        path: entry.path,
        value: entry.oldValue,
      })),
      ...this.inverse.slice(index),
    ];
  }

  add(path: string, value: unknown): void {
    this.forward.push({ op: 'add', path, value });
    this.inverse.push({ op: 'remove', path });
  }

  remove(path: string, oldValue: unknown): void {
    this.forward.push({ op: 'remove', path });
    this.inverse.push({ op: 'add', path, value: oldValue });
  }

  replace(path: string, oldValue: unknown, value: unknown): void {
    this.forward.push({ op: 'replace', path, value });
    this.inverse.push({ op: 'replace', path, value: oldValue });
  }

  finish(): PatchPair {
    return { forward: this.forward, inverse: this.inverse.reverse() };
  }
}

function diffValues(before: unknown, after: unknown, path: string, out: PairBuilder): void {
  if (Object.is(before, after)) {
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    diffArrays(before, after, path, out);
  } else if (isPlainObject(before) && isPlainObject(after)) {
    diffObjects(before, after, path, out);
  } else {
    out.replace(path, before, after);
  }
}

const largeObjectKeyCount = 128;
const keysOfLargeObjects = new WeakMap<object, readonly string[]>();

function keysOfAfter(after: PlainObject): readonly string[] {
  const keys = Object.keys(after);
  if (keys.length >= largeObjectKeyCount) {
    keysOfLargeObjects.set(after, keys);
  }
  return keys;
}

function keysOfBefore(before: PlainObject): readonly string[] {
  const remembered = keysOfLargeObjects.get(before);
  if (remembered === undefined) {
    return Object.keys(before);
  }
  keysOfLargeObjects.delete(before);
  return remembered;
}

function diffObjects(
  before: PlainObject,
  after: PlainObject,
  path: string,
  out: PairBuilder,
): void {
  const beforeKeys = keysOfBefore(before);
  const firstOperation = out.length;
  let kept = 0;
  for (const key of keysOfAfter(after)) {
    if (!hasOwn(before, key)) {
      out.add(joinPointer(path, key), after[key]);
      continue;
    }
    kept += 1;
    const oldValue = before[key];
    const newValue = after[key];
    if (!Object.is(oldValue, newValue)) {
      diffValues(oldValue, newValue, joinPointer(path, key), out);
    }
  }
  if (kept < beforeKeys.length) {
    const removed: RemovedEntry[] = [];
    for (const key of beforeKeys) {
      if (!hasOwn(after, key)) {
        removed.push({ path: joinPointer(path, key), oldValue: before[key] });
      }
    }
    out.insertRemovals(firstOperation, removed);
  }
}

function commonPrefixLength(before: readonly unknown[], after: readonly unknown[]): number {
  const limit = Math.min(before.length, after.length);
  let length = 0;
  while (length < limit && Object.is(before[length], after[length])) {
    length += 1;
  }
  return length;
}

function commonSuffixLength(
  before: readonly unknown[],
  after: readonly unknown[],
  prefix: number,
): number {
  const limit = Math.min(before.length, after.length) - prefix;
  let length = 0;
  while (
    length < limit &&
    Object.is(before[before.length - 1 - length], after[after.length - 1 - length])
  ) {
    length += 1;
  }
  return length;
}

function diffArrays(
  before: readonly unknown[],
  after: readonly unknown[],
  path: string,
  out: PairBuilder,
): void {
  const prefix = commonPrefixLength(before, after);
  const suffix = commonSuffixLength(before, after, prefix);
  const beforeEnd = before.length - suffix;
  const afterEnd = after.length - suffix;
  if (before.length === after.length) {
    for (let index = prefix; index < beforeEnd; index += 1) {
      diffValues(before[index], after[index], joinPointer(path, index), out);
    }
    return;
  }
  for (let index = beforeEnd - 1; index >= prefix; index -= 1) {
    out.remove(joinPointer(path, index), before[index]);
  }
  for (let index = prefix; index < afterEnd; index += 1) {
    out.add(joinPointer(path, index), after[index]);
  }
}

export function diffPair(before: unknown, after: unknown): PatchPair {
  const out = new PairBuilder();
  diffValues(before, after, '', out);
  return out.finish();
}

export function diff(before: unknown, after: unknown): Patch {
  return diffPair(before, after).forward;
}
