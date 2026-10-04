import type { Operation, TimelineEntryPatches } from 'signal-timeline';

export type OperationName = Operation['op'];

export interface DiffValue {
  readonly present: boolean;
  readonly text: string;
  readonly full: string;
  readonly truncated: boolean;
}

export interface DiffRow {
  readonly operation: OperationName;
  readonly path: string;
  readonly before: DiffValue;
  readonly after: DiffValue;
}

const absent: DiffValue = { present: false, text: 'none', full: 'none', truncated: false };
const defaultMaxLength = 80;

function stringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[not serializable]';
  }
}

/**
 * Formats a value for the diff table. Long values are cut, with the whole text in `full`.
 */
export function formatValue(value: unknown, maxLength = defaultMaxLength): DiffValue {
  const full = stringify(value);
  if (full.length <= maxLength) {
    return { present: true, text: full, full, truncated: false };
  }
  return { present: true, text: `${full.slice(0, maxLength)}...`, full, truncated: true };
}

/**
 * Shows an RFC 6901 pointer for people: the empty path is the whole state.
 */
export function formatPath(path: string): string {
  return path === '' ? '(whole state)' : path;
}

function valueOf(operation: Operation | undefined): DiffValue {
  return operation !== undefined && operation.op !== 'remove'
    ? formatValue(operation.value)
    : absent;
}

/**
 * Pairs every forward operation with the inverse operation that undoes it, which is the
 * mirrored position in the inverse patch, to give a before and an after value per row.
 */
export function diffRows(patches: TimelineEntryPatches): readonly DiffRow[] {
  const { forward, inverse } = patches;
  const aligned = forward.length === inverse.length;
  return forward.map((operation, index) => ({
    operation: operation.op,
    path: operation.path,
    before: aligned ? valueOf(inverse[forward.length - 1 - index]) : absent,
    after: valueOf(operation),
  }));
}
