export type PlainObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isContainer(value: unknown): value is PlainObject | readonly unknown[] {
  return Array.isArray(value) || isPlainObject(value);
}

export function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

const unsafeKeys: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export function setOwn(target: PlainObject, key: string, value: unknown): void {
  if (unsafeKeys.has(key)) {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}

export function copyPlainObject(source: PlainObject): PlainObject {
  return { ...source };
}
