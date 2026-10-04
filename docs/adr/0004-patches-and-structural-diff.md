# 0004 Patches and the structural diff

Status: accepted, 2026-10-04

## Context

History is stored as forward and inverse patches in the style of RFC 6902 (JSON Patch). The diff must skip unchanged subtrees by reference equality, because the state comes from `patchState` and is immutable by convention, and a deep compare of a 10,000 entity map on every change would defeat the point.

RFC 6902 (rfc-editor.org) defines `add`, `remove`, `replace`, `move`, `copy` and `test`, with JSON Pointer paths, `-` for appending to an array, and an empty path for the whole document.

## Decision

- Own implementation in `projects/signal-timeline/src/core`: `json-pointer`, `diff`, `apply`. No runtime dependency.
- A patch is a readonly array of `add | remove | replace` operations. `move`, `copy` and `test` are never emitted. Pointer segments escape `~` and `/` as `~0` and `~1`.
- Operation values are references into the states, not clones. Structural sharing keeps a patch small.
- `diffPair(before, after)` walks once and returns both the forward and the inverse patch. The inverse of `replace` carries the old value, so a UI can show before and after without holding any state.
- Diff rules: `a === b` skips the subtree. Plain objects are compared key by key. Arrays: trim the common prefix and suffix by reference, then compare the middle element by element when the lengths match, otherwise emit removes (from the end) and adds (from the start). There is no move detection; entity `ids` arrays change at the ends or at one index, so the cheap rule fits the real case. `Date`, `Map`, `Set` and class instances are atomic leaves and are replaced as a whole.
- `applyPatch` is immutable and copy-on-write: each container on a changed path is copied once per call (tracked in a set of containers the call owns), so a patch with many operations on one entity map copies the map once. Untouched branches keep their identity. A failing operation throws `PatchError` and leaves the input unchanged. Keys named `__proto__`, `constructor` and `prototype` are written with own-property definitions.
- `rfc6902` 5.3.0 (MIT, released 2026-07-23) is a dev dependency used as an oracle in tests: it applies our patches to a deep clone and the result must equal ours.

## Alternatives

- `rfc6902` or `fast-json-patch` at runtime: both mutate in place and compare deeply without reference skipping. `fast-json-patch` last released in 2022.
- Immer patches: they need drafts, and the state here is produced by `patchState`, not by Immer.
- `jsondiffpatch`: its own delta format, not RFC 6902.

## Consequences

- State has to be treated as immutable plain data. `undefined` values work in memory and disappear in JSON, so persistence needs JSON-safe state, and the docs say so.
- Reordering a long array produces a patch of the size of the changed middle. That is a known limit and goes into the README.
