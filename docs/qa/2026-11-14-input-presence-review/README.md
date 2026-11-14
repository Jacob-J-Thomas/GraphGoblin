# #235 review and correction evidence

This proposal retains the scan 1 native repro, the scan 2 U22 claim corrections, and the numeric Omit implementation evidence. Review and implementation records are separated from later native and independent QA bundles.

## Scan 1 native repro

[Formatted GPT scan 1 report](gpt-scan1/report.md) has its source bytes at gpt-scan1/report.md.txt. It identified the native incomplete-number omission defect in the pre-correction candidate. The final attempt record, browser log and repeatable driver are retained with both first fixture attempts. The first two attempts failed because their fixtures were incomplete; they are preserved as fixture failures, not product failures. Selected before/after captures show New run and Wait.

The browser run bound to retained built files through gpt-scan1/build-binding-check.json and the API entry hash through gpt-scan1/api-binding-check.json. gpt-scan1/cleanup.json records the owned processes and locks absent after cleanup. The full run used Windows headless Edge 157 and a local fixture API; it did not call a model/provider. Large event streams, host command histories and the disposable database/key are excluded. The exact candidate CI link in the source review is retained as a historical gate only; it predates the numeric patch.

## Scan 2 precision corrections

[Formatted Opus scan 2 report](opus-research-scan2/report.md) has its raw source at opus-research-scan2/report.md.txt. It is a READY review of U22 research prose, not of the #235 input implementation. Its corrections narrow the #64 duration/signal reload wording, the #125 denied-read/no-PUT description, and the U22 byte-preservation statement. The report states that its requested xhigh effort is not independently observable. Sanitized session metadata preserves the reported Opus model, requested launch effort and exit status without token/cost data.

The [e0ff Git readback](u22-git-readback-e0ff50c5.json) and two distinctly named verifier scripts are byte-preservation evidence only. verify-u22-git-evidence-attempt1.mjs is the original attempt; its refusal on the expected attributes-metadata difference is retained as a historical first failure. verify-u22-git-evidence-corrected.mjs is the later collector that verified 29 original raw U22 data/artifact blobs and recorded both README and .gitattributes metadata differences. The original README blob also matches its raw copy. No baseline scenario was re-executed as part of that Git readback. This later root readback narrows the older scan's suggested raw-file count; the original scan report remains byte-preserved.

## Numeric Omit correction

[numeric-correction/handoff.md](numeric-correction/handoff.md) is the formatted implementation handoff; its raw Markdown is handoff.md.txt. It retains patches, first typecheck failure JSON, final focused logs and sanitized session metadata. At handoff time it correctly recorded 60 focused unit passes and said the production build and native test had not run. That status is historical, not current.

Later, the [rebuilt native browser bundle](../2026-11-14-input-numeric-native/README.md) passed all nine form-control cases on its first corrected-build execution. The [separate independent QA bundle](../2026-11-14-input-numeric-omit-independent/README.md) passed eight native - and 1e omission cases across desktop and coarse profiles, with required-value refusal, sibling values, persistence and representative target geometry. The earlier implementation unit stand-in remains distinct from these real browser checks. The bundles are linked, not duplicated.

The implementation launch requested Claude Sonnet 5.5 at xhigh; sanitized result metadata reports canonical Sonnet 5.5 and successful completion, but effective effort was not independently verified. The historic pre-correction CI summary does not verify the corrected head. Full current-head CI, the reserved fresh Astra audit and owner acceptance remain pending.

## Files and provenance

The [curation/source-manifest.json](curation/source-manifest.json) binds byte-preserved files to their source archive path and SHA-256. The [curation/publication-manifest.json](curation/publication-manifest.json) inventories the complete proposed QA tree after Markdown formatting. The [curation/markdown-publication-hashes.json](curation/markdown-publication-hashes.json) records source and publication hashes, including link rewrites; [correction-markdown-hashes.json](curation/correction-markdown-hashes.json) and [markdown-corrections.diff](curation/markdown-corrections.diff) retain the two canonical README before/after hashes and Markdown-only diff. Paths in these manifests are relative to the proposal docs/qa root (the parent of the three QA bundle folders). The prior CI summary's raw Markdown and formatted caveat copy are gate-status.md.txt and gate-status.md.
