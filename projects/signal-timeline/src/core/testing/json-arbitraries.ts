import * as fc from 'fast-check';
import type { JsonValue } from '../patch';

export const keyArbitrary = fc.constantFrom(
  'a',
  'b',
  'c',
  'd',
  'a/b',
  'a~b',
  '~0',
  '~1',
  '',
  '0',
  '-',
  '__proto__',
  'constructor',
  'prototype',
);

export const safeKeyArbitrary = fc.constantFrom('a', 'b', 'c', 'd', 'a/b', 'a~b', '~0', '', '0');

const leafArbitrary: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.integer({ min: -5, max: 5 }),
  fc.constantFrom('x', 'y', 'z', ''),
  fc.boolean(),
  fc.constant(null),
);

function jsonValueWith(keys: fc.Arbitrary<string>): fc.Arbitrary<JsonValue> {
  return fc.letrec<{ node: JsonValue; array: JsonValue; object: JsonValue }>((tie) => ({
    node: fc.oneof({ maxDepth: 3, depthSize: 'small' }, leafArbitrary, tie('array'), tie('object')),
    array: fc.array(tie('node'), { maxLength: 6 }),
    object: fc.dictionary(keys, tie('node'), { maxKeys: 5, noNullPrototype: true }),
  })).node;
}

export const jsonValueArbitrary = jsonValueWith(keyArbitrary);

export const safeJsonValueArbitrary = jsonValueWith(safeKeyArbitrary);

export const jsonArrayArbitrary: fc.Arbitrary<JsonValue[]> = fc.array(leafArbitrary, {
  maxLength: 12,
});

type JsonObject = { [key: string]: JsonValue };

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectOf(keys: fc.Arbitrary<string>): fc.Arbitrary<JsonObject> {
  return jsonValueWith(keys).filter(isJsonObject);
}

export const jsonObjectArbitrary = objectOf(keyArbitrary);

export const safeJsonObjectArbitrary = objectOf(safeKeyArbitrary);
