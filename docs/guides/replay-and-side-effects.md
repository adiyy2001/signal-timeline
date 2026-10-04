# Replay and side effects

Undo, redo and `jumpTo` change the store with `patchState`. Everything that listens to the store sees those writes as ordinary changes. If an `effect` saves the document to a server, undoing a rectangle sends a save. If an `rxMethod` logs an analytics event, an undo logs it again. Time travel should not run any of that.

## Why a flag is not enough

The obvious fix is a boolean that is true while the timeline writes the state. It works for `watchState` callbacks, because they run synchronously inside `patchState`. It fails for effects. An Angular `effect` does not run inside `patchState`. It runs later, in the next change detection pass, and by then the boolean is already false again.

## What the library does

Each timeline keeps a replay window. The window opens before the writes of an undo, redo, jump or rehydration. It closes after the next render, through `afterNextRender`, which Angular runs at the end of the pass that flushed the effects the replay scheduled. Where there is no render (a server, a test that never ticks), a microtask closes it.

While the window is open, `store.isReplaying()` is true. The recorder never records replay writes, so history does not grow while you move through it.

A live change made while the window is open (a click in the same tick as an undo) closes it at once. The effect that follows sees live state and does its work, which matches what the user did last.

## Using it

Do not read `isReplaying` as a dependency of an effect. The effect would run again when the window closes, on the replayed state, which is the bug you are avoiding. Use the helpers, which read it with `untracked`.

```ts
import { effect } from '@angular/core';
import { skipReplay } from 'signal-timeline';

effect(() => {
  const document = store.document();
  skipReplay(store, () => api.save(document));
});
```

`rxMethod` takes an operator.

```ts
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap } from 'rxjs';
import { ignoreReplays } from 'signal-timeline';

const saveDocument = rxMethod<Document>(
  pipe(ignoreReplays(store), switchMap((document) => api.save(document))),
);
```

`signalMethod` works like the effect: call `skipReplay` inside the callback. In a `watchState` callback read `store.isReplaying()` directly, since it runs synchronously.

## What is tested

The replay suite runs an `effect`, an `rxMethod`, a `signalMethod` and a `watchState` callback across an undo, a redo and a `jumpTo`, then across a live change, which must fire again. It runs in a zoneless TestBed and again with zone.js, on Angular 22 and on Angular 21. A negative control (the helpers replaced by pass-through code) makes the checks fail, so they are not vacuous. ADR 0007 has the design and the fallback I kept in reserve.

## Limits

- Start undo and redo from event handlers and methods. A replay started from inside an effect or a render hook registers its window closer for the render after the one that flushes its effects, so those effects are not skipped.
- An effect that already reacted to a replay write before you added `skipReplay` has nothing to do with this library. The helper only decides whether your own work runs.
- A reaction triggered by another signal after a replay is treated like any other. Only the work you wrap is skipped.
