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

class PairBuilder {
  readonly forward: Operation[] = [];
  readonly inverse: Operation[] = [];

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

function diffObjects(
  before: PlainObject,
  after: PlainObject,
  path: string,
  out: PairBuilder,
): void {
  for (const key of Object.keys(before)) {
    if (!hasOwn(after, key)) {
      out.remove(joinPointer(path, key), before[key]);
    }
  }
  for (const key of Object.keys(after)) {
    const childPath = joinPointer(path, key);
    if (hasOwn(before, key)) {
      diffValues(before[key], after[key], childPath, out);
    } else {
      out.add(childPath, after[key]);
    }
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

/**
 * Computes the forward and the inverse patch between two states in one pass.
 * Subtrees that are the same reference in both states are skipped without being read.
 */
export function diffPair(before: unknown, after: unknown): PatchPair {
  const out = new PairBuilder();
  diffValues(before, after, '', out);
  return out.finish();
}

/**
 * Computes the patch that turns `before` into `after`.
 */
export function diff(before: unknown, after: unknown): Patch {
  return diffPair(before, after).forward;
}
