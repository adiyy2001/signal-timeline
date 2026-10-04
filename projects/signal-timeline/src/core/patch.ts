/**
 * A JSON value. Persisted history only works with state made of these.
 */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * Adds a value at a path. On an array the last path segment is an index, or `-` to append.
 */
export interface AddOperation {
  readonly op: 'add';
  readonly path: string;
  readonly value: unknown;
}

/**
 * Removes the value at a path.
 */
export interface RemoveOperation {
  readonly op: 'remove';
  readonly path: string;
}

/**
 * Replaces the value at a path. An empty path replaces the whole document.
 */
export interface ReplaceOperation {
  readonly op: 'replace';
  readonly path: string;
  readonly value: unknown;
}

/**
 * One step of a patch, in the style of RFC 6902. Only the operations that a diff needs are modeled.
 */
export type Operation = AddOperation | RemoveOperation | ReplaceOperation;

/**
 * An ordered list of operations. Applying them in order turns one state into another.
 */
export type Patch = readonly Operation[];

/**
 * Thrown when a pointer is malformed or an operation does not fit the document it is applied to.
 */
export class PatchError extends Error {
  readonly operationIndex: number | undefined;
  readonly path: string | undefined;

  constructor(message: string, details: { operationIndex?: number; path?: string } = {}) {
    super(message);
    this.name = 'PatchError';
    this.operationIndex = details.operationIndex;
    this.path = details.path;
  }
}
