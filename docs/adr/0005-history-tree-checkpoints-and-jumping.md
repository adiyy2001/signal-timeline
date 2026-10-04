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
- A checkpoint is added whenever a node's depth is a multiple of `checkpointEvery` (default decided by the benchmarks in M5, starting at 50). Checkpoints are references, so on a state with structural sharing they cost only the objects that changed since the previous one.
- `maxEntries` counts non-root nodes. When it is exceeded the engine removes leaves that are not on the root to current path, oldest first. If every leaf is on that path (a linear history), it advances the root: the first node on the path becomes the new root, its checkpoint is built, and the other subtrees of the old root are dropped.
- Invariants checked by tests after every operation: one parent per node, a single root, no cycles, the current pointer exists, every checkpoint equals the state reached by replaying from the root.

## Alternatives

- A flat array of entries with an index (linear undo): cannot branch.
- Storing a full snapshot per node: simple, and exactly the memory cost the project is meant to avoid.
- Recomputing everything from the root on every jump: correct but slow on long histories.

## Consequences

- Undo and redo cost one patch application. Jumps cost at most the path length or one checkpoint interval, whichever is smaller.
- Pruning can drop whole branches, and the docs must say so.
