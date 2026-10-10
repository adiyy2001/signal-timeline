# 0009 Timeline groups as a composite state

Status: accepted, 2026-10-04

## Context

`provideTimelineGroup()` lets several stores share one timeline, so one undo reverts an action that touched several stores. The engine from ADR 0005 works on one tracked state. Something has to say which changes belong to one action.

## Decision

- A group owns one engine whose tracked state is a record keyed by store key: `{ shapes: <slice>, layout: <slice> }`. Patch paths start with the store key (`/shapes/entityMap/s1/x`). The engine does not know about groups.
- Each store that joins (`withTimeline({ group: true, storeKey: 'shapes' })`) injects the group, reports its changes as `record(storeKey, beforeSlice, afterSlice)`, and applies the slice of a replay target to itself with `patchState`. A store key is required in a group and must be unique, because persisted history is addressed by it.
- One action is one explicit `group.transaction(label, fn)`. A store's own `transaction` inside a group delegates to the group. Changes outside a transaction become one entry each, as with a single store.
- Everything a store offers about the timeline (`undo`, `redo`, `jumpTo`, `canUndo`, `entries`, `isReplaying`) works on the shared timeline when the store is in a group. The group offers the same API, and the devtools component accepts either.
- A replay writes the stores in the order they joined. The replay window (ADR 0007) is shared, so the stores report `isReplaying` together.

## Alternatives

- Merge changes from different stores that happen in the same synchronous turn automatically: surprising, because two unrelated updates in one tick would undo together.
- A separate engine per store with a coordinator that links entries by id: needs a second structure to keep the trees consistent, which the composite state avoids.
- One timeline per store only: it cannot undo an action that touched several stores.

## Consequences

- Entries in a group show which stores they touched, derived from the first path segment of the patch.
- The hot path stays O(number of stores) because the composite is rebuilt by shallow copy.
- A store that joins late starts at its current state; history before it joined does not include it. The docs say so.

## Decisions made while building groups

- The group is a class, `TimelineGroup`, built by `provideTimelineGroup(options)` with a factory provider. It reuses the store runtime over the composite state, so undo, redo, jump, transactions, coalescing and signals behave exactly as in one store. A member store gets the group runtime as its own, so its `undo` and `transaction` are the group's.
- The limits belong to the group: `maxEntries`, `checkpointEvery`, `coalesce.windowMs` and `persistence` are options of `provideTimelineGroup`, and a member store that passes them throws a `TimelineError`. The types forbid them too. A member can still set `label`, `coalesce.key`, `track` and `skip`.
- A store that joins late: the engine adds the store key to the current state and to every checkpoint and pending entry, with the store's slice at join time. History before the join therefore treats that slice as constant, and undoing past the join leaves the store at its join time state, whichever way the engine reaches the target (patches or a checkpoint). Without that step a jump through a checkpoint and a jump through patches would disagree.
- Group persistence needs `stores`, the list of store keys. The history is restored once all of them have joined, and nothing is saved before that, so a partial group cannot overwrite a complete saved history. A store with a key outside the list is rejected.
- A destroyed store leaves the group: it is no longer written to, and its key is retired. Joining again with the same key throws, because the old history refers to a slice the new store never had.
- Replay writes every store in join order, collecting errors instead of stopping at the first. If any store throws (a `watchState` callback that rejects the value, for example), the runtime writes the previous slices back to every store, moves the engine back to where it was and rethrows the first error. This is the same path a single store uses. The writes of the revert are best effort.
- Entries carry `changedKeys`, which in a group are the store keys the entry touched. The keys come from a reference comparison of the root slices at record time, so they are cheap, and they are persisted.
