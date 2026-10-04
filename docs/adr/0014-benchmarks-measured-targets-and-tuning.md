# 0014 Benchmarks, measured targets and tuning

Status: accepted, 2026-10-04

## Context

The brief sets two numeric targets: recording overhead under 0.1 ms per typical `patchState` on a state with 10,000 entities, and a history after 10,000 small edits at least 10 times smaller than full snapshots, measured as serialized size and as heap with `--expose-gc`. Milestone M3 only had a probe. M5 builds the real suites and tunes what they show.

## Method

- `pnpm bench` runs `bench/run.mjs` for Node and for Chromium (playwright-core, `--js-flags=--expose-gc --enable-precise-memory-info`). Results go to `bench/results/node.json` and `bench/results/chromium.json` with CPU, core count, memory, OS and engine version. `pnpm bench:report` turns them into `bench/results/summary.md`; the README takes numbers only from there. `pnpm bench:smoke` runs shortened versions of every suite and is part of the checks.
- Recording overhead is measured in interleaved pairs: each pair times the same `patchState` call on a plain store and on a store with the feature, back to back, in alternating order, and the report uses the median of the differences. The first attempt subtracted two separate runs and produced negative overheads, because the noise (garbage collection, the map copy of about 2.7 ms) is far larger than the effect.
- Heap is the retained size after a forced garbage collection, minus the same store without history. The snapshot baseline keeps one structurally shared state per edit, which is the fair comparison for a plain JS array of states.
- Hardware for every number below: Intel Core i7-12700H, 20 cores, 15 GB RAM, WSL2, Node 24.21.0, Chromium 153.

## Results

The tables below are from the first full run, when the tuning decisions were made. The full benchmark was run again on the final code, and `bench/results/summary.md` and the README carry those figures. They differ slightly (for example 0.005 ms instead of 0.012 ms for the synchronous overhead of `updateEntity`, and 16.6 ms and 58.3 ms instead of 8 ms and 41 ms for saving and loading 10,000 entries) because the laptop is shared and timings move between runs. The verdicts did not change.

Recording, 10,000 entities with string ids, Node, `updateEntity`:

| | before M5 | after M5 |
| --- | --- | --- |
| synchronous overhead on the `patchState` call (median) | 0.025 ms (subtraction method) | 0.012 ms (paired) |
| mean, p90 | not measured | -0.010 ms, 0.224 ms |
| patches computed afterwards | 3.3 ms in total | 1.15 ms in total |
| the store's own update | 2.7 ms | 2.7 ms |

The 0.1 ms target is met on the synchronous path: median 0.012 ms for `updateEntity`, 0.003 ms for `addEntity`, 0.006 ms for `removeEntity`, 0.026 ms with the history full at `maxEntries` 100, 0.003 to 0.005 ms for small slice updates. It is not met for everything the user waits for. Computing the patch of one entity update in a 10,000 entity map costs 1.15 ms, and 7.6 ms at 50,000 entities, because a diff has to look at every key; that work runs in a microtask after the call, it is not hidden. A transaction of ten updates costs 1.3 ms synchronously, because the commit diffs once. The p90 of the paired difference is 0.2 ms: about one call in ten pays for a garbage collection triggered by the extra references. Chromium rounds timers to 0.1 ms in this setup and reads zero for the median; the Node numbers are the precise ones.

History size after 10,000 edits (about 70 percent entity moves, 20 percent counter, 10 percent view zoom), `checkpointEvery` 250:

| entities | serialized ratio | heap, history | heap, snapshots | heap ratio |
| --- | --- | --- | --- | --- |
| 100 | 23.4 | 11.4 MB | 6.7 MB | 0.6 |
| 1,000 | 235 | 11.9 MB | 54.8 MB | 4.6 |
| 10,000 | 2,006 | 26.6 MB | 2,627 MB | 98.7 |

The serialized target is met at every size. The heap target is met only at 10,000 entities. At 100 and 1,000 entities the history costs more heap than structurally shared snapshots, because every entry holds about 1.1 KB (node, two patches, path strings, label, children array) and a snapshot of a small state shares nearly everything. Reaching 10 times at 1,000 entities would need under 0.55 KB per entry, which plain JS objects do not allow without a packed format. Chromium gives the same ratios (0.5, 4.4, 96.4).

Navigation, 10,000 entries over 1,000 entities, p50:

| | before | after |
| --- | --- | --- |
| undo | 0.019 ms | 0.019 ms |
| redo | 0.002 ms | 0.002 ms |
| jump to a random entry, `checkpointEvery` 50 | 3.46 ms | 0.51 ms |
| jump to a random entry, `checkpointEvery` 250 | 18.6 ms | 0.63 ms |
| jump to the initial state | 0.52 ms | 0.52 ms |

On 10,000 entities with 3,000 entries a jump costs 2.9 ms, which is the copy of the entity map that applying any patch to it needs (3 ms in the apply benchmark). Loading a persisted history of 10,000 entries takes 41 ms in Node (27 ms in Chromium); saving takes 8 ms.

Diff of a 10,000 entity map with string keys, one change: 3.7 ms before, 1.95 ms after; integer keys 1.6 ms before, 0.31 ms after.

## Decisions

- Batched replay: a jump concatenates the operations of all steps on its route and applies them once, so the map is copied once per jump instead of once per entry. This is the source of the jump improvement.
- Lazy root on `maxEntries` pruning: advancing the root records the patch that leads to the new root and resolves the state after 256 advances or when it is read (`LaggingState`). A full history at the limit no longer pays a patch application per edit.
- One pass `diffObjects` with a key cache: objects with 128 keys or more keep their key list in a `WeakMap`, consumed when the object is used as the `before` side, so the next diff does not enumerate the same map twice. Path strings are built only for keys that changed.
- `load()` restores history by routes: state is materialized only at checkpoints, the current entry, branch points and leaves.
- Default `checkpointEvery` is 250 (was 50). Jump latency is flat between 25 and 250 (0.47 to 0.63 ms) and grows to 1.05 ms at 1,000. Heap at 10,000 entities and 3,000 entries is 48.6 MB at 25, 26.1 MB at 50, 14.8 MB at 100 and 8.1 MB at 250. Applications with very large states can set a larger value.
- `pendingLimit` stays 64 (ADR 0006). A burst of 2,000 edits on 1,000 entities costs 0.36 ms per edit at limit 0, 0.34 ms at 64, 0.33 ms at 256 and 0.25 ms at 1,024, while the entries waiting for their patches hold 0, 0.25, 1 and 4.8 MB. The gain at 64 is small, and a larger limit holds more memory and lets a burst run longer before any patch exists.
- Not changed: `entries()` is recomputed per change and costs 0.26 ms p50 after an edit at 1,000 entities (the README states that it is O(n)); whole-history serialization per save stays (ADR 0010).

## Alternatives

- Hide the diff cost completely with a Proxy or immer-style draft: rejected in ADR 0006, it changes how state is written.
- A packed binary history format to reach 10 times on small states: more code and a format version for a target that is about heap, not about persistence.
- Keep checkpoint 50: faster jumps by 0.1 ms at the cost of 3 times the heap on large states.

## Consequences

- The README states the verdicts as measured: the synchronous recording target is met, patch computation adds 1.2 ms at 10,000 entities and grows linearly, the serialized size target is met everywhere, the heap target only for large states.
- Every number in the README is copied from `bench/results/summary.md`; a bench change means regenerating it.
- `playwright-core` 1.63.0 (Apache-2.0) is a development dependency for the Chromium run and goes into `CREDITS.md`.
