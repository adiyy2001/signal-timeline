# 0013 Dependency license policy

Status: accepted, 2026-10-04

## Context

The brief allows only permissive dependencies (MIT, Apache 2.0, BSD, ISC). Checked on the npm registry on 2026-10-04: Angular, NgRx, ng-packagr, Vitest, fast-check, tinybench, Cypress, `rfc6902`, `cypress-axe`, `sirv-cli`, `publint`, `@arethetypeswrong/cli` and Changesets are MIT. TypeScript, RxJS, Playwright, TypeDoc, Lighthouse and `expect-type` are Apache 2.0. `axe-core` 4.13.0 is MPL-2.0, which is a file-level copyleft license.

The brief also requires a Lighthouse accessibility score of 95 or more. Lighthouse depends on `axe-core`, so it is already in the dependency tree of any repo that follows the brief.

## Decision

- The published package has no runtime dependency except `tslib`, and peers that are MIT or Apache 2.0 (Angular, NgRx, RxJS).
- Development tools may include MPL-2.0 code when it is not modified, not copied into the repo and not part of the published package. `axe-core` is used through `cypress-axe` and through Lighthouse for accessibility checks.
- `CREDITS.md` lists every third-party package that is part of the build, test or docs pipeline with its license, and marks `axe-core` as MPL-2.0, development only.
- `tools/check-licenses.mjs` reads the license field of every installed package (727 of them on 2026-10-04) and fails on anything outside MIT, MIT-0, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense, Python-2.0 and the named exceptions. It understands SPDX expressions with `OR` and `AND`.
- The full scan found three more packages that need a named exception, all development only and unmodified: `lightningcss` and its Linux binary (MPL-2.0, pulled in by Vite inside `@angular/build`), and `caniuse-lite` (CC-BY-4.0 browser data read by browserslist). None of them is copied into the repo or into the published package. `MIT-0` and `Unlicense` are permissive and were added to the allowed list.

## Alternatives

- Drop `axe-core` and the Lighthouse check: loses the automated accessibility evidence the brief asks for.
- Vendor nothing and test accessibility by hand only: not repeatable.

## Consequences

- The README says in one line that the accessibility checks use `axe-core` under MPL-2.0 as a development tool.
- Adrian can veto the `axe-core` exception; removing `cypress-axe` leaves Lighthouse as the only accessibility check. The other exceptions come with Angular's own build tool, so they cannot be removed without dropping Angular.
