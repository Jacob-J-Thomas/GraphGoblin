# Orchestrator dispositions for the #240 QA round 3 (2026-10-24)

The independent QA at `987b70f7` reproduced no #240 defect. Its 146 checks and the 7 maintained browser specs passed. They covered the audit's B1 (overlapping Refreshes across filter changes, revisits and tab switches) and B2 (pending receipts displaced by one and by many arrivals, at the first-page boundary and deeper), the inclusive `anchor` parameter (owned, foreign, filtered-out and unknown anchors, the refusal with `cursor`, limits), and round 2's regressions at both widths. Web, API and API-client coverage passed. Its verdict was "fail" only because the infrastructure gate did not pass. The orchestrator (Claude Opus 5.5) records these dispositions.

- **V1: infrastructure gate.** Nine tests in five infrastructure files that #240 does not change failed, as did their isolated reruns: the native process-control files that the QA sandbox denies (register D-015), plus native fixture cleanup. CI passed the infrastructure suite at this head.
- **Physical SQL scan counts** were unavailable in the QA environment; the bounded read is shown by the rows returned and the query shape, as in round 2.
- **Record edits.** The copied audit context (`audit-round1-context.md.txt`) had the local user name in a quoted grep, now written as `<user name>`; the manifest is recomputed from the committed bytes.
