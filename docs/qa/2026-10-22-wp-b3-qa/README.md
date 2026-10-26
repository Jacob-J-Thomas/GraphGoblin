# WP-B3 independent QA, round 2

## 1. Branch and worktree

**Verdict: PASS WITH MINOR FINDINGS for `a33e0fec78f8c3ac5dc847a816c31a7f889e1fec`.** The requested reset/path rules, startup ledger guard, C6 per-loop boundary, native reset/wait restart and Edge behavior passed. One adjacent preflight behavior and one generated-artifact observation are recorded below. Infrastructure's full coverage command remains red solely on seven known D-015 native process cases; this report does not waive unrestricted-host/CI gates.

The checkout is detached at that exact head, in `<repository>/.claude/worktrees/codex-qa-wp-b3`. No source, product documentation, index or commit was changed. Round-1 evidence was left untouched; all new evidence is under this folder. [Final state and cleanup](final-verification.json).

Windows, Node `v22.14.0`, pnpm `12.8.1`, PowerShell with `pnpm.cmd`. Dependencies were already installed by the orchestrator, so no reinstall was needed. Build ran with `--force`: all 11 tasks succeeded with zero cache hits. Independent API listeners used 5652/5653 and Edge used 5654; CLI environments used 5651. No owner port/store was touched. The unchanged repository acceptance/E2E runners choose their own ports: wait-restart logged 5600 and the API process tests used 5680; other ephemeral values are not all printed. These are distinct from the manually selected 5651–5659 range.

[API environment](api-environment.json), [path environment](path-environment.json), [browser environment](browser-environment.json), [gate environment](gate-environment.json), [C6 environment](c6-environment.json). Exact `%TEMP%\gg-qa-266-r2-*` roots and removal receipts are in final-verification.json. Fixture subdirectories and database URLs are recorded in each path receipt. Edge ran isolated/headless on installed Microsoft Edge; its exact version is in browser-environment.json. No paid provider turn was made.

Read again: QA-COMMON, COMMON, ADR-0042, ADR-0044, docs/10's reset/guard sections, the CHANGELOG #266/#188 bullets and owner recipe steps 1–11. The latest user brief governs where it explicitly authorizes disposable junctions and temporary-store removal beyond the older common restrictions.

## 2. Per bolt and findings

**F-001 — minor: CLI `--preflight` is not byte-preserving for an unsupported WAL-backed store.**

1. Initialize a real current-format SQLite store with all shipped migrations.
2. With no API running, delete only the latest `__drizzle_migrations` row, leaving the complete head structure and committed change in WAL.
3. Record SHA-256 hashes of DB/WAL/SHM; run built `main.js --preflight` with this disposable `GG_DATA_DIR`.
4. The command correctly exits 1 and says `the migration ledger is behind the store structure`. However, the main DB hash changes and WAL/SHM disappear. The committed ledger rows read from independent before/after copies are identical: no conversion, ledger repair or logical ledger change was observed.

Expected: a diagnostic that refuses an unsupported store preserves the bytes, consistent with its read-only description. Actual: the mutable SQLite connection checkpoints the existing committed WAL on close. Reproduced in the initial extended check and twice more in isolated disposable fixtures. This is **not** a startup-guard failure: the separately measured built startup refusal left **every DB/WAL/SHM byte identical**. The failure is the additional preflight probe. Severity is minor because no logical ledger loss/change was observed; it still changes an operator's stored files during a failed readiness check.

Evidence: [original snapshots](truncated-ledger.json), [startup-only verdict](ledger-startup-verdict.json), [two isolated reproductions](ledger-preflight-triage.json). Relevant source: `apps/api/src/preflight.ts:421` opens `openDatabase` for inspection; `:493` closes it. Startup uses the read-only client in `apps/api/src/container.ts:172`. No fix was attempted.

**A-001 — minor generated-artifact observation: historical converter files remain in populated `dist` folders.**

The source and supported entry points are clean, but the in-place output contains files such as `packages/contracts/dist/upgrade-v2.js`, `upgrade-v3.js`, `packages/domain/dist/upgrade.js` and `convert-v3-v4/index.js`. They have no current source counterpart and no current public export. The available evidence does not establish exactly which previous build/cache produced each file; the normal in-place gates did not prune them. They were not deleted to manufacture a clean scan.

To distinguish residue from current compilation, contracts and domain were compiled into **new disposable output directories** with separate build-info files. Both exited 0, emitted 80 and 84 files respectively, and emitted **no converter/frozen-schema filenames**. Current public module exports also contain no retired names. Thus #188's current-source/current-consumer retirement passes, while a literal claim that this populated checkout contains no converter bytes would be false. Use clean build output for packaging; do not treat old generated residue as a current converter interface.

Evidence: [source/built inventory and script/bin metadata](converter-retirement.json), [fresh-output compilation and current public exports](fresh-compile.json). No source defect is attributed from residue alone.

| Acceptance criterion                                                                               | Result and evidence                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| #266: empty/current initialization, reopening, old store/import/device refusals                    | PASS: built owner recipe, native reset, wait/restart, API coverage and Edge checks                                                                  |
| #266: named, bounded reset preserves unrelated data                                                | PASS: exact snapshots, key/notes/junction target preservation, live-lock refusal and 21 executable path cases                                       |
| #266: explicit disjoint manifest; refused reset changes no bytes                                   | PASS: all built reset refusals returned 1 and left every byte unchanged; accepted dry runs were byte-identical                                      |
| #188: no current converter consumers/commands; current initialization/recovery protection retained | PASS for current source, supported exports and clean compilation. A-001 records populated-output residue; F-001 records adjacent preflight behavior |
| ADR-0044: retired exit event is per-loop; healthy loops work                                       | PASS: affected detail and run start 409 `LOOP_UPGRADE_REQUIRED`; healthy loop ran to `succeeded`; separate invalid field still refused startup      |
| Truncated migration ledger                                                                         | PASS for required startup refusal and **all-byte preservation**. Additional preflight byte-preservation check failed as F-001                       |

The [complete per-check matrix](checks.md) gives steps, expected, actual, status and evidence for every independent case, including the original QA-helper failure and the corrected targeted result. Detailed receipts retain complete outputs and before/after hashes.

## 3. Files changed

Only `docs/qa/2026-10-22-wp-b3-qa/` was added. It contains small text reports, JSON receipts, accessibility text snapshots and QA scripts. Round 1 remains in its original folder. No product source/test/configuration, existing numbered doc or ADR was edited; no dependency was added; no files were staged, unstaged or committed. Build outputs were produced only by the authorized build/gates and disposable diagnostic compilation.

## 4. Tests

- **API coverage:** 783 passed, 7 skipped; exit 0. Lines **97.36%**, branches **91.69%**; statements 96.15%, functions 93.93%. [api-coverage.log](api-coverage.log).
- **Infrastructure coverage:** 597 passed, 7 failed; exit 1. All failures are the three known D-015 native-process files below; no storage/guard test failed. No successful infrastructure coverage percentage is claimed. [infra-coverage.log](infra-coverage.log).
- **Native reset acceptance:** 1/1 passed. Full format-3 refusal, byte-identical dry run, wrong target, bounded reset/junction preservation and fresh health check. [native-reset.log](native-reset.log).
- **Native wait/restart:** passed for timer polls 50ms and 1000ms, preserving input identity, one timer wake, one paused wake and heartbeat count 2. [wait-restart.log](wait-restart.log).
- **Requested Edge spec:** 3/3 passed, no retry. [edge-spec.log](edge-spec.log).
- **Independent Edge checks:** 6/6 passed: old-import alert; browser loop creation; format-3/missing/null definition records; reload/second-tab blocking; exact exported records; zero draft PUTs before discard; explicit discard opening the server draft. Null-definition export/discard also passed via keyboard at 390×844. [browser-checks.json](browser-checks.json).
- **Independent path matrix:** 21 passed, 1 not testable (8.3 alias unavailable). Every dry/refused reset was hashed; ADS content was hashed separately because directory listings omit streams. [path-checks.json](path-checks.json).
- **C6 targeted check:** passed, including a real healthy run. [c6-checks.json](c6-checks.json).

Infrastructure D-015 failures, retained without name exclusions:

| File                          | Failing cases                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/adversarial.test.ts`     | `6/QA-LIMIT-001: ProcessScripts abort kills a real child and its grandchild` — 30s timeout                                     |
| `src/claude/process.test.ts`  | deadline/output-overflow kill; running-process cancellation; descendant termination — EBUSY cleanup and a marker still growing |
| `src/process/scripts.test.ts` | cancellation with incomplete UTF-8; process-tree timeout; signal-abort kill — unfinished termination / 15s timeouts            |

These are the native process-tree/cancellation sandbox artefacts identified as D-015 in the brief and branch delivery register. They remain failed command evidence and require unrestricted-host/CI validation. They are not WP-B3 reset/guard defects. No broad test suite was retried, no threshold was lowered and no new skip/exclusion was added.

The known C6 `subloop-restart` double-finish race associated with #320 did **not** occur in this serial API run; its absence here is not a claim that a probabilistic race is disproven. #205 model-picker tests were outside the requested device-draft spec and were not run; no claim is made that the whole browser suite is green.

One QA helper initially read `body.run.status` from `GET /runs/:id`, whose supported response is a direct RunRecord. Its TypeError is retained in api-checks.json; the corrected **C6-only** script uses `body.status` and passed. The original combined ledger/preflight receipt is also retained; its startup snapshot passed and its additional preflight snapshot failed. No product regression test was written or modified.

## 5. Gates

All package commands ran under Node 22, from PowerShell, with serial execution and no broad retry. Dependencies were already installed as stated in the brief; `install --frozen-lockfile` was not repeated.

| Command                                                                                                                                                          | Expected                                       | Actual / result                                                   | Evidence                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `pnpm.cmd build --force`                                                                                                                                         | Fresh successful build                         | PASS, 11/11 tasks, zero cached                                    | [build.log](build.log)                   |
| `pnpm.cmd test:reset`                                                                                                                                            | Native reset acceptance passes                 | PASS, 1 test                                                      | [native-reset.log](native-reset.log)     |
| `pnpm.cmd test:wait-restart`                                                                                                                                     | Identity/timers survive native restart         | PASS, both poll intervals                                         | [wait-restart.log](wait-restart.log)     |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                                                                                                               | Tests and thresholds pass                      | PASS, 783 pass / 7 existing skips                                 | [api-coverage.log](api-coverage.log)     |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage`                                                                                                    | Tests and thresholds pass                      | FAIL, only 7 D-015 natives; 597 passed                            | [infra-coverage.log](infra-coverage.log) |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/device-draft-format.spec.ts --retries=0 --output=<disposable>` with `GG_E2E_BROWSER_CHANNEL=msedge` | All requested Edge cases pass                  | PASS, 3/3                                                         | [edge-spec.log](edge-spec.log)           |
| `pnpm.cmd check:templates`                                                                                                                                       | Current examples valid; invalid graphs refused | PASS, four shipped starting points                                | [templates.log](templates.log)           |
| `pnpm.cmd check:migrations`                                                                                                                                      | Generation no-op                               | PASS                                                              | [migrations.log](migrations.log)         |
| `pnpm.cmd typecheck`                                                                                                                                             | All tasks pass                                 | PASS, 20/20; 12 cached. Cache I/O access-denied warnings retained | [typecheck.log](typecheck.log)           |
| `pnpm.cmd lint`                                                                                                                                                  | All tasks pass                                 | PASS, 11/11; 6 cached. Cache I/O warnings retained                | [lint.log](lint.log)                     |
| `pnpm.cmd check:layers`                                                                                                                                          | No layer violations                            | PASS                                                              | [layers.log](layers.log)                 |
| `pnpm.cmd check:deps`                                                                                                                                            | No dependency errors                           | PASS, one existing no-orphans warning for drizzle.config.ts       | [deps.log](deps.log)                     |
| `pnpm.cmd format:check`                                                                                                                                          | All repository text formatted                  | PASS, exit 0; all files formatted                                 | [format-check.log](format-check.log)     |

Per-command exit codes and elapsed time are in [gate-results.json](gate-results.json). `check:docs`, `check:licenses` and `check:tokens` were not needed for evidence-only work with no route/schema, dependency or web-source change.

## 6. Docs and retirement

No existing docs were changed. ADR-0042, ADR-0044, docs/10 and the current reset guide describe the tested rules. The CHANGELOG #266 note names explicit resets, unsupported formats, exact root admission, identity/listed-spelling behavior, streams, ambiguous hard links and stopped-store precautions. #188 names the removed tool, scripts, frozen shapes and converter fixtures. Historical conversion references remain attributable history, and the CHANGELOG points to an old build for historical use; those references are not an active converter in this build.

The built binary has no general help dispatcher. `--reset --help` correctly exits 2 and emits strict reset usage containing no converter option. Root converter/test-upgrade scripts and the converter bin are absent. Source search has no current retired-symbol consumers; fresh output and supported module exports are clean. The populated-output exception is recorded explicitly as A-001.

## 7. Decisions and parameters

- Tests exercised public built CLI/API interfaces and real Windows files, junctions, hard links, ADS, IndexedDB and Edge. No component was monkey-patched and no private state was accessed to bypass an interface.
- A 300s per-CLI watchdog exceeds the product store reader's 120s bound; API startup had a separate 180s bound. No retry-to-green or test timeout change was introduced.
- Minimal trigger-to-exit loops avoided provider turns. Browser authentication used a key created by the disposable built API; the token was never retained in evidence.
- The `R:` substitution was created only after checking for an unused letter, pointed only at the owned fixture root, and was removed in `finally`. Both DB-only alias refusal and configured-substitute-root acceptance passed. The actual mapping/cleanup receipt is [substituted-drive.json](substituted-drive.json) and [substituted-drive-cleanup.json](substituted-drive-cleanup.json).
- Independent fixtures used the current seed or malformed external records deliberately; no retired converter was used to construct them. Before/after snapshots never followed a link. All this round's disposable roots were removed only after their owned processes exited; remaining-root and TCP checks confirmed cleanup.

## 8. Caveats and open items

- F-001 is a minor adjacent preflight write. It needs an explicit reviewer/orchestrator disposition; no corrective product edit was authorized in this QA thread.
- A-001 is untracked generated-output residue. Current source and clean compilation passed; packaging should use clean output. The residue was not silently removed or mistaken for a supported converter command.
- FIFOs cannot be created on this Windows host, so native FIFO/socket/device database admission is **not passed** here. The POSIX FIFO regression is explicitly skipped on Windows. Symbolic links may require privileges; the tested directory links were junctions, which succeeded without those privileges.
- The 8.3 probe returned no distinct short filename. That optional native alias case is not testable on this volume. Actual cross-volume file-index collisions and separate physical `Data`/`data` directories on a case-sensitive filesystem were not created here; the exact-prefix refusal, case-insensitive listed-spelling behavior, look-alike identities and substituted-drive boundary were exercised.
- Full infrastructure coverage still exits 1 for the seven D-015 cases. An unrestricted reviewer/required CI must supply that green gate. This QA report does not resolve threads, close #266/#188, merge or waive release prerequisites.
- All **round-2** temporary stores and the substitute mapping were removed. Round-1 evidence and previously reported round-1 cleanup state were not altered or reclassified. [Final verification](final-verification.json).
