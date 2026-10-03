# Release sign-off - GraphGoblin 1.0 (2026-10-03)

Final review of `main` at `21fa22d` before the 1.0 tag. Every gate was run again with Turborepo caches bypassed, the install path was followed end to end with a fresh data directory and one live Codex run, both QA reports and the plan's residual-risk list were checked against the code, and sixteen documentation claims were checked against the code. Machine: Windows 11 Pro, Node 23.10.0 (dependency-cruiser on Node 22.14.0), pnpm 12.8.1, Codex CLI 0.160.0, Microsoft Edge for Playwright.

**Verdict: ship with the following fixes first.** Two items block the tag; both are small. Everything else is either verified or an honestly recorded residual risk.

1. **Guard the one-process-per-data-directory rule.** A second API process started against the same data directory recovers and re-executes the first process's in-flight runs, even when it then fails to bind the port. Reproduced below. Fix: take an exclusive lock in the data directory before `container.start()` (or, at the least, bind the port before recovery), and state the rule in the user guide.
2. **Correct two false security and retention claims in docs/11 (and the matching row in docs/02).** They describe per-secret data keys, an OS-keyring master-key source, and a manual purge action, none of which exists.

## Gates

All gates were run from the main checkout. Caches were bypassed with `--force` where Turborepo runs the gate.

| Gate                                                                          | Result                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd exec turbo run typecheck --force`                                   | Pass: 20 of 20 tasks, 0 cached (22 s)                                                                                                       |
| `pnpm.cmd exec turbo run lint --force`                                        | Pass: 11 of 11 tasks, 0 cached (25 s)                                                                                                       |
| `pnpm.cmd check:layers`                                                       | Pass: "Layer rules: OK"                                                                                                                     |
| `pnpm.cmd exec turbo run test:coverage --force`                               | Pass: 12 of 12 tasks, 0 cached (58 s); 1,011 tests passed, 8 skipped (all `LIVE=1` checks); table below                                     |
| `pnpm.cmd check:licenses`                                                     | Pass: 225 packages checked against the allowlist                                                                                            |
| `pnpm.cmd check:docs`                                                         | Pass: "Generated docs are up to date."                                                                                                      |
| `pnpm.cmd exec turbo run build --force`                                       | Pass: 11 of 11 tasks, 0 cached                                                                                                              |
| `pnpm.cmd format:check`                                                       | Pass                                                                                                                                        |
| `node --test tooling/scripts/*.test.mjs` (five files listed)                  | Pass: 26 tests                                                                                                                              |
| dependency-cruiser (Node 22.14.0, `packages apps`, `.dependency-cruiser.cjs`) | Pass: 0 errors, 4 `no-orphans` warnings on config files (`drizzle.config.ts`, `vite.config.ts`, `playwright.config.ts`, the web test setup) |
| `pnpm.cmd --filter @graphgoblin/web test:e2e` (installed Edge)                | Pass: 14 passed, 1 skipped (`live.spec.ts`, `LIVE=1` only)                                                                                  |

The `coverage/` and `test-results/` folders were removed with Node's `fs.rmSync` afterwards; `git status` was clean before the two files of this sign-off were written.

### Coverage

Thresholds are 90% on all four metrics in `tooling/vitest.shared.mjs`; no package overrides them, and the only exclusions are tests, `.d.ts`, `__fixtures__`, and `generated`. The `tooling` task runs Node's test runner and emits no V8 percentages.

| Package        | Statements | Branches | Functions |  Lines |
| -------------- | ---------: | -------: | --------: | -----: |
| contracts      |     100.00 |    94.44 |    100.00 | 100.00 |
| domain         |      98.73 |    96.80 |     96.02 |  99.21 |
| engine         |      97.71 |    93.77 |     97.00 |  98.83 |
| infrastructure |      99.23 |    94.63 |     98.75 | 100.00 |
| adapter-codex  |      98.70 |    97.99 |     97.43 |  99.64 |
| adapter-jev    |      98.64 |    98.00 |    100.00 | 100.00 |
| api-client     |     100.00 |   100.00 |    100.00 | 100.00 |
| api            |      97.65 |    92.79 |     95.51 |  98.82 |
| mcp            |      93.86 |    95.30 |     92.94 |  95.23 |
| plugin-codex   |      95.52 |    95.45 |    100.00 |  95.23 |
| web            |      98.21 |    93.30 |     98.27 |  99.16 |

Lowest margins: `api` branches (92.79), `mcp` functions (92.94), `web` branches (93.30).

## Install path and live run

1. `scripts/install.ps1` with `GG_DATA_DIR` set to a new directory under `%TEMP%`: exit 0. It installed (frozen lockfile), built, created the data directory, and ran the preflight: 0 failed, 3 warnings (master key, database, and Jev not created or checkable before the first start), harness `codex 0.160.0 is installed and logged in`.
2. `node apps/api/dist/main.js --preflight` against the same directory: exit 0, the same table.
3. `node apps/api/dist/main.js` in the background with that data directory: listening on `127.0.0.1:4747`.
4. Over HTTP: `GET /healthz` 200; `GET /app/` 200 with the app shell; `GET /system/preflight` 200, `ok: true`, every check `ok` except Jev (`warn`, no key).
5. Through the API: `POST /loops` (trigger, one inference node with `gpt-6-luna`, effort `low`, sandbox `read-only`, approval `never`, prompt "Reply with exactly the single word OK and nothing else.", then exit) 201; `POST /loops/{id}/publish` 200; `POST /loops/{id}/runs` 202.
6. **Run `01M41G099YTF9MKG8RZVY72YC3`: `succeeded` in 9.1 s.** The assistant message was `OK`. Events: `run.queued`, `run.started`, the trigger's start and finish, `node.started`, `harness.session`, two `node.progress`, `harness.usage` (19,670 input tokens, 5,888 cached, 5 output), `node.finished`, the exit's start and finish, `run.finished`. `GET /runs/{id}/events` with `Accept: text/event-stream` on the finished run replayed all 13 events and closed.
7. The server was stopped and the temporary data directory deleted.

This was the only live Codex session in this review.

### Second process against the same data directory (blocking item 1)

With the server from step 3 still running, a loop with one script node (a Node program that appends a line to a marker file and then sleeps 15 s) was started. Two seconds later a second `node apps/api/dist/main.js` was started with the same `GG_DATA_DIR` and the same port. It exited with `EADDRINUSE` after 1.6 s, but `apps/api/src/main.ts` runs `container.start()` (migrations, recovery, the run manager, timers, and the scheduler) before `app.listen()`, so in that window it recovered the first process's running run. The run's log (run `01M41G2FHG56YTXARN5EW2R07Q`):

```
5  node.started  work  attempt 1   (process A)
6  run.started         attempt 2   (process B, recovery)
7  node.started  work  attempt 2   (process B, re-executing the script node)
8  node.progress work              (process A)
9  node.finished work              (process A)
...
12 run.finished                    (process A)
```

Process B died before its copy of the script wrote to the marker file, so the side effect ran once this time; the outcome is a race. With a longer gap between recovery and the failed bind, or a Codex node instead of a script, the node runs twice, which is the doubled inference the design review already demonstrated for two run managers. With a different `GG_PORT` the second process runs to completion and every queued and recovered run, timer, and schedule is executed by both.

The restriction itself is documented (05 "One run manager per store", 11 "Distribution", the M8 notes), but nothing enforces it, and the user guide only implies it ("let the process exit before starting another API against the same database"). Running `pnpm start` a second time is an ordinary mistake. The fix is small: an exclusive lock on a file in the data directory taken before `container.start()` (refuse to start with a clear message when it is held), which also covers a different port; binding the port before recovery alone covers only the same-port case. `--preflight` and `--create-api-key` do not start the run manager and need no lock.

## QA reports and residual risks

### WP-D2 (`qa/2026-10-03-wp-d2.md`)

- D01 to D25 are fixed per the report; D26, D27, D28 are fixed in WP-F2. Checked in code: `If-Match` and `DRAFT_CONFLICT` on draft saves (ADR-0015), `--create-api-key` (`apps/api/src/create-api-key.ts`), and the visit cap (`packages/engine/src/run-manager.ts`, `MAX_ITERATIONS` before `node.started`, `resumable: false`).
- D29 and D30 are open and cosmetic, as recorded; the severities are honest.
- The report's summary table still says three majors and five defects open. After WP-F2 the correct figures are 0 major and 2 cosmetic open (27 of 29 fixed). Stale, not misleading about the code; the follow-up section at the end of the report states it correctly.
- The six UI gaps against docs/09 (no replay button, no scheduler status card or endpoint, webhook endpoints not on the Events screen, stand-in CodeMirror modes, no canvas shortcuts or undo, variables in the Loop tab) are all in the plan's "Product gaps known at 1.0".

### Adversarial design review (`qa/2026-10-03-adversarial-design-review.md`)

- ADV-001 to ADV-016, the second, third, and fourth review rounds, and QA-LIMIT-001 are recorded as fixed with tests, and the regression tests ran green in this coverage run (engine `recovery.test.ts` 79 tests, `finalization.test.ts` 44, `adversarial.test.ts` 47; infrastructure and API adversarial suites).
- The report's opening paragraph ("eight remain open") predates WP-G; the "Status after WP-G" section directly below it supersedes it.

### The items the brief named

| Item                               | State in code                                                                                                                                                             | Recorded where                                                                   | Assessment                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single process, no execution lease | No lock of any kind; `container.start()` precedes `listen()`                                                                                                              | 05, 11, M8 notes; not in the plan's residual-risk list; implied only in guide 01 | **Understated.** The documented restriction is fine for 1.0; the absence of any guard is not (blocking item 1).                                                                                                                                                                     |
| Returns re-delivered after a crash | `deliverReturns` appends `return.delivered` after the delivery; the `event` channel publishes with no dedupe key, `webhook` posts with no idempotency key                 | 05 ("returns are at least once"); not in the residual list or the guide          | Honest in 05, missing from the risk list. Consequence not stated anywhere: a crash in that window can start event-triggered runs twice and post a webhook twice. Low likelihood; record it. A dedupe key of `run:<id>:<channel>` on the published event would close the event half. |
| Child-creation crash window        | `handlers/subloop.ts` creates the child (line 206) and then records `child_run.started` (line 213)                                                                        | 05 "Crash recovery"; not in the residual list                                    | Accurately described in 05; missing from the risk list. Low likelihood (a crash between two adjacent awaits); consequence is an orphaned child run and a second child.                                                                                                              |
| Regex heuristic limits             | `packages/domain/src/regex-safety.ts`; `$eval` shadowed                                                                                                                   | 11 "Execution posture", 05 WP-G notes; not in the residual list                  | Honest: polynomial backtracking, memory, and Liquid CPU and output size are named as unbounded in-process. Acceptable for a single-user tool where the expression author is the owner.                                                                                              |
| `api-keys:write` minting `*` keys  | Fixed: `POST /api-keys` requires scoped callers to list scopes, grants only held scopes (write implies read), never `*`; 403 `SCOPE_NOT_DELEGABLE` (`routes/settings.ts`) | ADR-0016, 07, 11                                                                 | Closed. Residual note: an `api-keys:write` key can still list and revoke every key, including `*` keys. That is key management by definition; worth one sentence in 07.                                                                                                             |
| `initialThread` size               | No cap; trigger payload bounded by the 8 MB API and 1 MB webhook body limits, a child's seed by the parent thread                                                         | 05 "Event log and projections"; plan "Product gaps"                              | Honest. Low for a local tool.                                                                                                                                                                                                                                                       |
| D29, D30                           | Open                                                                                                                                                                      | WP-D2 report; plan "Open defects"                                                | Honest; cosmetic.                                                                                                                                                                                                                                                                   |
| WP-D2 UI gaps                      | Absent, as described                                                                                                                                                      | Plan "Product gaps"; guide "After 1.0" callouts                                  | Honest.                                                                                                                                                                                                                                                                             |

Other residual items checked: `exposeTo` not enforced, inference `capabilities` not resolved, `list_runs` same-millisecond paging, Jev live check open, Codex sandbox in the container not exercised live, image size, the `./data` default change, unconditional draft saves without `If-Match`, `--create-api-key`'s trust boundary. All are recorded in the plan with honest wording. One recorded residual affects only pre-WP-G databases (a pre-upgrade duration wait with a separate timeout re-arms one timer); it does not apply to fresh 1.0 installs.

## Documentation spot-check

Sixteen claims checked against the code; thirteen hold, two are false, one is stale.

| #   | Claim                                                                                                                                                                          | Where                                | Code                                                                                                                  | Result                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | `GG_MAX_CONCURRENT_RUNS` 4 (1 to 64), `GG_TIMER_POLL_MS` 1000, `GG_HOOK_RATE_LIMIT` 60, `GG_DEFAULT_MODEL` `gpt-6-luna`, `GG_DEFAULT_EFFORT` `low`, data dir `~/.graphgoblin`  | guide 01                             | `apps/api/src/config.ts:22-26, 61`                                                                                    | Holds                                                                                           |
| 2   | Webhook: HMAC-SHA256 over timestamp, dot, body; 300 s default window; 1 MiB limit; 409 `REPLAYED`; event chains stop at 8                                                      | guide 04, 08                         | `triggers/trigger-service.ts:49, 52, 327, 384`; `contracts/src/nodes.ts:90`                                           | Holds                                                                                           |
| 3   | A fresh visit beyond `maxIterations` fails with `MAX_ITERATIONS`, `resumable: false`, before `node.started`                                                                    | 05, ADR-0015                         | `engine/src/run-manager.ts:1090-1102`                                                                                 | Holds                                                                                           |
| 4   | A crash between creating a child and recording `child_run.started` can orphan the child                                                                                        | 05                                   | `engine/src/handlers/subloop.ts:206-213`                                                                              | Holds                                                                                           |
| 5   | Returns are delivered per channel, skipping recorded ones, and are at least once                                                                                               | 05                                   | `engine/src/run-manager.ts` `deliverReturns`                                                                          | Holds                                                                                           |
| 6   | Every private route needs `<resource>:read` or `:write`; write implies read; `POST /loops/{id}/runs` needs `runs:write`, validate needs `loops:read`                           | 07                                   | `apps/api/src/plugins/auth.ts` `requiredScope`, `hasScope`                                                            | Holds                                                                                           |
| 7   | Scoped `api-keys:write` callers must list scopes, may grant only held scopes, never `*`; 403 `SCOPE_NOT_DELEGABLE`                                                             | 07, 11, ADR-0016                     | `apps/api/src/routes/settings.ts:185-212`                                                                             | Holds (07 links ADR-0016 with the text "ADR-0015")                                              |
| 8   | 8 MB body limit; `MALFORMED_BODY`, `BODY_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` instead of `FST_ERR_*`                                                                           | 07                                   | `apps/api/src/app.ts:39`; `plugins/errors.ts:57-62`                                                                   | Holds                                                                                           |
| 9   | Codex sandbox defaults to `workspace-write`; `harnessOptions` defaults to `{}`                                                                                                 | 11, `reference/nodes.md`             | `contracts/src/nodes.ts:174-203`                                                                                      | Holds                                                                                           |
| 10  | `--create-api-key` defaults to `*` only without `--scopes` and exits 2 on usage errors                                                                                         | 11, ADR-0015                         | `apps/api/src/create-api-key.ts:59, 106`                                                                              | Holds                                                                                           |
| 11  | `POST /runs/{id}/replay` answers 202, and 409 `REPLAY_NODE_NOT_REACHED` for a node the source never reached                                                                    | `reference/api.md`, 05, 07           | `plugins/errors.ts:49`; `run-manager.ts:621`                                                                          | Holds                                                                                           |
| 12  | The MCP server has fourteen tools                                                                                                                                              | CHANGELOG, 07                        | `apps/mcp/src/tools.ts` (11 named plus `cancel_run`, `pause_run`, `resume_run`)                                       | Holds                                                                                           |
| 13  | The API warns when it listens beyond localhost without API keys                                                                                                                | 11                                   | `apps/api/src/main.ts`                                                                                                | Holds                                                                                           |
| 14  | "Each row has its own data key, wrapped by a master key. The master key comes from an environment variable or the OS keyring through `@napi-rs/keyring`, chosen at first run." | 11 "Secret store"; 02 table          | `infrastructure/src/sqlite/secrets.ts` encrypts each value directly with the master key; no keyring dependency exists | **False.** The guide (06, "After 1.0") and the plan's product gaps say the opposite, correctly. |
| 15  | "A manual purge action per run and per loop exists in settings."                                                                                                               | 11 "Retention"                       | No purge route or UI anywhere in `apps` or `packages`                                                                 | **False.** Guide 06 and backlog item 6 say it comes after 1.0.                                  |
| 16  | The 2-second SSE grace exists because "the status changes just before the event is appended"                                                                                   | 07 SSE; `apps/api/src/sse.ts:13, 80` | Since WP-G terminal events are appended before the terminal status                                                    | **Stale rationale.** The grace is harmless; the explanation is wrong.                           |

## Residual-risk assessment

With the two fixes above, 1.0 meets the owner's bar: permissive licences only and Codex external (allowlist green); 90% lines and branches per package, enforced (table above); the API, MCP server, and Codex plugin over one contract; failures end runs with a typed reason (seen in the WP-D2 checks and this review's script failure, `SCRIPT_EXIT_CODE`, `resumable: true`); adversarial QA by both vendors with every finding closed or recorded.

Residual risks for 1.0, in order of weight:

1. One API process per data directory, with no execution or scheduler lease (major until the lock lands, then low: it becomes a refused start).
2. Returns are at least once: a crash between delivering a channel and recording it re-delivers; for `event` channels that can start downstream runs twice, for `webhook` channels it posts twice (low).
3. A crash between creating a subloop child and recording `child_run.started` can orphan that child and start a second (low).
4. Expression safety is a syntactic regex heuristic: polynomial backtracking, memory, and Liquid CPU and output size are not bounded in-process (low for one local owner; a hosted product needs out-of-process evaluation).
5. Codex's sandbox inside the container image is unverified live; the image is about 1 GB.
6. The Jev live check is open (no key on the development machine).
7. `run.queued.initialThread` has no size cap (bounded by request limits).
8. Product gaps and cosmetic defects as listed in the plan (replay button, scheduler status, webhook endpoints on Events, editor modes, shortcuts and undo, `exposeTo`, `capabilities`, `list_runs` paging, D29, D30).

Non-blocking documentation follow-ups: the WP-D2 summary table's open counts; the "ADR-0015" link text for ADR-0016 in 07; the SSE grace rationale in 07 and `sse.ts`; `scripts/install.ps1` printing `pnpm start` rather than `pnpm.cmd start` in its PowerShell hint; a sentence in 07 that `api-keys:write` can revoke every key; and adding items 2 to 4 above to the plan's residual-risk list (done in the sign-off paragraph there).
