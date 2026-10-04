# Sharing a timeline between stores

`provideTimelineGroup()` gives several stores one history. One `undo` reverts an action that touched all of them.

```ts
import { provideTimelineGroup, withTimeline } from 'signal-timeline';

export const appConfig = {
  providers: [provideTimelineGroup()],
};

export const ShapesStore = signalStore(
  { providedIn: 'root' },
  withState({ shapes: [] as Shape[] }),
  withTimeline({ group: true, storeKey: 'shapes' }),
);

export const LayoutStore = signalStore(
  { providedIn: 'root' },
  withState({ columns: 2 }),
  withTimeline({ group: true, storeKey: 'layout' }),
);
```

Inject `TimelineGroup` for the shared API. A member store also exposes `undo`, `redo`, `jumpTo`, `entries` and the rest, and they act on the shared history.

## What counts as one action

An explicit `group.transaction(label, fn)`. A store's own `transaction` inside a group delegates to the group. Changes made outside a transaction become one entry each, the same as with a single store. I did not merge changes from different stores that happen in one synchronous turn. Two unrelated updates in one tick would then undo together, which is a surprise nobody asked for.

```ts
group.transaction('Move shape and widen layout', () => {
  shapes.moveShape('s1', 40, 0);
  layout.setColumns(3);
});
group.undo();
```

## How it is stored

The group owns one engine whose tracked state is a record keyed by store key, so patch paths start with the store key (`/shapes/entityMap/s1/x`). The engine does not know about groups. An entry carries `changedKeys`, which in a group are the store keys it touched, and the devtools panel shows them.

## Rules

- A store key is required and must be unique. Keep it stable between releases, because saved history is addressed by it.
- `maxEntries`, `checkpointEvery`, `coalesce.windowMs` and `persistence` belong to the group. A member that sets one throws, and the types forbid it. A member can still set `label`, `coalesce.key`, `track` and `skip`.
- Group persistence needs the list of store keys: `provideTimelineGroup({ persistence, stores: ['shapes', 'layout'] })`. History is restored once all of them have joined, and nothing is saved before that, so a partial group cannot overwrite a complete saved history.
- A store that joins late starts at its current state. History before the join treats its slice as constant, and undoing past the join leaves the store at its join time state.
- A destroyed store leaves the group and its key is retired. Joining again with the same key throws.
- A replay writes the stores in the order they joined and reports `isReplaying` for all of them together. If one store throws during a replay (a `watchState` callback that rejects a value, for example), every store is written back to its previous slice and the first error is rethrown.

ADR 0009 has the reasoning.
