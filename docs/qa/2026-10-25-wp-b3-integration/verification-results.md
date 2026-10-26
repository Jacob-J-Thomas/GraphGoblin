# Verification results

Verification is complete. All eleven instrumented packages exceed 90% lines and branches. The combined coverage gate failed; earlier failed runs remain unresolved even where a later collection run passed.

## Exact coverage commands

```powershell
$env:GG_TEST_PORT_START="5600"
$env:GG_TEST_PORT_COUNT="100"
$env:GIT_CONFIG_COUNT="1"
$env:GIT_CONFIG_KEY_0="safe.directory"
$env:GIT_CONFIG_VALUE_0="%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-wp-b3-integrate"
pnpm.cmd exec turbo run test:coverage --concurrency=2 --force
pnpm.cmd exec turbo run test:coverage --concurrency=2 --force --env-mode=loose
pnpm.cmd exec turbo run test:coverage --concurrency=2 --force --env-mode=loose --filter='!@graphgoblin/tooling' --filter='!@graphgoblin/contracts' --filter='!@graphgoblin/domain' -- --maxWorkers=2
pnpm.cmd exec turbo run test:coverage --concurrency=2 --force --continue=always --env-mode=loose --filter='!@graphgoblin/tooling' --filter='!@graphgoblin/contracts' --filter='!@graphgoblin/domain' --filter='!@graphgoblin/adapter-codex' -- --maxWorkers=2 --testTimeout=30000 --hookTimeout=30000
pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000 --coverage.reportOnFailure=true
pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000 --coverage.reportOnFailure=true
pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2 --testTimeout=30000 --hookTimeout=30000 --coverage.reportOnFailure=true --reporter=verbose
```

The final three commands explicitly collect truthful coverage denominators even if a test fails; they are not retries that erase earlier failures. No production timing or coverage settings were edited. All commands prepend the Node path recorded in the main report.

## Native / browser acceptance

- `pnpm.cmd test:upgrade`: 2 passed, 140.219s. Fresh and pre-0015 current-format startup, retained data and migrated receipts, restart at head, format-3/unmarked refusal (exit 1 and documented message).
- `pnpm.cmd test:reset`: 1 passed, 76.45s.
- Edge drafts/device-format specs: 6 passed, 1.4m, zero retries and one worker.
- Focused SQLite: 8 files, 143 passed, 43.72s.

## Instrumented package totals

| Package        |   Lines | Branches | Unit result                                                                     |
| -------------- | ------: | -------: | ------------------------------------------------------------------------------- |
| contracts      |  99.74% |   95.00% | 278 passed                                                                      |
| domain         |  99.39% |   97.66% | 327 passed                                                                      |
| engine         |  97.39% |   91.27% | 1701 passed; 1 failed (collection)                                              |
| infrastructure |  99.07% |   96.02% | 779 passed; 7 failed (collection)                                               |
| adapter-codex  |  98.63% |   94.21% | 501 passed; 5 skipped                                                           |
| adapter-jev    |  98.80% |   96.77% | 34 passed; 5 skipped                                                            |
| api-client     | 100.00% |   98.42% | 96 passed                                                                       |
| api            |  97.04% |   91.54% | 1541 passed; 12 skipped (collection); prior cleanup failure unresolved          |
| mcp            |  96.69% |   95.11% | 51 passed                                                                       |
| plugin-codex   |  95.23% |   95.45% | 9 passed; 1 skipped                                                             |
| web            |  98.96% |   94.84% | 1760 passed                                                                     |
| tooling        |     N/A |      N/A | 87 passed; existing command uses Node tests without a numeric coverage reporter |

The eleven instrumented packages all exceed 90% lines and branches. The existing tooling script emits test counts rather than percentages. The individual JSON reports beside this file preserve exact denominators. Coverage policy and exclusions are unchanged.

## Failed run details

The completed Turbo run exited 1: 12 successful tasks / 15 total. Its failing tasks were engine, infrastructure and API; web passed all 145 files / 1,760 tests. See [coverage-complete.log.txt](coverage-complete.log.txt).

- Engine completion run: 1,701 passed / 1 failed; `src/recovery.test.ts:678` measured 5,534.248ms against `< 2000`. The later coverage-reporting run had 1,701 passed / 1 failed at `src/webhook-returns.test.ts:92`: `expected [] to have a length of 1 but got +0`. Neither result is erased by narrower diagnoses.
- Infrastructure completion run: 780 passed / 6 failed. Final coverage-reporting run: 779 passed / 7 failed in four files. Failures include EBUSY cleanup, a descendant continuing to append after abort, an alive process after cancellation, no-turn readiness reporting termination unconfirmed rather than the ordinary deadline message (`src/claude/readiness.test.ts:62`), and a wait for resumed finalization (`src/adversarial.test.ts:441`). See [infra-coverage-reported.log.txt](infra-coverage-reported.log.txt).
- API completion run: 1,540 passed / 1 failed / 12 skipped. The failure was the `src/subloop-restart.test.ts:23` disposal hook: `Hook timed out in 60000ms.` The final API coverage-reporting run passed 1,541 tests (12 skipped), exit 0, in 1,598.51s. This collects the missing coverage report; it does not resolve the earlier cleanup-hook failure.
- Tooling first attempt failed Git ownership; its scoped environment correction subsequently passed 87/87. Initial engine timeout attempts and bounded diagnostics are retained in their named logs.

The failing engine, API restart and native process test files match main, as do the relevant engine/process implementations. This is source parity, not a claim of a separately executed main baseline or a proven failure cause. The failures remain open for orchestrator triage under COMMON's outside-scope rule. No test threshold, source deadline, coverage exclusion or skip was added.

## Final formatting and source inventory

The full `pnpm.cmd format:check` passed after the resolved source was formatted. A redundant later full scan was stopped after more than 18 minutes; no source code changed afterward. Direct Prettier checking of the subsequently added architecture/report Markdown passed. The final report and architecture Markdown are checked directly after adding these results (see `format-report-final.log.txt`). Source inventory records zero conflict markers, five physically absent conflict deletions, unchanged reset sources, unchanged migration SQL/metadata relative to main, and regenerated files matching the merged index.

No EADDRINUSE error appeared in either API run; the conditional shutdown-process-only rerun was not needed. The existing live/provider and opt-in performance skips were unchanged. No paid provider turn ran.

Exact final Markdown command:

```text
pnpm.cmd exec prettier --check docs/architecture/README.md docs/architecture/debt-register.md docs/qa/2026-10-25-wp-b3-integration/README.md docs/qa/2026-10-25-wp-b3-integration/verification-results.md
```

Additional focused commands:

```text
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/fresh-initialization.test.ts src/sqlite/store-format.test.ts src/sqlite/readiness.test.ts src/sqlite/webhook-receipt-upgrade.test.ts src/sqlite/definition-pins.test.ts src/sqlite/catalog.test.ts src/sqlite/classifiers.test.ts src/sqlite/storage.test.ts
pnpm.cmd --filter @graphgoblin/tooling exec node --test scripts/dockerignore.test.mjs
pnpm.cmd --filter @graphgoblin/engine exec vitest run src/repair-deadline.test.ts src/unlimited.test.ts src/webhook-returns.test.ts src/handlers/classifiers.test.ts src/handlers/gates.test.ts src/handlers/waiting.test.ts src/completion-deadline.test.ts src/structured-deadline.test.ts --maxWorkers=2
```
