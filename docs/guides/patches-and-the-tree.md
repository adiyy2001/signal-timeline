# Patches, the tree and checkpoints

This is the long version of the "How it works" section in the README. The decisions behind it are in ADRs 0004, 0005, 0006 and 0008.

## Patches

Each entry stores two RFC 6902 style patches: a forward patch that turns the parent state into the entry's state, and an inverse patch that turns it back. Only `add`, `remove` and `replace` are emitted. `move`, `copy` and `test` never appear.

The diff walks two states once. If `a === b` for a subtree, it skips the subtree, which is why a change to one entity does not cost a comparison of the other 9,999. Plain objects compare key by key. Arrays trim the common prefix and suffix by reference, then compare the middle element by element when the lengths match, and emit removes and adds otherwise. There is no move detection. A long array that is reordered produces a patch the size of the changed middle.

The inverse of a `replace` carries the old value, so a UI can show before and after from the patches alone. The inverse patch is the reversed list of per-operation inverses, and the devtools diff view relies on that to pair each row.

Applying a patch is immutable and copy on write. Each container on a changed path is copied once per call, so a patch with many operations on one entity map copies the map once. A failing operation throws `PatchError` and leaves the input unchanged. Keys named `__proto__`, `constructor` and `prototype` are written as own properties.

Operation values are references into the states, not clones. Structural sharing is what keeps a patch small, and it is also why state has to be treated as immutable.

## The tree

The engine is plain TypeScript with no Angular imports. It owns a tree of nodes. A node has an id, a parent, children, the child visited last, a label, a timestamp, the two patches and sometimes a checkpoint. The root is "Initial state" and always has a checkpoint.

Recording a change adds a node under the current node and makes it current. Nothing is deleted by recording, so a change after an undo starts a new branch and the old redo history stays reachable. `redo()` follows the branch visited last, and `redo(id)` picks one.

Ids are increasing integers and are never reused.

## Checkpoints and jumping

A checkpoint is a reference to the full tracked state at a node. One is kept at every node whose depth is a multiple of `checkpointEvery` (250 by default). On a state with structural sharing a checkpoint costs only the objects that changed since the previous one.

`jumpTo(target)` takes the cheaper of two routes. One walks up from the current node to the lowest common ancestor, applying inverse patches, and down again, applying forward patches. The other starts from the nearest checkpoint above the target and replays forward patches. With path length $d$ and checkpoint interval $k$, the cost is about $\min(d, k)$ patch applications. The operations of the whole route are concatenated and applied in one copy on write call, so a jump copies each touched map once.

## Pending entries

`patchState` is a free function, so the library cannot wrap it. It records through `watchState`, which runs synchronously after every call. Computing a diff there would scan a 10,000 key entity map on the hot path, so a new entry first keeps only the before and after references of the tracked slices. The patches are computed in a microtask, or on demand when something needs them (an undo, a jump, a save, the diff view). A burst of more than 64 pending entries is computed synchronously, so a loop of 10,000 edits cannot hold 10,000 copies of a map.

While an entry is pending, an undo sets the stored reference directly and applies no patch.

## Transactions and coalescing

`transaction(label, fn)` suppresses entries inside `fn` and compares the state at the start with the state at the end when `fn` returns. One net change makes exactly one entry. No net change makes none, because an empty entry only pollutes the tree. If `fn` throws, the state is restored to the start without recording and the error is rethrown. Transactions nest.

Coalescing merges changes into one open entry, by a time window (`windowMs`) or by a key. The entry keeps its first before state and moves its after state. A merged entry that ends where it started is removed when it is sealed, so a drag that returns to its starting point leaves nothing behind. `undo`, `redo`, `jumpTo`, a transaction, `endCoalescing` and the next change with another key seal the open entry.

## Pruning

`maxEntries` counts entries without the initial state. When it is exceeded the engine removes the oldest leaf that is not on the path from the root to the current entry. If every leaf is on that path (a linear history), the root advances by one entry and the other subtrees of the old root are dropped. Pruning can drop whole branches.
