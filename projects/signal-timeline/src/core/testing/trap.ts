import type { JsonValue } from '../patch';

export interface TrapReport {
  readonly value: { [key: string]: JsonValue };
  readonly touches: () => number;
}

export function createTrap(): TrapReport {
  let touched = 0;
  const handler: ProxyHandler<{ [key: string]: JsonValue }> = {};
  const traps = [
    'get',
    'set',
    'has',
    'ownKeys',
    'getPrototypeOf',
    'getOwnPropertyDescriptor',
    'defineProperty',
    'deleteProperty',
  ] as const;
  for (const name of traps) {
    Object.defineProperty(handler, name, {
      value: () => {
        touched += 1;
        throw new Error(`The shared subtree was touched through ${name}`);
      },
    });
  }
  return { value: new Proxy({}, handler), touches: () => touched };
}
