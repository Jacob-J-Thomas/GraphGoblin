# Orchestrator review of #205 round 3 (2026-10-24)

The orchestrator (Claude Opus 5.5) reviewed round 3 and accepted F1 and F3 to F5 as implemented. For F2 it kept the manual-admission check and removed the engine-side recheck before committing.

**What changed after this report.** Round 3 also made the engine's request resolution call `harnesses.claude.preflight()` before every Claude inference or LLM request, so that triggers, children and resumes were checked against the ready capability list too. The Claude adapter's preflight runs the CLI (version and auth status, each with a 15-second timeout), so every Claude node visit gained two process starts, and a nested start probed once per request instead of once per admission (the `nested-readiness` probe counts had been raised from 1 to 2 or 3). The capability list the preflight returns is the adapter's static table (`claudeModelCapabilities()` in `packages/infrastructure/src/claude/models.ts`), and Claude's catalog rows are seeded from that same table (`claudeCatalogModels()`, refreshed on each start; harness rows cannot be edited). The catalog check the engine already performs before every adapter request therefore enforces the same efforts in every start path. The per-request probe only made a difference with a test fake whose probed list disagrees with the catalog.

**Resulting design.** Manual admission (`apps/api/src/run-readiness.ts`) resolves each pinned inference and LLM selection with the run's pinned defaults and checks the ready capability list once per start, refusing `EFFORT_UNSUPPORTED` on the node before anything is recorded. Engine request resolution checks the catalog and never probes the CLI.

**Tests.**

- `packages/engine/src/claude-effort.test.ts` now asserts that a supported request runs and a catalog-unsupported one is refused before the adapter, both without a preflight call.
- `apps/api/src/claude-effort-readiness.test.ts` keeps the manual-admission cases: inherited and explicit high refused, a pinned child refused, low running. It drops the trigger, child-execution, resume and non-manual start cases, which asserted the removed per-request probe.
- `apps/api/src/nested-readiness.test.ts` is back to one probe per admission.

Docs 06 and 09 and the CHANGELOG entry say this.
