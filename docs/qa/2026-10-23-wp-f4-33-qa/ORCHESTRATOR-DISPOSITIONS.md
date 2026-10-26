# Orchestrator dispositions for the #33 QA (2026-10-24)

The independent QA at `7d76abd0` found no #33 functional defect: all seven case groups passed (28 API checks and both Edge widths), including worker, reviewer, worker continuity, reset boundaries, parallel runs, replay forks, child runs, restart and the failure classes. Its verdict was "fail" only because the validation gates were not clean. The orchestrator (Claude Opus 5.5) records these dispositions.

- **Ten tests in five unchanged infrastructure files failed when re-run alone** (`adversarial`, `claude/process`, `claude/readiness`, `process/scripts`, `sqlite/upgrade`). Four of the five exercise native process control (the Claude CLI process and script process trees), which the QA sandbox denies (register D-015); `sqlite/upgrade` times out under the host's load as it did on other branches this week. #33 changes none of these files. CI (Linux) passed the infrastructure suite at this head (771 passed, 3 skipped). Not a #33 defect.
- **API and web coverage incomplete in the QA sandbox.** CI is the clean run; its only failure at this head was the pre-existing race filed as #398, fixed separately in PR #399.
- **ADR-0052's status line** said "independent review pending"; it now records the review, the live checks and the QA.
- **Record edits.** Local profile paths in six logs are written as `%USERPROFILE%`; `evidence-manifest.json` is recomputed from the committed bytes.
