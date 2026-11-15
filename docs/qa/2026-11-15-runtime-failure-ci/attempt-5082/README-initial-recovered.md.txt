# PR #485 CI attempt 1: head 5082bc17

This is the first CI attempt for PR #485. Run `43735208367` (run 881, attempt 1) tested source head `5082bc176e92cf3518abb630a5afc0a59c444815` against target `main` at `f91bd69b79dc417a2997ddb9c7670cb33df7597c`. GitHub's synthetic merge was `5db4567e252e503d44db79e1216f52312616b31f`, tree `959942bf3d6ba1a16daccad278c0a8a9aad022bd`, with parents target then head. All four job checkout logs show `refs/remotes/pull/485/merge` at that SHA.

## Result

The run concluded **failure**. Three jobs passed; Gates failed its Format check. The failed step ran `pnpm prettier --check .` and listed exactly these six retained raw inspector snapshots:

- `docs/qa/2026-11-15-runtime-failure-baseline/functional/attempt-2-evidence/a1-exit-depth/inspector-dom.html`
- `docs/qa/2026-11-15-runtime-failure-baseline/functional/attempt-2-evidence/a1-explicit/inspector-dom.html`
- `docs/qa/2026-11-15-runtime-failure-baseline/functional/attempt-2-evidence/a2-provider-error/inspector-dom.html`
- `docs/qa/2026-11-15-runtime-failure-candidate/functional/corrected-attempt-1/a1-exit-depth/inspector-dom.html`
- `docs/qa/2026-11-15-runtime-failure-candidate/functional/corrected-attempt-1/a1-explicit/inspector-dom.html`
- `docs/qa/2026-11-15-runtime-failure-candidate/functional/corrected-attempt-1/a2-provider-error/inspector-dom.html`

Build, seven acceptance steps, Typecheck and Lint passed. After Format check failed, Layer rules, migration no-op, design token rules, dependency graph, shipped templates, tooling browser measurements, unit coverage, licence, generated docs, contrast and dependency audit steps were skipped. The coverage upload step succeeded but reported that no coverage-summary files were present; the workflow artifact list is empty. No package test/coverage aggregate or audit result exists for this run. Acceptance logs expose individual Node test totals for some steps, but no aggregate across the seven acceptance steps.

- **Windows launcher:** job passed; 14 tests passed, 0 failed, 0 skipped. The upload step itself passed, but logged `No files were found with the provided path: .tmp/windows-launcher-*/`; no Windows evidence artifact was produced.
- **Template image:** job passed and loaded four installed templates without network or writable storage: starter (4 draft nodes), implementation (11), review (10), and qa (11). The image build logged that the shared workspace lockfile forced the legacy deploy implementation.
- **Browser:** job passed with 481 tests passed and 1 skipped, using Edge, one worker and zero retries. The sole skip was `live.spec.ts`, which requires `LIVE=1`, a Codex CLI/provider login and subscription quota; CI set `LIVE=0`. Optional `GG_ROUTING_STRICT_PERF` bounds were disabled; ordinary tests still ran. Browser coverage/exclusion reporting passed; failure-evidence upload was skipped because the job had no failure evidence.

All job logs also retain Node 20 action deprecation warnings (actions run under Node 24), and applicable Node `url.parse()` / `punycode` deprecation warnings. The full step snapshots and complete decoded job logs are linked below.

## Identity timing and correction

The initial PR/run identity readback records head `5082…` and base `f91…`. The terminal snapshot was collected after root had advanced the PR to corrected head `656a73214c5d59a25c22a4abf2d8b3bf17976959`; that newer PR state does not change this run's head or checkout, which the logs bind to synthetic merge `5db4567e…`. Root committed two narrow `.prettierignore` patterns on corrected head `656a73214c5d59a25c22a4abf2d8b3bf17976959` after this first run completed. The local format check is separate evidence; this CI attempt remains failed, with no rerun.

A separate oversized GitHub commit-response capture was interrupted before completion. The resulting `synthetic-merge-5db4567e.json` file is incomplete, unverified and excluded from the evidence manifest and report. The merge identity above comes from the bounded identity readback and completed job checkout logs.

## Files

- [Gate log](job-logs/gates.decoded.log) · [Gate steps](job-logs/gates.steps.json)
- [Windows log](job-logs/windows-launcher.decoded.log)
- [Template log](job-logs/template-image.decoded.log)
- [Browser log](job-logs/browser.decoded.log) · [Browser steps](job-logs/browser.steps.json)
- [Initial PR](pr-485.initial.json) · [Initial run](run-43735208367.initial.json) · [Initial jobs](jobs-snapshot-162950Z.json) · [Terminal snapshot](terminal-snapshot.json)

`evidence-manifest.json` records the retained evidence file sizes and SHA-256 values and separately labels the incomplete capture as excluded from evidence. `SHA256SUMS.txt` covers every directory file except itself.
