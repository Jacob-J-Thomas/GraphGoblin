# PR #478 review correction implementation evidence

This packet preserves the design, implementation handoff, focused verification, negative controls, and root source-freeze records for the canvas review corrections. The handoff and reports are retained byte-for-byte; artifacts preserve the worker's original failed runs and recovery records alongside final checks.

## Scope and status

The worker addressed three reproduced correction areas: refusal when multiple stored edges share an ID, binding a selected edge to the loaded draft and its current endpoints, and arming the existing gesture gate when a card drag starts. A real Reset focus-order defect found by the new tests was also corrected. The work did not change the schema, API, draft admission, history model, or dependencies.

At the worker handoff snapshot, the assigned branch was at HEAD `993d58a781ed2f0b4d13756c39e83162307b0ccd`, tree `77f0af8c8276fba6761f3bc63bfa12a2d706ffa4`, with 16 modified tracked files and no staged or untracked paths. Root later verified and froze the 16 source paths at head `47b00a520a4b8787786102cac69d84f145f2ed1c`, tree `0ced356ea4dd474e0c8c31c47c650ddfde86a6a3`, parent `993d58a781ed2f0b4d13756c39e83162307b0ccd`. The exact path hashes are in the [worker's 16-path SHA-256 manifest](raw/implementation/artifacts/final-changed-paths.sha256) and [root source-freeze record](raw/root/source-freeze.json).

The separate root integration readback records candidate `ca9ac7bdea9adb0a05a5e515fb6d7bb229b1eab8`, tree `16cfc0dd206cf4a4865281c296eb26f289f0f252`, with parents source freeze `47b00a520a4b8787786102cac69d84f145f2ed1c` and actual main `41bde22c80a796bf8c4bec8ab5dec8e755271f9e`. It records 16 verified source paths and zero product delta. This metadata readback is not native QA or a final gate.

## Focused evidence

- Baseline and existing tests: 15 focused files, 309 passed at the clean worker base; the same 309 passed with the new production code.
- Final focused run: 27 files, 461 passed. The 27 new tests include 24 defect cases and three controls.
- Old-source negative control: 24 failed and 114 passed out of 138 when the seven old production files were restored. The mutation control also fails when same-selection retention is removed; restoration is recorded.
- Typecheck, changed-file ESLint, Prettier, and `git diff --check` passed. No build, full coverage, browser run, provider run, or corrected-head native run is claimed.

The complete worker handoff, short implementation report, and earlier [design report](raw/design/design-report.md.txt) are retained. The design report predates the final F3 implementation and describes that change as conditional. The final implementation state and focused evidence are in the handoff and implementation report. The short report has a malformed abbreviated Canvas.test hash; the full handoff and 16-path manifest carry the canonical SHA-256 `7216f6515d5b071d4017d368f10ba6959bdfb96d78e650a22d23973e76c1e7e1`. The report itself is preserved unchanged.

The worker's first-failure logs and fixture corrections remain in `raw/implementation/artifacts/logs/`. The restore-trap failure, immediate absolute-path restore, pre/post hashes and index readbacks, old-source negative control, and mutation control remain in `raw/implementation/artifacts/negative-control/`. The incident report says the script's relative restore ran from the wrong directory; manual restoration verified all 16 source hashes and the index unchanged, and no index command ran.

## Follow-up and limits

One of three formal review scans has been used. This packet is implementation evidence, not an independent correction review or sign-off. At the worker handoff and root source-freeze snapshot, corrected-head native QA was pending. Subsequent native QA on integration candidate `ca9ac7bdea9adb0a05a5e515fb6d7bb229b1eab8` passed five targeted cases but also reproduced a Reset-route double-click that deletes the connection. That separate result (report SHA-256 `6b2a4434eb388a0feb4172166082c43bd9425daaadc1539df6a72117d2b41ec3`) and the [published disposition comment](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/478#issuecomment-6887319153) remain distinct from this implementation packet; the newly reproduced behavior and its correction remain open. Current final-head CI and full coverage are not established here.

The source report preserves known limits: Decision route bookkeeping can rewrite another stored edge that shares an ID; route edits by shared ID can affect multiple holders; public Chat admission of duplicate IDs is unestablished; and fractional-pixel rounding at the 3 px drag threshold is untested. Root created [issue #481](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/481) as an open, backlog follow-up for ambiguous shared-ID route ownership. Its exact fresh GET body/state/labels are retained in the [issue readback](raw/root/issue-481-followup-readback.json). The follow-up was not dispatched; existing #476, #477, and #479 remain distinct and untouched.

Root's source-freeze record reports the actual worker as Claude Opus 5.5 xhigh and records the root admission state. A separate [safe completion summary](root-supplement/worker-completion-summary.json) records root-verified model and exit status without copying private worker result, event, or signature streams.

## Evidence map

- [Full worker handoff](raw/implementation/handoff.md.txt), [short implementation report](raw/implementation/report.md.txt), [design report](raw/design/design-report.md.txt), [implementation brief](raw/design/implementation-brief.md.txt), and [scope spec](raw/design/implementation-spec.json).
- [Exact full diff](raw/implementation/artifacts/final.diff), [diff hash record](raw/implementation/artifacts/final.diff.sha256), and [16-path SHA-256 list](raw/implementation/artifacts/final-changed-paths.sha256) with [path details and blob IDs](raw/implementation/artifacts/final-changed-paths-detail.txt).
- [Final source readback](raw/implementation/artifacts/final-readback.txt), [final focused run](raw/implementation/artifacts/logs/16-final-focused.log), [typecheck](raw/implementation/artifacts/logs/19-final-typecheck.log), [lint](raw/implementation/artifacts/logs/18-final-eslint.log), [format](raw/implementation/artifacts/logs/17-final-prettier.log), and [diff check](raw/implementation/artifacts/logs/20-diff-check.log).
- [Old-source failure summary](raw/implementation/artifacts/negative-control/first-failures.txt), [negative-control runner](raw/implementation/artifacts/negative-control/run-negative-control.sh), [mutation-control runner](raw/implementation/artifacts/negative-control/run-identity-mutation.sh), and [manual restoration verification](raw/implementation/artifacts/negative-control/restore-verify-manual.txt).
- [Root source freeze](raw/root/source-freeze.json), [actual-main integration metadata](raw/root/main-integration-readback.json), and [issue #481 exact readback](raw/root/issue-481-followup-readback.json).

See [retained-files-manifest.json](retained-files-manifest.json), [omissions.json](omissions.json), [link-checks.json](link-checks.json), and [SHA256SUMS.txt](SHA256SUMS.txt) for byte hashes, exclusions, and link validation. `.gitattributes` disables text conversion for `raw/` so retained bytes, including logs and diffs, remain stable.
