import { isContainer, isPlainObject } from '../core/values';

const scanBudget = 5000;

function describe(value: unknown): string {
  if (typeof value === 'function') {
    return 'a function';
  }
  if (typeof value === 'symbol') {
    return 'a symbol';
  }
  if (typeof value === 'bigint') {
    return 'a bigint';
  }
  const name = (value as { constructor?: { name?: string } }).constructor?.name;
  return name === undefined ? 'an object without a prototype chain' : `a ${name} instance`;
}

function isAcceptedLeaf(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

export function findNonPlainValue(root: unknown): string | undefined {
  const pending: { value: unknown; path: string }[] = [{ value: root, path: '' }];
  let visited = 0;
  while (pending.length > 0 && visited < scanBudget) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    visited += 1;
    const { value, path } = current;
    if (isAcceptedLeaf(value)) {
      continue;
    }
    if (!isContainer(value)) {
      return `${path || '/'} holds ${describe(value)}`;
    }
    const entries: [string, unknown][] = Array.isArray(value)
      ? value.map((item, index): [string, unknown] => [String(index), item])
      : Object.entries(value);
    if (!Array.isArray(value) && !isPlainObject(value)) {
      return `${path || '/'} holds ${describe(value)}`;
    }
    for (const [key, child] of entries) {
      pending.push({ value: child, path: `${path}/${key}` });
    }
  }
  return undefined;
}
