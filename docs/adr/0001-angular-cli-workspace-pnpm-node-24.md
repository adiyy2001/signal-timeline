# 0001 Angular CLI workspace with pnpm 12 on Node 24

Status: accepted, 2026-10-04

## Context

The repo holds one Angular library with two entry points (`signal-timeline` and `signal-timeline/devtools`), a demo app, benchmarks, an end-to-end suite and small tools. The brief names ng-packagr, TypeDoc, changesets and Cypress. There is no Java side and no second language, so a task graph across languages would not pay for itself. The CI also has to swap the Angular major (ADR 0002), and that is easier when the workspace is plain.

Angular 22 requires Node `^22.22.3 || ^24.15.0 || >=26` (angular.dev, versions page). The default Node on this machine is 24.13.0, which is too old. Node 24.21.0 is installed under nvm.

## Decision

- An Angular CLI 22.2.1 workspace (`angular.json`) with two projects, `signal-timeline` (library) and `demo` (application). `bench/`, `e2e/` and `tools/` are plain folders with their own tsconfig.
- pnpm 12.9.1, pinned in `packageManager`. Lifecycle scripts are allowed per package in `pnpm-workspace.yaml` (`allowBuilds`: esbuild, cypress, `@parcel/watcher`, lmdb, msgpackr-extract), the same way the flagwire repo does it. The Cypress binary is already in `~/.cache/Cypress/16.1.1`.
- `engines.node` is `^24.15.0`. Every script and workflow exports a matching Node (`~/.nvm/versions/node/v24.21.0/bin` locally, `actions/setup-node` with `24` in CI).

## Alternatives

- Nx 23 with `@nx/angular`: it is Adrian's daily tool and the flagwire repo uses it, but here it adds a layer between me and `ng-packagr` and `ng test`, and the plugin would have to follow the Angular major in the compatibility matrix.
- npm workspaces: works, but the compatibility job installs a second dependency set, and pnpm's content-addressed store makes that cheap in time and disk.
- One package without a workspace: no room for a demo app that consumes the built library the way a user would.

## Consequences

- `ng build` and `ng test` behave exactly like in a freshly generated project, which keeps the repo easy to read for an Angular reviewer.
- Anyone on an older Node 24 gets an engine error from Angular and has to update first.
