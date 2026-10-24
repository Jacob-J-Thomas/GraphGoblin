# Orchestrator dispositions for the #116 QA round 2 (2026-10-24)

The independent QA at `a553d429` reproduced no #116 defect. All five case groups passed: both reproductions of the audit's B1 (the delayed duplicate and the recovery-written checkpoint, REST, MCP, the inspector and full replay agreeing), the 0017 to 0018 upgrade with NULL state reading the whole history until the next checkpoint write, bounded reads of exactly 1 and 201 rows on 10,000 events, damaged stored state refused with other runs readable, and the round-1 regressions in Edge at both widths. Its verdict was "fail" only because the infrastructure gate did not pass. The orchestrator (Claude Opus 5.5) records these dispositions.

- **Infrastructure gate.** The native process-control files fail inside the QA sandbox (register D-015). The untouched `sqlite/upgrade.test.ts` cutover and status-blocking cases exceeded their 20-second limits by under half a second on the loaded host. The same file timed out on other branches this week without this migration, and CI passed the infrastructure suite at this head.
- **Outside scope:** the append-value display the QA noted belongs to #255 (history browsing).
- **Record edits.** Local profile paths in six logs are written as `%USERPROFILE%`. The QA's finalisation script copy (`finalize.mjs.txt`) had the local user name in a pattern, now written as `<user name>`.
