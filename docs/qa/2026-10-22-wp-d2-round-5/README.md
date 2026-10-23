# WP-D2 round 5 (#246)

## 1. Branch and worktree

Branch `codex-wp-d2-webhook-retry`, worktree `.claude/worktrees/codex-wp-d2-webhook-retry`,
starting base `4fd622b28ccbb135c23f3c33f7cd83dab4fa603c`. During verification, two externally
added QA-record repair commits (`01a6f73a`, `5f5bca1d`) advanced HEAD to
`5f5bca1d70a4568a2347c672b4615def36f79aae`. Their only change is the historical QA README;
production source and tests are identical between these heads. The round-five work is uncommitted; ready for
orchestrator commit after review. No index, commit, branch, publication or owner-store changes.

The independent audit reviewed `c433939a`; this round reproduced its findings on the newer
base above before corrective edits. The auditor's original artifacts remain untouched under
`%TEMP%/gg-audit-d2-20261022`. The restored round-four QA logs were not edited.

## 2. Per bolt

All five findings concern #246. These are implementation and verification results, with
independent confirmation still pending.

| Finding                                         | Before on the current base                                                                                                                     | Fix and after evidence                                                                                                                                                                                                                                                                                                               | Regression and docs                                                                                                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: damaged pending thread wedges startup       | Auditor replay: exit 1, `served: false`, `SQLITE_ERROR: malformed JSON`, migration ledger remains 15 entries.                                  | Guard array/object types before nested JSON extraction and exclude malformed defaults from pending allocation. The built API starts on an original pre-0015 store holding a healthy and damaged pending run; healthy delivery finalizes, damaged run logs `HISTORY_UNREADABLE`, its initial thread and events remain byte-identical. | `startup-regression.mjs`; seven `migration isolates a damaged pending returnDefaults ... alongside a healthy run` cases. ADR-0043 and CHANGELOG Upgrade note.                                                           |
| P2: HTTP 600 strands delivery                   | Auditor driver: pending, attempt 1/5 in flight, no finalization; log `delivery.lastError.httpStatus: Too big: expected number to be <=599`.    | Normalize invalid statuses to retryable `transport` / unknown, omit `httpStatus`. Focused built API + real receiver: five requests, one identity, one final event, final failed delivery, succeeded execution, finalized run.                                                                                                        | `normalizes HTTP 600 to a journal-valid uncertain transport failure`; `response-outcomes.check.mjs ... 600`. Docs 05/07/08, ADR and CHANGELOG.                                                                          |
| P2: later rejection hides uncertainty           | Auditor's truncated 200 -> 429 -> 200: three attempts, one key; inspector `warningVisible: false`.                                             | Required sticky `acknowledgementUncertain` persists independently of `lastError` and the latest acknowledgement. Real Edge sequence ends delivered after three attempts with the 429 error and uncertainty/deduplication warning. Rejection-only control remains false.                                                              | Engine and panel parameterized tests; Edge `inspector retains unknown acknowledgement after a rejection and eventual success`; response checker `uncertainty`. Docs 03/05/07/08, ADR, CHANGELOG and regenerated client. |
| P2: malformed historical receipt loses evidence | Auditor replay rewrites `return.delivered` with `target: 17` and `unexpectedEvidence` to `delivery.finished`, drops both fields and finalizes. | Receipt conversion validates required/optional field types, bounds, strict payload/channel keys and duplicate keys. Replay leaves the original row byte-identical, unfinalized and available for unreadable-history diagnostics/explicit repair; healthy API startup is unaffected.                                                  | Twelve shape-damaged receipt fixtures, including separate invalid target and unexpected evidence cases. Auditor replay `migration-shapes.mjs`. ADR and CHANGELOG Upgrade note.                                          |
| P3: five added local paths                      | The HEAD scan for the local user name identifies the five new documentation lines called out by the audit.                                     | Two PATH examples now use `$env:APPDATA`; three worktree entries use repository-relative paths. New evidence is sanitized to environment tokens.                                                                                                                                                                                     | Static working-tree path scan; five QA Markdown files and this report. HEAD still contains the old text until the orchestrator commits.                                                                                 |

Evidence collectors are copies of the auditor's drivers, with only output/store locations
changed before reproduction; formatting later changed presentation. `native-audit.mjs` uses
5640/5641, migration/startup replays 5642/5644, and the focused 600 capture 5645/5646.
All manually created stores use `%TEMP%/gg-wp-d2-round5-*`. Existing mandatory test fixtures
retain their ephemeral listeners and established prefixes.

The old-store source is the auditor's retained synthetic fixture created by archived build
`52360d9`; it contains the original 15-entry ledger. This round copies it independently for
each startup. It does not claim a fresh historical dependency installation or old-build run.

To replay against the fixed built API, retain the auditor's synthetic fixture manifest and
its original store, then run from the repository root with a fresh evidence directory:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$env:pnpm_config_verify_deps_before_run = 'false'
pnpm.cmd build
$env:WP_D2_EVIDENCE = Join-Path $env:TEMP ('gg-wp-d2-round5-replay-evidence-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $env:WP_D2_EVIDENCE | Out-Null
$env:WP_D2_PHASE = 'after'
$scripts = 'docs/qa/2026-10-22-wp-d2-round-5'
node "$scripts/startup-regression.mjs"
node "$scripts/migration-shapes.mjs"
node "$scripts/native-audit.mjs"
node "$scripts/http-600.capture.mjs"
node "$scripts/response-outcomes.check.mjs" $env:WP_D2_EVIDENCE 600
node "$scripts/response-outcomes.check.mjs" $env:WP_D2_EVIDENCE uncertainty
```

This preserves the recorded before/after artifacts. The scripts create new stores; leave their
directory cleanup to the orchestrator under COMMON. `response-outcomes.check.mjs` against
the recorded `before` directory reproduces the quoted outcome-assertion failures without
altering the current source or restarting the old app.

## 3. Files changed

- Contracts: `packages/contracts/src/delivery.ts` adds the required uncertainty flag.
- Engine: `webhook-returns.ts` initializes, recovers and retains that flag; public-port tests
  cover unknown/rejected/accepted and rejection-only sequences. No `run-manager.ts` edit.
- Infrastructure: `http/delivery.ts`, its real-receiver regression, migration 0015 and
  `sqlite/delivery-runs.test.ts` guards/fixtures. No runs/row/decoding repository edit.
- Web: only `DeliveryPanel.tsx`, its component tests and the main-suite webhook delivery spec.
- API-client: regenerated `openapi.json` and `src/generated/schema.ts`.
- Docs: numbered docs 03/05/07/08, ADR-0043, one #246 CHANGELOG bullet, the five path fixes,
  and this evidence folder (drivers, sanitized raw observations, screenshots and gate logs).
- Additional shared QA edit: `docs/qa/2026-10-21-wp-d2-qa/README.md:90`, four padding spaces
  required by Prettier after the two external record repairs. A before/after comparison confirmed
  that all non-whitespace characters are identical; no restored log file was edited.

Shared production-file ranges in the final diff: delivery contract 42-43;
`webhook-returns.ts` 32, 131 and 204-206; `DeliveryPanel.tsx` 30-31;
HTTP adapter 108-121. These edits stay within delivery handling. All changed source/test/doc
hunks are listed in [source-ranges.txt](source-ranges.txt); raw evidence artifacts are contained
within this folder.

## 4. Tests

Demonstrated red before the corresponding fix:

- Startup: `AssertionError ... API must start with healthy and damaged pending runs`,
  `1 !== null`, with `SQLITE_ERROR: malformed JSON` in the child log.
- SQLite isolation: `LibsqlError: SQLITE_ERROR: malformed JSON` for string/array corruption;
  other invalid defaults allocated an unwanted journal row. Seven cases failed.
- Receipt preservation: expected original `return.delivered`/payload, received
  `delivery.finished`/rewritten payload. Nine newly added malformed-receipt cases failed.
- Real HTTP 600 adapter: `expected false to be true` for journal-schema validity.
- Native 600 outcome checker: `HTTP 600 must have a bounded final outcome`,
  actual `'pending'`, expected `'failed'`.
- Engine uncertainty/control: expected `acknowledgementUncertain: true/false`, received
  snapshots without the field. Both cases failed.
- Inspector component: expected an uncertainty warning after success, received `null`.
- Edge against the old built app: `getByText(/An acknowledgement was unknown/)` timed out
  after the successful three-attempt result and 429 were visible.
- Native inspector checker: `Successful delivery must retain the earlier uncertainty warning`,
  `false !== true`.

The focused green commands passed infrastructure 49/49, engine 20/20 and panel 7/7.
The two requested Edge files passed 3/3, including the new three-attempt regression.
The auditor-driver native replay completed all 28 observations without a driver failure.
Its HTTP 600 observation was an early attempt-4 snapshot, before the final scheduled retry;
the driver then deleted that loop. `after/http-600-final.json` is the separately observed
final result, checked by the same outcome assertions used against the old evidence.

Setup/verification errors are retained: the first isolation fixture omitted required
`outcome`; it was corrected and rerun red before the SQL fix. An initial component assertion
used identity comparison with an asymmetric matcher; it was corrected. A focused 600 checker
initially read the matrix's not-yet-written results file; the checker now reads its completed
focused capture independently. No full suite was rerun to replace a failed gate.

Full suites ran directly with `--maxWorkers=2 --coverage.reportOnFailure=true`, preserving
uncached dependency-source coverage and failures. Percentages below are statements / branches /
functions / lines; unchanged thresholds remain enforced.

| Package        | Original full-suite result                                       | S / B / F / L                 |
| -------------- | ---------------------------------------------------------------- | ----------------------------- |
| Engine         | PASS, 557 tests, 31 files                                        | 96.87 / 92.48 / 98.72 / 98.05 |
| Infrastructure | FAIL, 662 passed / 12 failed, 46 files                           | 97.54 / 94.55 / 97.88 / 98.41 |
| API            | PASS, 702 passed / 6 existing skips, 51 files passed / 2 skipped | 96.41 / 92.88 / 94.05 / 97.83 |
| Web            | PASS, 1482 tests, 118 files                                      | 98.00 / 94.77 / 98.45 / 98.92 |
| Contracts      | PASS, 259 tests, 19 files                                        | 99.49 / 94.92 / 100 / 99.73   |
| API-client     | PASS, 71 tests, 8 files                                          | 100 / 99.36 / 100 / 100       |

Changed-file coverage: `webhook-returns.ts` 100% lines, 97.18% branches;
`http/delivery.ts` 100% lines, 96.49% branches. The delivery projection remains 100% lines and
branches. `DeliveryPanel.tsx` is 100% lines and 91.30% branches. No package line/branch
threshold was lowered; all package line and branch percentages exceed 90%.

Each infrastructure failure file was run once alone with
`pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run <file> --maxWorkers=1`:

| File                          | Isolated result      | Full-run failure and disposition                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/adversarial.test.ts`     | 19 passed / 1 failed | D-015: `6/QA-LIMIT-001 ... abort kills a real child and its grandchild`: `Test timed out in 30000ms`.                                                                                                                                                                |
| `src/claude/process.test.ts`  | 2 passed / 3 failed  | D-015: `kills on deadline and output overflow` and `does not spawn ... cancels a running process` fail cleanup with `EBUSY: resource busy or locked, rmdir`. `kills the descendant ...` observes continuing output (`Object.is equality` failure) and EBUSY cleanup. |
| `src/process/scripts.test.ts` | 36 passed / 3 failed | D-015: incomplete UTF-8 cancellation: `native process-tree cancellation must finish before fixture cleanup: expected true to be false`; tree timeout and signal abort each `Test timed out in 15000ms`.                                                              |
| `src/sqlite/upgrade.test.ts`  | 25 passed / 1 failed | Five original `Test timed out in 20000ms` failures; isolated `refuses changed source, damaged SQL/ledger, malformed template identities and invalid definitions` still times out at 20039 ms. Load/deadline class, not D-015.                                        |

The other full-run SQLite timeouts were `requires every hash-bound review ...`, `rolls back
deletions, DDL, ledger, rewrites and marker ...`, `rechecks safety at commit ...`, and
`refuses an ordinary definition that would invoke a retired template loop`. The persistent
case builds several format-three fixtures and performs refusal inspections; no corrective
change or passing full-run claim is made for it. Original and isolated logs are both retained.

## 5. Gates

All commands select Node `v22.14.0` first. Pnpm 12's automatic dependency verification tried
to open its global install lock outside the writable sandbox on the initial before-build.
Installed tool versions match the manifests; no dependency was installed or linked. Subsequent
commands use process-local `pnpm_config_verify_deps_before_run=false` to run those dependencies.
Turbo reports nonfatal cache I/O access-denied warnings; actual process exits determine results.

The starting-head full format gate passed. After the two external QA-record commits, the
final format gate flagged only the historical QA README's table padding. Its whitespace-only
fix is included above; both the failed gate (`logs/round5-final-format-check.txt`) and the
subsequent full gate (`logs/round5-post-qa-format-check.txt`) are retained. That subsequent
attempt failed with `ENOENT` because scratch status files were moved into this evidence folder
while Prettier was scanning them. All files were preserved. After the layout was stable,
`logs/round5-stable-layout-format-check.txt` records the passing full format gate. This is a
verification cleanup race, not a product or D-015 failure.

| Command                                                                                                                                                      | Result                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                                                         | PASS, 20/20 tasks, zero cached                                                                                                                     |
| `pnpm.cmd lint`                                                                                                                                              | PASS, 11/11 tasks, zero cached                                                                                                                     |
| `pnpm.cmd format:check`                                                                                                                                      | PASS, all matched files                                                                                                                            |
| `pnpm.cmd check:layers`                                                                                                                                      | PASS                                                                                                                                               |
| `pnpm.cmd check:deps`                                                                                                                                        | PASS; existing `packages/infrastructure/drizzle.config.ts` orphan warning only                                                                     |
| `pnpm.cmd check:migrations`                                                                                                                                  | PASS, Drizzle generation is a no-op                                                                                                                |
| `pnpm.cmd check:docs`                                                                                                                                        | PASS                                                                                                                                               |
| `pnpm.cmd check:tokens`                                                                                                                                      | PASS                                                                                                                                               |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=2 --coverage.reportOnFailure=true`                                                         | PASS, figures above                                                                                                                                |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2 --coverage.reportOnFailure=true`                                                 | FAIL, original failures and isolated triage above                                                                                                  |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2 --coverage.reportOnFailure=true`                                                            | PASS, figures above                                                                                                                                |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 --coverage.reportOnFailure=true`                                                            | PASS, figures above; 1183.14 seconds                                                                                                               |
| `pnpm.cmd --filter @graphgoblin/contracts test:coverage --maxWorkers=2 --coverage.reportOnFailure=true`                                                      | PASS, figures above                                                                                                                                |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage --maxWorkers=2 --coverage.reportOnFailure=true`                                                     | PASS, figures above                                                                                                                                |
| `pnpm.cmd build`                                                                                                                                             | PASS, 11/11 tasks, zero cached                                                                                                                     |
| `pnpm.cmd test:webhook-retry`                                                                                                                                | PASS, nine scenarios; five exhausted requests, two crash requests; drain 85 ms in backoff and 9983 ms in flight, zero new requests in either drain |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/webhook-delivery.spec.ts e2e/webhook-receiver.spec.ts --retries=0 --output=test-results/round5` | PASS, Edge (`GG_E2E_BROWSER_CHANNEL=msedge`), 3/3, 1.4 minutes, after build                                                                        |
| `pnpm.cmd docs:generate`                                                                                                                                     | PASS; references unchanged                                                                                                                         |
| `pnpm.cmd --filter @graphgoblin/api-client generate`                                                                                                         | PASS, OpenAPI/client types updated                                                                                                                 |
| `git diff --check`                                                                                                                                           | PASS                                                                                                                                               |

Logs are retained in `logs/`; coverage percentages in `coverage.json` are collected from
each completed package's V8 report. File-only formatting/collection after the last gate keeps
the final report and artifacts current. No threshold, exclusion or test timeout was changed.

## 6. Docs

Docs 03/05/07/08 describe the required sticky uncertainty flag and its independence from the
latest error/acknowledgement. Docs 05/07/08 describe invalid statuses as existing retryable
`transport` / unknown failures. ADR-0043 records the audit amendment and awaits confirmation.
The #246 CHANGELOG Upgrade note explains preserved damaged threads/receipts, per-run
`HISTORY_UNREADABLE` diagnostics, repair/deletion and healthy startup; it retains the stopped
store backup and `DATA_UPGRADE_REQUIRED` rollback instructions and names the client field.
`docs:generate` ran; generated numbered references are unchanged. The API-client document
and types were regenerated for the required field. Five QA Markdown paths were corrected.

## 7. Decisions and parameters

Keep the register's section-6 policy unchanged: five attempts; a 10-second deadline; 2/5/10/20
second delays; 64 KiB acknowledgement bound; `Idempotency-Key`; no jitter or Retry-After logic.
No new failure class or final outcome is introduced. Invalid statuses cannot provide a recognized
acknowledgement, so they use existing retryable `transport` / unknown within the same budget.

Use one required boolean, `acknowledgementUncertain`, for any completed/interrupted unknown
attempt, never cleared by later rejection or success. It is false for fresh queues and
historical acceptance; true for historical unknown failures/pending returns. Existing
`effectMayHaveHappened` includes successful effects and cannot identify prior uncertainty.
The migration is explicitly editable before shipment; its historical budget stays literal five,
independent of runtime policy. There is no legacy runtime reader or optional/default flag path.

## 8. Caveats and open items

- Independent confirmation and exact-head sign-off remain pending. This run performed no Git writes.
- Full infrastructure coverage is red: 662 passed, 12 failed (seven D-015 termination cases and
  five SQLite upgrade deadlines). Isolated triage retained all seven native failures and one
  20-second upgrade timeout; it does not turn the full suite green. Details follow in gate data.
- The original audit evidence, restored historical QA logs and other workers' stores are untouched.
  Manually created replay stores are inventoried in `retained-stores.json` for orchestrator cleanup;
  COMMON explicitly forbids directory deletion, so no manual directory cleanup was attempted.
  Native process fixtures whose teardown failed may also remain; their exact synthetic names are
  retained in the D-015 logs. The eight replay stores are separate from those fixtures.
- The early 600 matrix sample and checker file-ordering error are retained alongside the focused
  final capture. They are distinguished from product failures and from the passing final checks.
- Native termination failures do not establish a fresh unsandboxed Windows pass. No paid or live
  provider turn was used; receiver deduplication is not assumed.
- Manual redelivery, Retry-After, recovery fan-out, conservative DNS/secret classification and
  #185 delivery streaming/finalization follow-ups remain outside this round. Migration numbering
  reconciliation with other pending branches remains orchestrator work; any new integrated head
  needs renewed sign-off.
