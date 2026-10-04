import { hasOwn, isPlainObject } from './values';

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
    );
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => hasOwn(right, key) && deepEqual(left[key], right[key]))
    );
  }
  return false;
}
