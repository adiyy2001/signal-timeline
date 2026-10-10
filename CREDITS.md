# Credits

Everything in this repository is original work. The favicon and the demo shapes were drawn for this project. No font, image or data set from a third party is bundled.

## Published package

The package `signal-timeline` has one runtime dependency and three peers. Nothing else ships in the tarball.

| Package | Role | License |
| --- | --- | --- |
| `tslib` 2.8.1 | runtime dependency | 0BSD |
| `@angular/core` 21 or 22 | peer | MIT |
| `@ngrx/signals` 21 or 22 | peer | MIT |
| `rxjs` 7 | peer | Apache-2.0 |

## Build, test and documentation tools

None of these is part of the published package. Versions are the ones pinned in `package.json`.

| Package | Used for | License |
| --- | --- | --- |
| `@angular/build`, `@angular/cli`, `@angular/compiler`, `@angular/compiler-cli`, `@angular/common`, `@angular/platform-browser` 22.2.1 | workspace, build, demo app | MIT |
| `ng-packagr` 22.2.4 | building the library | MIT |
| `typescript` 6.0.3 | compiler | Apache-2.0 |
| `vitest` and `@vitest/coverage-v8` 5.0.3 | unit tests and coverage | MIT |
| `jsdom` 30.1.1 | DOM for unit tests | MIT |
| `fast-check` 4.10.2 | property tests | MIT |
| `expect-type` 1.4.0 | type tests | Apache-2.0 |
| `rfc6902` 5.3.0 | oracle in the patch tests, applies patches to a deep clone | MIT |
| `zone.js` 0.16.3 | running the replay suite against zone based change detection | MIT |
| `cypress` 16.1.1 and `cypress-axe` 1.7.0 | end-to-end tests | MIT |
| `axe-core` 4.13.0 | accessibility rules | MPL-2.0, development only |
| `lighthouse` 13.5.0 | accessibility, best practice and performance audit | Apache-2.0 |
| `playwright-core` 1.63.0 | benchmarks in Chromium, screenshots, the demo recording, must-have checks | Apache-2.0 |
| `tinybench` 6.2.0 | benchmarks | MIT |
| `esbuild` 0.28.2 | bundling the benchmarks | MIT |
| `sirv` 3.0.2 | static server for e2e, Lighthouse and the recording | MIT |
| `typedoc` 0.28.20 | API reference | Apache-2.0 |
| `@changesets/cli` 3.0.3 and `@changesets/changelog-github` 1.0.1 | versioning and changelog | MIT |
| `publint` 0.3.25 and `@arethetypeswrong/cli` 0.18.5 | checking the tarball | MIT |
| `eslint` 10.12.0, `@eslint/js`, `typescript-eslint` 8.71.0, `angular-eslint` 22.5.0, `globals`, `prettier` 3.9.9 | lint and formatting | MIT |
| `@types/node` 24.19.1 | Node typings | MIT |

The `axe-core` exception is explained in [ADR 0013](docs/adr/0013-dependency-license-policy.md). It is used unmodified and only as a development tool. Two more development only packages that Angular's own build tool pulls in are not permissive in the narrow sense: `lightningcss` 1.33.0 (MPL-2.0) and `caniuse-lite` 1.0.30001814 (CC-BY-4.0, browser data). They are not copied into the repository or the package. `pnpm check:licenses` scans every installed package and fails on any license outside the allowed list and these named exceptions.

Outside the repository, the demo GIF was encoded with ffmpeg and recorded in Google Chrome. Neither is distributed here.

## Prior art

No code was taken from these projects. They are the work I read before deciding what to build, and the README compares against them.

- `withUndoRedo` in `@ngrx-toolkit/core` (formerly `@angular-architects/ngrx-toolkit`), MIT: linear undo and redo for SignalStore.
- `signalstory`, MIT: its own store classes with history tracking across stores.
- `ngrx-wieder`, MIT: undo and redo for the classic NgRx Store with Immer patches.
- `zundo`, MIT: undo and redo for Zustand.
- Vim's undo tree, for the idea of branching instead of discarding redo history.
- RFC 6902 (JSON Patch) and RFC 6901 (JSON Pointer), for the patch format.
- The WAI-ARIA Authoring Practices tree view pattern, for the keyboard behavior of the branch tree.
