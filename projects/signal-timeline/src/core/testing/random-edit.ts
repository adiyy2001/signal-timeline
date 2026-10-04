import * as fc from 'fast-check';
import type { JsonValue } from '../patch';
import {
  jsonValueArbitrary,
  keyArbitrary,
  safeJsonValueArbitrary,
  safeKeyArbitrary,
} from './json-arbitraries';

export interface RandomEdit {
  readonly route: readonly number[];
  readonly kind: 'add' | 'remove' | 'replace';
  readonly key: string;
  readonly index: number;
  readonly value: JsonValue;
}

function editWith(
  keys: fc.Arbitrary<string>,
  values: fc.Arbitrary<JsonValue>,
): fc.Arbitrary<RandomEdit> {
  return fc.record({
    route: fc.array(fc.nat(8), { maxLength: 4 }),
    kind: fc.constantFrom('add', 'remove', 'replace'),
    key: keys,
    index: fc.nat(12),
    value: values,
  });
}

export const randomEditArbitrary = editWith(keyArbitrary, jsonValueArbitrary);

export const safeRandomEditArbitrary = editWith(safeKeyArbitrary, safeJsonValueArbitrary);

type Plain = { [key: string]: JsonValue };

function isObject(value: JsonValue): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isList(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function defineEntry(target: Plain, key: string, value: JsonValue): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function withEntry(object: Plain, key: string, value: JsonValue | undefined): Plain {
  const copy: Plain = {};
  for (const existing of Object.keys(object)) {
    if (existing === key) {
      if (value !== undefined) {
        defineEntry(copy, key, value);
      }
    } else {
      defineEntry(copy, existing, object[existing]);
    }
  }
  if (value !== undefined && !Object.keys(object).includes(key)) {
    defineEntry(copy, key, value);
  }
  return copy;
}

function editObject(object: Plain, edit: RandomEdit): Plain {
  if (edit.kind === 'add') {
    return withEntry(object, edit.key, edit.value);
  }
  const keys = Object.keys(object);
  if (keys.length === 0) {
    return object;
  }
  const target = keys[edit.index % keys.length];
  return withEntry(object, target, edit.kind === 'remove' ? undefined : edit.value);
}

function editList(list: readonly JsonValue[], edit: RandomEdit): readonly JsonValue[] {
  const copy = list.slice();
  if (edit.kind === 'add') {
    copy.splice(edit.index % (copy.length + 1), 0, edit.value);
  } else if (copy.length > 0 && edit.kind === 'remove') {
    copy.splice(edit.index % copy.length, 1);
  } else if (copy.length > 0) {
    copy[edit.index % copy.length] = edit.value;
  }
  return copy;
}

function childCount(value: JsonValue): number {
  if (isList(value)) {
    return value.length;
  }
  return isObject(value) ? Object.keys(value).length : 0;
}

export function applyRandomEdit(state: JsonValue, edit: RandomEdit, depth = 0): JsonValue {
  const count = childCount(state);
  const selector = edit.route[depth];
  if (selector === undefined || count === 0) {
    if (isList(state)) {
      return editList(state, edit);
    }
    return isObject(state) ? editObject(state, edit) : edit.value;
  }
  const position = selector % count;
  if (isList(state)) {
    const copy = state.slice();
    copy[position] = applyRandomEdit(copy[position], edit, depth + 1);
    return copy;
  }
  if (isObject(state)) {
    const key = Object.keys(state)[position];
    return withEntry(state, key, applyRandomEdit(state[key], edit, depth + 1));
  }
  return edit.value;
}

export function applyRandomEdits(state: JsonValue, edits: readonly RandomEdit[]): JsonValue {
  return edits.reduce<JsonValue>((current, edit) => applyRandomEdit(current, edit), state);
}
