export type Canonical = string | number | boolean | null | readonly Canonical[];

export function canonical(value: unknown): Canonical {
  if (Array.isArray(value)) {
    return ['array', ...value.map(canonical)];
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.keys(value)
      .sort()
      .map((key): Canonical => [
        key,
        canonical(Object.getOwnPropertyDescriptor(value, key)?.value),
      ]);
    return ['object', ...entries];
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  return null;
}
