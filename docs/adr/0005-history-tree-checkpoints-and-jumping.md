# 0005 History tree, checkpoints and jumping

Status: accepted, 2026-10-04

## Context

A change after an undo must start a branch and keep the redo history, like Vim's undo tree. `jumpTo(entryId)` must stay fast on long histories, and the brief wants a full checkpoint every N entries.

## Decision

- The engine (`core/engine.ts`, plain TypeScript, no Angular) owns a tree of nodes. Each node has an id, a parent id, child ids, a label, a timestamp, a forward patch, an inverse patch and optionally a checkpoint (a reference to the full tracked state at that node). The root is a pseudo entry labelled "Initial state" and always holds a checkpoint, so `jumpTo(root)` goes back to the start.
- Ids are increasing integers, never reused, and persisted with the tree.
- Each node remembers its last visited child. `redo()` follows it. `redo(childId)` picks a branch.
- A change records a node whose parent is the current node, makes it current, and makes it the last visited child of its parent. Nothing is ever deleted by recording.
- Moving to a target: walk from the current node up to the lowest common ancestor applying inverse patches, then down applying forward patches. When that path is longer than the checkpoint interval, start from the nearest checkpoint on the root to target path and replay forward patches, which is at most one interval.
- A checkpoint is added whenever a node's depth is a multiple of `checkpointEvery` (default 250, chosen from the M5 benchmarks, see ADR 0014). Checkpoints are references, so on a state with structural sharing they cost only the objects that changed since the previous one.
- `maxEntries` counts non-root nodes. When it is exceeded the engine removes leaves that are not on the root to current path, oldest first. If every leaf is on that path (a linear history), it advances the root: the first node on the path becomes the new root, its checkpoint is built, and the other subtrees of the old root are dropped.
- Invariants checked by tests after every operation: one parent per node, a single root, no cycles, the current pointer exists, every checkpoint equals the state reached by replaying from the root.

## Alternatives

- A flat array of entries with an index (linear undo): cannot branch.
- Storing a full snapshot per node: simple, and exactly the memory cost the project is meant to avoid.
- Recomputing everything from the root on every jump: correct but slow on long histories.

## Consequences

- Undo and redo cost one patch application. Jumps cost at most the path length or one checkpoint interval, whichever is smaller.
- Pruning can drop whole branches, and the docs must say so.
- A jump costs the cheaper of two routes: walking up to the lowest common ancestor and down, or replaying from the nearest checkpoint above the target. Entries that are still pending are stepped over by their stored references, so a jump over them applies no patch.
- Depths are never renumbered. After the root advances, checkpoint positions still follow the original depth, and the new root always holds a checkpoint.
- `snapshot()` stores the root state and the patches of every entry, not the checkpoints. `restore()` replays the tree once to rebuild them and throws `SnapshotError` for a missing parent, a duplicate id, a patch that does not apply or a bad pointer.
- The store reports `depth` relative to the current root (`engine.rootDepth` is subtracted), because the exposed value means steps from the initial state. A property test over persisted history caught the first version, which showed the stale absolute depth after the root had advanced. A restored engine numbers depths from its own root, so its checkpoints sit at multiples of the interval counted from there.
