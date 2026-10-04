# 0010 Persistence format and adapters

Status: accepted, 2026-10-04

## Context

History has to survive a reload. The brief asks for an adapter interface and a `sessionStorage` adapter. `sessionStorage` holds about 5 MB per origin and per tab, throws when full, and is unavailable in some privacy modes.

## Decision

- The interface is small: `load(): string | null | Promise<string | null>`, `save(value: string): void | Promise<void>`, `remove(): void | Promise<void>`. The timeline serializes to a string itself, so an adapter can target `localStorage`, IndexedDB or a server without knowing the format.
- `createSessionStorageAdapter(key)` and `createLocalStorageAdapter(key)` share one implementation over the `Storage` interface. Every access is wrapped; a quota error calls `onError` and the timeline keeps working in memory.
- Format version 1, JSON: `{ format: 1, base, nodes, current, nextId, lastChildren }`. `base` is the state at the root. A node is `{ id, parent, label, at, forward, inverse }`. Checkpoints are not stored; they are rebuilt on load, which keeps the payload near the size of the patches. Pending entries are materialized before saving.
- Saving is debounced (default 250 ms after the last sealed entry) and flushed on `pagehide` and on store destroy.
- On load the payload is validated structurally. A payload that fails validation, or has an unknown format number, is ignored and removed, and `onError` is called.
- Rehydration modes: `'history-and-state'` (default) sets the tracked state to the stored current state and keeps the history, marked as a replay. `'history-if-state-matches'` keeps the stored history only when the stored current state equals the live tracked state (compared by JSON text), for apps that restore state some other way.
- `migrate?: (payload, fromFormat) => payload` is part of the options so that the stretch goal (typed migration of persisted history) has a place to land.

## Alternatives

- Persist full snapshots: simplest, and the size problem the project exists to avoid.
- Persist checkpoints too: faster load, bigger payload. Rebuilding costs one pass over the forward patches.
- Make the adapter responsible for serialization: more flexible, but every adapter would need to re-implement validation.

## Consequences

- State has to be JSON-safe to persist. The docs and a runtime check in development mode say so.
- A history that was saved by a different store shape is dropped rather than applied to the wrong state.
