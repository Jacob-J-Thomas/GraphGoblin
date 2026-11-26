# Independent D237 lock-composition delta QA

**Pass for the admitted delta scope.** All thirteen independently designed cases passed on their first behavioral run, with zero independent skips. The unchanged lock-failure suite added fourteen passes; the unchanged Mac local-key suite added one pass and eighteen skipped POSIX cases. The exact selection therefore reports **28 passed, 18 skipped, 0 failed, 46 selected** across three files. The eighteen skipped cases are unexecuted requirements, not passing Mac proof. No confirmed integration-delta defect was established. This is not full Mac, UI, native POSIX or owner acceptance.

The tested candidate is head `e2161f5d9b13f6701929fa67ef77329d4bb98945`, tree `d1122527ef7f884ddc908bf2b569887e2980589b`, parents `6fe12f412cd74b034a77cde10a521bb319e8aa96` and `0f6c325becf3e3e0562ae69dfae2c42bcf1d7129`. Root created and admitted the detached QA checkout `G:/ggq/gg-mac-d237-qa/GraphGoblin`. QA independently read back its head/tree/parents and source hashes; root supplies predecessor/signature authority. No new signature verification was performed here.

The sole worktree addition is `apps/api/src/data-dir-lock.integration.independent.qa.test.ts`, SHA-256 `35bc29a71b5aff7b05796339938f9b7e087822645e87a7c568de42aa5b5e6f84`. `09-overlay-executed.ts` preserves the exact executed bytes. No product source, authored tests, lock/package manifests, index, Git configuration, original Mac checkout, Swift/AppKit or original evidence bytes were modified. No checkout/merge/commit/stage/publication or external provider/account operation was performed by this QA.

## Independent outcomes and evidence tiers

| Schedule | Actual cases | Outcome | Evidence tier |
| --- | ---: | --- | --- |
| L1 ordinary and optional-attested acquisition | 2 | One successful exclusive primary creation per public acquisition; a contender is refused; ordinary shape stays ordinary; attested proof identifies the same primary inode/device; release is typed/idempotent and reacquisition works | Native Windows file ownership/release; positive attestation controlled as disclosed below |
| L2 actual exited-child owner | 2 | Both overloads reclaim the genuine former owner's file, report `{ file: true, guard: false }`, create the new primary once and release it | Native Windows process/filesystem; attested positive separately controlled |
| L3 recovery cleanup failure | 2 | Both overloads reject without returning a successful lease, preserve matching primary/guard records at the fault, remove the primary on rollback, retain the guard, and refuse a contender | Narrow controlled guard-unlink EACCES; native surrounding I/O and owned child |
| L4 recovery plus rollback failure | 2 | Both overloads retain original and rollback errors in AggregateError, retain primary/guard ownership and refuse another writer | Two distinct controlled unlink errors; native surrounding I/O and owned child |
| L5 absent / genuine successor / removal fault | 3 | The wrapper forwards missing/kept outcomes, preserves the actual successor's bytes, retires proof, and retains failed-release ownership while blocking a contender | Native Windows absent/successor observations; controlled primary-unlink error and positive attestation |
| L6 verification crossing release | 1 | A previously successful verifier's final native observation is held; release begins/completes; both the new verifier and old in-flight verifier return undefined | Controlled completion barrier plus disclosed metadata; original underlying filesystem result |
| L7 canonical database ownership | 1 | Both overloads exclude each other through equivalent path spelling, share the canonical lock name, and both reject genuine multiple hard links | Native Windows canonical/file/hard-link observations; attested positive separately controlled |

These are thirteen concrete tests, not thirteen full product criteria. `BINDINGS.md` records literal public API and resource bindings. No private acquisition/release/verification helper was invoked, no lock-record writer/canonicalizer/verifier was reproduced, and no proof token was fabricated. The one-primary observation counts successful public exclusive creates, not private call counts or failed stale-file open attempts.

Windows lacks real geteuid here; the native attested verifier's refusal is asserted before controls in L1. Positive attestation controls only `process.geteuid` returning 0 and bigint uid/mode metadata becoming uid0/private0600. Real device, inode, link count, file type, opened descriptor results, reads and bytes remain real. Those controls are process-local, disposable/restored and explicitly admitted by root. They establish method behavior; they do not establish Darwin permission, uid, inode trust or O_NOFOLLOW semantics. L6 additionally delays the original second exact-primary lstat result after the verifier's byte/descriptor work. It does not substitute a made-up result.

## Actual execution and first failure

All package/check commands ran through pnpm.cmd on project Node `v22.23.4` / pnpm `12.8.1`, with separate original stdout/stderr bytes and actual start/end/exit receipts. `RUNTIME-IDENTITY.json` records the Node binary, selected Vitest/TypeScript/Zod resolutions and compiled lock/module-map hashes. This is selected identity, not a complete installation or native Mac identity.

| Command phase | Actual result | Receipt |
| --- | --- | --- |
| Fresh `install --frozen-lockfile --offline` | Pass; 801 reused, zero downloaded; esbuild 0.25.12 and 0.28.2 postinstall scripts ran | `01-install.receipt.json` |
| Repository build before API tests | 12/12 tasks successful, 10 cached | `02-build.receipt.json` |
| Initial API typecheck | Pass | `04-api-typecheck.receipt.json` |
| Initial overlay lint | Fail: type-only import, unknown promise rejection reason, forbidden console.log | `05-overlay-lint.receipt.json` |
| Final overlay lint | Pass after fixture-only correction | `07-overlay-lint.receipt.json` |
| Final complete API typecheck | Pass | `08-api-typecheck.receipt.json` |
| First/only behavioral selection | 28 passed / 18 skipped / 0 failed; 13/13 independent | `09-delta-tests.receipt.json` |

The failed lint output and `05-overlay-before-lint-fix.ts` are retained. Corrections use a type import, normalize the rejected value to Error, and emit case journals through the repository-permitted console.warn. Those structured observations appear in the original Vitest stderr; they are not product warnings or failed cases. No behavioral rerun, retry, sleep-to-green, timeout increase, threshold change or source fix occurred. Tests used the existing forks configuration and unchanged 20-second test/hook budgets, `--maxWorkers=1 --retry=0`. Each owned fixture child also had a 15-second lifetime cap; no child hit it.

The initial baseline-snapshot orchestration printed only its output when the tool yielded, losing that tool session identifier. A standalone baseline command exit was not retained. The complete generated JSON was independently parsed and its clean head/tree/status validated before installation; final content/index comparison is explicit in `PARITY.json`. No unobserved original exit is claimed and no behavior was rerun to replace it. The earlier preparation packet separately retains its corrected metadata-generation error and incomplete first manifest; those were preparation-only and preceded candidate execution.

## Owned resources and preservation

Eight directly spawned Node children used only the built public lock module in unique owned mkdtemp sandboxes. All eight closed with code 0 and no signal; their raw child streams were empty. IPC results and actual close receipts were captured during execution, not reconstructed from later PID lookup. `OWNED-CHILDREN.json` extracts those records from the original stderr. Native creation-time strings are present in four ready/release-fault receipts. The four rollback receipts bind direct process handles/PIDs and public failure state, without a separately logged birth string; this is not an unrelated-host process inventory.

Intentionally failed holds stayed in their disposable child and ended with it. The live successor was released through its own public lease before child exit. Every independent case's cleanup checked resolved containment, removed only its owned temporary root, and asserted actual absence; all thirteen cleanup hooks passed. Public filesystem fault/metadata adapters did not reach an owner store or owner process. No API listener, fixed port, browser, launcher, Swift/AppKit or device session was launched. Owner ports 4747/4748/11434 were not touched.

`PARITY.json` confirms all **42,372 tracked file SHA-256 values unchanged**, all eleven manual admitted source pins equal, head/tree/parents unchanged, raw index `419cea35e99f1f0fbe5901c70810bad36b8aade62258bec1dd3d19642f58c4a7` unchanged, ordered staged entries identical and common index absent before/after. Final status contains only the admitted untracked overlay. The heavy slot was explicitly released after execution and this readback at approximately 2026-11-23 02:43 UTC; only metadata/report sealing followed.

Root's separate whole-merge whitespace qualification remains exactly that: two trailing-space lines in an already-delivered signed-main raw QA candidate.diff, with byte identity preserved, and all eleven actual manual resolution paths passing its separate check. This QA did not rewrite that fixture, rerun that general gate, or waive a product/test/static/coverage requirement.

## Remaining gates

This result accepts only the bounded lock-composition behaviors above under their stated evidence tiers. It does not re-accept the complete local-key admission protocol, main/serve/reset/launcher lifecycle, inherited platform scenarios or full application regression. The eighteen real POSIX Mac cases remain unexecuted here. Exact integrated native macOS API/launcher/coverage, all 25 Swift production/executable entries, at least 90% line/region coverage plus explicit branch outcomes and unchanged V8 gates, the seventh hosted macOS lane/current-head/current-target CI, actual Claude opposing-family critique, reserved third/final Astra MAX audit, Finder/alias/Dock/browser-close/replacement/restarted-history GUI evidence, signed delivery and owner acceptance remain required. No general/formal review scan was consumed. The prior provenance-core QA packet remains frozen and separate.

Primary machine-readable evidence is `RESULTS.json`, `PARITY.json`, `OWNED-CHILDREN.json`, `RUNTIME-IDENTITY.json`, `09-delta-tests.json`, all `*.receipt.json`, executed fixture bytes and `MANIFEST.json`.
