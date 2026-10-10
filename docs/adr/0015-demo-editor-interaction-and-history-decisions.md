# 0015 Demo editor: interaction, history and test decisions

Status: accepted, 2026-10-04

## Context

The demo is a vector editor with rectangles, ellipses and connectors, built on `withEntities` and `withTimeline`, with the devtools panel beside it. It has to prove the packaging (it imports the built library), show every feature of the library in the production build, and pass keyboard, axe and Lighthouse checks. This record lists the choices that were not obvious.

## Decision

Library and build:

- The app imports `signal-timeline` and `signal-timeline/devtools` through `paths` in `projects/demo/tsconfig.app.json` that point at `dist/signal-timeline`, so the production build compiles the partial output of ng-packagr and the exports map is the real one. The unit test config maps both names to the source instead, so tests do not need a build. `tools/typecheck.mjs` builds the library first when `dist` is missing.
- The demo is served from the root of its own host, `signal-timeline.adrianturbinski.pl`, through GitHub Pages with a custom domain. The production build therefore keeps the base href `/`, and `tools/build-site.mjs` writes `site/CNAME` and fails when `site/index.html` has another base. The e2e runner, the Lighthouse run and the demo recording serve `dist/demo/browser` at `/` with a small sirv server (`tools/serve-demo.mjs`), which is the layout Pages publishes.

State and history:

- Shapes and connectors are two named `withEntities` collections. Selection and the active tool are state keys listed in `skip`, so they never create entries. Ids come from an injectable generator (random in the app, a counter in tests), so an id is never reused on another branch.
- Persistence uses the session storage adapter, so a reload keeps the drawing and the whole tree. A "Clear history" button calls `clear()` and keeps the drawing.
- Labels come from one pure function over the before and after state (`describeChange`): add, delete, move, resize, recolor, connector. A delete is a `transaction` of two writes (the connectors, then the shape), labelled with the count of connectors it took along, and one undo restores both.
- A pointer drag or resize is a gesture: `beginCoalescing` on pointer down, `endCoalescing` on pointer up or cancel. It has no time limit, so holding still in the middle of a drag does not split it. A drag that ends where it started leaves no entry (ADR 0008).
- Keyboard moves, plus and minus resizing, the inspector fields and the color swatches have no gesture. They merge through `coalesce.key` (`adjustmentKey`: move, resize or recolor of one shape) and the demo closes the open entry from a 600 ms idle timer. `windowMs` is not used, because it would also merge an add with the connector drawn right after it. Every other write has a different or no key, so it seals the open entry by itself. A first version kept a gesture open for 600 ms after each key press, and an edit made inside that window was swallowed by the key press entry; the Cypress keyboard run found it, and the store test "keeps a key press run apart from a different edit" keeps it fixed.
- The autosave counter is an `effect` over the two entity maps that increments only inside `skipReplay`. It reads the map references, so selection changes do not count, and it does not count undo, redo or a jump.

Interaction and accessibility:

- The canvas is one `svg` with `role="group"`. Each shape and connector is a `g` with `role="button"`, `tabindex="0"`, an `aria-label` that carries name, color and geometry, and `aria-pressed` for selection. Focus selects in the select tool. Enter and Space select (or pick the end of a connector), arrow keys move by 10 (Shift: 2), plus and minus resize, Delete removes, Escape cancels. Resize handles are for the pointer only; the inspector fields and the keys are the keyboard route.
- No single character shortcuts. WCAG 2.1.4 asks for a way to turn them off or remap them, and the toolbar buttons are enough. Undo and redo use Ctrl or Cmd with Z, Shift+Z and Y, and the hints are printed on the buttons.
- Pointer moves are tracked on `window` between pointer down and up instead of with pointer capture, so a drag that leaves the canvas still ends and synthetic events in tests work. Shapes under the pointer come from `hitTest` over the geometry, not from the DOM target, so the same code path serves tests and users.
- State is never carried by color alone: the pressed tool has a heavier border and an inner bar, a selected shape has a dashed box and handles, a selected connector is dashed, the pending connector start has a dashed heavy outline, the current swatch has a check mark, and the swatches carry their names. Forced colors map shapes to `Canvas` and `CanvasText`.
- Theme: `auto`, `light` or `dark` through `data-theme` on the root, the same tokens as the devtools panel, remembered in `localStorage` with a try and catch.

Tests:

- Unit: geometry (resize from each corner, minimum size, world border, hit testing, connector routing), labels and keys, the store (draw, edit, gestures with fake timers, delete in one entry, branch, reload), the autosave counter, every component through TestBed with synthetic pointer and key events.
- Cypress runs against the production build in Chrome: draw, undo, branch, scrub, tree keys, reload, autosave, keyboard only, axe in five states, no horizontal scroll at 360, 390 and 768 px. Pointer input is synthetic (`trigger` with `PointerEvent`), and the keyboard goes through `cy.press` for real key events. `cy.press(Enter)` did not activate a focused button in this Cypress and Chrome pair, so buttons use `type('{enter}')`; Enter and Space on the SVG elements are handled in our own `keydown` and work with `cy.press`.
- Lighthouse runs on the production build on the empty editor (mobile and desktop presets). States with shapes are covered by axe.

## Alternatives

- Pointer capture on the svg: fails with synthetic pointer ids and ties the drag to one element.
- `windowMs` for keyboard edits: merges unrelated edits (see above).
- One keyboard gesture with a timer: leaks into the next edit (see above).
- A DOM tree with absolutely positioned elements instead of SVG: loses the resize handles and connector geometry for free, and SVG gives hit testing and resize handles for free.
- Roving tabindex for the shapes: Tab through every shape is the simpler model, and a drawing with a few dozen shapes does not need it.

## Consequences

- On a 360 px screen the shape names are about 5 px high. They stay in the accessible name, the handles grow to stay touchable, and the numbers in the inspector are the precise route. The README states that the editor is built for a pointer or a keyboard on a laptop.
- Lighthouse does not see states with content. If an audit wants one, a Lighthouse user flow with Playwright is the next step.
- Screen reader behavior of the editor and of `role="tree"` on SVG is untested here (no screen reader on this machine). ADR 0011 names the fallback.
- The history grows by one entry per merged run, so a long editing session stays readable in the tree.
