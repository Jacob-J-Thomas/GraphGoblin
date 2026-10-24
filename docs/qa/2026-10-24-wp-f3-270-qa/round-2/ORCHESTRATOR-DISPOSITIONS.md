# Orchestrator dispositions for the #270 QA round 2 (2026-10-24)

The independent QA at `827c4f39` passed D2 (migration 0020 on a store built at 0017, every loop reopening, authored values and damaged rows kept, the upgrade suite 21 passed and 3 platform skips) and D3 (repair timeout provenance), with the deadline regressions and the Edge checks. The orchestrator (Claude Opus 5.5) records these dispositions.

- **R2-D1 (minor): the generated references omit the completion limit's scope.** Not a #270 defect. The reference generator emits node configurations and API routes, not loop settings field descriptions: `docs/reference/api.md` and `docs/reference/nodes.md` mention neither `structuredTimeoutMs` nor the existing `maxNodeVisits` and `runDeadlineSeconds`. The orchestrator's QA brief wrongly asked for the scope there. The Loop tab help, the schema metadata, docs 05 and 06, ADR-0051 and the CHANGELOG state it. Extending the generator to loop settings is outside this bolt (register D-035).
- **Gate failures.** Four infrastructure native process-control files (register D-015), in files #270 does not change; CI is the clean run.
- **Record edits.** Local profile paths in one log are written as `%USERPROFILE%`.
