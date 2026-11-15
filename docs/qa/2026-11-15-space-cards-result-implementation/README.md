# Space cards result implementation evidence

This packet records the worker implementation and its focused evidence for the post-action result panel used to prevent a second hit from reaching the underlying Canvas control. It does not establish native acceptance or whole-candidate readiness.

## Source identity and authorship

The worker's final handoff covers seven files and is preserved as recovered. Root later added one documentation paragraph to docs/guide/02-build-a-loop.md. The exact eight-file source freeze is commit dba48e441732d4ef88e3e67aef3ca3a3029b3cae (tree 34e5a8f6d382e4510a2947310736b23ab857d52c; parent 5c80b06f6861b41e0177cd9def89334ab0c7858d). The worker patch contains only its seven files; the separate guide snapshot and root source-freeze record preserve the root addition. The guide-only addition was formatted and diff-checked by root; the worker's test counts below predate that documentation-only edit.

The worker handoff was recovered from the logged report Write and four literal correction edits. The recovered handoff SHA-256 exactly matches the worker manifest's expected report hash. The runner's current 3,386-byte report is preserved separately with its actual hash; it is not substituted for the handoff. See the [recovery provenance](worker/handoff-recovery-provenance.md.txt), [recovered handoff](worker/handoff-recovered.md.txt), [runner report](worker/runner-current-report.md.txt), and [worker artifact manifest](worker/artifact-manifest.sha256).

## Focused results and preserved failures

- Final worker focused suite: 159 passed across seven files. No-emit typecheck, ESLint, Prettier, and diff checks passed on the worker's final source. The root's later guide-only addition had its own formatting and diff check; no product behavior changed there.
- Old-production controls: 14 failed and 23 passed across the 37 relevant unit and gate cases. The final new-source run passed the focused 159-test set. These remain implementation evidence, not native proof.
- Checkpoint first gate run: the outside-pan assertion expected the result to disappear synchronously immediately after pointerdown; it failed. The rerun passed after waiting for the documented microtask boundary. Resume ESLint initially caught a floating Promise. The first old-production gate control timed out in a Shift-drag case because a preceding failed test left d3 mid-gesture. The fixture cleanup and assertion ordering were corrected; both original failures and their reruns are retained.
- The control backups are omitted as repeated source copies. Their hashes were checked against the two worker final source snapshots and are mapped in the [copy manifest](copy-manifest.json). Checkpoint logs repeated in both initial and checkpoint folders are also represented once with exact source aliases.

## Limits and gates

The test harness states where a press lands; jsdom does not prove native hit testing, touch/pen behavior, layout geometry, or browser click targeting. The worker did not run native/browser QA, a build, full coverage, or CI. Root's source-freeze record leaves the corrected actual-parent seven-group native matrix pending and records one of two global fixture-correction batches used. No formal review scans have been used for this Space work (0/3). Do not infer owner acceptance or integrated readiness from these focused runs.

## Evidence files

See the [complete evidence index](evidence-index.md), [root source freeze](root/result-correction-source-freeze.json), [root-added guide snapshot](root-source/docs/guide/02-build-a-loop.md), [worker final diff](source/final.diff), [checkpoint correction diff](source/delta-from-checkpoint.diff), and [worker source manifest](worker/artifact-manifest.sha256). The [copy manifest](copy-manifest.json) records source paths, hashes, and omitted exact duplicates; report recovery details are in the provenance note. [SHA256SUMS.txt](SHA256SUMS.txt) covers every packet file except itself.
