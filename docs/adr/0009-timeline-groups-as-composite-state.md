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
- One timeline per store only: fails the brief.

## Consequences

- Entries in a group show which stores they touched, derived from the first path segment of the patch.
- The hot path stays O(number of stores) because the composite is rebuilt by shallow copy.
- A store that joins late starts at its current state; history before it joined does not include it. The docs say so.
