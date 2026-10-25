## 1. Branch and worktree

Branch `codex-wp-c7-319`, worktree
`%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-wp-c7-319`,
base `d32aa382cfc5578632e8b2b2cfd11813df9f8c44`.
Uncommitted; ready for orchestrator commit after review and disposition of the recorded parallel-run failures. No staging, commits, branch changes, GitHub
writes or subagents. Only this checkout and disposable temporary stores were used.

## 2. Per bolt

**#319: implementation complete; final serial gates and both native browser tests passed.** This is implementation
evidence for **Part of #319**, not owner acceptance or issue closure.

| Criterion                          | Result and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reproduce before fixing            | The built baseline gateway reported `draining`, then `awaiting-choice` with the active run ID and `choices: ["wait", "force"]`. The browser showed its ordinary Loops page with no shutdown notice or choice. See `baseline-draining-state.log.txt`, `baseline-awaiting-choice-state.log.txt`, `baseline-browser-at-expiry.log.txt`, `baseline-expiry.png` and `baseline-result.log.txt`. The real-browser regression failed because the heading `Gateway is draining` did not exist. |
| Every page explains draining       | `ShutdownNotice` is mounted in the common application shell. It explains refused independent starts, finishing active work, saved waits/pauses and recoverable queued independent work. Component navigation tests and the native Loops/Events/reload scenario exercise the shell.                                                                                                                                                                                                    |
| Grace expiry and work identities   | The gateway remains authoritative. `awaiting-choice` explains expiry and offers its advertised choices. Active IDs link to inspectors; existing `GET /runs/{id}` reads supply pinned loop names. Failed or restricted name reads preserve links and choices. Historical unconfirmed IDs appear separately.                                                                                                                                                                            |
| Keep waiting                       | Sends one conditional `wait`, displays the returned phase, and starts no countdown. The native scenario has two tabs choose concurrently, observes draining beyond the original grace, closes one tab, then releases the held script and verifies clean exit and successful recovery after restart. Passed; see `final-browser.log.txt` and the retained final restart records.                                                                                                       |
| Force confirmation and recovery    | Confirmation lists run identities, required children, uncertain external effects and explicit recovery. Cancelling sends nothing. The native scenario drives a real gateway and SDK with a controlled native CLI, checks the CLI PID is gone, lock released, exit zero and persisted `RUN_INTERRUPTED_BY_STOP` after restart. Passed; see `final-browser.log.txt` and the retained final restart records.                                                                             |
| Concurrent/stale actions and 409   | A snapshot carries an opaque phase/incarnation token. Browser actions send it; the route synchronously rejects stale tokens with a current-state 409. This prevents a delayed force from becoming the separate force-failed exit acknowledgement. API regression: before fix expected 409, received 202; after fix all three new API tests passed. Components exercise stale tabs, changed incarnation, confirmation reset and current-state rendering.                               |
| Failure phases                     | All phases have component coverage. `drain-failed` explains retained listener/store/lock with no invalid action. `force-failed` offers a separately confirmed Force exit and explains retained lock reclamation. This is controlled component/API evidence, not native cleanup-failure evidence.                                                                                                                                                                                      |
| HTTP closure and failures          | Observation stops after connection failure or stopped phase; ready/exiting keep observing closure. The page says stopped or disconnected without fabricating a stopped snapshot. No automatic action retries, focus/reconnect retries or shutdown polling storm; explicit Check gateway state is read-only. A quick drain between polls has its own red/green regression.                                                                                                             |
| Tab lifecycle                      | Mount, unmount and navigation tests assert no POST. Native scenarios reload, navigate and close a second tab without issuing shutdown actions.                                                                                                                                                                                                                                                                                                                                        |
| Starting drain in browser          | Deliberately omitted: the bolt does not require it. Tests start drain through the existing operator API.                                                                                                                                                                                                                                                                                                                                                                              |
| Scoped API and generated contracts | Existing `system:read` and `system:write` routes are retained. Tests check scope enforcement and preservation of authentication headers alongside the conditional header. Client schema, OpenAPI and API reference regenerated. No run-summary route is needed.                                                                                                                                                                                                                       |

Before/after phase record:

| Phase                 | Baseline browser evidence                           | Implemented behavior and evidence tier                                                                                       |
| --------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| running               | Ordinary Loops page                                 | No shutdown notice; component test.                                                                                          |
| draining              | Ordinary Loops page, API reports draining           | Shell notice, work links and advertised choices; components and native scenario.                                             |
| awaiting-choice       | Ordinary Loops page, API reports expiry and choices | Grace explanation, Keep waiting and Force stop; components and native scenario.                                              |
| draining after wait   | Not exercised in baseline browser                   | No new countdown; component and native beyond-grace observation.                                                             |
| forcing               | Not captured on baseline                            | Interruption/uncertain-effects explanation; component test. Native force transition may be too brief for browser capture.    |
| drain-failed          | Not captured on baseline                            | Held ownership/log inspection explanation; component test.                                                                   |
| force-failed          | Not captured on baseline                            | Retained-lock explanation and fresh Force exit confirmation; components plus real controller over a controlled failing port. |
| ready/exiting/stopped | Not captured on baseline                            | Distinct stopping, failed-cleanup exit and stopped messages; component tests.                                                |
| connection closed     | Not captured on baseline                            | Stopped-or-disconnected notice and halted observer polling; components and native scenarios.                                 |

## 3. Files changed

- **API:** `apps/api/src/routes/system.ts` and new
  `apps/api/src/shutdown-choice.test.ts`. Shared-file edit beside PR #393's
  model-defaults ownership: final lines 1, 10–11, 15–19, 26, 29, 38–39 and 43–58.
  Only existing shutdown routes changed; no routes reordered.
- **Web:** new `apps/web/src/app/ShutdownNotice.tsx` and its test; shared shell
  `apps/web/src/app/App.tsx`; default observer response in
  `apps/web/src/__fixtures__/fake-api.ts`; new native browser spec, dedicated config
  and controlled CLI compiler under `apps/web/e2e/shutdown*`.
- **API client:** generated `packages/api-client/openapi.json` and
  `packages/api-client/src/generated/schema.ts`.
- **Docs/evidence:** CHANGELOG, docs 07/09, guide 07, ADR-0049 amendment,
  `docs/reference/api.md` and this evidence directory.

`apps/web/src/api/queries.ts` (PR #394), `useRunEvents.ts` (PR #391),
`run-manager.ts`, `shutdown.ts`, shutdown signals, container and main entry point
are unchanged. There are no controller/engine semantic edit ranges to report.

## 4. Tests

- `apps/web/src/app/ShutdownNotice.test.tsx`: **25 tests**, all passed inside the
  full web run. Covers every phase; wait; force, cancellation and renewed
  confirmation; stale tabs and restarted gateway; invalid snapshots; 409;
  permission/network failure; quick closure and ready-to-closure; no automatic
  action retry; unavailable names; historical unconfirmed work; navigation/unmount.
- `apps/api/src/shutdown-choice.test.ts`: **3 tests** passed in the direct targeted
  run (`phase-guard-after.log.txt`): stale force versus failed cleanup, stable and
  distinct incarnation tokens, and scoped conditional requests. Uses public app
  composition and a real controller over injected ports.
- `apps/web/e2e/shutdown.spec.ts`: two built-entry lifecycle scenarios with real
  HTTP, SQLite, filesystem, browser and restart, with no provider turn. **Both passed with zero retries** (`final-browser.log.txt`).
  `final-confirmed-choice.png` and `final-force-confirmation.png` were visually inspected.
  `final-restarted-completion.log.txt` records success;
  `final-restarted-interruption.log.txt` records the nonresumable interruption and uncertain effects.

Red regressions retained:

1. Baseline browser: `getByRole('heading', { name: 'Gateway is draining' })`:
   **element(s) not found** (`baseline-result.log.txt`).
2. Stale force against the original route: **Expected: 409; Received: 202**
   (`phase-guard-before.log.txt`). The fix leaves controller force semantics intact.
3. Initial UI candidate, quick closure after a healthy running snapshot:
   **Unable to find** `Gateway stopped or disconnected`
   (`fast-close-before.log.txt`). One-line observer caption correction; the new
   case passed in the full web run. This is a candidate regression, not an
   additional baseline product claim.

Final direct package coverage (`coverage-totals.log.txt`):

| Package                 | Tests                                                | Lines                | Branches             |
| ----------------------- | ---------------------------------------------------- | -------------------- | -------------------- |
| API, one worker         | 1,353 passed, 11 skipped; 72 files passed, 2 skipped | 97.53% (1,979/2,029) | 92.11% (1,391/1,510) |
| Web, two workers        | 1,673 passed; 133 files passed                       | 98.92% (7,551/7,633) | 94.99% (7,873/8,288) |
| API client, two workers | 72 passed; 8 files passed                            | 100% (246/246)       | 99.37% (160/161)     |

Thresholds and exclusions are unchanged. The earlier native wait scenario passed; the force scenario first
failed before fixture execution because Windows blocked its unsigned compilation
script. The fixture now invokes PowerShell with a per-process execution-policy
flag; no installed policy or runtime configuration was changed.

## 5. Gates

All commands select Node **v22.14.0** first on PATH and use `pnpm.cmd`. Package
coverage runs invoke Vitest directly through the package scripts, avoiding Turbo
coverage cache ambiguity. Results below refer to retained logs in this directory.

| Command                                                                                     | Result                                                                                             | Evidence                                                                                     |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                        | PASS, including final quick-close source correction                                                | `final-typecheck.log.txt`, `final-gate-exits.log.txt`                                        |
| `pnpm.cmd lint`                                                                             | PASS, including final quick-close source correction                                                | `final-lint.log.txt`, `final-gate-exits.log.txt`                                             |
| `pnpm.cmd format:check --log-level debug`                                                   | PASS, same full checker/file set; original quiet run was interrupted during slow archive traversal | `final-format-debug.log.txt`, `final-format-exit.log.txt`; full raw capture in `NOT-KEPT.md` |
| `pnpm.cmd check:layers`                                                                     | PASS                                                                                               | `final-check-layers.log.txt`                                                                 |
| `pnpm.cmd check:deps`                                                                       | PASS                                                                                               | `final-check-deps.log.txt`                                                                   |
| `pnpm.cmd check:docs`                                                                       | PASS                                                                                               | `final-check-docs.log.txt`                                                                   |
| `pnpm.cmd check:tokens`                                                                     | PASS                                                                                               | `final-check-tokens.log.txt`                                                                 |
| `pnpm.cmd --filter @graphgoblin/api-client generate`                                        | PASS                                                                                               | Generated OpenAPI/schema diff; generator completed before gates                              |
| `pnpm.cmd docs:generate`                                                                    | PASS                                                                                               | `docs-generate.log.txt`                                                                      |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2 --reporter=verbose`        | FAIL: 7 tests in 4 files, 1,346 passed and 11 skipped                                              | `final-api-coverage.log.txt`                                                                 |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=1 --reporter=verbose`        | PASS: 1,353 passed, 11 skipped; 97.53% lines, 92.11% branches                                      | `final-api-single-coverage.log.txt`, `final-api-single-exit.log.txt`                         |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 --reporter=verbose`        | PASS: 1,673 tests; 98.92% lines, 94.99% branches                                                   | `final-web-coverage.log.txt`                                                                 |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage --maxWorkers=2 --reporter=verbose` | PASS: 72 tests; 100% lines, 99.37% branches                                                        | `final-client-coverage.log.txt`                                                              |
| `pnpm.cmd build`                                                                            | PASS: 11 tasks before final native tests; nonfatal OS I/O warning retained                         | `final-build-before-native-tests.log.txt`, `final-build.log.txt`                             |
| From `apps/web`: `pnpm.cmd exec playwright test --config=e2e/shutdown.config.ts`            | PASS: both tests, zero retries, 2.7 minutes                                                        | `final-browser.log.txt`                                                                      |

The final serialized API run passed all non-skipped tests, including every case that failed in the earlier two-worker run. This does not erase or establish the cause of the earlier failures. The two-worker API run had six timeouts in existing CLI/readiness tests and one
`EADDRINUSE` collision on assigned port 5985. A single additional full API run uses
one worker and ports 5981–5989, reserving 5980 for the browser fixture. This
specifically removes inter-file port competition; it does not change assertions,
timeouts or thresholds. Earlier default-worker attempts and their failures are
retained in `api-default-workers.log.txt`, `api-coverage.log.txt`,
`web-default-workers.log.txt` and `web-coverage.log.txt`. They do not count as
passing evidence. No repeated whole-suite retry after the serialized run. Final changed-file formatting also passed; its exact command is recorded in `final-changed-format-check.log.txt`. Final `git diff --check` passed. A real bind probe found every assigned port 5980 through 5989 free (`final-port-probe.log.txt`).

## 6. Docs

- `docs/07-api-and-streaming.md`: token, conditional actions, scopes and 409.
- `docs/09-frontend-and-pwa.md`: shell notice, confirmation, gateway-owned timing,
  disconnected state, read failures and tab behavior.
- `docs/guide/07-troubleshooting.md`: Keep waiting, force/failed cleanup, recovery,
  permissions and connection closure.
- ADR-0049: browser implementation amendment. ADR-0054 is not needed because
  controller/engine policy and D-038 are unchanged.
- Top `## Unreleased` CHANGELOG bullet ends `(#319)`. **Upgrade:** update gateway
  and browser together because browser choices require the snapshot token. No
  stored-state migration or reset.
- Generated `docs/reference/api.md`, client OpenAPI and schema updated.

## 7. Decisions and parameters

- No browser drain initiator: explicitly outside the required bolt.
- Existing run reads are the cheap source of pinned loop names; names are cached
  indefinitely per immutable run. A missing name never blocks control.
- Two-second polling bounds idle cost; one-second freshness avoids an immediate
  post-action read replacing the returned snapshot. No automatic read/action
  retries after errors. Only explicit reads recover observation after disconnect.
- Force confirmation is keyed by the phase/incarnation token. Gateway state
  changes or pending/error transitions discard it rather than reinterpreting
  earlier consent. The API's synchronous conditional guard covers delayed tabs.
- The token is an opaque fresh UUID plus phase, stable within a phase/instance.
  Existing deliberate unconditional operator/signal requests retain their
  semantics. Browser snapshots without tokens are invalid, with no unguarded
  compatibility fallback.
- The default gateway grace remains five minutes. Native fixture grace is three
  seconds; waiting is observed for 3.5 seconds beyond it. Fixture watchdogs are
  180 seconds, longer than the 120-second browser test timeout, so work cannot
  finish early and accidentally satisfy the interruption assertion.
- Dedicated browser config owns and stops its built gateway rather than using the
  shared suite server. One browser worker, zero retries, installed Edge. Fixtures
  select assigned ports 5980–5989, verify their child's own bind announcement,
  isolate inherited `GG_*` settings and use `gg-wp-c7-319-` temporary directories.
- No dependency, schema migration, engine policy or global runtime change.

## 8. Caveats and open items

- Final serial API coverage, web/client coverage, build, static gates and both native browser tests passed. The parallel API failures remain recorded for orchestrator disposition; no retry-to-green or owner acceptance claim is made.
- Existing API failures observed outside scope: `apps/api/src/main.test.ts:69`
  (CLI dispatch timeout), `nested-readiness.test.ts:440` (executable readiness
  timeout), `readiness-evidence.test.ts:29` (four auth-probe scenario timeouts),
  `retired-event-startup.test.ts:135` (bind collision reported by
  `testing/api-subprocess.ts:109`). No unrelated test bodies or timeouts changed.
- The final build reported a nonfatal `Access is denied` I/O warning after all 11 tasks succeeded. Its cause was not investigated outside this bolt.
- Controlled CLI evidence establishes this actual SDK/gateway/process path;
  it establishes no live-provider behavior or stronger installed-provider
  descendant-tree guarantee. Native process-tree control restrictions on this
  host remain relevant (D-015). Failure-phase presentation is component evidence.
- Orchestrator still owns commit/integration, Opus review, independent Sol QA,
  fresh Astra audit and owner product acceptance. Keep #319 open pending those
  gates. No owner port 4747/4748, owner store or main checkout was touched.
- Disposable stores, coverage and browser artifacts remain local for orchestrator
  cleanup. `NOT-KEPT.md` records oversized/raw captures by byte size and SHA-256.
  No directory deletion was attempted.
