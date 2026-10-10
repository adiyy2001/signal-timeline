# 0016 Prior art and how the README compares

Status: accepted, 2026-10-04

## Context

What other libraries offer had to be checked before writing anything, and the prior art has to be credited accurately. Linear undo for SignalStore already exists, so the README must say what this project adds and must not claim more than I verified.

## What I checked

Read from the npm registry and from the published tarballs on 2026-10-04.

- `@ngrx-toolkit/core` 22.0.1 (renamed from `@angular-architects/ngrx-toolkit` at v22, MIT). `withUndoRedo` keeps an undo stack and a redo stack of snapshots of the tracked keys (by default the entity keys, `selectedIds` and `filter`, plus `keys`). Options are `maxStackSize`, `collections`, `keys` and `skip`. A candidate is compared with the last record through `JSON.stringify`. A new change clears the redo stack. It has no branches, no transactions, no history across stores and no patches.
- `signalstory` 22.0.0 (MIT). Its own store classes, not SignalStore (its only peers are Angular). `trackHistory(50, store1, store2)` spans several stores and has `beginTransaction` and `endTransaction`.
- `ngrx-wieder` 17.0.0 (MIT). Undo and redo for the classic NgRx Store, built on Immer patches.
- `zundo` 2.3.0 (MIT). Undo and redo middleware for Zustand.

## One claim I tested instead of assuming

Reading the compiled source of `withUndoRedo` 22.0.1, the stack limit looked inert: the code clears the redo stack and then tests whether the redo stack is longer than `maxStackSize`, and it calls `unshift()` without an argument. `tools/prior-art-check.mjs` downloads that exact version, runs it in a real application with `maxStackSize: 3`, makes 20 edits and undoes until `canUndo` is false. It took 20 undos. The README states that result with the version number and says nothing broader. The script takes another package spec as an argument, so the claim can be re-checked against a newer release.

## Decision

- The README has a short comparison with the three closest projects, limited to facts above, and names the version each fact comes from.
- The positioning: the project picks up where linear undo stops. A branching tree, transactions, history across several stores and time travel that does not re-fire side effects. It does not claim to be faster or smaller than any of them, because I did not benchmark them.
- Nothing is copied from any of these projects. CREDITS.md lists them under prior art.

## Alternatives

- Leave the comparison out: less to get wrong, but a reader who knows `withUndoRedo` would ask the question in the first minute.
- Benchmark the competitors: their snapshots are of different keys and their features differ, so a fair benchmark would take its own project.

## Consequences

- The comparison ages. The versions are in the text, and the script is there to repeat the one check that is not a matter of reading.
- I have not reported the finding about `maxStackSize` upstream yet. `pnpm prior-art` reproduces it.
