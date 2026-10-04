# 0018 Verification, README numbers and the coverage badge

Status: accepted, 2026-10-04

## Context

The README quotes numbers, the badges have to be honest before anything is pushed, and the repository has to work for someone who clones it. Nothing here can be checked by reading the code, so the checks have to run.

## Decision

- Every number in the README comes from a script in the repository. Benchmark figures are copied from `bench/results/summary.md`, which `pnpm bench:report` generates from the JSON files of `pnpm bench`. Test counts and coverage come from `pnpm test:coverage`. The two Lighthouse and must-have claims come from `tools/lighthouse.mjs` and `tools/verify-must-haves.mjs`. The prior art claim comes from `tools/prior-art-check.mjs` (ADR 0016).
- The benchmarks were run again at the end, on the final code, instead of reusing the figures from the tuning phase. ADR 0014 says which figures it quotes from the earlier run.
- The coverage badge is an SVG that `tools/coverage-badge.mjs` writes to `docs/media/coverage.svg` from the coverage summaries of both projects. A badge service would need an account and a first push. The file is regenerated with `pnpm coverage:badge` after `pnpm test:coverage`, and it shows the line coverage over both projects.
- The CI and npm badges point at the planned repository and package. They stay empty until Adrian pushes and publishes, and the README says so.
- The demo GIF is produced by `pnpm demo:gif` (ADR 0017) and committed, because GitHub renders the README from the repository and cannot run a script.
- A fresh clone is checked in a Docker container with the commands from the README: clone, `pnpm install`, `pnpm start`, then a request to the dev server. The container name starts with `signal-timeline-`.

## Alternatives

- Shields.io endpoint badges for coverage: need a hosted JSON file or a third party service.
- Generate the README tables with a script: removes copy errors, but the prose around the tables is the point of the section, and a template would be one more thing to maintain.

## Consequences

- A reviewer can reproduce any number with one command, and a change to the code means rerunning the script and updating the text. Nothing checks the README automatically.
- The coverage badge can go stale if nobody regenerates it. `pnpm verify` runs the coverage gate, which fails first when coverage drops below the limits.
