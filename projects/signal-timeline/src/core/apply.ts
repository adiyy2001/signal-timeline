import { parsePointer } from './json-pointer';
import { PatchError, type Operation, type Patch } from './patch';
import { copyPlainObject, hasOwn, isPlainObject, setOwn, type PlainObject } from './values';

type Container = PlainObject | unknown[];

const arrayIndexPattern = /^(0|[1-9]\d*)$/;

class Session {
  private readonly owned = new WeakSet<object>();

  writable(value: unknown, path: string): Container {
    if (this.isOwned(value)) {
      return value;
    }
    if (Array.isArray(value)) {
      return this.claim(value.slice());
    }
    if (isPlainObject(value)) {
      return this.claim(copyPlainObject(value));
    }
    throw new PatchError(`The value at "${path}" is not an object or an array`, { path });
  }

  private isOwned(value: unknown): value is Container {
    return typeof value === 'object' && value !== null && this.owned.has(value);
  }

  private claim<T extends Container>(copy: T): T {
    this.owned.add(copy);
    return copy;
  }
}

function parseIndex(segment: string, length: number, allowEnd: boolean, path: string): number {
  if (allowEnd && segment === '-') {
    return length;
  }
  if (!arrayIndexPattern.test(segment)) {
    throw new PatchError(`"${segment}" is not an array index`, { path });
  }
  const index = Number(segment);
  const limit = allowEnd ? length : length - 1;
  if (index > limit) {
    throw new PatchError(`Index ${index} is out of range for an array of length ${length}`, {
      path,
    });
  }
  return index;
}

function childOf(container: unknown, segment: string, path: string): unknown {
  if (Array.isArray(container)) {
    return container[parseIndex(segment, container.length, false, path)];
  }
  if (isPlainObject(container) && hasOwn(container, segment)) {
    return container[segment];
  }
  throw new PatchError(`Nothing to follow at "${segment}"`, { path });
}

function assignChild(container: Container, segment: string, value: unknown): void {
  if (Array.isArray(container)) {
    container[Number(segment)] = value;
  } else {
    setOwn(container, segment, value);
  }
}

function applyAtLeaf(parent: Container, segment: string, operation: Operation): void {
  const { path } = operation;
  if (Array.isArray(parent)) {
    if (operation.op === 'add') {
      parent.splice(parseIndex(segment, parent.length, true, path), 0, operation.value);
    } else if (operation.op === 'remove') {
      parent.splice(parseIndex(segment, parent.length, false, path), 1);
    } else {
      parent[parseIndex(segment, parent.length, false, path)] = operation.value;
    }
    return;
  }
  if (operation.op === 'add') {
    setOwn(parent, segment, operation.value);
    return;
  }
  if (!hasOwn(parent, segment)) {
    throw new PatchError(`Cannot ${operation.op} missing key "${segment}"`, { path });
  }
  if (operation.op === 'remove') {
    Reflect.deleteProperty(parent, segment);
  } else {
    setOwn(parent, segment, operation.value);
  }
}

function applyOperation(root: unknown, operation: Operation, session: Session): unknown {
  const segments = parsePointer(operation.path);
  if (segments.length === 0) {
    if (operation.op === 'remove') {
      throw new PatchError('Cannot remove the document root', { path: operation.path });
    }
    return operation.value;
  }
  const newRoot = session.writable(root, '');
  let parent = newRoot;
  for (let depth = 0; depth < segments.length - 1; depth += 1) {
    const segment = segments[depth];
    const current = childOf(parent, segment, operation.path);
    const next = session.writable(current, operation.path);
    if (next !== current) {
      assignChild(parent, segment, next);
    }
    parent = next;
  }
  applyAtLeaf(parent, segments[segments.length - 1], operation);
  return newRoot;
}

/**
 * Applies a patch without changing the input. Containers on a changed path are copied once per call,
 * everything else keeps its identity. If any operation fails, a `PatchError` is thrown and nothing is returned.
 */
export function applyPatch<T = unknown>(state: T, patch: Patch): T {
  const session = new Session();
  let current: unknown = state;
  patch.forEach((operation, operationIndex) => {
    try {
      current = applyOperation(current, operation, session);
    } catch (error) {
      if (error instanceof PatchError && error.operationIndex === undefined) {
        throw new PatchError(error.message, { operationIndex, path: error.path ?? operation.path });
      }
      throw error;
    }
  });
  return current as T;
}
