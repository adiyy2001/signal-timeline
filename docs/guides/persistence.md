# Persistence

History can survive a reload. Pass an adapter in the options and the timeline saves itself and restores itself.

```ts
import { createSessionStorageAdapter, withTimeline } from 'signal-timeline';

withTimeline({
  persistence: { adapter: createSessionStorageAdapter('editor-history') },
});
```

## Adapters

An adapter moves text. It has `load`, `save` and `remove`, and each may return a promise. The timeline serializes itself, so the same adapter shape fits `localStorage`, IndexedDB or a server. The library ships `createSessionStorageAdapter(key)` and `createLocalStorageAdapter(key)`.

`sessionStorage` holds about 5 MB per origin and per tab, and it throws when it is full. A failed save goes to `onError`, or to `console.warn` when you gave none, and the timeline keeps working in memory.

## Format

Version 1 is JSON: `{ format, keys, root, nodes, currentId, nextId }`. The root is the state at the start of the history. Each node holds its parent, label, timestamp, forward patch, inverse patch and the keys it changed. Checkpoints are not stored. They are rebuilt on load, so the payload stays close to the size of the patches.

Saving is debounced (250 ms by default) and flushed on `pagehide` and when the store is destroyed. Every save writes the whole history, so the cost grows with the history and not with the last change. The benchmark results (`bench/results/summary.md`, section "Saving and loading the whole history") give the measured time for 1,000 and 10,000 entries.

## Rehydration

`history-and-state` is the default. The stored current state is written to the store and the history is kept. The write is a replay, so `isReplaying` is true until the next render and effects guarded with `skipReplay` do not fire for the restore.

`history-if-state-matches` keeps the stored history only when its current state equals the live state the store has now. Use it when the app restores its state some other way, for example from a server.

A payload that fails validation is ignored, removed and reported through `onError`. That includes a payload saved for other tracked keys, so changing the shape of the tracked state drops old histories instead of applying them to the wrong state. Validation checks the structure and replays every forward patch while loading, so a patch that does not apply rejects the payload. It does not check that an inverse patch really inverts its forward patch. A payload edited by hand can make an undo land on a wrong state. The storage belongs to the app, so I did not defend against that.

## Migration

`migrate(payload, fromFormat)` is called only when the stored format number is not the current one. Its result must declare the current format and goes through the same validation. Nothing more typed than that exists yet.

## State has to be JSON-safe

`undefined` object values and `undefined` operation values are lost in JSON. Dates, Maps and class instances are not supported in persisted state. In development mode the recorder warns once per root key when a recorded value is not plain data.

## Asynchronous adapters

A slow load is applied only if nothing was recorded in the meantime, and nothing is saved before the load finished, so a slow adapter cannot overwrite the history it is about to read. A user change that wins the race drops the stored history. ADR 0010 has the details.
