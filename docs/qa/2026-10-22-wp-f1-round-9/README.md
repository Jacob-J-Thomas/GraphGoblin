# WP-F1 round 9 (#179)

## 1. Branch and worktree

Branch `codex-wp-f1-readiness-precision`, worktree `.claude/worktrees/codex-wp-f1-readiness-precision`.
Base and unchanged HEAD: `06244e4cdf50d44ca1814136f5735e0d08486fff`.
`git merge-base --is-ancestor 2dd81ac9 HEAD` returned 0; the initial worktree was clean.
Uncommitted; ready for orchestrator commit after review. No index changes, commits or GitHub writes.

## 2. Per bolt

### #179: successful-exit sign-out — confirmed and fixed

The auditor's original `classification-r2.mjs` was run against the built API before production edits,
using copied auditor native fakes and a new disposable store on port 5638. These executables refuse
every model turn. [Before](classification-before.json), [after](classification-after.json),
[before log](built-api-before.log.txt), [after log](built-api-after.log.txt).

| Audit case | Input at auth status                         | Before, Claude                                           | After, Claude                           | Codex control                   |
| ---------- | -------------------------------------------- | -------------------------------------------------------- | --------------------------------------- | ------------------------------- |
| 20         | Exit 0, stdout `Not logged in`, empty stderr | `unknown`; no `authenticated`; 205 ms for both harnesses | `auth`, `authenticated:false`; 1,733 ms | `auth` / false before and after |
| 21         | Exit 0, empty stdout, stderr `Not logged in` | `unknown`; no `authenticated`; 219 ms for both harnesses | `auth`, `authenticated:false`; 1,501 ms | `auth` / false before and after |

The exact prior problem was: “Claude readiness could not be confirmed. Check that the Claude CLI
starts and responds, then retry preflight.” The corrected problem is: “Claude is not signed in.
Run claude auth login, then retry preflight.” No UI copy string or visual component changed.

The complete auditor collection has 27 cases: before, 48 assertions passed and two failed;
after, all 50 assertions passed. Four Codex conflict outcomes are deliberately record-only in
the auditor's script. All HTTP responses were 200 and no response exposed its private sentinel.
The empty, malformed, object, null, array and unrecognised controls remain `unknown` without
an `authenticated` fact. Structured signed-out and signed-in controls remain auth/false and ready/true.

The native built-API collector also checks Settings-facing harness preflight, system preflight and
draft validation for both zero-exit streams, with Settings unchanged:
[before surfaces](surfaces-before.json), [after surfaces](surfaces-after.json).

After the final gates and isolated triage, the original auditor script was executed again:
[27-case responses](classification-after-gates.json), [public surfaces](surfaces-after-gates.json),
[replay exception](replay-after-gates.json), [log](built-api-after-gates.log.txt).
All 50 asserted outcomes passed again, with no sentinel exposure. Earlier after-fix records and
timings above remain preserved rather than overwritten. [Summary](summary.json) derives the counts
from the retained responses and logs using [this script](summarize.mjs).

### #179: replay admission exception — reproduced and documented

With both binary paths missing, normal manual trigger start returned 422. Replay returned 202,
recorded `ROUND_9_EFFECT` from the preceding mutation, then failed with `HARNESS_NOT_INSTALLED`.
This happened before and after the fix: [before](replay-before.json), [after](replay-after.json).
The source run was established using a turn-refusing fake, not a provider. Replay and engine
behaviour were not changed; D-017's manual trigger-start and nested admission rule remains intact.

### #179: installed Claude assertion diagnostics — improved; instability not reproduced

The ready assertion still requires ready, ok, authenticated true and an empty problem list, and now
includes `JSON.stringify({problems: result.problems})` as its safe failure message. No CLI body,
environment or credential is printed. Five separate isolated executions of only the installed
no-turn probe passed; no login skip occurred. [1](installed-1.log.txt), [2](installed-2.log.txt),
[3](installed-3.log.txt), [4](installed-4.log.txt), [5](installed-5.log.txt).
The historical unknown/true result was not reproduced, so its cause remains unestablished.
No timing change or additional probe fix was made. It is not labelled D-015.

## 3. Files changed

Production changes are confined to infrastructure's Claude auth-status handling and bounded
process evidence. Shared-file changed ranges (current working copy):

| File                                               | Lines                              |
| -------------------------------------------------- | ---------------------------------- |
| Infrastructure `claude/harness.ts`                 | 225–226, 235–258                   |
| Infrastructure `claude/process.ts`                 | 31–32, 87–89                       |
| Infrastructure `claude/harness.test.ts`            | 800–827, 948                       |
| Infrastructure `claude/readiness.test.ts`          | 75–76, 96, 119–124                 |
| Infrastructure `claude/fixtures/readiness-cli.mjs` | 28–29                              |
| Codex `src/fixtures/readiness-cli.mjs`             | 36–37                              |
| API `src/readiness-evidence.test.ts`               | 25–26, 32–40, 82–84, 107–110, 154  |
| `docs/06-harness-integration.md`                   | 98, 105, 117–122, 127–129, 140–142 |
| `docs/07-api-and-streaming.md`                     | 344                                |
| `CHANGELOG.md`                                     | 7–8                                |

- `packages/infrastructure/src/claude/process.ts`: adds a fixed `notLoggedIn` fact from bounded,
  opt-in no-turn stderr, independently of exit code; stderr bodies remain ephemeral.
- `packages/infrastructure/src/claude/harness.ts`: accepts positive auth-status text on either
  stream after checking process failures; preserves structured account-method diagnostics.
- `packages/infrastructure/src/claude/harness.test.ts`: five process-precedence controls and
  real-turn error controls carrying the new metadata.
- `packages/infrastructure/src/claude/readiness.test.ts`: two zero-exit executable regressions,
  explicit false login assertion, and safe installed-probe assertion diagnostics.
- `packages/infrastructure/src/claude/fixtures/readiness-cli.mjs`: both zero-exit sign-out profiles.
- `packages/adapter-codex/src/fixtures/readiness-cli.mjs`: the matching Codex control profiles;
  no Codex production code changed.
- `apps/api/src/readiness-evidence.test.ts`: both public preflight/validation regressions,
  specific operator messages, false login facts, unchanged Settings and probe-free drafts.
- `docs/06-harness-integration.md`: manual trigger-start wording, replay exception and positive
  auth-status text semantics.
- `docs/07-api-and-streaming.md`: manual trigger-start scope and replay's separate admission policy.
- `CHANGELOG.md`: Unreleased sign-out correction ending `(#179)`.
- This QA folder: collectors, auditor fixture/script copies, sanitised responses and original
  gate/isolated logs. No other QA folder was changed.

## 4. Tests

Both new executable-boundary tests failed on old code, as did both API regressions:

```text
AssertionError: expected { state: 'unknown', ok: false, … } to match object { state: 'auth', ok: false }
- "state": "auth"
+ "state": "unknown"
```

[Unit failures](unit-before.log.txt), [API failures](api-regression-before.log.txt).
The corrected API file passes 9/9: [log](api-evidence-fixed.log.txt).
The two new executable regressions also pass in full coverage and the isolated readiness file.
The five new controls retain timeout, missing executable, unconfirmed termination, aborted process
and output overflow ahead of sign-out, with no false authenticated fact. Existing turn tests still
require `HARNESS_TURN_FAILED`, non-retriable, even when injected process metadata includes auth text.

Original infrastructure coverage: **FAIL, 721 passed / 15 failed (736), 43 files passed / 5 failed**.
Lines **98.46% (2111/2144)**, branches **94.76% (1719/1814)**.
[Full log](infrastructure-coverage.log.txt).

Original adapter coverage: **FAIL, 93 passed / 2 failed / 5 skipped (100)**.
Lines **98.76% (319/323)**, branches **94.78% (309/326)**.
[Full log](adapter-coverage.log.txt). The five skips are the four opt-in live tests and the installed
Codex check; this nonverbose gate does not expand its skip reason. No skip was added to obtain a pass.

Original API coverage: **FAIL, 744 passed / 3 failed / 6 skipped (753)**, with only the new message
expectations failing; subprocess teardown passed. Lines **98.04% (1805/1841)**, branches
**93.25% (1286/1379)**. [Original log](api-coverage.log.txt). The corrected file passed 9/9; the
full API gate was repeated once because its assertions changed, retaining this failed first run.

Final API coverage: **FAIL, 711 passed / 6 skipped, one worker error (753 declared)**.
The worker running untouched `src/classifiers.test.ts` exited with **3221225477 (`0xC0000005`)**;
36 declared tests have no reported completion result. No assertion failures were reported.
Reported (incomplete-run) coverage: lines **97.28% (1791/1841)**, branches **92.09% (1270/1379)**.
[Final log](api-coverage-fixed.log.txt). The crash is not D-015; its cause is unestablished.
The classifier file passed **40/40** in its one isolated run: [log](api-classifiers-alone.log.txt).
That does not explain or erase the coverage-run crash. No third full API run was made.

Every failed infrastructure file was run alone once:

| File                              | Original failures                                              | Isolated result and disposition                                                                                                    |
| --------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `adversarial.test.ts`             | Child/grandchild cancellation timeout                          | [Log](infra-adversarial-alone.log.txt); 19 passed / 1 failed; D-015 native termination                                             |
| `process/scripts.test.ts`         | Three cancellation/timeout failures                            | [Log](infra-process-scripts-alone.log.txt); 36 passed / 3 failed; D-015 native termination                                         |
| `claude/process.test.ts`          | Three native shutdown failures plus stdout transport assertion | [Log](infra-claude-process-alone.log.txt); 2 passed / 3 failed; stdout control passed alone, original failure retained             |
| `claude/readiness.test.ts`        | Hung fake's exact problem-list assertion                       | [Log](infra-claude-readiness-alone.log.txt); 20 passed / 1 failed; D-015 unconfirmed termination detail; installed controls passed |
| `sqlite/upgrade.test.ts`          | Six 20-second timeouts                                         | [Log](infra-upgrade-alone.log.txt); 26/26 passed alone; original timeout failures retained, cause unestablished, not D-015         |
| Adapter `probe-directory.test.ts` | Two 5-second timeouts                                          | [Log](adapter-probe-directory-alone.log.txt); 4/4 passed alone; original timeout failures retained, cause unestablished, not D-015 |

Examples of the D-015 assertions, without local paths:

```text
Error: EBUSY: resource busy or locked, rmdir '[local-path]'
expect(await readFile(marker, 'utf8')).toBe(stopped)
+ "Claude CLI check process did not confirm that it stopped. Check that the Claude CLI starts and responds, then retry preflight."
```

The full-run stdout control returned `timedOut:true` instead of false despite exit 0 and the expected
stdout; it passed alone. This extra failure
and the SQLite/Codex timeouts are not asserted to be sandbox termination failures or fixed by retry.

Test-authoring failures are retained too: [initial guard run](unit-after.log.txt) expected the
nonexistent `ABORTED` harness code for a synthetic aborted result (the existing wrapper returns
`HARNESS_TURN_FAILED`); [first API isolation](api-evidence-alone.log.txt) exposed an inaccurate generic
message expectation. Corrected assertions preserve each CLI's actual specific or generic detail;
production copy was not altered to satisfy a test.

## 5. Gates

Node 22.14.0 and `pnpm.cmd`, no dependency installation or threshold change. Full-suite failures
remain failures even where a file passed alone. The API is built before subprocess coverage.

| Command                                                                                                 | Result / evidence                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd build` before / after                                                                         | PASS / PASS; [before](build-before.log.txt), [after](build-after.log.txt)                                                                                       |
| `pnpm.cmd typecheck`                                                                                    | PASS after fixing the new unknown-value narrowing error; [first failure](typecheck.log.txt), [fixed](typecheck-fixed.log.txt), [final](typecheck-final.log.txt) |
| `pnpm.cmd lint`                                                                                         | PASS after removing unnecessary async from the new port fixture; [first failure](lint.log.txt), [fixed](lint-fixed.log.txt), [final](lint-final.log.txt)        |
| `pnpm.cmd format`                                                                                       | PASS; [log](format.log.txt); later evidence/changed test formatted separately                                                                                   |
| `pnpm.cmd format:check`                                                                                 | PASS; [log](format-check.log.txt)                                                                                                                               |
| `pnpm.cmd check:docs`                                                                                   | PASS; [original](check-docs.log.txt), [final](check-docs-final.log.txt)                                                                                         |
| `pnpm.cmd check:layers`                                                                                 | PASS; [log](check-layers.log.txt)                                                                                                                               |
| `pnpm.cmd check:deps`                                                                                   | PASS with existing `no-orphans` warning for `drizzle.config.ts`; [log](check-deps.log.txt)                                                                      |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1 --coverage.reportOnFailure` | FAIL; counts and triage above                                                                                                                                   |
| `pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage --maxWorkers=1 --coverage.reportOnFailure`  | FAIL; counts and triage above                                                                                                                                   |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=1 --coverage.reportOnFailure`            | FAIL initially on message assertions, then FAIL on classifier-worker crash; [original](api-coverage.log.txt), [final](api-coverage-fixed.log.txt)               |
| Auditor `classification-r2.mjs` against the rebuilt API                                                 | PASS, all 27 cases, 50 asserted outcomes; four record-only outcomes                                                                                             |

The gate-only [port preload](port-scope.cjs), copied from the prior reviewed QA tooling, constrains
stock fixture listeners to 5630–5639. [Listener records](listeners.jsonl) expose actual logged binds.
Some fixtures strip the logging variable, so the log is not a complete process/listener inventory.
Direct built-API collectors used 5638 without the preload. This is a disclosed test-environment
adjustment, not an unmodified network-environment run.

## 6. Docs

Docs 06 and 07 explicitly limit D-017's admission hook to **manual trigger start** and list replay
as an exception. Exact new replay sentence in doc 07: “Replay (`POST /runs/{id}/replay`) has a
separate admission policy and does not perform this preflight: it can return 202, execute preceding
mutations and then fail at an unready harness.” Doc 06 also says: “During auth status, explicit
`Not logged in` text on stdout or bounded stderr confirms sign-out even on exit 0.”
The CHANGELOG bullet is: “Recognise explicit Claude auth-status sign-out text on stdout or bounded
stderr even after a successful CLI exit; empty or unrecognised status remains unknown, and process
failures keep precedence. (#179)” No schema or route changed; no generated-reference update is needed.

To repeat the current-head public API evidence with the original audit fixture directory available:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
pnpm.cmd build
$audit = Join-Path $env:TEMP 'gg-audit-f1-r2-1792705147414'
node docs/qa/2026-10-22-wp-f1-round-9/collect.mjs after $audit
```

The final post-gate invocation adds `after-gates` as the last argument to preserve separate records.

Port 5638 must be free; do not stop another listener. The collector creates a fresh `gg-wp-f1-*`
root, removes provider-key variables from its own environment, uses only native no-turn fakes,
and closes its own API through supported `app.close()` in `finally`. It intentionally retains
disposable directories. The retained [auditor C# source](audit-cli.cs) is Windows PowerShell
5.1-only compilation tooling; [classification script copy](classification-r2.mjs) retains the
auditor's assertions with formatting changes only. The original script, not this copy, was executed.
Run [sanitisation](sanitize.mjs) after collectors finish before sharing any newly generated evidence.

## 7. Decisions and parameters

- Confirmed sign-out is processed only in Claude auth status, independent of successful/nonzero exit.
  Its text pattern is the case-insensitive whole phrase `Not logged in`, not broad auth keywords.
- The process runner adds only a fixed boolean from its existing last-8192-character stderr window,
  gated by `classifyDiagnostics`. It does not retain stderr or infer login facts from model output.
- Positive status evidence uses the existing structured-status path: process start, timeout,
  cancellation, overflow and unconfirmed termination are checked before setting authenticated false.
  Ordinary diagnostic precedence remains unchanged: syntax; explicit statuses; connection wording;
  quota/auth keywords, with recognised Claude stderr ahead of conflicting stdout. Positive explicit
  sign-out is treated like structured sign-out rather than inferred generic diagnostics.
- Existing 15-second command deadlines, five-second bounded shutdown confirmation, byte bounds,
  operation memo, concurrency, readiness states, model catalog and D-017 admission behaviour are unchanged.
- Replay retains its separate policy. Scheduled/webhook/internal-child/resume paths retain their
  existing execution checks and can fail after prior effects. No engine or run-route code was edited.

## 8. Caveats and open items

- Fable review, orchestrator commit and resumed independent acceptance audit remain pending.
- Coverage gates retain the failures above. Passing isolated files do not turn the original runs green.
  The historical installed-probe unknown/true result is not explained by five passing checks.
- The final API coverage worker crash (`0xC0000005`) is unresolved, not D-015. The untouched classifier
  file passed 40/40 alone; that does not make the gate pass. Both API runs' subprocess teardown checks passed.
- No live provider turn occurred. The native replay reproduction deliberately attempted work only
  through a fake that refuses all model turns. No owner app/store/listener was accessed.
- No orphan-process fix is claimed or prescribed. Sandbox native failures do not establish a
  production lifetime defect; complete process-tree termination/inventory is not claimed.
- The PR #375 subprocess teardown class and six #205/F2b browser failures remain outside this round.
  No browser or web gate was run because no web source or visual component changed.
- Other QA folders, engine/run-manager, model catalogs and stacked F4/F2b production regions are untouched.
  Evidence preserves original failures, with local paths removed and logs normalised to UTF-8 `.log.txt`.
- Evidence-tool ordering was corrected after the link audit ran before its future format-check log
  existed, leaving the subsequent hygiene JSON formatter without its input. Those setup failures
  are retained in [the verifier quote](hygiene-first.log.txt) and [formatter log](format-hygiene.log.txt);
  they are not product failures.
- Final `hygiene.json` records head/branch, ancestry, unchanged index, the allowed changed-file set,
  evidence links, absence of local user paths and whitespace checks.
