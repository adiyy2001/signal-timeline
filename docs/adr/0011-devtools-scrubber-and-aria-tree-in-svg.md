# 0011 Devtools: a native range scrubber and an ARIA tree drawn in SVG

Status: accepted, 2026-10-04

## Context

The `/devtools` entry point has a timeline scrubber, the branch tree in SVG, and a diff view of the selected entry. It has to work with the keyboard, and the tree has to follow the ARIA tree pattern. The W3C APG tree view pattern asks for `role="tree"`, `role="treeitem"`, `role="group"`, `aria-expanded` on parents, `aria-selected`, a label on the tree, and `aria-level`, `aria-setsize` and `aria-posinset` when the DOM is not nested. Keys: Up and Down move between visible nodes, Right opens a closed node or moves to the first child, Left closes an open node or moves to the parent, Home and End go to the first and last node, Enter activates.

`@angular/aria` 22.2.1 ships headless directives, but it declares `@angular/core ^22.0.0 || ^23.0.0` as a peer, so it does not cover Angular 21, and it would be one more peer dependency for the library.

## Decision

- The scrubber is a native `<input type="range">` over the path from the root to the tip of the current branch, with an `aria-valuetext` that carries the entry label. The arrow keys, Home and End come from the browser. A button row (first, previous, next, last, undo, redo) sits next to it.
- The tree is one `<svg>` with `role="tree"`. Each node is a `<g role="treeitem">` with `tabindex` managed as a roving tabindex, `aria-level`, `aria-setsize`, `aria-posinset`, `aria-selected`, and `aria-expanded` for nodes with children. The nodes are flat in the DOM, which the pattern allows with those attributes. Enter jumps to the entry; the current entry is also marked with a shape, not only a color.
- The layout is a pure function `layoutTree(nodes, currentId)` returning positions, with its own tests: a parent is above its children, siblings do not overlap, the active branch is drawn on a straight line.
- The diff view is an HTML table: operation, path, before, after, derived from the forward and inverse patches. Long values are truncated with the full text in a `title` and a `<details>` element.
- Focus is visible in the SVG with an outline that has 3:1 contrast against both themes. The component follows `prefers-color-scheme` and `forced-colors`.
- Tests: component tests with TestBed, an axe run on the rendered DOM in jsdom for the rules jsdom supports, and the real keyboard and screen-reader checks in the demo e2e.

## Alternatives

- `@angular/aria` tree: tested keyboard behavior, but no Angular 21 support in 22.2.1, a new peer dependency, and I have not verified that it works on SVG elements.
- A hidden HTML list that mirrors the SVG for assistive technology: two sources of truth.
- A custom slider with `role="slider"`: the native range input already does what the pattern needs.

## Consequences

- Screen reader behavior for `role="tree"` on SVG elements is less uniform than for HTML. If the audit finds a real problem, the fallback is the hidden list, and this record is updated.
- The keyboard handling is my own code, so its tests are mine to keep complete.
