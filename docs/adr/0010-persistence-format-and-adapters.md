# 0010 Persistence format and adapters

Status: accepted, 2026-10-04

## Context

History has to survive a reload. The brief asks for an adapter interface and a `sessionStorage` adapter. `sessionStorage` holds about 5 MB per origin and per tab, throws when full, and is unavailable in some privacy modes.

## Decision

- The interface is small: `load(): string | null | Promise<string | null>`, `save(value: string): void | Promise<void>`, `remove(): void | Promise<void>`. The timeline serializes to a string itself, so an adapter can target `localStorage`, IndexedDB or a server without knowing the format.
- `createSessionStorageAdapter(key)` and `createLocalStorageAdapter(key)` share one implementation over the `Storage` interface. Every access is wrapped; a quota error calls `onError` and the timeline keeps working in memory.
- Format version 1, JSON: `{ format, keys, root, nodes, currentId, nextId }`. `keys` lists the tracked root keys, sorted. `root` is `{ id, label, timestamp, state, lastVisitedChild }`, the state at the start of the history. A node is `{ id, parentId, label, timestamp, forward, inverse, changedKeys, lastVisitedChild }`. Checkpoints are not stored; they are rebuilt on load, which keeps the payload near the size of the patches. Pending entries are materialized before saving.
- Saving is debounced (default 250 ms after the last sealed entry) and flushed on `pagehide` and on store destroy.
- On load the payload is validated structurally. A payload that fails validation, or has an unknown format number, is ignored and removed, and `onError` is called.
- Rehydration modes: `'history-and-state'` (default) sets the tracked state to the stored current state and keeps the history, marked as a replay. `'history-if-state-matches'` keeps the stored history only when the stored current state equals the live tracked state (the live state goes through a JSON round trip first, then a deep comparison that ignores key order), for apps that restore state some other way.
- `migrate?: (payload, fromFormat) => payload` is part of the options so that the stretch goal (typed migration of persisted history) has a place to land.

## Alternatives

- Persist full snapshots: simplest, and the size problem the project exists to avoid.
- Persist checkpoints too: faster load, bigger payload. Rebuilding costs one pass over the forward patches.
- Make the adapter responsible for serialization: more flexible, but every adapter would need to re-implement validation.

## Consequences

- State has to be JSON-safe to persist. The docs and a runtime check in development mode say so.
- A history that was saved by a different store shape is dropped rather than applied to the wrong state.

## Decisions made in milestone M4

- The payload lists the keys it was saved for, and the root state must have exactly those keys. A payload for other keys (a tracked key was added or removed) is rejected like a corrupt one: ignored, removed, reported through `onError`.
- The format check validates structure, and the engine then replays every forward patch while it loads, so a patch that does not apply rejects the whole payload. It does not check that an inverse patch really inverts its forward patch. That would mean comparing a full state per entry on load. A payload edited by hand can therefore make an undo land on a wrong state. The storage is the app's own, so this is stated in the docs and not defended against.
- `changedKeys` is saved per entry. It is cheap to compute while recording (by reference, per root key) and the patch cannot give it back exactly: a change to an equal value has an empty patch but still names its key.
- `migrate` is called only when the stored format number differs from the current one. Its result must declare the current format and passes the same validation.
- Saving serializes the whole history each time, so the cost grows with the history, not with the last change. The debounce keeps that off the hot path. An incremental append format would fix it and is left out; the limit goes into the README.
- Loading from an asynchronous adapter applies the result only if nothing was recorded in the meantime, and nothing is saved before the load finished, so a slow load cannot overwrite the history it is about to read. A user change that wins the race drops the stored history.
- A value that JSON cannot carry is lost: `undefined` object values and `undefined` operation values. An operation without a value makes the payload invalid. Dates, Maps and class instances are not supported in persisted state, which the development check already warns about.
- Rehydration is a replay (ADR 0007): `isReplaying` is true until the next render, so effects guarded with `skipReplay` do not fire for the restore.
- The session and local storage adapters look the storage up on every call. A blocked or full storage throws at use and the timeline reports it through `onError`, or as a console warning when no handler is given.
