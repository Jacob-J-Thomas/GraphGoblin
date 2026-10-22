# Independent QA: WP-F3 / #243

## 1. Verdict, branch and worktree

**FAIL: qualification incomplete for `ca54c697c71709e34e1053606e8355aa7f626a46`.**
No confirmed WP-F3 product defect was found. The exercised feature scenarios passed.
The exact archived-F4-store startup/migration requirement remains blocked by the host,
and the full infrastructure and API coverage commands failed. These results do not
constitute an unconditional QA sign-off.

Independent QA, working alone; no implementation, staging, commits or publication.
QA checkout: `codex-qa-wp-f3`; branch: `codex-qa-wp-f3`.
Product HEAD remained the requested SHA. Stacked F4 base:
`56a6fb9d9ec6c1f080bb7ab0ad71e4406b7ef196`.
Uncommitted QA evidence; ready for orchestrator review. Product tracked diff and index
were empty at the closing boundary check. All added files are in this directory.

Environment: Windows, PowerShell, Node **22.14.0** first on PATH; `pnpm.cmd`.
Built web assets served by built API modules, headless Microsoft Edge through Playwright.
QA-created API listeners used **5900** (native recipe), **5905** (fake-harness API and
Edge), and **5907** (native fake Claude). Existing native tests inside the requested
API coverage command chose their own 56xx ports; one collided at 5646.
No owner listener on 4747/4748, owner store or paid provider turn was used.

All provider evidence is **fake-only**. Native means real operating-system processes
and HTTP; it does not mean a real provider. The Edge runner retained one worker and
zero retries. Its QA configuration replaced global setup to keep the API listener in
the requested range and use compiled API/engine/storage modules. The checked-in specs
themselves were unchanged.

## 2. Defects and per-criterion coverage

### Defects

**Confirmed product defects: none.** No blocker, major or minor product defect is
asserted from the host failures below. A missing native qualification is not a pass.

Qualification blockers:

- **Q-01, major verification gap:** exact F4 base build/store migration could not run.
  `git archive 56a6fb9d` succeeded into an independent TEMP directory. Both dependency
  installation attempts failed with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`, access
  denied to pnpm's shared `all-stores.lock`. A process-local isolated store/LOCALAPPDATA
  attempt encountered the same lock. No dependencies were linked from another checkout.
  Evidence: [base-install.log](base-install.log), [base-install-2.log](base-install-2.log).
- **Q-02, failed infrastructure gate:** 9 failed / 649 passed. Eight failed test cases
  concern native process-tree stop/termination or their locked cleanup directories
  (D-015); one was a 20-second SQLite upgrade timeout. The focused upgrade file passed
  later without changing its timeout or product. Original command remains failed.
- **Q-03, failed API gate:** 1 failed / 718 passed / 6 skipped. The retired-Event native
  startup test exited with `EADDRINUSE` on 5646. This is a listener collision, not a load
  timeout or a demonstrated execution-limit regression. The full suite was not repeated.
- **Q-04, cleanup blocked:** four identified temporary directories remain because
  automatic approval review rejected recursive deletion, including the exact-path
  attempt, with only `blocked by policy` as the reason. Their manifest is in section 8.

### Check matrix

Each row gives the procedure, expected behavior, actual result, disposition and evidence.

| ID / system                         | Steps                                                                                                                                                        | Expected                                                                                                 | Actual / disposition                                                                                                                                                                                                     | Evidence                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| V1 Editor defaults                  | Create an omitted-settings loop; open Loop controls at desktop and 390 px.                                                                                   | Visits Limited 10; deadline No run deadline before a run exists.                                         | **PASS**; 10 and neutral no-deadline help visible.                                                                                                                                                                       | `edge-specs.log` test 9; `edge-extra-results.json` Loop tab check                                                              |
| V2 Settings                         | Open Settings at 390 px.                                                                                                                                     | Execution defaults 10; no deadline unless authored.                                                      | **PASS**; card text and layout verified.                                                                                                                                                                                 | `edge-extra-results.json` Settings check                                                                                       |
| V3 Published API pin / inspector    | Publish an omitted-settings loop; start through REST; inspect run and narrow inspector.                                                                      | `pinned.limits = {maxNodeVisits:10, runDeadlineSeconds:null}` and matching card.                         | **PASS**.                                                                                                                                                                                                                | `api-results.json` first check; `edge-extra-results.json` published pin check                                                  |
| V4 Definition lifetime              | Run a waiting draft, edit its exit in the editor, provide input; start another run.                                                                          | Old execution returns old value; new execution uses edited value.                                        | **PASS**, including terminal inspector refresh. No additional limits-edit mutation is claimed for this test.                                                                                                             | `edge-specs.log` definition-pins; `coverage-engine.log`                                                                        |
| U1 Visits Unlimited                 | Select Unlimited, observe warning, save and reload.                                                                                                          | Number disappears; warning appears; persisted null; inspector says Unlimited.                            | **PASS**.                                                                                                                                                                                                                | `edge-specs.log` unlimited-mode test 1; `edge-extra-results.json`                                                              |
| U2 Old cutoff / native cancellation | Native fake Codex loop with no visit cap; observe >20 turns; cancel through built API; separately cancel stalled native fake.                                | Continues beyond former 10; cancelled within 10 seconds; fake PID gone.                                  | **PASS**; >20 turns; both native cancellation observations **62 ms**, stalled PID confirmed exited.                                                                                                                      | `native-recipe.log`; replayable `native-recipe.mjs`                                                                            |
| U3 Gate passes Unlimited            | Author marked repeat route with `maxPasses:null`, visits null; observe >20 work visits; cancel.                                                              | No synthetic pass exhaustion.                                                                            | **PASS**, 21 visits; cancelled in **187 ms**. Gate evidence has null maxPasses in the focused public engine scenario.                                                                                                    | `api-results.json` unlimited repeat gate; `engine-focused.log` first scenario                                                  |
| U4 Finite negative                  | Omit visit settings and execute cycle.                                                                                                                       | Stops at visible 10-visit default with `MAX_NODE_VISITS`.                                                | **PASS**; native and component checks.                                                                                                                                                                                   | `native-recipe.log`; `engine-focused.log`                                                                                      |
| U5 No substitute budgets            | Inspect Settings controls, editor/inspector text, OpenAPI schema, captured run pins, and adapter launch facts.                                               | No spending, token, subscription or provider-turn budget controls/fields.                                | **PASS** for exercised surfaces and schema. Settings explicitly explains that these budgets are absent; informative usage counters are permitted.                                                                        | `edge-extra-results.json`; `api-results.json`; `claude-native-first.json`; docs/06 audit                                       |
| D1 Input deadline                   | Publish wait-for-input loop with 5-second deadline; await failure; submit late observed input.                                                               | Failure near 5 seconds, `RUN_DEADLINE_EXCEEDED`, non-resumable; late input cannot change terminal state. | **PASS**, **5,578 ms**, resumable false, late request rejected and failure preserved.                                                                                                                                    | `api-results.json` five-second check                                                                                           |
| D2 Child cancellation               | Parent with authored 5 seconds awaits child waiting for input with no deadline.                                                                              | Parent fails; child cancelled.                                                                           | **PASS**, parent elapsed **5,287 ms**; child cancelled.                                                                                                                                                                  | `child-inspector-results.json`                                                                                                 |
| D3 Late active result               | Public engine handler ignores deadline signal and returns late.                                                                                              | Late result cannot resurrect failed run.                                                                 | **PASS**; distinct active-abort and signal-ignoring-handler cases.                                                                                                                                                       | `engine-focused.log`                                                                                                           |
| D4 No default overnight stop        | Advance public fake clock by 24 hours, with and without manager recovery; deliver observed signal. Also native restart and short observation.                | Still waiting after a day, then succeeds after signal; no deadline pin.                                  | **PASS controlled component**, both 24-hour cases. Native check remained waiting 7 seconds after restart. No claim of a real one-hour soak.                                                                              | `engine-focused.log`; `api-results.json` default input wait                                                                    |
| D5 Pause and native restart         | Start authored 5-second input wait, pause, kill own API process, wait past deadline, start a new process over same disk store.                               | Original absolute deadline includes pause/downtime and is not restarted.                                 | **PASS**; paused before, failed after recovery, original `startedAt` identical (`2026-10-22T04:44:50.883Z`); effective absolute deadline was start + 5 seconds.                                                          | `api-results.json` paused/restart; script now explicitly compares start and limits rather than a nonexistent deadline property |
| M1 Exact archived base              | Archive F4 56a6fb9d under TEMP, install/build, create old store, open with candidate.                                                                        | Actual old runs/intents migrate on candidate startup.                                                    | **NOT TESTABLE here**, Q-01. Archive extracted; install failed before build/store creation.                                                                                                                              | `base-install*.log`                                                                                                            |
| M2 Supplemental SQL matrix          | Create real libSQL synthetic pre-0015 rows; apply shipped SQL twice for omitted/4/null visits, omitted deadline, queued event pins and saved admission pins. | 10/4/null visits; null deadline everywhere; idempotent.                                                  | **PASS supplemental**, all three cases and both intent pins match. Not evidence of an archived-F4 build/startup.                                                                                                         | `migration-supplement-results.json`; `migration-supplement.mjs`                                                                |
| M3 Damaged JSON                     | Apply SQL to malformed run pin, queued payload and saved webhook intent.                                                                                     | Malformed bytes unchanged; other rows migrate.                                                           | **PASS supplemental**; exact `{broken` strings retained. Existing SQLite scenarios also cover authored null/5 and historical fixtures.                                                                                   | `migration-supplement-results.json`; `infrastructure-isolated.log`                                                             |
| M4 Migrated inspector               | Remove limits from terminal run/queued pin in isolated store; apply SQL 0015 atomically; read REST and Edge inspector at 390 px.                             | Reconstructed pin and visible limits card agree.                                                         | **PASS synthetic pre-0015 row**; 10 visits / no deadline visible. Does not remove M1 gap.                                                                                                                                | `child-inspector-results.json`                                                                                                 |
| A1 Claude launch                    | Run native QA-only protocol executable through public Claude runner injection; capture actual inference request.                                             | No `--max-turns`; no independent per-turn timeout.                                                       | **PASS**; `maxTurns:false`, `timeoutMs:null`. The no-turn help compatibility probe may still parse `--max-turns 1 --help`; it is not inference. No 10-minute real soak was performed.                                    | `claude-native-first.json` large case; `claude-corrected-results.json`                                                         |
| A2 Node watchdog                    | Stalled fake Claude, node timeout 10 seconds, no run deadline.                                                                                               | Node watchdog fails `INFERENCE_TIMEOUT`; one invocation.                                                 | **PASS code/count**; result after **12,402 ms**, because native stop did not promptly kill the fixture in this sandbox and its own finite 12-second lifetime ended. No clean process-tree timing qualification inferred. | `claude-native-first.json` stall case                                                                                          |
| A3 Safe transport retry             | Public fake harness gives retriable, definitely-not-submitted transport failure; count invocations through built REST API.                                   | Exactly two, retained authored task, no third invocation.                                                | **PASS fake-port evidence**, two invocations. Exact authored prompt/turn identity separately passed engine test. This is not a native CLI pre-submission transport proof.                                                | `api-results.json`; `engine-focused.log`                                                                                       |
| A4 Retry negatives                  | Repeat with uncertain transport, non-retriable transport, quota, auth, timeout and output-limit errors.                                                      | Each invoked once; no allowance recovery or substitution.                                                | **PASS fake-port evidence**. Native fake Claude quota/uncertain transport/timeout/output cases also each invoked once, recorded in fake log.                                                                             | `api-results.json`; `claude-corrected-results.json`; `claude-native-first.json`                                                |
| A5 Typed native errors              | Native fake Claude emits documented assistant error categories for service/transport and quota.                                                              | Truthful run failure code, no silent retry of uncertain work.                                            | **PASS**, `HARNESS_TRANSPORT_FAILED` / `HARNESS_QUOTA_EXHAUSTED`, one invocation each. Native Codex equivalents also passed.                                                                                             | `claude-corrected-results.json`; `native-recipe.log`                                                                           |
| A6 Stream resource bound            | Native fake streams >4 MiB of individually valid assistant records.                                                                                          | `HARNESS_OUTPUT_LIMIT`, not successful truncation.                                                       | **PASS**, failed run, one invocation.                                                                                                                                                                                    | `claude-native-first.json` overflow case                                                                                       |
| A7 Detail/final distinction         | Native fake returns 20,000 ASCII chars; inspect normalized stored transcript detail and final result.                                                        | Text detail <=16,384 chars, final complete.                                                              | **PASS component/native transport**, detail exactly 16,384, final exactly 20,000. Inspector limits card separately tested. Large transcript detail was not interactively expanded in the inspector.                      | `claude-native-first.json`; `infrastructure-isolated.log` protocol detail cases                                                |
| E1 All field modes                  | Edge visits Limited/Unlimited; deadline none/Limited, clear suggested 3600, enter 5, restore none; gate Limited 4/Unlimited.                                 | Editable finite numbers, correct warning/default text and persisted selection.                           | **PASS**; six presentation cases in web suite, two feature Edge cases, narrow checks.                                                                                                                                    | `coverage-web.log`; `edge-specs.log`; `edge-extra-results.json`                                                                |
| E2 Gate validation                  | Submit finite visits 3 with marked gate passes 4 to validation endpoint.                                                                                     | Warning explains visits undercut passes.                                                                 | **PASS**, `GATE_PASSES_ABOVE_VISIT_CAP` warning naming the gate and `MAX_NODE_VISITS`. Then narrow gate editor successfully selected Unlimited and showed warning.                                                       | `edge-extra-results.json` validation/dialog                                                                                    |
| E3 390 px / keyboard                | Measure document width for Settings, Loop panel, inspector and gate dialog; use native select keys and keyboard node activation.                             | No horizontal document overflow; controls available.                                                     | **PASS**, viewport and document width both 390 in measured screens.                                                                                                                                                      | `edge-extra-results.json`; desktop/narrow modality in `edge-specs.log`                                                         |

Issue #243's four acceptance bullets have positive tested evidence for visible
disableable limits, no substitute usage budgets, the combined cutoff audit, and typed
failures/safe bounded retries. Native migration qualification and the interactive large
inspector detail path remain incomplete as explicitly distinguished above. #288 and
#278 were used as scope/authority; this report does not claim all of I06 complete.

## 3. Files changed

Only this QA evidence directory was added: report, executable QA recipes, JSON
observations and sanitized text logs. No product source, existing test, numbered doc,
ADR, CHANGELOG, generated reference, package manifest, lockfile or Git index changed.
No cross-package ownership edits. Build/coverage artifacts are ignored outputs.

The QA runner setup errors are preserved separately: initial wrong config location,
initial test policy/default-effort omissions, incorrect native protocol error carrier,
detail measurement including JSON envelope, missing validation request body, and an
initial narrow-panel hydration race/focus selector. Corrections changed only these QA
scripts. Original failing observations are retained in `*fixture-errors*`,
`claude-native-first.json`, `edge-extra-hydration-error.json` and `edge.log`.
Those are fixture/admission errors, not product regressions or retries of broad suites.

## 4. Tests and coverage

No product regression test was added or changed; there was no implementation fix.
All requested broad coverage commands ran once, directly through their package scripts.

| Package        | Broad result                                           | Lines                     | Branches                  |
| -------------- | ------------------------------------------------------ | ------------------------- | ------------------------- |
| contracts      | **PASS**, 264 passed                                   | 99.73%, 379/380           | 95.00%, 190/200           |
| engine         | **PASS**, 593 passed                                   | 97.94%, 2287/2335         | 92.59%, 1902/2054         |
| infrastructure | **FAIL**, 9 failed / 649 passed, 658 total             | Not emitted on failed run | Not emitted on failed run |
| api            | **FAIL**, 1 failed / 718 passed / 6 skipped, 725 total | Not emitted on failed run | Not emitted on failed run |
| web            | **PASS**, 1508 passed                                  | 98.93%, 7058/7134         | 94.92%, 7261/7649         |

No historical implementer percentages are reused as fresh infrastructure/API coverage.
Those packages' >90% policy cannot be certified from this failed coverage collection.
Thresholds, exclusions and timeouts were unchanged.

Focused evidence, for named triage and explicit criterion measurements:

- Engine `src/unlimited.test.ts`: **19 passed**, including fake 24-hour waits/recovery,
  late results, safe retry identity and child cancellation. `engine-focused.log`.
- Infrastructure `definition-pins.test.ts`, `claude/protocol.test.ts`,
  `sqlite/upgrade.test.ts`: **120 passed**. This isolates the broad run's upgrade
  timeout; it does not turn that original broad command green. `infrastructure-isolated.log`.
- Edge `unlimited-mode.spec.ts`, `definition-pins.spec.ts`, `editor-modal.spec.ts`:
  **10 passed**, including the inspector and loop-panel cases. `edge-specs.log`.
  There is no separate `loop-settings.spec.ts` in this revision.
- Extra Edge: **5 passed** after correcting QA-only setup/synchronization mistakes.
  Native parent/child and synthetic migrated-inspector checks also passed.
- Native implementer recipe rerun independently with only TEMP prefix changed:
  **five scenarios passed** (success, stall, quota, transport, unknown).

No claim about the rest of the browser suite is made. Known #205 model-picker failures
were not exercised or counted as exceptions to these ten passing relevant cases.

## 5. Gates and exact commands

All commands used Node 22 first on PATH in PowerShell; logs are named after the gate.

| Command                                                                                                                                                                                  | Result                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd build`                                                                                                                                                                         | **PASS**, 11 tasks, fresh build                                                                                      |
| `pnpm.cmd --filter @graphgoblin/contracts test:coverage`                                                                                                                                 | **PASS**                                                                                                             |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage`                                                                                                                                    | **PASS**                                                                                                             |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage`                                                                                                                            | **FAIL**, Q-02                                                                                                       |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                                                                                                                                       | **FAIL**, Q-03                                                                                                       |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`                                                                                                                                       | **PASS**                                                                                                             |
| `pnpm.cmd typecheck`                                                                                                                                                                     | **PASS**                                                                                                             |
| `pnpm.cmd lint`                                                                                                                                                                          | **PASS**                                                                                                             |
| `pnpm.cmd format:check`                                                                                                                                                                  | Initial **FAIL** only on new QA artifacts; final **PASS** in `final-checks.log` after formatting this directory only |
| `pnpm.cmd check:layers`                                                                                                                                                                  | **PASS**                                                                                                             |
| `pnpm.cmd check:deps`                                                                                                                                                                    | **PASS**, existing orphan Drizzle-config warning                                                                     |
| `pnpm.cmd check:docs`                                                                                                                                                                    | **PASS**                                                                                                             |
| `pnpm.cmd check:tokens`                                                                                                                                                                  | **PASS**                                                                                                             |
| `pnpm.cmd check:migrations`                                                                                                                                                              | **PASS**                                                                                                             |
| `pnpm.cmd check:licenses`                                                                                                                                                                | Not run; no dependency changes                                                                                       |
| `pnpm.cmd --filter @graphgoblin/engine exec vitest run src/unlimited.test.ts --reporter=verbose`                                                                                         | **PASS**, 19                                                                                                         |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/definition-pins.test.ts src/claude/protocol.test.ts src/sqlite/upgrade.test.ts --reporter=verbose`             | **PASS**, 120                                                                                                        |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test --config ../../docs/qa/2026-10-22-wp-f3-qa/edge.config.mjs unlimited-mode.spec.ts definition-pins.spec.ts editor-modal.spec.ts` | **PASS**, 10; `GG_E2E_BROWSER_CHANNEL=msedge`, isolated URL/control 5905                                             |
| `pnpm.cmd install --frozen-lockfile --offline` in archived base                                                                                                                          | **BLOCKED**, shared pnpm lock access denied                                                                          |
| `pnpm.cmd install --frozen-lockfile --store-dir <base-temp>/store` with process-local `LOCALAPPDATA`                                                                                     | **BLOCKED**, same shared lock                                                                                        |

Replay scripts: `node docs/qa/2026-10-22-wp-f3-qa/native-recipe.mjs`,
`api-checks.mjs`, `claude-checks.mjs`, `edge-extra.mjs`,
`migration-supplement.mjs`, `child-and-inspector.mjs` (each latter path relative to this
directory). `server.mjs <gg-qa-243-name>` is the isolated built-API composition root
used by the Edge checks, at 5905. Cleanup restrictions on this host still apply.

## 6. Documentation and authority

Read QA-COMMON and COMMON first; repository documentation index, issue workflow and
architecture map; issues #243/#288 and the #278 owner-ledger/completion requirements;
ADR-0047; docs/06 execution cutoff audit; docs/05 limits; CHANGELOG #243; plan and
implementer round-1/round-2 reports plus recipe. Read D-027 directly from the register
on `main`, without changing that checkout.

The current docs/ADR/CHANGELOG agree on 10 visits and **no default run deadline**,
optional authored deadlines, explicit null for Unlimited visits/passes, the SQL pin
migration, typed failures and the item-detail storage bound. Upgrade notes explicitly
describe nullable clients/pins and removal of programmatic `maxTurns`/`turnTimeoutMs`.
Historical round-1 finite-default claims are marked superseded; they were not used as
current requirements. No product documentation was edited during independent QA.

## 7. Decisions and parameters

- D-027 governs the no-default deadline; 3600 is only the UI suggestion after selecting
  Limited. Native deadline fixtures authored 5 seconds; node watchdog authored 10.
- Unlimited checks were bounded by observation beyond 20 turns and explicit Cancel.
  No paid or indefinite soak. The long-wait check used public fake-clock injection.
- 16,384 is the text/output character excerpt bound (16 KiB for the ASCII fixture),
  not total serialized JSON size. Metadata remains outside that text bound. A complete
  final result is distinct from the inspector's stored item excerpt.
- Safe retry used the public FakeHarness submission evidence; the native CLI fixtures
  recorded actual invocation facts and uncertain transport was correctly not repeated.
- No private-method access, reflection, production monkey-patching, changed coverage
  thresholds, runtime installation changes or test-only production exports were used.

## 8. Caveats, cleanup and open items

Before a clean QA sign-off: run the exact F4 archived-build/store-to-candidate startup
matrix in a host that permits dependency installation; resolve/qualify the infrastructure
native-process gate; obtain a clean API coverage run without its 5646 collision and
fresh coverage for both failed packages. Large-item transcript data is verified through
the real native adapter/component result, but an interactive large-item expansion in
the inspector remains unverified. The ten-minute adapter watchdog absence is measured
at the public process request (`timeoutMs:null`), not by a ten-minute wall-clock soak.

The native timeout's 12.4-second observation is explicitly host-qualified: D-015 process
termination limits prevented treating node timeout observation as clean native kill
timing. Native Codex cancellation did positively confirm its fake PID exited in 62 ms.

All short-lived API/Claude/native-recipe stores otherwise removed themselves. The QA
Edge server PID was verified as Node on its dedicated 5905 listener and stopped. Closing
listener inventory found no 5900â€“5909 listeners. No owner process was stopped.

**Orchestrator cleanup manifest, all under `%TEMP%`:**

1. `gg-qa-243-base-ca54-20261022` â€” archived base source/dependency-install attempt; no old store was created.
2. `gg-qa-243-claude-Lj3Yx4` â€” one closed native-Claude fixture store whose immediate removal hit EBUSY.
3. `gg-qa-243-edge-ca54-20261022` â€” stopped fake-harness API/Edge store.
4. `gg-claude-process-njyprF` â€” this infrastructure run's failed descendant-process fixture marker directory.

Their resolved paths were verified inside TEMP. Recursive deletion was rejected by
automatic approval review, including exact `-LiteralPath` targets, with the sole stated
reason **`blocked by policy`**. No alternate deletion mechanism was used after rejection.
The process-command-line CIM inventory also returned Access denied. These are host
limitations, not user authorization requests. Other ordinary coverage/build outputs
remain ignored in the worktree as the common QA brief directs.

The pnpm lock and port-collision observations are outside WP-F3 behavior. No issue,
GitHub comment, PR, owner environment setting, protected work or memory file was changed.
