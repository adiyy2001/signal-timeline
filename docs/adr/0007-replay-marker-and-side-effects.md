# 0007 Replay marker and side effects

Status: accepted, 2026-10-04. The mechanism is validated by a spike test at the start of milestone M3; if the test fails, the fallback below replaces it and this record is updated.

## Context

Undo, redo and time travel write the store with `patchState`. Anything that listens to state sees those writes as ordinary changes: an `effect` that saves to a server, an `rxMethod` that fires a request, a `watchState` callback. Replaying history must not re-run them.

A flag that is true only while `patchState` runs is not enough. Angular effects do not run inside `patchState`. They run later, in the next change detection tick, when the flag would already be false.

## Decision

- Each timeline has two separate things. A synchronous guard is set around the writes of an undo, redo, jump or rehydration, and the watcher uses it to avoid recording them. The replay window is a counter that is incremented before those writes and decremented when the window closes.
- The window closes after the next render: the feature calls `afterNextRender` with the store's injector, which Angular runs at the end of the tick that flushes the effects the replay scheduled. Where no render happens (server, tests that do not tick), a microtask closes it. In unit tests, `TestBed.tick()` flushes the effects and the hooks.
- `isReplaying` is a read-only signal for UI. It is true during the window.
- Side-effect code does not read `isReplaying` as a dependency. The helpers read it with `untracked`: `skipReplay(store, fn)` wraps a callback, `ignoreReplays(store)` is an RxJS operator for `rxMethod` pipes, and the docs show an `effect` and a `signalMethod`. Reading it as a dependency would make the effect run again when the window closes, on the replayed state, which is the bug.
- `watchState` consumers run synchronously, so `store.isReplaying()` is already true when they are called.
- A live change that is recorded while a window is open (a user action in the same tick as an undo) closes the window at once. The effect that runs afterwards sees the live state and its side effect fires, which is what the user did last.

## Fallback

If the spike shows that the window cannot be closed reliably after the effect flush on both Angular lines, the helpers use a provenance stamp instead: every state change is tagged `live` or `replay`, and the helper skips when the latest change is tagged `replay`. The cost is that a reaction triggered by another signal after a replay is skipped until the next live change, and the docs must name that limit.

## Alternatives

- A boolean set around `patchState`: wrong for effects, as above.
- Asking users to guard every effect by comparing state to the previous value: pushes the problem onto every caller.
- Running replays inside `untracked` or outside the injection context: does not change what effects see.

## Consequences

- The tests must cover an `effect`, an `rxMethod`, a `signalMethod` and a `watchState` callback, each across an undo, a redo and a jump, and then across a live change, which must fire again.
- The window length depends on the render cycle, so zoneless and zone-based apps both have a test.
