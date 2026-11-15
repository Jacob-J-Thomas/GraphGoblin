# Issue #207 phase 1 conformance evidence

This packet preserves the phase 1 implementation recovery and selected evidence. It is a bounded record of the evidence listed here; it does not contain the later independent supplement.

## Source identity and handoff

The implementation freeze is commit `3effb992c5f367eb7cfc5c0b1d8c09b11b840f06`, tree `c46fd4268e146f7e977324abe87dc33bd07c7082`, parent `1dcee36b16cc4662e8acb691e9166aff52949ad9` ([freeze record](raw/root/phase1-freeze.json)). The freeze covers exactly 14 source and test paths. The later conflict-free parent integration is `c524434dd1a563b0946dbb8793a351b9cbe9d35f`, tree `9f6733608ad19892578dea0856865c88b35e64d7`, with parent `35bb3fbdc724a82064d0d9e65b551608542c6b22`; [the integration binding](raw/root/parent-correction-integration.json) records that the exact delta was those 14 phase 1 paths. The integration did not rebuild or repeat behavioral verification.

The retained recovery was performed by `claude-sonnet-5-5` at requested xhigh and exited 0 at `2026-11-14T20:08:58.090Z`. Its full handoff is preserved byte-for-byte at [handoff.md.txt](raw/sonnet-recovery/handoff.md.txt); the exact launch and exit records are adjacent. The original Opus attempt was interrupted during diagnostics; its exit record is not a successful completion.

## What this packet establishes

The ordinary focused recovery command passed 9 files and 133 tests. Separate no-emit TypeScript, changed-file ESLint, and Prettier checks also passed through `pnpm.cmd` on Node 22.23.4 without coverage arguments. The [focused test log](raw/sonnet-recovery/logs/02-focused-nine.log), [no-emit typecheck log](raw/sonnet-recovery/logs/03-web-typecheck-noemit.log), [lint log](raw/sonnet-recovery/logs/04-web-lint-changed.log), and [format log](raw/sonnet-recovery/logs/05-prettier-changed.log), with adjacent command metadata, preserve those results. The recovery did not run a build, coverage gate, browser, API, or service.

The retained binding checks report that all nine exercised product source modules match the recorded native source hashes, and all 1,227 files across 13 compiled trees still match the candidate build manifests. [The source binding](raw/sonnet-recovery/logs/09-native-source-binding-vs-restored-checkout.json), [compiled-tree verification](raw/sonnet-recovery/logs/06-restoration-verification.json), and [candidate build tree summary](raw/candidate-build-manifests/trees-summary.json) and its adjacent per-tree hash listings are retained for inspection. These are identity checks against the retained build, not a new build.

The candidate-B native run records nine scenario outcomes in its [run record](raw/native-results/candidate-b/run.json), with structured results retained by scenario. Only the six screenshots explicitly inspected by root are included: [repeat publication](raw/native-inspected-screenshots/candidate-b/repeat-published.png), [stale-script recovery popover](raw/native-inspected-screenshots/candidate-b/recovery-popover-script-stale.png), [ghost-edge recovery popover](raw/native-inspected-screenshots/candidate-b/recovery-popover-ghost.png), [occupied-kind refusal](raw/native-inspected-screenshots/candidate-b/kinds-occupied-refusal.png), [keyboard removal focus](raw/native-inspected-screenshots/candidate-b/keyboard-toolbar-remove-focus.png), and [emulated coarse selection](raw/native-inspected-screenshots/candidate-b/coarse-selected.png). The retained native sessions used Windows Edge; coarse input was emulated, not a physical-device test. This is implementer-run native evidence, not the separate independent supplement.

Root later reported phase 1 conformance accepted based on a separate independent supplement. That supplement and its screenshots/results are intentionally not duplicated here. This packet does not establish phase 2, modal deletion, final coverage, current-target CI, formal review completion, or owner acceptance.

## Retained failures and coverage diagnostic boundary

The interrupted Opus attempt's first failure logs and subsequent correction logs are retained under [interrupted-opus/logs](raw/interrupted-opus/logs/10-focused-first.log) and the adjacent numbered files. The older 796-test editor run is not included or claimed as current-source evidence because `Canvas.test.tsx` changed after it.

The repeated zero-threshold coverage diagnostics are preserved only as rejected execution history. The [root diagnostic disposition](raw/root/diagnostic-disposition.md.txt) rejects them as coverage acceptance evidence. The selected logs `25`, `26`, `27`, `28`, `29`, and `33` are kept under [the diagnostic command log](raw/interrupted-opus/logs/25-diagnostic-coverage-changed-files.log) and the adjacent numbered files; `25`, `28`, and `33` include their exact command metadata. Do not treat their exit status or test count as a package coverage result. No diagnostic coverage report directories are included.

## Packet integrity

[copy-manifest.json](copy-manifest.json) maps each preserved raw file to its original batch-relative path, byte count, and SHA-256. [link-checks.json](link-checks.json) records the local README links and their resolved targets. The [packet manifest](manifest.json) lists every payload file with its byte count and SHA-256; [SHA256SUMS.txt](SHA256SUMS.txt) covers all packet files other than itself. `.gitattributes` disables text conversion under `raw/` so the retained bytes remain unchanged when integrated into Git.
