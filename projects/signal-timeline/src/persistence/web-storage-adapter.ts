import type { TimelinePersistenceAdapter } from './adapter';

function createWebStorageAdapter(
  key: string,
  resolveStorage: () => Storage,
): TimelinePersistenceAdapter {
  return {
    load: () => resolveStorage().getItem(key),
    save: (value) => resolveStorage().setItem(key, value),
    remove: () => resolveStorage().removeItem(key),
  };
}

/**
 * Keeps the history in `sessionStorage` under `key`, so it survives a reload of the tab.
 * Storage that is missing, blocked or full makes the adapter throw, and the timeline reports
 * that through `onError` and carries on in memory.
 */
export function createSessionStorageAdapter(key: string): TimelinePersistenceAdapter {
  return createWebStorageAdapter(key, () => globalThis.sessionStorage);
}

/**
 * Keeps the history in `localStorage` under `key`, so it survives closing the browser.
 */
export function createLocalStorageAdapter(key: string): TimelinePersistenceAdapter {
  return createWebStorageAdapter(key, () => globalThis.localStorage);
}
