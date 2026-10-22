# WP-F1 round 8 (#179): final-audit classification fixes

## 1. Branch and worktree

`codex-wp-f1-readiness-precision`, worktree `.claude/worktrees/codex-wp-f1-readiness-precision` in GraphGoblin. First command confirmed base **`b83c7f145478956854756813ceaca3d9145f57d3`**; initial worktree was clean. Uncommitted; ready for orchestrator commit after review. Node **22.14.0**, `pnpm.cmd`, no index/branch changes, directory deletion through tools, owner-app/store access or provider turns.

## 2. Per bolt

**#179 / D-029 findings 1-3: reproduced before production edits and fixed.** The baseline build passed (11 tasks, 47.1 s). The auditor's original `classification-repro.mjs` ran against the built public API on **5638**, in a fresh `gg-wp-f1-r8-*` store, with copies of its native no-turn executables. The retained auditor server/store were not changed. The script itself was unmodified; only its fixture-root and base-URL arguments selected this isolated instance.

| Exact diagnostic / successful auth output                                                  | Before: Claude / Codex        | After: Claude / Codex                   |
| ------------------------------------------------------------------------------------------ | ----------------------------- | --------------------------------------- |
| Exit 1, stderr `API Error: 401 Authentication failed; check network settings.`             | `transport` / `transport`     | `auth` / `auth`                         |
| Exit 1, stderr `HTTP 429 Too Many Requests; network request failed.`                       | `transport` / `transport`     | `quota` / `quota`                       |
| Exit 1, stdout `API Error: 429 Too Many Requests`, stderr `Warning: setting is deprecated` | `unknown` / `quota`           | `quota` / `quota`                       |
| Exit 0, empty stdout and stderr                                                            | `auth`, false / `auth`, false | `unknown`, omitted / `unknown`, omitted |
| Exit 0, stdout `{}`, empty stderr                                                          | `auth`, false / `auth`, false | `unknown`, omitted / `unknown`, omitted |

Baseline response bodies: [classification-before.json](classification-before.json). The final built-API collection passed all five expectations for both harnesses: [classification-after.json](classification-after.json), with no `authenticated` field in either unknown case. The helper asserted those states and omissions; HTTP status was 200 for each lookup. The public fixture always refuses model turns.

- **Finding 1:** explicit HTTP/API status now precedes diagnostic wording. Syntax errors remain first. Existing connection, syntax, version-number and temporary-service cases retain their classifications. The two new classifier regressions and both executable/public-route paths establish this.
- **Finding 2:** Claude consults no-turn stdout when stderr is absent or classified `unknown`. Recognised stderr wins if both streams carry recognised, conflicting unstructured diagnostics: stderr is the CLI's primary error channel and the runner already provides its bounded classification. Both conflict directions have executable tests. Structured auth JSON is handled separately; process failures still take precedence. Model-turn stdout and retry classification are unchanged.
- **Finding 3:** missing recognised login evidence no longer creates a negative login fact. Empty output and `{}` on exit 0 return `unknown` with `authenticated` omitted. The exact problem is `Claude readiness could not be confirmed. Check that the Claude CLI starts and responds, then retry preflight.` (or Codex). Explicit signed-out and signed-in controls retain false and true respectively.

D-017 is unchanged: draft writes make no probes; explicit validation/publication/preflight/manual admission share one probe per harness, concurrently; manual admission includes pinned nested definitions. No route, memo, pinning or engine implementation changed here.

## 3. Files changed

### Domain

- `packages/domain/src/readiness.ts`: places explicit HTTP/API status ahead of diagnostic wording, after CLI syntax.
- `packages/domain/src/readiness.test.ts`: adds both mixed status/network regressions beside existing controls.

### Infrastructure

- `packages/infrastructure/src/claude/harness.ts`: fixes unknown-stderr fallback, preserves recognised-stderr precedence and leaves unrecognised login facts absent.
- `packages/infrastructure/src/claude/readiness.test.ts`: adds five executable regressions, two conflict controls and explicit login-fact assertions for existing ready/auth controls.
- `packages/infrastructure/src/claude/harness.test.ts`: corrects the existing combined capability/sign-out fixture from `{}` to explicit signed-out JSON; its assertions are unchanged.
- `packages/infrastructure/src/claude/fixtures/readiness-cli.mjs`: adds the exact audited outputs and both stderr/stdout conflict scenarios; still refuses turns.

### Codex adapter and API

- `packages/adapter-codex/src/cli.ts`: separates explicit sign-out, recognised sign-in and unrecognised successful output.
- `packages/adapter-codex/src/cli.test.ts`: adds four executable regressions, the stdout-quota control and explicit login-fact assertions.
- `packages/adapter-codex/src/fixtures/readiness-cli.mjs`: adds the five audited auth-status boundary profiles; still refuses turns.
- `apps/api/src/readiness-evidence.test.ts`: exercises both executable fixtures through Settings/system preflight and validation, checks zero-probe draft creation, unchanged Settings and no runs.

### Documentation and retained evidence

- `docs/06-harness-integration.md`: updates the readiness table, evidence precedence, stream-conflict rule and tri-state login facts.
- `docs/guide/07-troubleshooting.md`: explains unknown versus confirmed sign-out, explicit auth/quota statuses and the operator actions.
- `CHANGELOG.md`: adds the audit fixes under Unreleased, ending `(#179)`.
- `docs/qa/2026-10-19-wp-f1-readiness/qa-round-6/api-coverage.txt`: strips trailing spaces and extra final blank lines only.
- `docs/qa/2026-10-19-wp-f1-readiness/qa-round-6/admission-tests.txt`: strips the extra final blank line only.
- This evidence directory retains the reproducer, native fixture source, before/after responses and gate logs, with local paths removed. Every retained file is listed below; logs strip local filesystem paths, terminal escapes, trailing spaces and any API-key-shaped tokens. The unmodified auditor script was executed for the observations; its retained copy differs only in formatting.

- [after-api.txt](after-api.txt): passing focused regression/control results.
- [after-codex.txt](after-codex.txt): passing focused regression/control results.
- [after-domain.txt](after-domain.txt): passing focused regression/control results.
- [after-harness-fixture.txt](after-harness-fixture.txt): 46 passing current Claude harness tests.
- [after-infrastructure.txt](after-infrastructure.txt): passing focused regression/control results.
- [audit-cli.cs](audit-cli.cs): auditor native no-turn fixture source; Windows PowerShell 5.1 tooling.
- [baseline-secret-cleanup.json](baseline-secret-cleanup.json): owned baseline secret-row cleanup, without its value.
- [before-api.txt](before-api.txt): quoted pre-fix regression failures.
- [before-codex.txt](before-codex.txt): quoted pre-fix regression failures.
- [before-domain.txt](before-domain.txt): quoted pre-fix regression failures.
- [before-infrastructure.txt](before-infrastructure.txt): quoted pre-fix regression failures.
- [build.txt](build.txt): scrubbed successful gate output.
- [classification-after.json](classification-after.json): passing fixed-head response bodies.
- [classification-before.json](classification-before.json): reproduced baseline response bodies.
- [classification-repro.mjs](classification-repro.mjs): formatted copy of the auditor's five-case HTTP reproducer.
- [coverage-adapter-codex.txt](coverage-adapter-codex.txt): complete scrubbed package coverage output, including failures.
- [coverage-api.txt](coverage-api.txt): complete scrubbed package coverage output, including failures.
- [coverage-domain.txt](coverage-domain.txt): complete scrubbed package coverage output, including failures.
- [coverage-infrastructure.txt](coverage-infrastructure.txt): complete scrubbed package coverage output, including failures.
- [d015-assertions.json](d015-assertions.json): the eight isolated native failures and their scrubbed error text.
- [docs-check.txt](docs-check.txt): scrubbed successful gate output.
- [format.txt](format.txt): scrubbed successful gate output.
- [gate-results.json](gate-results.json): command exit codes and focused/isolated test counts.
- [infrastructure-lint-final.txt](infrastructure-lint-final.txt): passing lint after the fixture correction.
- [infrastructure-typecheck-final.txt](infrastructure-typecheck-final.txt): passing typecheck after the fixture correction.
- [lint.txt](lint.txt): scrubbed successful gate output.
- [listener-audit.json](listener-audit.json): all 116 allowed-port binds, aggregated.
- [native-after.txt](native-after.txt): scrubbed native final collection and supported shutdown/cleanup log.
- [package-summary.json](package-summary.json): counts and coverage denominators for all four packages.
- [port-scope.cjs](port-scope.cjs): verification-only TCP allocation boundary.
- [README.md](README.md): this eight-section report.
- [triage-adversarial.txt](triage-adversarial.txt): isolated D-015 failure output.
- [triage-claude-process.txt](triage-claude-process.txt): isolated D-015 failure output.
- [triage-claude-readiness.txt](triage-claude-readiness.txt): isolated D-015 failure output.
- [triage-scripts.txt](triage-scripts.txt): isolated D-015 failure output.
- [typecheck.txt](typecheck.txt): scrubbed successful gate output.

The API test and the documentation edits are the cross-package work assigned by this brief. F4/F2b visual components, model definitions, contracts, lockfile, engine and the protected `docs/qa/2026-10-20-wp-f1-qa/` folder/reports are unchanged.

## 4. Tests

All **16 new regression cases failed before the production fix**. Five additional new controls already passed. Existing domain controls remained green.

| Pre-fix command suffix (after `pnpm.cmd --filter <package> exec vitest run`)                                       | Before                            | After focused check    |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ---------------------- |
| Domain: `src/readiness.test.ts --maxWorkers 1 --reporter=verbose`                                                  | 2 failed / 20 passed              | 22 passed              |
| Infrastructure: `src/claude/readiness.test.ts -t 'audited Claude auth evidence' --maxWorkers 1 --reporter=verbose` | 5 failed / 2 passed / 12 filtered | 7 passed / 12 filtered |
| Codex: `src/cli.test.ts -t 'audited Codex auth evidence' --maxWorkers 1 --reporter=verbose`                        | 4 failed / 1 passed / 23 filtered | 5 passed / 23 filtered |
| API: `src/readiness-evidence.test.ts --maxWorkers 1 --reporter=verbose`                                            | 5 failed / 2 passed               | 7 passed               |

Exact pre-fix failures include:

```text
expected 'transport' to be 'auth'
expected 'transport' to be 'quota'
expected { state: 'unknown', ok: false, ... } to match object { state: 'quota', ok: false }
expected { state: 'auth', ok: false, ... } to match object { state: 'unknown', ok: false }
```

The first two failures appear in the classifier and both executable adapters; Claude alone fails the stdout-quota/warning case; both adapters fail empty/`{}` success. The same five cases fail through the public API. The [before-domain](before-domain.txt), [before-infrastructure](before-infrastructure.txt), [before-codex](before-codex.txt) and [before-api](before-api.txt) logs retain the test names and full diffs. The four `after-*.txt` files retain the focused passes, **41 cases in total** including existing domain controls.

The first infrastructure coverage run exposed one obsolete fixture expectation: `reports a missing capability and failed login together without starting a turn` supplied `{}` but expected `authenticated: false` and an auth-login action. That is the very inference finding 3 rejects. Its input now explicitly says `{"loggedIn":false,"authMethod":"none"}`; no assertion is weakened. The entire `src/claude/harness.test.ts` then passed **46/46**, including the three tests that forbid guessing real-turn causes from auth/quota/transport stderr. Only the affected file was rerun after this test-input correction; production runtime code and coverage denominators are unchanged. The original full gate remains failed, and none of its nine failures is hidden or relabelled as a full-suite pass.

Full coverage/results:

| Package                 | Files / tests                    | Statements | Branches | Functions |  Lines | Result                                         |
| ----------------------- | -------------------------------- | ---------: | -------: | --------: | -----: | ---------------------------------------------- |
| domain                  | 30 files; 591 passed             |     97.32% |   95.78% |    97.11% | 98.47% | PASS                                           |
| infrastructure, initial | 45 files; 643 passed / 9 failed  |     97.84% |   94.58% |    98.23% | 98.62% | FAIL: eight D-015 cases plus the fixture above |
| adapter-codex           | 7 files; 95 passed / 5 skipped   |     98.05% |   95.39% |    97.64% | 99.07% | PASS                                           |
| api                     | 55 files; 742 passed / 6 skipped |     96.59% |   93.25% |    94.48% | 98.04% | PASS                                           |

Codex's skips are the four opt-in paid-turn cases (`LIVE=0`) and the explicit installed-login skip. No provider turn was run. Both installed Claude no-turn tests, including the empty-home signed-out case, passed in the initial full infrastructure run; the auditor's earlier intermittent failure remains historical evidence, not a clean result retroactively obtained by this round.

## 5. Gates

All pnpm commands select Node 22 first on PATH. Full coverage runs directly, rather than relying on Turbo's coverage cache. `--coverage.reportOnFailure` retains truthful metrics on failing suites; additional text/JSON-summary/JSON reporters do not alter thresholds or exclusions.

| Command                                                           | Result                                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm.cmd typecheck`                                              | PASS: 20 tasks, 76.368 s                                                                                                       |
| `pnpm.cmd lint --concurrency=2`                                   | PASS: 11 tasks, 174.772 s                                                                                                      |
| `pnpm.cmd format:check`                                           | PASS; final added report/artifacts also checked with Prettier                                                                  |
| `pnpm.cmd check:layers`                                           | PASS                                                                                                                           |
| `pnpm.cmd check:deps`                                             | PASS: 819 modules / 3,262 dependencies; one existing `drizzle.config.ts` no-orphans warning                                    |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage`             | PASS; full flags below                                                                                                         |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage`     | FAIL: 643 passed / 9 failed; eight D-015 cases reproduced separately; obsolete fixture corrected and all 46 harness tests pass |
| `pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage`      | PASS                                                                                                                           |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                | PASS: 742 passed / 6 skipped                                                                                                   |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`                | Not run: no web source changed, as allowed by the brief                                                                        |
| `pnpm.cmd build`                                                  | PASS: 11 tasks, 23.384 s on the fix                                                                                            |
| `pnpm.cmd check:docs`                                             | PASS; generated references current                                                                                             |
| Auditor's `classification-repro.mjs`, against the built fixed API | PASS: all five cases match for both harnesses; unknown login facts omitted                                                     |

Each full package coverage command adds `--maxWorkers 1 --coverage.reportOnFailure --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --reporter=default --reporter=json --outputFile=<disposable-report>`. `LIVE=0`; TEMP/TMP/TMPDIR point inside the new disposable root. A temporary, verification-only `NODE_OPTIONS` preload restricts TCP listeners to **5630-5639**, because stock fixtures choose 5600-5699 or ephemeral ports. It rotates ephemeral candidates, retries occupied allowed ports and refuses excluded ports with EADDRINUSE. A real-socket smoke check bound 5631/5632 and refused 5600. Product/test source has no port change; native classification collection uses explicit 5638 without that preload. The [listener audit](listener-audit.json) records 116 binds, all within the allowed ten ports; zero excluded-port binds. The [preload source](port-scope.cjs) is retained for review. It changes verification I/O only, not product source. Direct native before/after servers used 5638 without the preload.

### D-015 native termination disposition

All eight native failures reproduced in four separate, single-worker runs. No state assertion, timeout, threshold or process handling was weakened. Full error evidence is retained in [d015-assertions.json](d015-assertions.json).

| Isolated source and selected cases                                   | Result                                               | Quoted assertion / error                                                                                                                                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adversarial.test.ts`, abort child/grandchild                        | 1 failed / 19 filtered                               | `Test timed out in 30000ms.`                                                                                                                                                              |
| `process/scripts.test.ts`, incomplete UTF-8 cancellation             | selected with the next two; 3 failed / 36 filtered   | `native process-tree cancellation must finish before fixture cleanup: expected true to be false`                                                                                          |
| `process/scripts.test.ts`, timeout and signal-abort cases            | both failed                                          | `Test timed out in 15000ms.`                                                                                                                                                              |
| `claude/process.test.ts`, deadline/output overflow and running abort | selected with descendant case; 3 failed / 2 filtered | `EBUSY: resource busy or locked, rmdir`                                                                                                                                                   |
| `claude/process.test.ts`, descendant lifetime                        | failed                                               | expected the marker's contents to stop changing; it kept growing, followed by `EBUSY` during cleanup                                                                                      |
| `claude/readiness.test.ts`, hanging no-turn CLI                      | 1 failed / 18 filtered                               | Expected `Claude CLI did not answer before the check deadline.`; received `Claude CLI check process did not confirm that it stopped.` (each followed by the unchanged check/retry action) |

Exact selectors (each command also used `--reporter=default --reporter=json --outputFile=<disposable-report>`):

```powershell
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/adversarial.test.ts -t '6/QA-LIMIT-001' --maxWorkers 1
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/process/scripts.test.ts -t 'kills and closes a real process cancelled|kills the process tree on timeout|kills the process when the signal aborts' --maxWorkers 1
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/process.test.ts -t 'kills on deadline and output overflow|does not spawn for an already aborted|kills the descendant' --maxWorkers 1
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/readiness.test.ts -t 'hang reports unknown' --maxWorkers 1
```

Logs: [adversarial](triage-adversarial.txt), [script processes](triage-scripts.txt), [Claude processes](triage-claude-process.txt), [Claude readiness](triage-claude-readiness.txt). These are the identified D-015 native-control boundary, not evidence that all Windows process termination is broken. The separate obsolete fixture failure is not D-015. The fixture correction's 46-case file pass and final infrastructure typecheck/lint passes are retained; no second full infrastructure gate is presented as passing.

The original auditor script invocation used the isolated copied-fake root and the built API URL:

```powershell
node "$auditRoot/classification-repro.mjs" "$qaRoot" 'http://127.0.0.1:5638'
```

Both API instances were closed through the built app's supported `app.close()` / container stop path. This round makes no fresh general child-lifetime or orphan-process claim.

Turbo's shared-cache `Access is denied (os error 5)` warnings do not change the successful task exit codes. PowerShell 5.1 also wraps redirected native stderr in `NativeCommandError` records even when the command succeeds; gate results use captured native exit codes and test summaries. No dependency linking, permission override, coverage exclusion, threshold change or timeout increase occurred.

## 6. Docs

The numbered integration doc is the source for diagnostic precedence; guide 07 links to it and gives the exact operator message for empty/unrecognised successful login output. The readiness table and CHANGELOG describe the changed behavior. D-017 is retained. No contract enum, HTTP schema, migration, default/provider selection or architectural decision changes, so no client regeneration or new ADR is needed. `pnpm.cmd check:docs` passes; generated references are unchanged. The protected older QA folder and its missing-artifact reports remain the orchestrator's regeneration work.

## 7. Decisions and parameters

- **Within one no-turn diagnostic:** CLI syntax first; explicit HTTP/API 401/403 -> auth, 429 -> quota, 5xx -> transport; connection errors/wording next; quota/auth keywords last. A returned status is stronger evidence than incidental network advice. Existing errno and authentication-server connection examples remain transport; CLI version components are never status evidence.
- **Across Claude diagnostic streams:** recognised stderr is primary, including a recognised conflict. Stdout is fallback for absent/unknown stderr. This preserves the runner's bounded error-channel evidence without retaining its raw body. Structured auth JSON remains a separate positive fact; timeout/start/cancellation/overflow/unconfirmed termination overrides diagnostic guesses. No model-turn stdout inference is added.
- **Login facts:** positive supported sign-in -> true; explicit signed-out status or a wrong Claude account method -> false; absent/unrecognised successful output -> omitted. Exit 0 alone proves no login fact. Unknown uses the existing detail/action helper and exposes no CLI bodies.
- **Test limits:** the new executable/API cases use the existing 60-second fixture-test bound to accommodate several local no-turn subprocesses. No existing test deadline or runtime probe deadline changes.

For owner reproduction, use Windows PowerShell 5.1 (the retained C# source is 5.1-only tooling), Node 22 and `pnpm.cmd build`. Compile [audit-cli.cs](audit-cli.cs) to separate `claude.exe` / `codex.exe` files in a fresh `gg-wp-f1-*` temp root; write each directory's `harness.txt` (`claude`/`codex`) and `scenario.txt` (`ready`). Set `GG_CLAUDE_BINARY`/`GG_CODEX_BINARY` to those files, use a new `GG_DATA_DIR`, host 127.0.0.1 and free port 5630-5639, clear `JEV_API_KEY` and set `GG_JEV_API_KEY` empty, then start `node apps/api/dist/main.js`. Run `node docs/qa/2026-10-22-wp-f1-round-8/classification-repro.mjs <fake-root> http://127.0.0.1:<port>` from a second terminal. Its auth profiles are five lines: exit code, pre-output delay ms, Base64 UTF-8 stdout, Base64 UTF-8 stderr, post-output delay ms. Expect the five corrected rows above; unknown responses must omit `authenticated`. The fixture refuses every turn. Use the public API regression test for Settings/system-preflight/validation preservation checks. Stop the owned foreground API with Ctrl+C; leave disposable directories for orchestrator cleanup.

## 8. Caveats and open items

Verification is complete with the infrastructure gate failure disclosed above. All three blocking classification findings are fixed; the native recheck passes for both harnesses. No merge/closure/sign-off claim is made. The orchestrator owns blocking finding 4: regeneration of the missing October 20 QA evidence on the fixed candidate head. F4/F2b must re-merge/review the resulting head.

Non-blocking audit disposition:

1. Installed signed-out intermittency: not reproduced in the current initial full run; retain the auditor's failed run and defer further intermittent-deadline investigation. No weaker state assertion or retry-to-green change.
2. Six known Edge failures: retained as the audit's evidence, not rerun here because no web source changed; four are #205 model-picker cases and two belong to WP-F2b.
3. Historical local-path hits: outside this change; no historical document rewrite. New evidence is scrubbed.
4. Round-6 text whitespace: reproduced the 14 reported findings, then trimmed only line-end whitespace and excess final blank lines in the two named files; diagnostic tokens are identical.
5. Claude policy asynchronous message assertion: defer to the web/F2b scope; no component or browser-spec change here.
6. Existing editor-save fixed-sleep assertion: unchanged/outside scope; the audit's initial failure remains recorded.

One isolation detail: the first baseline API inherited the legacy `JEV_API_KEY` alias and logged seeding that key into its new encrypted disposable store. No key value was printed and no provider call occurred. Later collection explicitly clears the alias and supplies empty `GG_JEV_API_KEY`. The owned baseline secret row was then removed through its public API: 204, with no raw value read ([cleanup record](baseline-secret-cleanup.json)). The baseline/after stores, fake executables, native-test leftovers, raw logs and normal ignored coverage outputs remain for orchestrator cleanup; no store or directory was deleted through tools.

Readiness remains an admission-time prerequisite observation, not provider entitlement or proof of a future model turn. Native termination failures are D-015 only where their assertions establish that boundary; no orphan fix is claimed or prescribed.
