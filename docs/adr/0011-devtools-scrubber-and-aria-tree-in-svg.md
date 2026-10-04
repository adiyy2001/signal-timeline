# 0011 Devtools: a native range scrubber and an ARIA tree drawn in SVG

Status: accepted, 2026-10-04

## Context

The `/devtools` entry point has a timeline scrubber, the branch tree in SVG, and a diff view of the selected entry. It has to work with the keyboard, and the tree has to follow the ARIA tree pattern. The W3C APG tree view pattern asks for `role="tree"`, `role="treeitem"`, `role="group"`, `aria-expanded` on parents, `aria-selected`, a label on the tree, and `aria-level`, `aria-setsize` and `aria-posinset` when the DOM is not nested. Keys: Up and Down move between visible nodes, Right opens a closed node or moves to the first child, Left closes an open node or moves to the parent, Home and End go to the first and last node, Enter activates.

`@angular/aria` 22.2.1 ships headless directives, but it declares `@angular/core ^22.0.0 || ^23.0.0` as a peer, so it does not cover Angular 21, and it would be one more peer dependency for the library.

## Decision

- The scrubber is a native `<input type="range">` over the path from the root to the tip of the current branch, with an `aria-valuetext` that carries the entry label. The track is the root, the current entry and then the newest children below it, and it stays the same while the current entry stays on it, so scrubbing back past a branch point does not swap the track under the thumb. The component handles the arrow keys, Page Up, Page Down, Home and End itself and cancels the browser default, because jsdom does not step a range input and because a key pressed before the view has caught up with the previous one must still move one more step. The input emits a move request (by steps, to an index, to the start or the end) and the panel resolves it against the live signals, never against the input values it was last rendered with. A button row (first, undo, redo, last) sits next to it.
- The tree is one `<svg>` with `role="tree"`. Each node is a `<g role="treeitem">` with `tabindex` managed as a roving tabindex, `aria-level`, `aria-setsize`, `aria-posinset`, `aria-selected`, and `aria-expanded` for nodes with children. The nodes are flat in the DOM, which the pattern allows with those attributes, and they are direct children of the `svg`, because a `g` without a role maps to `group` and would sit between the tree and its items. Enter, Space and a click jump to the entry. The current entry is a diamond, other entries are circles, the active branch is a thick line and a collapsed branch has a dashed ring, so no state is carried by color alone. The one tab stop is the focused item, or the current entry while focus is outside the tree.
- Branches can be collapsed with Left and opened with Right. A branch that leads to the current entry cannot be collapsed (Left moves to the parent instead), so the current entry is always visible and `aria-selected` always has a target.
- The entry shown in the diff is the one that holds focus in the tree, and it returns to the current entry after every jump. Focus only inspects, Enter jumps, so arrowing through the tree never changes the state of the app.
- The layout is a pure function `layoutTree(nodes, currentId)` returning positions, with its own tests: a parent is above its children, siblings do not overlap, the active branch is drawn on a straight line.
- The diff view is an HTML table: operation, path, before, after, derived from the forward and inverse patches. Long values are truncated with the full text in a `title` and a `<details>` element.
- Focus is visible in the SVG with an outline that has 3:1 contrast against both themes. The component follows `prefers-color-scheme` and `forced-colors`.
- The layout is a leaf-count grid: a node sits one row below its parent, the first child (the active one) shares its parent's column, and every other child gets the columns of its own subtree to the right. Siblings and subtrees therefore never overlap, and the walk is iterative, so a history ten thousand entries deep does not overflow the stack.
- Tests: component tests with TestBed, an axe run on the rendered DOM in jsdom for the rules jsdom supports (color contrast is out of reach there, so a spec computes the contrast of every token pair in both themes from the stylesheet), property tests for the layout, and the real keyboard and screen-reader checks in the demo e2e.

## Alternatives

- `@angular/aria` tree: tested keyboard behavior, but no Angular 21 support in 22.2.1, a new peer dependency, and I have not verified that it works on SVG elements.
- A hidden HTML list that mirrors the SVG for assistive technology: two sources of truth.
- A custom slider with `role="slider"`: the native range input already does what the pattern needs.

## Consequences

- Measured in Chromium with the panel in a throwaway page: the tree draws every entry, and 5,000 entries take about 360 ms for the first render and 50 to 85 ms for an undo or a jump. The panel is meant for histories of a few thousand entries. Collapsing branches shortens the DOM, and no windowing is built.
- A diff row pairs each forward operation with the inverse operation at the mirrored position, which holds because the inverse patch is the reversed list of per-operation inverses (ADR 0004). A row list is capped at 200 rows and says how many are left.
- Screen reader behavior for `role="tree"` on SVG elements is less uniform than for HTML. If the audit finds a real problem, the fallback is the hidden list, and this record is updated.
- The keyboard handling is my own code, so its tests are mine to keep complete.
