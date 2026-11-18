# Independent targeted QA of CI evidence correction 01

**Verdict: FAIL.** The original three regression groups passed on the corrected candidate. Two additional controls within the accepted evidence-consistency finding still returned exit 0 and complete evidence.

- A missing run ID is marked complete even with the manifest reporting it as unavailable and the checkout comparisons verified.
- The finalizer accepts an observation stream claiming one rejected record in its closer with zero visible rejected records and zero omissions. It reports a complete result with zero rejections.

[QA record](qa-record.md.txt), [supplemental CLI harness](supplemental-cli/cli-controls.mjs), [raw 3/5 supplemental result](supplemental-cli/cli-controls.json), [exact source receipts](source-receipts.json).

The original CLI harness passed 13/13. After recognizing the two new workflow conditions, the original expectations passed 6/6 for Windows, 25/25 for Gates, 5/5 for coverage summaries and 24/24 for repository setup and checks. The focused helper suite passed 28/28 with 99.26% line coverage and 97.19% branch coverage. The corrected parser accepted both previously retained streams. This QA assessed native and full coverage through the admitted reports and targeted stream replay.

[CLI matrix](cli-controls.json), [workflow matrix](workflow-controls.json), [initial workflow-model failure](workflow-original-attempt.log.txt), [helper log](helper-tests.log.txt), [native replay](retained-native-validation.json).

Prepublication controls correctly inject invalid preparation in PowerShell and keep init stdout out of the refusal fixture's object array. Both local refusal finalizers failed while leaving the outside canary unchanged. The dedicated cancellation workflow retains Gates verbatim and provides a bounded observation window in each lane. Actual hosted execution and downloaded archives require separate receipts.

[Hosted-overlay receipts](control-overlay-receipts.json), [invalid-prepare overlay](hosted-overlay/qa-496-invalid-prepare.yml), [negative/refusal overlay](hosted-overlay/qa-496-candidate-negative.yml), [external cancel overlay](hosted-overlay/qa-488-external-cancel.yml), [local shell proof](hosted-shell-probes.json).

The [publication manifest](publication-manifest.json) records the original names and hashes for every raw copy. The [author correction packet](../2026-11-17-ci-intent-1-correction-01/README.md) and the [original independent QA](../2026-11-17-ci-intent-1-independent-qa/README.md) remain intact. Formal review remains 0/3.
