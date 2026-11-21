# #486 W handoff

W source work is complete in the admitted shared checkout; source files are now released to root integration. No issue-completion, acceptance, independent QA or merge claim.

Base: 02351e2fb932b3be44e7cc3fb3943a61d568226c. Exact core freeze inputs matched SHA-256 3c4e57f0608f0c25243353aee7948dda46381edef4ce6acff21158a94f9fb572 (freeze-v1.md) and 64762A13772EBB729F0E764D1115CFF58AD4100429C1B298359E6F0C7459D755 (freeze-v1-source.json). No interface mismatch/change was needed.

## Exact owned files

- packages/engine/src/testing/fakes.ts
- packages/infrastructure/src/fs/workspace.ts
- packages/infrastructure/src/fs/owned-resources.ts
- packages/infrastructure/src/sqlite/workspace-references.ts (comment only)
- packages/engine/src/edge-cases.test.ts
- packages/engine/src/run-manager.test.ts
- packages/infrastructure/src/fs/fs.test.ts
- packages/infrastructure/src/sqlite/history-cleanup.test.ts
- apps/api/src/history-cleanup.test.ts

Production adapters/fake accept only the frozen two-argument temp/fixed resolve. The engine owns render/trim. Fixed/relative mkdir behavior, temp identity/ownership, shared canonical journal use, writeFile and all cleanup/sweep algorithms remain intact. Direct owned callers and selector helper callers use frozen interfaces without compatibility overloads. CASES.md maps effects, controls and the required neighboring B19 assertion updates.

## Verification

- Engine focused group: final 70/70 PASS (engine-focused-02.log), including all 14 workspace preparation cases and corrected neighboring raw-coerce assertions. First 63/70 failure attempt retained.
- Infrastructure direct/filesystem/history group on G: 49 passed, one existing short-name failure, eight integration cases then filtered (infra-focused-01.log). The unchanged short-name case passes once on original C: host temp (infra-shortname-C-control-01.log). The original G: 8.3 path limitation is preserved, not hidden or weakened.
- After L production migration, all eight previously excluded engine/real-filesystem cases PASS (infra-engine-boundary-01.log). Together the infrastructure case set has passing evidence for all 58 distinct cases across the explicitly recorded commands and temp volumes; this is not an unfiltered single-command pass claim.
- All nine owned files pass scoped ESLint; final engine lint re-run passes after assertion/fixture correction. Final formatting and scoped git diff --check pass.
- Engine no-emit final attempt remains exit 1 solely for L's heartbeat-visit.test.ts:63 old Promise<string> workingDirectory fixture (engine-noemit-02.log); L/root notified. Earlier engine/infrastructure no-emit errors were only unmigrated L consumers. No W source/type diagnostics were observed.
- Built API history-cleanup runtime check, full unfiltered stable combined check/coverage and independent review/QA remain pending root. No build or coverage output was produced by W. Author checks imported the evolving shared core/L source, so root must bind the stable combined source for acceptance.

## Source and cleanup

Final W-only patch workspace.patch SHA-256: 5bc4905a109a6a24540692b62b80b91ceac483ad7bd620c4b508703fec5d74fa.

Final source-after.json SHA-256: 51cf7fb653d695eeab0b82f1656eff4a88027b0b308c0ac682b35e798291bd27. It contains all nine final per-file hashes; source-before.json preserves their pre-edit hashes. ATTEMPTS.md and raw logs/receipts retain failures and corrections. Git status snapshots distinguish shared dirty work; only the nine owned source files were edited by W.

Disposable test fixtures were removed by test hooks. The assigned G: task root contains only node-compile-cache. Automatic approval review rejected the attempted cache removal with the stated reason blocked by policy; no retry/bypass. cleanup.json and task-temp-after.json record this remaining scratch cache. Shared original C: temp/cache was never recursively cleaned. No Git index/branch/commit/push, owner data/store, provider, service, port or persistent environment mutation.
