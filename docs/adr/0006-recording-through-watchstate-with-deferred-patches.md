# 0006 Recording through watchState, with patches computed after the change

Status: accepted, 2026-10-04

## Context

`patchState` is a free function, so a store feature cannot wrap it. `watchState(store, watcher)` is public, runs synchronously after every `patchState` (once per call, however many updaters it got) and also once at registration. I read `@ngrx/signals` 21.1.1 and 22.0.1: the state-source code is the same in both apart from a small refactor.

The target is a recording overhead under 0.1 ms per typical `patchState` on a state with 10,000 entities. A throwaway script (Node 24.21.0, x64, WSL2, not for the README) shows why a naive eager diff cannot meet that:

- The store's own `updateEntity` copies the whole `entityMap` and `ids`: 3.9 ms with string ids such as `shape-123`, 11 microseconds with integer-like ids (V8 stores those as array elements).
- Finding the changed entity by comparing the two maps costs 1.1 to 1.5 ms with string ids and 0.16 to 0.5 ms with integer-like ids, in the best loop I tried. A diff of the root keys alone costs 0.3 microseconds.

So any diff that scans a 10,000 key map is above the target by an order of magnitude. Only an O(1) hot path can reach it.

## Decision

- Recording keeps two things per change: references to the tracked slices before and after (`pending`). That is O(number of root keys). The entry exists, with its label, immediately, so `entries`, `canUndo` and the rest are correct right after `patchState`.
- The patches are computed after the change: sealed entries are scheduled with `queueMicrotask`, in one batch, and a pending entry is also materialized on demand by `undo`, `jumpTo`, persistence and the diff view. When an entry is materialized it drops its before and after references. A burst of more than a fixed number of pending entries (default 64) is materialized synchronously, so a loop of 10,000 edits cannot hold 10,000 copies of the entity map.
- While a pending entry exists, undo and redo set the stored reference directly and apply no patch.
- The watcher keeps the last seen tracked slices. It records only keys in the tracked set (`track` or everything minus `skip`) whose reference changed.
- The benchmark reports two numbers per scenario: the synchronous overhead on the `patchState` call, and the total cost including materialization. The README states both, with the hardware.

## Alternatives

- Eager diff in the watcher: simple, but 100 to 1,000 times over the target on 10,000 entities.
- Wrap or replace `patchState` with a `store.patch` method that knows the changed ids: fast, but users would have to stop using `patchState` and the NgRx entity updaters.
- Record state snapshots only: constant time, but memory grows with the state size per change, which is what the project avoids.

## Consequences

- The hot path is cheap. The total CPU cost still exists; it moves to a microtask. The benchmark shows whether it fits the frame budget on large states, and the README says so plainly.
- The engine needs a "pending" node state with its own tests: undo before materialization, materialization after coalescing, and persistence of pending entries.

## Early probe (not the final suite)

`bench/probe.ts`, run with `pnpm bench:probe` (production flags, Node 24.21.0, Intel Core i7-12700H, 20 cores, WSL2, state of 10,000 entities with string ids). Overhead is the mean of the timeline task minus the mean of the same update on a store without the feature.

- Update of one small slice: 2 to 5 microseconds for the synchronous part, 3 to 5 microseconds including the patches.
- Update of one entity in the 10,000 entity map: the update itself takes 2.7 to 3.8 ms. The synchronous overhead was 0.12 to 0.37 ms across three runs, so the 0.1 ms target is missed on this path and the noise is as large as the effect. Including the patches the overhead was 3.0 to 4.7 ms, almost all of it the diff of the two entity maps.
- The code on the hot path is O(root keys), and the small slice number shows it. The extra cost on the entity map is most likely garbage collection pressure from keeping the before and after maps alive until the patch exists, which the heap measurements had to confirm.

Superseded: the probe script is removed and the numbers come from `pnpm bench` with interleaved pairs, see ADR 0014. The suspicion above was wrong in one respect: the synchronous overhead on the entity path is 0.012 ms median in Node, and the earlier 0.12 to 0.37 ms was subtraction noise between two separate runs.

## Development check

In development mode the recorder checks the forward patch of each recorded entry for values that are not plain data (class instances, functions, symbols, bigints) and warns once per root key. Scanning the slices on every change would add a scan of 10,000 entities to the hot path, so the check works on the patch, in the microtask that computes it. `undefined` is accepted: it is atomic for the diff, and only persistence drops it.

