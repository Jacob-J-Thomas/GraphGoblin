# Orchestrator run of the two cases the sandbox could not observe

The independent QA above records the Claude `rate_limit` and `server_error` stream-failure cases as **not observable here**: inside the worker's sandbox, native process termination is denied (register D-015), so both the `main` baseline and the PR build recorded `HARNESS_TERMINATION_UNCONFIRMED` instead of the stream classification. The orchestrator ran the QA's own driver once outside that sandbox, at the same head, with the QA's prepared fake executables and baseline archive. This is the orchestrator's observation, recorded as such; it is not an independent QA verdict on those two cases.

- Head: `7d5493f71142d28987e4abcfb461b3e5c70996e8` (confirmed with `git rev-parse HEAD` before the run), worktree `codex-qa-pr426-final`.
- Node: `v22.23.4` from the project-scoped runtime, first on `PATH`.
- Command: `node docs/qa/2026-10-27-pr426-qa-final/scripts/run-driver.mjs c4-regression` from the worktree root, 2026-10-27 20:45:51 to 20:46:08 UTC. No provider call; the fake CLIs only.
- Ports 6736 (baseline) and 6738 (PR build); disposable stores `gg-qa-426f-c4-main-*` and `gg-qa-426f-c4-pr-*`, retained.
- Result: **7 passed, 0 failed, 0 observations** ([orchestrator-c4-regression-result.json](orchestrator-c4-regression-result.json), [orchestrator-c4-regression.log.txt](orchestrator-c4-regression.log.txt), [orchestrator-c4-regression-console.log.txt](orchestrator-c4-regression-console.log.txt)).
  - 4-3 Claude `rate_limit` in the stream then exit 1: `HARNESS_QUOTA_EXHAUSTED`, message `Claude account rate limit reached`, resumable, on both builds; no stderr banner or provider body in the record.
  - 4-4 Claude `server_error` in the stream then exit 1: `HARNESS_TRANSPORT_FAILED`, message `Claude connection or provider service failed; check connectivity and retry`, resumable, on both builds; no banner or body in the record.
  - 4-1, 4-2 (Codex 429 and 500) and 4-5 (the F2 refusal stream: D2 on `main`, the pinned `HARNESS_ARGUMENTS_REJECTED` refusal on the PR build) passed as in the QA's own run.
- Both gateways drained to exit 0 ([orchestrator-pids.log.txt](orchestrator-pids.log.txt), [orchestrator-exits.log.txt](orchestrator-exits.log.txt)); no process outside the two gateways and their fake CLIs was started or ended.

The QA's original `c4-regression*`, `pids.log.txt` and `exits.log.txt` were copied aside before the run and restored unchanged afterwards; the driver's gateway logs from this run are [orchestrator-c4-regression-main-gateway.log.txt](orchestrator-c4-regression-main-gateway.log.txt) and [orchestrator-c4-regression-pr-gateway.log.txt](orchestrator-c4-regression-pr-gateway.log.txt).
