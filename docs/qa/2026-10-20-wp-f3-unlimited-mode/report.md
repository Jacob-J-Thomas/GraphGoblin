> Historical round 1 report. D-027 and N1 supersede its finite-default deadline and full item-detail statements. Current results are in [round2-report.md](round2-report.md).

# WP-F3 / #243 implementation report

## 1. Branch and worktree

Branch `codex-wp-f3-unlimited-mode`; worktree
`<local>\source\repos\GraphGoblin\.claude\worktrees\codex-wp-f3-unlimited-mode`.
Base `624aaa9cd4699b20f8330a0cee0b4a7d736c88db`.
Uncommitted; ready for orchestrator commit and independent review, with the failed
qualifications below retained. No staging, unstaging, commits, push, merge, rebase,
stash or branch switch. This is an implementation candidate, not review/QA sign-off.

## 2. Per bolt

#243 / B45; parent **#306 (U17)**; intent #288 (I06).

- **Visible defaults:** contracts, editor and Settings show 10 visits and 3,600 seconds.
  New runs persist effective values in `pinned.limits`; the inspector shows them and
  the absolute deadline. `contracts/src/unlimited.test.ts`, web limit component tests
  and the final Edge persistence/inspector flow verify this.
- **Unlimited:** explicit `null` removes the visit, repeat-pass or run-deadline check.
  Format 4 already retired shared iterations; no shared counter was restored. Public
  engine tests exceeded 20 marked passes/unmarked visits and cancelled. A complete
  built-API native run exceeded 20 fake turns and cancelled in **135 ms**; its stalled
  native fake PID exited in **56 ms**. Engine tests cover finite/default limits,
  configured/disabled deadlines, waits/restart, draining, late results and child cleanup.
- **No substitute budgets:** Claude's hidden 100-turn and ten-minute inference ceilings
  are removed. No spending, token, subscription or provider-turn guardrail was added.
- **Cutoff audit:** the complete tables are in [the plan](../2026-10-20-wp-f3-plan.md)
  and `docs/06-harness-integration.md`. Claude's unmarked accepted-transcript slices
  were measured (20,000 characters retained as 16,384) and removed. Explicit resource
  failures remain. Installed no-turn inspection: Claude 2.1.304; Codex 0.160.0. Help and
  SDK option types establish options, not live-provider behavior.
- **Truthful failures:** transport/output/quota remain typed. Only retriable
  `HARNESS_TRANSPORT_FAILED` that F4 classifies **definitely-not-submitted** gets one
  automatic retry, retaining exact prompt/turn identity. Accepted/uncertain work and
  quota/auth/output/unknown failures do not automatically retry. F4 classification is
  unchanged. Native quota, transport and unknown cases passed in the complete run.
- **Verification qualification:** all requested behavior has controlled positive
  evidence, including ten final Edge tests. Full local test gates remain failed as
  detailed below. The latest native runner failed before API startup; do not present
  it as a clean final native gate. No paid turns were made.
- **Owner QA:** [self-contained README](README.md), including fresh session, isolated
  data/database, ports 5900-5909, native fake, UI/API checks and cleanup. Owner acceptance
  is not a merge gate under the latest dispatch; independent review and QA remain.

## 3. Files changed

| Area           | Change                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| contracts      | loop/evaluation/run schemas, sample pin, current goldens, unlimited tests                                                                           |
| domain         | nullable-cap warning, frozen-converter type narrowing, current expected outputs, gate tests                                                         |
| engine         | pinning, visit/pass checks, new run-deadline helper, timer/watchdog integration, safe transport retry, public tests and affected timer expectations |
| infrastructure | Claude cutoff removal/full accepted transcript, nullable process timeout, SQL 0015 pin migration, metadata and migration/protocol tests             |
| api            | native fake-CLI acceptance script; migration/timer expectations and native fixture clock alignment only                                             |
| web            | new execution-limit field, gate override, Loop controls, Settings defaults, inspector limits/evidence, component and Edge tests                     |
| api-client     | regenerated OpenAPI and TypeScript schema                                                                                                           |
| tooling/docs   | native fake Codex C# source; numbered docs, guides, ADR, CHANGELOG and QA evidence                                                                  |

Every tracked hunk is listed in [changed-line-ranges.txt](changed-line-ranges.txt).
Shared production/fixture edits are in [shared-edit-ranges.md](shared-edit-ranges.md).
Integration-sensitive changes:

- WP-D2: **`run-manager.ts:1857` only** in finalization, extending existing durable child
  cancellation to deadline failure. Before this condition the new regression observed a
  failed parent and a still-waiting child. No delivery-region rewrite.
- WP-D1: API native fixtures at `subloop-restart.test.ts:198-199` and
  `retired-event-startup.test.ts:63-64` seed the fake clock from the real epoch. Their
  historical October 2 starts correctly expired against the real October 21 wall clock;
  the fixture correction preserves deadline enforcement and assertions. No script or
  subloop recovery logic was changed.
- WP-F4: inference mapping/retry hunks `224-230`, `407-435` consume existing submission
  evidence. Classification and recovery authority are unchanged.
- WP-F1: Claude harness/process/protocol edits concern inference cutoffs/transcript only;
  no readiness production files or API run-admission code changed.
- WP-F2b: no model-picker or `NodeEditorDialog.tsx` edits. Shared editor/inspector hunks
  are named in the range file.

## 4. Tests

[Before evidence](../2026-10-20-wp-f3-before.md) records the actual baseline failures:
null rejected with `Invalid input: expected number, received null`; absent deadline
default; transport received `HARNESS_TURN_FAILED` instead of `HARNESS_TRANSPORT_FAILED`.
There was no old disabled-limit shape to execute. Claude's hidden ceilings were audited
from source/options. The child regression failed before the finalizer condition:
expected `cancelled`, received `waiting`. The initial test cleanup mistake (`forceStop`)
was corrected to public stop/wait/cancel APIs and is disclosed there. Not every new test
was separately run on the baseline.

| Package        | Broad coverage tests                         | Lines  | Branches | Gate                 |
| -------------- | -------------------------------------------- | ------ | -------- | -------------------- |
| contracts      | 264 passed                                   | 99.73% | 95.00%   | passed               |
| domain         | 591 passed                                   | 98.47% | 95.78%   | passed               |
| engine         | 591 passed                                   | 97.94% | 92.55%   | passed               |
| adapter-codex  | 97 passed; 5 existing live skips             | 98.49% | 94.42%   | passed               |
| infrastructure | 648 passed; 9 failed                         | 98.59% | 94.63%   | failed tests         |
| api            | 718 passed; 1 failed; 6 existing skips       | 97.90% | 92.93%   | failed test/hook     |
| web            | 1470 passed; 5 failed; 2 worker-start errors | 98.82% | 94.65%   | failed tests/workers |
| api-client     | 69 passed; 2 failed                          | 100%   | 99.36%   | failed tests/hooks   |

All package percentages exceed policy using the original coverage configuration.
No exclusions, thresholds, assertions or test timeouts were weakened. Web's broad run
executed 117 files; two workers failed before their files ran. Do not call that all 119
files passing. Those two files subsequently passed **33 tests** in a separate one-worker
command. The broad web denominator remains 7,133 lines / 7,637 branches.

New public scenarios cover nullable/default contracts; marked/unmarked cycles beyond
20; cancellation; configured/disabled/recovered deadlines; deadlines during drain;
late-result suppression; awaited-child cleanup; typed failures; exact task identity and
safe retry bound. SQL tests cover idempotent pins in runs, queued events and saved webhook
intents, custom/null limits and malformed JSON. Claude protocol tests retain full accepted
assistant/reasoning/tool output. UI tests cover defaults, typing/validation, gate Unlimited
and inspector/timeline evidence. There is no private reflection or new private monkeypatch.

Preserved failures and selected triage:

- Infrastructure: eight native process-stop/readiness/cleanup failures (including EBUSY,
  continued descendant writes, unconfirmed termination and abort timeouts), plus the
  existing upgrade testcase's 20-second timeout. Selecting those nine with one worker
  reproduced all nine. D-015 native qualification must happen outside this sandbox;
  the upgrade timeout remains unresolved, not an established product defect.
- API: broad failure was a 60-second subloop-restart cleanup-hook timeout. Selected
  commands also found the seeded child still `running`, then `queued`, within the
  existing wait budget, followed by the same cleanup timeout. The serial post-coverage
  attempt remained failed. No timeout was extended and no recovery assertion changed.
- Web: three trigger-form 20-second timeouts and two undo grouping assertions (including
  `Start hell` instead of `Start`). Without changes, the complete undo file passed 8/8
  and the selected trigger cases passed 3/3. The two worker-error files passed 33/33 after
  coverage stopped. These are separate results, not a clean broad gate.
- API-client: template tests hit 5-second test and 10-second cleanup budgets. The serial
  post-coverage command passed one and retained one timeout/hook failure. Runtime client
  code was unchanged; generated types changed. Qualification remains open.

The exact outputs are the `coverage-*-current.log`, `triage-*.log` and
`postcoverage-*.log` files in this directory; initial failed outputs are retained too.

## 5. Gates

Node **v22.14.0**, `pnpm.cmd`, this worktree throughout.

| Command                                                                                 | Result                                                                      |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm.cmd typecheck --concurrency=1`                                                    | passed, 20/20 tasks                                                         |
| `pnpm.cmd --filter @graphgoblin/web typecheck`                                          | passed after final E2E fixture delta                                        |
| `pnpm.cmd lint --concurrency=1`                                                         | passed, 11/11 tasks                                                         |
| `pnpm.cmd --filter @graphgoblin/api exec eslint scripts/unlimited-mode.integration.mjs` | passed after final runner-only changes                                      |
| `pnpm.cmd format:check`                                                                 | passed; final report formatting recheck recorded in final-report-checks.log |
| `pnpm.cmd check:layers`                                                                 | passed on final source                                                      |
| `pnpm.cmd check:deps`                                                                   | passed; existing drizzle.config.ts no-orphans warning (837 modules)         |
| `pnpm.cmd check:tokens`                                                                 | passed, 165 files                                                           |
| `pnpm.cmd check:migrations`                                                             | passed; Drizzle no-op                                                       |
| `pnpm.cmd --filter @graphgoblin/api-client generate`                                    | passed                                                                      |
| `pnpm.cmd docs:generate` / `pnpm.cmd check:docs`                                        | passed; generated docs current                                              |
| `pnpm.cmd build --concurrency=1`                                                        | passed, 11/11 tasks                                                         |
| `git diff --check`                                                                      | passed                                                                      |

Coverage used direct `pnpm.cmd --filter @graphgoblin/<package> test:coverage`:
`--maxWorkers=1` for contracts/domain/adapter-codex; final engine/infrastructure/api/web/
api-client commands used `--maxWorkers=2 --coverage.reportOnFailure`. Results and failed
gates are above. Direct commands avoid Turbo dependency-cache ambiguity. No dependencies
changed; the conditional licences gate was not required.

`GG_E2E_BROWSER_CHANNEL=msedge pnpm.cmd --filter @graphgoblin/web exec playwright test
e2e/unlimited-mode.spec.ts e2e/editor-modal.spec.ts e2e/definition-pins.spec.ts`:
**10 passed on the final production build**. No model-picker specs were selected.

`node apps/api/scripts/unlimited-mode.integration.mjs`: `native-current.log` contains
one complete five-scenario pass on the final production build: success, stall (including
configured/disabled deadline), quota, transport, unknown; 135-ms unlimited cancellation,
56-ms stalled fake PID exit. Later runner-only changes explicitly pin GG_DB_URL inside
the TEMP store and bound HTTP requests. Their first run passed success (442-ms cancel)
then failed before stall startup. The final serial invocation also failed before the first
API listened: ECONNREFUSED, process alive, no whitelisted stderr code within the unchanged
30-second startup budget. **Latest native runner qualification is unresolved.** No extra
retry loop, budget relaxation or provider turn was used.

The owner recipe's four PowerShell blocks are syntax checked. Native fake compilation
and all previous observed turns used the C# fixture, never an installed provider CLI.
Installed real CLIs were used only for version/help/option inspection.

## 6. Docs

Updated docs/04, 05, 06; guides 02, 03, 06; ADR-0047; CHANGELOG's upgrade bullet ending
`(#243)`; generated node catalog and API-client OpenAPI/types; plan, before evidence,
report/ranges and [owner README](README.md). The PowerShell resume example now sends
JSON `{}`. Upgrade notes explain nullable limits, required run-pin limits, the one-off
SQL migration, expiry of already-overdue runs on recovery and removal of programmatic
Claude `maxTurns`/`turnTimeoutMs`. No owner-store migration was performed.

## 7. Decisions and parameters

Engineering choices, not owner-approved numbers: retain 10 default visits and the finite
10,000 maximum; default elapsed deadline one hour to stop forgotten executions while
allowing ordinary work; maximum 31,536,000 seconds follows the existing gate-time range.
Null explicitly removes the corresponding cutoff. Queue time is excluded; waits, pauses
and downtime count. The active watchdog chunks delays below Node's 2,147,483,647-ms timer
ceiling and is disposed after each executor pass. Cancel remains distinct; unconfirmed
native termination is preserved rather than falsely reporting that work stopped.

Format 4 keeps authored per-gate passes, not a global iteration default. Switching back
to Limited uses contract defaults; required passes use 10 as a finite starting value.
A newly marked gate still requires the author to choose its pass limit. One immediate
transport retry (two invocations) bounds positively safe transient recovery without
allowance polling. No generic, quota, auth, timeout, output or uncertain-submission retry.

Native cancellation's 10-second test budget includes the existing five-second adapter
termination grace and API propagation; observed timings are not a latency SLA. QA HTTP
requests are bounded at 10 seconds, health requests at two seconds, startup at 30 seconds.
These are test failure budgets. Resource/protocol protections remain truthful typed
failures; they are not spending/usage limits. Complete numeric metadata/output audit and
provider-side qualifications are in the linked audit tables.

## 8. Caveats and open items

- Independent Claude review and independent QA remain. Full local test gates are not
  green despite every package exceeding coverage policy. Preserve all failed commands;
  selected successes and an earlier native pass are not a clean final gate.
- D-015 native process-tree qualification and locked test-fixture cleanup need an
  environment that can confirm termination. Relevant paths/assertions are in the logs.
  Upgrade/client/API timing failures and latest API startup qualification remain open.
  No F1 readiness assertions or source were changed to hide unconfirmed termination.
- SQL **0015** collides with pending branches. The orchestrator must renumber/reconcile
  SQL, journal and snapshot with a strictly increasing migration timestamp. ADR-0047 is
  reserved here; ADR-0046 is not used. Review the single WP-D2 finalizer condition.
- #270 structured-completion deadline enforcement and #335 allowance wait/recovery
  remain outside this bolt. No live-provider or structured-completion enforcement claim.
- Outside scope: Windows Codex preflight accepts .js/.mjs launchers but the SDK directly
  spawns its override for turns. The native fake avoids that mismatch; adapter launch
  semantics and F4 classification were not changed to solve it.
- The base register lacks D-025/D-026/section 4b; the current dispatch supplies authority.
  Pending F1/F4 integration/sign-off belongs to the orchestrator.
- Owner app/store and main-checkout commands were untouched. No paid turns, API-key
  disclosure, installed-runtime change or outside-worktree link was made. Ambient data,
  database and defaults overrides were absent during earlier native evidence; the final
  runner explicitly isolates both data and database. All own gg-wp-f3 TEMP stores were
  removed; absence verified. One earlier empty compiler-failure folder was removed only
  after verifying it empty. Worktree coverage/test-results/QA folders remain per COMMON.
