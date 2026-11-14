# PR #474 independent whole-PR audit — scan 3 of 3

This packet preserves the final independent audit report and selected supporting records for PR #474, recorded in the review-273 evidence stream. The report is copied byte-for-byte as `report.md.txt`; `retained-files-manifest.json` records source paths, sizes and SHA-256 hashes for every retained evidence copy.

## Disposition

**CHANGES REQUIRED.** Scan 3 of 3 found two introduced P2 defects at audited head `5a4fb439c63755eeb2b5bef945319772623a9905` (tree `caf777a63de7d9938b03dfa81b9ee60e9a1bf3e5`), against actual main/PR target `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`:

- A1: the JSONata walker skips evaluated computed-key arguments of a recognized `$lookup`, allowing a missing nested visit to remain publishable.
- A2: a self-reference rename remounts the form and consumes the first pointer activation of an Add/Remove button.

Root's exact GitHub disposition readback records both as FIX-IN-PR. Known-cause correction completion, independent behavioral QA, and fresh CI for the resulting exact head against the current target are still pending. The three-scan cap is exhausted; this packet does not authorize a fourth scan. Owner acceptance and closure remain open.

## Evidence

- [Full final audit report](report.md.txt) — findings, audit method, exact identity, coverage boundaries and generated diff hashes.
- [Audit brief](brief.md.txt) — review scope and admission instructions.
- [Identity readback](identity.json) — checkout, branch, head/tree, target and live readback identity.
- [Source and evidence readback](source-and-evidence-readback.json) — per-path size, SHA-256 and Git blob verification for the audited source set.
- [Gate status](gate-status.json) — gate/job state captured for the audited head.
- [Computed-key lookup probe](lookup-probe.json) and [probe source](lookup-probe.mjs) — retained negative observation and direct control.
- [Initial snapshot failure](snapshot-first-failure.md.txt), [snapshot configuration](snapshot-config.json), and [snapshot helper](snapshot-helper-first.mjs) — initial evidence-fixture correction history.
- [Non-QA path inventory](non-qa-paths.txt) — paths outside the QA documentation area.
- [Root disposition readback](root-disposition-readback.json) — exact fresh readback for the CHANGES REQUIRED disposition and A1/A2 FIX-IN-PR requests.
- [Audited-head CI job metadata](ci/jobs-complete.json), [routing job metadata](ci/routing-jobs-complete.json), [workflow metadata](ci/workflows-complete.json), and [log manifest](ci/log-manifest.json).

The five CI jobs passed on their first attempt for the audited head and target recorded above. These are pre-correction results; they do not establish that A1/A2 are fixed or that the resulting head has current-target CI. Raw CI logs and transport duplicates are not included.

The generated full binary diff is intentionally omitted. Its exact size and SHA-256, and those of the non-QA diff, are recorded in the final report and in `retained-files-manifest.json`. The retained source/evidence readback covers 834 entries totaling 25,542,483 bytes.

## Integrity

`retained-files-manifest.json` inventories the 16 copied evidence files. `SHA256SUMS.txt` records this packet's files, including the authored wrapper and link-check record. `.gitattributes` disables text conversion so retained raw files keep their original bytes. `link-checks.json` records local README links that were resolved in this directory.
