# Routing performance correction

Two final Browser attempts at `01c39c4290cf1884147d73d89a854b9380a01b61` exceeded the unchanged 300-node median routing p95 limit of 8 ms: 9.2 ms, then 9.8 ms. The dedicated same-head routing job passed at 6.6 ms. The first full attempt had 454 passes, one failure and one planned live-provider skip; the controlled rerun had 453 passes, two failures and one skip, with the additional failure matching the separately tracked shutdown issue #421. No further unchanged CI rerun was requested.

The correction preserves graph classification, routes, dependency reads, operation counters and all timing, coverage and retry settings. It removes transient candidate/reservation arrays and replaces string cell keys inside the existing 256px obstacle grid with nested numeric lookups. Three public-index tests cover ordering, duplicates, boundaries, handle exemptions and footprint reads.

## Evidence sequence

- [First allocation experiment](verification.md): routes matched, but p95 worsened. This was not accepted as a timing fix.
- [Profiled candidate-preparation experiment](hotspot-verification.md): typical cost improved; tail benefit remained small and variable.
- [Combined grid correction](grid-verification.md): 58 relevant tests and static checks passed. The single new paired diagnostic showed 26.3% lower p50 and 34.1% lower p95, with identical routes, directions, suspended edges and statistics at all 300 compared states.

These Node measurements time only the planner. They do not establish Browser acceptance or replace its unchanged gate. Final CI, targeted independent review and merge disposition are recorded on [PR #450](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/450).

Raw JSON, profiling data and harness bytes are preserved without normalization. Historical harnesses retain their original Windows host paths and depend on the executable source snapshots kept at `C:/Users/98jak/graphgoblin-qa/2026-11-07-loopback/performance-correction-01c39c42/`; they are not portable standalone tests. The notes record the baseline commit, commands, exact source hashes, import-only rewrites and measurement exclusions. Original and all intermediate source snapshots remain in that local evidence folder; the final source changes are in this PR. No claim of a fresh run is made by copying these artifacts.
