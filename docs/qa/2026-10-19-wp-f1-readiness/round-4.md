# WP-F1 round 4 (#179): Codex probe directory

## 1. Branch and worktree

`codex-wp-f1-readiness-precision`, worktree `.claude/worktrees/codex-wp-f1-readiness-precision` under the GraphGoblin checkout. Base merge: `3c52783bf57490500f981bd707d753f2dfc6ec0d`. Uncommitted; ready for orchestrator commit after independent review. No index changes, owner-app/store access, or provider turns.

## 2. Per bolt

The #179 integration issue is **reproduced and fixed** through the public `createCodexHarness(...).preflight()` interface.

- A real 226-character temporary root is assigned to all of TEMP/TMP/TMPDIR. Before the change, the regression test expected `ready`/`ok: true` but received `unknown`/`ok: false`, with **"Codex readiness could not be confirmed. Check that the Codex CLI starts and responds, then retry preflight."** The failed baseline run had 1 failure / 3 filtered cases. The old `mkdtemp` result would have been 248 characters, matching the Windows boundary measured in [WP-F5](../2026-10-19-wp-f5-launch-diagnosis.md).
- After the change, the same test passes. The existing package `.mjs` fake CLI runs all four no-turn commands from one fresh, empty, 250-character directory. The probe is removed afterwards, and the 226-character parent is empty. The test restores environment variables and removes its own disposable root in `finally`.
- A local helper uses `mkdir` with mode `0o700` and `gg-codex-probe-<8 random hex>`, retrying EEXIST over at most four fresh candidates. It does not reuse or remove an existing name. Other creation errors propagate before any CLI call; the existing public harness catch reports typed `unknown`.
- One real competing directory causes a fresh-name retry and successful readiness. Four real competing directories exhaust the bound with zero CLI starts and zero directory removals. Every competing directory's marker remains intact until the test cleans up its own parent.
- A real regular file used as the temp root causes a creation fault: one mkdir attempt, zero CLI starts, zero removals, unchanged file contents.

| Scenario                           | Verified result                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 226-character TEMP/TMP/TMPDIR root | Before: public readiness `unknown` instead of expected `ready`. After: fake CLI `ready`, one 250-character probe shared by four commands and removed. |
| One EEXIST collision               | Two distinct names; existing marker preserved; only the new probe removed.                                                                            |
| Four EEXIST collisions             | Four attempts; `unknown`; zero CLI starts/removals; all markers preserved.                                                                            |
| Temp root is a regular file        | One attempt; `unknown`; zero CLI starts/removals; file preserved.                                                                                     |

## 3. Files changed

- `packages/adapter-codex/src/cli.ts`: adds the small local directory helper and its Windows bound comment; replaces only the allocation call. Existing cleanup is unchanged. No cross-package helper import or test-only production export.
- `packages/adapter-codex/src/probe-directory.test.ts`: four tests through public harness readiness, using the existing fake CLI and real filesystem operations with collision injection at the filesystem boundary.
- `docs/06-harness-integration.md`: the existing Windows note now names both Claude and Codex probe directory patterns; this is the small cross-package documentation edit assigned by the brief.
- `CHANGELOG.md`: extends the existing Unreleased #179 bullet with exclusive Codex mkdir probes and bounded retries.
- `docs/qa/2026-10-19-wp-f1-readiness/round-4.md`: this report and gate evidence.

## 4. Tests

New file: `packages/adapter-codex/src/probe-directory.test.ts`:

1. `runs the fake CLI under a 226-character TEMP/TMP/TMPDIR root and removes its probe`.
2. `preserves 1 existing collision directories and bounds retries`.
3. `preserves 4 existing collision directories and bounds retries`.
4. `fails a real directory creation fault before starting the fake CLI or removing anything`.

The long-root regression failed before the production change and passes afterwards. All four tests pass together. The first collision-fixture attempt had two failures because it aliased the spied mkdir; the fixture was corrected to call the real filesystem implementation via `vi.importActual`. This was a test-code correction, followed by a new run; no production retry or timeout change was made to obtain a pass.

| Package        | Full-run tests                                                       | Lines              | Branches           |
| -------------- | -------------------------------------------------------------------- | ------------------ | ------------------ |
| adapter-codex  | 90 passed / 5 skipped (95); 6 files passed / 1 skipped               | 98.75% (317/321)   | 94.78% (309/326)   |
| infrastructure | 620 passed / 12 failed / 2 skipped (634); 38 files passed / 6 failed | 98.52% (2010/2040) | 94.43% (1612/1707) |

The coverage denominators include all source files under the existing configuration. The three installed-CLI tests are filtered by the brief's fake-only restriction; the four paid Codex LIVE cases are skipped. No coverage exclusion, threshold or test timeout changed.

All six failing infrastructure files were then run alone, after the full coverage and static gates finished, with the same fake-only test-name filter:

| File                           | File-only result                 | Disposition                                                                                                         |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/claude/harness.test.ts`   | 44 passed / 2 failed             | Stale merged expectations, not D-015: expected `Claude preflight failed`, received the typed Unknown message below. |
| `src/adversarial.test.ts`      | 19 passed / 1 failed             | Same real process-tree timeout at 30 seconds (D-015).                                                               |
| `src/claude/process.test.ts`   | 2 passed / 3 failed              | Same native cleanup EBUSY/descendant marker evidence (D-015).                                                       |
| `src/claude/readiness.test.ts` | 9 passed / 1 failed / 2 filtered | Hang remains `unknown`, but reports unconfirmed shutdown instead of the expected deadline detail (D-015).           |
| `src/process/scripts.test.ts`  | 36 passed / 3 failed             | Same incomplete-UTF-8 cancellation/termination failure and two 15-second termination timeouts (D-015).              |
| `src/sqlite/upgrade.test.ts`   | 26 passed                        | The two full-run 20-second timeouts did not recur. Whole isolated file: 30.86 seconds. Full-run gate remains FAIL.  |

The eight native-process-related failures reproduce in isolation and retain the sandbox/D-015 disposition. The two stale Claude expectations remain a separate integration finding at `src/claude/harness.test.ts:231`. No full suite was rerun; no unrelated test, timeout or threshold was changed. No native-process fix is claimed.

## 5. Gates

All commands use Node 22.14.0 first on PATH and `pnpm.cmd`; `node --version` was verified. Coverage calls packages directly, avoiding Turbo test-result cache hits. LIVE is absent. To honor this round's **fake CLIs only** restriction, both coverage commands use this test-name filter:

```text
^(?!.*(?:probes the actual installed|classifies a real installed signed-out)).*$
```

This explicitly filters the installed Codex smoke test and the two installed Claude tests; no source-coverage exclusions or thresholds change. The four paid Codex LIVE cases remain skipped.

| Exact command                                                                                                                                                                                                 | Result                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `pnpm.cmd typecheck --concurrency=2`                                                                                                                                                                          | PASS; 20 tasks (10 cached)                               |
| `pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage --maxWorkers 1 --coverage.reportOnFailure --testNamePattern '^(?!.*(?:probes the actual installed\|classifies a real installed signed-out)).*$'`  | PASS; 90 passed / 5 skipped                              |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers 2 --coverage.reportOnFailure --testNamePattern '^(?!.*(?:probes the actual installed\|classifies a real installed signed-out)).*$'` | FAIL; 620 passed / 12 failed / 2 filtered; triaged above |
| `pnpm.cmd lint --concurrency=2`                                                                                                                                                                               | PASS; 11 tasks                                           |
| `pnpm.cmd check:layers`                                                                                                                                                                                       | PASS                                                     |
| `pnpm.cmd check:deps`                                                                                                                                                                                         | PASS; existing no-orphans warning                        |
| `pnpm.cmd check:docs`                                                                                                                                                                                         | PASS; generated references current                       |

| Exact command                                                                                                                | Result                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm.cmd --filter @graphgoblin/adapter-codex exec vitest run src/probe-directory.test.ts -t '226-character' --maxWorkers 1` | FAIL before fix; 1 failed / 3 filtered; expected ready, received unknown |
| `pnpm.cmd --filter @graphgoblin/adapter-codex exec vitest run src/probe-directory.test.ts --maxWorkers 1`                    | PASS after fix and fixture correction; all 4 tests                       |

| Exact command                                                                                                                                                                                                     | Result                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/harness.test.ts --maxWorkers 1 --testNamePattern '^(?!.*(?:probes the actual installed\|classifies a real installed signed-out)).*$'`   | FAIL; 44 passed / 2 stale expectations         |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/adversarial.test.ts --maxWorkers 1 --testNamePattern '^(?!.*(?:probes the actual installed\|classifies a real installed signed-out)).*$'`      | FAIL; 19 passed / 1 native timeout             |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/process.test.ts --maxWorkers 1 --testNamePattern '^(?!.*(?:probes the actual installed\|classifies a real installed signed-out)).*$'`   | FAIL; 2 passed / 3 native failures             |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/readiness.test.ts --maxWorkers 1 --testNamePattern '^(?!.*(?:probes the actual installed\|classifies a real installed signed-out)).*$'` | FAIL; 9 passed / 1 native failure / 2 filtered |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/process/scripts.test.ts --maxWorkers 1 --testNamePattern '^(?!.*(?:probes the actual installed\|classifies a real installed signed-out)).*$'`  | FAIL; 36 passed / 3 native failures            |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/upgrade.test.ts --maxWorkers 1 --testNamePattern '^(?!.*(?:probes the actual installed\|classifies a real installed signed-out)).*$'`   | PASS; 26 tests; full-run timeouts retained     |

`pnpm.cmd format:check` and `git diff --check` both pass. `git diff --cached --quiet` confirms no index changes; `packages/infrastructure` has no diff. No browser/token gate is needed: no web files changed. No licence gate is needed: no dependency changed.

## 6. Docs

The Windows note in numbered doc 06 now names `gg-claude-probe-*` and `gg-codex-probe-*`. The existing #179 CHANGELOG bullet records the integration fix. No contract, route schema, dependency or architecture decision changed; no ADR, client regeneration or generated-reference change is needed.

## 7. Decisions and parameters

- Keep the helper local to adapter-codex; no cross-package filesystem coupling.
- Match the merged Claude implementation: eight random hexadecimal characters, exclusive nonrecursive mkdir, mode `0o700`, four attempts only for EEXIST. Other errors leave immediately before the CLI starts.
- Retain the existing post-probe removal path and public error sanitization.
- The new 250-character fake-CLI working directory is within Windows' measured 258-character limit. This change does not extend that limit. The 248-character mkdtemp boundary and wider native CLI measurements are WP-F5 evidence; this round runs only fakes.
- Collision injection creates real competing directories and marker files through the real filesystem implementation. The test uses only the public readiness interface and the existing CLI-runner port; no component internals are accessed.

## 8. Caveats and open items

- Infrastructure full coverage is a failing test gate despite passing percentage thresholds. Its 12 failures are triaged in section 4; none is erased by an isolated pass.
- Two merged Claude expectations are stale and outside this one-item Codex fix: `packages/infrastructure/src/claude/harness.test.ts:231` expects `Claude preflight failed`; the public harness now correctly returns **"Claude readiness could not be confirmed. Check that the Claude CLI starts and responds, then retry preflight."** The file has 44 passes / 2 failures when run alone. Infrastructure source/tests are unchanged in this diff. These two failures are not D-015.
- The installed Codex and Claude probes were not run, as this round requires fake CLIs only. No real-provider readiness claim is made.
- The separate Codex structured-completion temporary-directory issue (#363) is not changed.
- Typecheck and lint emit nonfatal Turbo `IO error: Access is denied. (os error 5)` warnings but exit 0. Dependency checking retains the existing `packages/infrastructure/drizzle.config.ts` no-orphans warning; no rule changed.

Owner product acceptance and independent review remain required before #179 closes. No commit was created. Existing coverage and scratch directories remain for the orchestrator; only newly created test roots are cleaned up by the tests. No owner instance, store, runtime, credentials, real provider CLI or paid turn was used.
