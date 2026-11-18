# CI evidence correction 02 for #488 and #496

This author packet records the correction for two evidence-consistency failures found by
[independent correction QA](../2026-11-17-ci-intent-1-correction-independent-qa/README.md).
It changes the Windows launcher evidence helper, its tests, and the exact status contract
in `docs/10-testing-and-quality.md`. The [source comparison](SOURCE-COMPARISON.txt) records
these three changes across the eight frozen source files.

Complete evidence now requires valid `repository`, `workflowRef`, `job`, `runId`,
`runAttempt`, `event`, and `ref` fields. Any missing or malformed field adds one
`binding-identity` marker. With a passing native step, the result is `incomplete`, exits
1, and retains valid evidence for upload.

The observation closer's rejected count must fall between the number of visible rejected
records and that number plus omitted records. This preserves genuine partial evidence.
A closer outside that range makes the observation stream invalid. An injected-clock
regression checks that a rejection counts only after its record exists.

The same supplemental CLI controls passed 3/5 on correction 01 and 5/5 on correction 02.
All 33 focused helper tests passed. The first full tooling coverage run passed 211 tests
with 97.54% line coverage and 93.46% branch coverage. The author reparsed two retained
genuine Windows evidence bundles. Both streams stayed valid, and their source bytes
matched. The author checks used replay for native evidence, with fresh hosted native
execution pending.

[Baseline CLI result](controls/red-original-source/cli-controls.json),
[corrected CLI result](controls/green-corrected-source/cli-controls.json),
[focused run](logs/02-focused-helper-coverage.log.txt),
[full tooling run](logs/06-tooling-coverage.log.txt),
[native replay](controls/reparse-retained-native/reparse-retained-native.json).

The [author record](author-record.md.txt), [public author report](provider-final-message.md.txt),
[source bindings](SOURCE-BINDINGS.txt), and [root verification receipt](root-verification.json)
retain the implementation evidence. The [publication manifest](publication-manifest.json)
maps the 60 original sealed records, their [seal](SHA256SUMS.txt), and the two additional public
receipts to their archived paths and hashes.

The [original independent QA](../2026-11-17-ci-intent-1-independent-qa/README.md) and the
[correction 01 independent QA](../2026-11-17-ci-intent-1-correction-independent-qa/README.md)
preserve both earlier failures. Independent verification of correction 02, hosted execution,
and formal review remain pending.
