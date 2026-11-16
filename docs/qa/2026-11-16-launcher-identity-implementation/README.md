# Issue #435 — launcher identity implementation handoff

This packet preserves the accepted five-path source handoff and its command evidence. It is not a candidate-build, native, hosted-CI, or formal-review acceptance.

## Source handoff

The source was captured against post-#419 main 9fa8b2474c7290adb800c5e26be73511095cae25, tree 88ade580c80b2139b5d1bf51449dca10e33184f1. The exact five changed paths and byte digests are in [candidate-source.json](evidence/candidate-source.json), with the five byte-preserved source copies under [evidence/source](evidence/source/). Root accepted all five copies and the source manifest in [source acceptance](provenance/435-source-root-acceptance.json).

The helper now compares both existing entry paths through native realpath resolution. The test covers a disposable Windows checkout junction and a directory symlink on other systems; it requires alias helper output to match direct output, preserves empty stderr, and checks invalid configuration refusal. Documentation and changelog describe the checkout alias behavior. The original source report is preserved as [implementation README.md.txt](evidence/implementation-source-README.md.txt).

## Verification actually recorded

- **Old-built regression:** the runner exited 1; one test failed and one passed. The three new candidate assertions failed against the admitted old build as intended: the alias digest/state calls and invalid-configuration command returned exit 0 silently. The existing health, digest, and refusal coverage passed. See [command receipt](evidence/built-regression-baseline.json), [log](evidence/built-regression-baseline.log), and exact test bytes [built-regression-before.mjs.txt](evidence/built-regression-before.mjs.txt). This is old-build regression evidence, not candidate verification.
- **Focused API tests:** 13 passed, with the exact run record and output in [focused-api.json](evidence/focused-api.json) and [focused-api.log](evidence/focused-api.log).
- **Type check:** the API no-emit type check exited 0; [receipt](evidence/api-noemit.json) and empty [log](evidence/api-noemit.log) are retained.
- **Lint and formatting:** finalized test lint, scoped lint, and formatting records are retained under [evidence](evidence/). The scoped lint and format commands exited 0.

The [baseline output readback](evidence/preserved-baseline-output-readback.json) reports 1,231 preserved output files. The original build binding is not duplicated here; the [baseline packet](../2026-11-16-launcher-identity-baseline/README.md) records its external source path, exact SHA-256, size and 28,809/1,231/13/19/22 binding counts.

At this accepted source-handoff checkpoint, candidate build, candidate native verification, hosted Windows evidence, current-head CI, and formal reviews remained pending. No full coverage or repository-wide check pass is claimed.
