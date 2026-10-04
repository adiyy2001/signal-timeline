# 0002 Two toolchain lines and the Angular compatibility rule

Status: accepted, 2026-10-04

## Context

The brief asks for the latest stable versions of everything and for a CI matrix on the current and the previous major of Angular and `@ngrx/signals`.

Checked on 2026-10-04 on the npm registry and on angular.dev:

- Latest line: Angular 22.2.1, `@ngrx/signals` 22.0.1, ng-packagr 22.2.4, Vitest 5.0.3, jsdom 30.1.1. TypeScript 7.0.2 is the latest release, but `@angular/compiler-cli` 22 and `ng-packagr` 22 declare `typescript >=6.0 <6.1`. The Angular 22 scaffold uses `~6.0.2`, which resolves to 6.0.3.
- Previous line: Angular 21.2.24, `@ngrx/signals` 21.1.1, ng-packagr 21.2.7, Vitest 4.1.11, jsdom 28, TypeScript 5.9.3 (the Angular 21 scaffold uses `~5.9.2`).
- The Angular library guide says an application must be built with the same or a newer Angular than any library it depends on.

That last point matters. A package built with the Angular 22 compiler is not guaranteed to link in an Angular 21 app. A package built with the Angular 21 compiler is expected to work in both.

## Decision

- Development, lint, e2e, docs and the demo use the latest line. TypeScript is pinned to `~6.0.3`, not 7.
- `tools/toolchains.json` holds the exact versions of both lines. `tools/compat.mjs <major>` copies the tracked files to `.compat/ng<major>`, rewrites the versions from that file, installs, and runs unit tests, type tests and the library build there.
- Peer ranges: `@angular/core ^21.0.0 || ^22.0.0`, `@ngrx/signals ^21.0.0 || ^22.0.0`, `rxjs ^7.4.0`.
- The tarball meant for npm is built with the previous line. CI builds it once, then a `consumer` matrix generates a fresh app of Angular 21 and of Angular 22, installs the tarball, and builds and tests the app for production.
- The source uses only Angular and NgRx APIs that exist in both majors. `zone.js` is not a dependency of the library.

## Alternatives

- Build and publish with 22 and declare `^22` only. Simplest, but it drops the previous major, which the brief wants in the matrix.
- Publish one major per Angular major, like `@ngrx-toolkit/core` does. Doubles the release work for a project of this size.

## Consequences

- The source has to compile with TypeScript 5.9 and 6.0.
- If the 21-built partial output fails in the Angular 22 consumer, or a feature turns out to exist only in 22, the fallback is to narrow the peers to `^22` and say so in the README.
- A release needs the previous line installed once on the machine that publishes. The release workflow does it; Adrian does not have to.
