# 0003 Vitest instead of Jest, and type tests with expect-type

Status: accepted, 2026-10-04

## Context

The brief says to use Jest unless the Angular CLI default is clearly the better fit. The Angular testing guide describes Vitest as the default runner (builder `@angular/build:unit-test`, `ng test`), keeps Karma for existing projects and does not mention Jest. The builder schema in `@angular/build` 22.2.1 accepts `runner: vitest | karma` and has `coverage`, `coverageThresholds`, `coverageInclude` and `coverageReporters`. The scaffold uses Vitest `^5.0.0` on Angular 22 and `^4.0.8` on Angular 21.

The brief also allows `expect-type` or `tsd` for type tests. Negative assertions such as "an unknown key is rejected" usually need `// @ts-expect-error`, and the repo rule is no comments in code.

## Decision

- Vitest 5.0.3 (4.1.11 on the previous line) through `@angular/build:unit-test`, with `@vitest/coverage-v8`. Pure TypeScript tests (patch engine, tree, layout) run in the same runner.
- fast-check 4.10.2 for property tests, used directly (`fc.assert`, `fc.property`, `fc.commands` for model-based runs). The seed and the counterexample are printed on failure. CI uses a fixed `numRuns`.
- Type tests live in `*.type-spec.ts` files and use `expectTypeOf` from `expect-type` 1.4.0 with `.not` and `.toEqualTypeOf`, with no comment directives. They are checked by `tsc --noEmit -p projects/signal-timeline/tsconfig.type-tests.json` (script `test:types`), because `expectTypeOf` does nothing at runtime.

## Alternatives

- Jest 30 with `jest-preset-angular` 17.0.1: it supports Angular 20 to 22, but it is a second runner next to the one the CLI ships and needs its own transform layer.
- tsd: its negative checks use `expectError`, which works without comments, but it checks with its own bundled TypeScript (`@tsd/typescript` 5.9), not the version the library is built with.
- Karma: real browsers, slow, no longer the default.

## Consequences

- One runner and one coverage provider for the library, the devtools component and the demo.
- Jest habits carry over; mocks and fake timers use `vi.*`.
- Coverage thresholds differ by folder (90 percent for `core`, 80 percent elsewhere), which the builder cannot express, so `tools/check-coverage.mjs` reads `coverage/coverage-summary.json` and enforces them.
