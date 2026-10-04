# 0008 Transactions and coalescing

Status: accepted, 2026-10-04

## Context

`transaction(label, fn)` must turn several `patchState` calls into one entry. Coalescing must merge changes within N milliseconds or by a key, for example one entry per drag. The brief says a transaction "always creates exactly one entry".

## Decision

Transactions:

- Inside `fn`, the watcher keeps recording the tracked state but creates no entries. When `fn` returns, the engine compares the state at the start with the state at the end and creates one entry labelled `label`.
- If nothing changed, no entry is created. An empty entry would pollute the undo stack and the tree. The property test reads: a transaction with a net change creates exactly one entry, and one without a net change creates none. The README states the rule.
- Transactions nest. An inner transaction joins the outer one.
- If `fn` throws, the tracked state is restored to the start without recording, and the error is rethrown. An async `fn` is not supported; the type returns `void`.

Coalescing:

- `coalesce.windowMs`: a change within `windowMs` of the previous change of the same open entry merges into it. The entry's `before` stays, its `after` moves, its timestamp moves.
- `coalesce.key`: a function from the change (`changedKeys`, `before`, `after`) to a string or `undefined`. Consecutive changes with the same defined key merge. A different key, `undefined`, an undo, a redo, a jump or a transaction seals the entry.
- A method `coalesce(key, fn)` on the store gives the same effect without reading the state: everything inside `fn` merges under `key`. The demo uses it for drags. A gesture that spans several event handlers uses `beginCoalescing(key)` and `endCoalescing()`.
- An entry that is still open keeps its pending references (ADR 0006) until it is sealed, so merging never needs a patch to be recomputed.

## Alternatives

- Create an empty entry for an empty transaction: matches the brief word for word and is useless in practice.
- Keep the changes of a failed transaction: leaves the store in a state no one asked for.
- Time-based coalescing only: a slow drag splits into several entries.

## Consequences

- The rule about empty transactions is a refinement of the brief. It is recorded here and in the README limitations, not hidden.
- The engine has an "open entry" concept with a timer, which tests drive with fake timers.
