# Independent QA: WP-F4 / #33

Revision: `7d76abd0e1330273e6efe3f0f82907e59061111d`. Base: `fbd48d3da5f162539964516a34d5de7e387d63c6`. Branch: `codex-qa-wp-f4-33`. Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-f4-33`. Executed 2026-10-24. Independent QA only: no production edits, no index actions, no commits, no GitHub changes, no delegated agents.

**Verdict: fail at the pinned head because required validation is not clean. All seven requested feature case groups passed; no #33 behavior defect was reproduced.** No #33 behavior defect has been reproduced. Fake-harness evidence establishes GraphGoblin routing and provenance, not native-provider recall or retention. Implementer/orchestrator provider results were not used as QA evidence.

## Environment and boundaries

`git rev-parse HEAD` matched before any work. `node_modules` was present and nonempty; no installation or links were made. Node `v22.14.0` was first on PATH for every gate. `pnpm.cmd build` completed successfully, 11 tasks, zero cache hits. Turbo emitted cache-write access warnings; these did not fail the commands. No `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` occurred and no direct-tool fallback was needed.

The independently authored fixture imports the **built public API composition**, uses its real SQLite repositories, HTTP routes, auth and served web build, and injects only public `FakeHarness` ports. It creates its API key through the public repository constructor/composition. The API key and runnable temporary copies remain only in the disposable store, not in the evidence. The retained scripts contain no API key.

| Instance          | Port | Disposable store                                      | Purpose                                                            |
| ----------------- | ---- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| Initial           | 5830 | `%USERPROFILE%\AppData\Local\Temp\gg-qa-f4-33-812Cx6` | Codex runtime, native kill/restart, row deletion, invalid requests |
| Corrected fixture | 5831 | `%USERPROFILE%\AppData\Local\Temp\gg-qa-f4-33-rY3MRF` | Remaining harness scenarios and all Edge checks                    |

Edge ran headlessly through Playwright, channel `msedge`, at 1440×900 and 390×900. These were isolated browser contexts, without controlling the owner's browser. No owner instance, ports 4747/4748, owner store, or main checkout was used. Stores and generated ignored build/coverage folders were not deleted by QA.

**Environment deviation:** the separately invoked maintained API coverage suite used its existing fixture port 5677 and temporary prefixes such as `gg-api-process-` and `gg-wp-c2-tests-`, as recorded in `coverage-api.log.txt`. This should have been checked before launching the broad suite; the independently authored cases all use the required ports and prefix. Existing maintained tests perform their own fixture cleanup. No real-provider inference was authorized or invoked by the independent scripts.

## Touched systems

Contracts and strict `SessionPolicySchema`; generic schema-driven editor and numeric validation; engine completed-visit selection and exact-attempt lookup; pending-turn provenance, repair/retry/cancellation; fake harness session announcements; SQLite session lookup and durability; built API admission, run control, events, sessions, replay, subloop composition and portable import/export; generated API-client schema; served inspector; documentation and CHANGELOG. `changed-systems.log.txt` enumerates the exact diff; `touched-source.log.txt` preserves the relevant source delta, including the separate test-only advisory suppression in `pnpm-workspace.yaml`.

## Checks

All runtime event captures contain the full retained event list, run record and thread, not just the assertions' summary. Unless marked otherwise these are **built API + real SQLite + fake harness** checks. Each JSON evidence filename below is linked in the artifact inventory.

| Case / system                          | Steps and expected behavior                                                                                                            | Actual evidence                                                                                                                                                                                                                                      | Result |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Pinned checkout and dependencies       | Read HEAD and inspect nonempty local dependencies before testing                                                                       | Exact head; `.bin`, `.pnpm`, workspace dependencies present; initial Git status clean                                                                                                                                                                | PASS   |
| Worker/reviewer/worker, both harnesses | Both nodes use `resume-own`; repeat through a decision gate                                                                            | Each node starts fresh, later resumes its own ID; worker and reviewer IDs differ. Every `harness.turn.resumeSessionId` equals the selected own session, or is absent on fresh. `codex-reset-blank.json`, `runtime-corrected/claude-reset-blank.json` | PASS   |
| Reset 1                                | Seven completed worker visits; reviewer has no reset                                                                                   | Worker modes `fresh,fresh,fresh,fresh,fresh,fresh,fresh`; one reviewer conversation. `codex-reset-1.json`, `runtime-corrected/claude-reset-1.json`                                                                                                   | PASS   |
| Reset 2                                | Seven completed visits                                                                                                                 | Worker modes `fresh,resumed,fresh,resumed,fresh,resumed,fresh`. `codex-reset-2.json`, `runtime-corrected/claude-reset-2.json`                                                                                                                        | PASS   |
| Reset 3                                | Seven completed visits                                                                                                                 | Worker modes `fresh,resumed,resumed,fresh,resumed,resumed,fresh`. `codex-reset-3.json`, `runtime-corrected/claude-reset-3.json`                                                                                                                      | PASS   |
| Blank reset                            | Twelve completed visits per node, both harnesses                                                                                       | One fresh then eleven resumed; one conversation per node. No hidden tenth-visit reset                                                                                                                                                                | PASS   |
| Shared state at every reset            | Seed a variable and shared message; render current feedback into authored tasks; inspect final thread                                  | `vars.sentinel` remains `never erase`; shared seed survives; seven-visit cases retain 15 messages, twelve-visit cases 25; reviewer ID remains constant; every task sees the seeded variable                                                          | PASS   |
| Existing fresh policy                  | Three worker/reviewer cycles                                                                                                           | Six distinct conversations; deliberate current-thread inputs remain in tasks. `fresh.json`                                                                                                                                                           | PASS   |
| Existing previous policy               | Both nodes use `resume-previous`                                                                                                       | One shared conversation, one fresh followed by five resumes. `resume-previous.json`                                                                                                                                                                  | PASS   |
| Existing named policy                  | Both use the same key; then start a second run                                                                                         | One shared conversation across nodes and both runs. `resume-named.json`, `resume-named-second-run.json`                                                                                                                                              | PASS   |
| Parallel run isolation                 | Start two same-loop runs concurrently, with controlled 400 ms turns, each harness                                                      | Distinct worker/reviewer handles in each run. IDs and full events in `runtime-corrected/runtime-results.json` and `*-isolated-*.json`                                                                                                                | PASS   |
| Replay worker and reviewer             | After source completion, fork once at each node                                                                                        | Each fork's first visit to each inference node is fresh and has no resume ID; copied thread/gate state carries no handle. Both harnesses                                                                                                             | PASS   |
| Subloop child isolation                | Run the repeated loop as a child; await parent success                                                                                 | Child has its own two conversations, distinct from source and forks. `runtime-corrected/*-parent.json` and isolated child captures                                                                                                                   | PASS   |
| Real process restart                   | Park at input wait after completed worker/reviewer visits; SIGKILL API; launch new process on same store; POST exact wait ID           | New PID; worker and reviewer resume pre-restart IDs. New fake adapter receives zero starts and two resumes. `restart-before.json`, `restart-after.json`, `restart-requests.json`                                                                     | PASS   |
| Missing completed session row          | While waiting, delete the worker's one SQLite session row; resume input                                                                | Exactly one row deleted; next visit fails `HARNESS_SESSION_MISSING`, `resumable:false`; zero new harness starts/resumes; resume request returns 409. `missing-row-before.json`, `missing-row-after.json`                                             | PASS   |
| Refusal at reset boundary              | Reset 1; positively refuse second worker task before submission; POST resume                                                           | Retry retains byte-equal prompt, `turnId`, `visitId`, and absent resume ID. Both harnesses; `codex-refusal.json`, `runtime-corrected/claude-refusal.json`                                                                                            | PASS   |
| Cancel resumed own turn                | Hold second worker visit for 60 s; cancel once resumed event is durable                                                                | Run cancelled; exactly two fresh starts (worker/reviewer) and one resume; no additional conversation. `codex-cancel.json`, `runtime-corrected/claude-cancel.json`                                                                                    | PASS   |
| Contract round trip                    | Export/import own policy without reset, reset 3, and max safe integer                                                                  | Policies/values preserved exactly. `runtime-corrected/roundtrip-*.json`                                                                                                                                                                              | PASS   |
| Negative API contract                  | POST reset 0, -1, 1.5, 9007199254740992, string `2`, null                                                                              | All six refused with HTTP 400 and schema paths. `invalid-reset-*.json`                                                                                                                                                                               | PASS   |
| Edge keyboard, both widths             | Focus native policy selector; End then Tab                                                                                             | Own policy selected, reset receives focus, both guidance texts visible. `edge-*-initial.json`, `edge-*-policy.png`                                                                                                                                   | PASS   |
| Edge save/reload/clear                 | Set 2, save, reload; set max, save, reload; clear, save, reload                                                                        | 2 and max survive reload, blank removes property. Model stays `gpt-6-luna`, effort `low`. `browser-results.json`, `edge-*-final.json`, `edge-*-cleared.png`                                                                                          | PASS   |
| Edge negative numeric inputs           | Type 0, -1, 1.5 and max+1, Tab, inspect validation and server draft                                                                    | `aria-invalid=true`, visible linked error text, last saved reset remains 2. Screenshots and descriptions retained for each value at each width                                                                                                       | PASS   |
| Sessions route and inspector           | GET sessions for parallel runs; open served inspector                                                                                  | Two distinct node sessions per run, HTTP 200; inspector shows succeeded execution, harness events and preserved thread. `adjacent-results.json`, `inspector-snapshot.json`, `inspector.png`                                                          | PASS   |
| Stale editor and two tabs              | Save reset 3 with current token; stale token attempts reset 1; reload in two real tabs                                                 | Stale save gets 409 `DRAFT_CONFLICT`; server remains 3; both tabs show 3. `adjacent-results.json`                                                                                                                                                    | PASS   |
| Docs and generated client              | Compare observed semantics with docs 03/04/05/06/09, ADR-0052, generated reference and upgrade note; run generated-doc check/typecheck | Same opt-in scoping, reset boundary, range, restart, missing-session and provenance semantics. Upgrade note correctly says no data rewrite and names consumer/new port change. `docs-observations.log.txt`, `docs.log.txt`, `typecheck.log.txt`      | PASS   |

## QA-script corrections (not product defects)

The first runtime script produced 17 passes and 11 setup/assertion failures. Its Claude definition omitted the explicit supported sandbox; it expected `subloop.started` instead of public `child_run.started`; and it expected the export envelope to use `definition` instead of `loop`. The initial source, results, log and partial captures are preserved. The corrected source ran only those eleven affected checks: all eleven passed. Previously passing cases were not repeated. `runtime-initial.mjs.txt`, `runtime-results.json`, `runtime.log.txt`, `runtime.mjs.txt`, and `runtime-corrected/` distinguish the two executions.

The adjacent script initially looked for capitalized `Succeeded`, while the badge exposes lowercase `succeeded`; it stopped before the remaining checks. Its original source/result are retained. Correcting the selector to a case-insensitive exact match let the served-inspector, stale-save and two-tab checks finish. No product change was made.

## Gate results

| Command                                                       | Actual                                                                                                       | Evidence                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `pnpm.cmd build`                                              | PASS (exit 0)                                                                                                | [build.log.txt](build.log.txt)                             |
| `pnpm.cmd typecheck`                                          | PASS (exit 0)                                                                                                | [typecheck.log.txt](typecheck.log.txt)                     |
| `pnpm.cmd lint`                                               | PASS (exit 0)                                                                                                | [lint.log.txt](lint.log.txt)                               |
| `pnpm.cmd check:layers`                                       | PASS (exit 0)                                                                                                | [layers.log.txt](layers.log.txt)                           |
| `pnpm.cmd check:deps`                                         | PASS (exit 0)                                                                                                | [deps.log.txt](deps.log.txt)                               |
| `pnpm.cmd check:docs`                                         | PASS (exit 0)                                                                                                | [docs.log.txt](docs.log.txt)                               |
| `pnpm.cmd check:tokens`                                       | PASS (exit 0)                                                                                                | [tokens.log.txt](tokens.log.txt)                           |
| `pnpm.cmd --filter @graphgoblin/contracts test:coverage`      | PASS; lines 99.74% ( 385/386 ), branches 95% ( 190/200 ); tests 280 passed (280)                             | [coverage-contracts.log.txt](coverage-contracts.log.txt)   |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage`         | PASS; lines 98.03% ( 2543/2594 ), branches 93.04% ( 2153/2314 ); tests 1607 passed (1607)                    | [coverage-engine.log.txt](coverage-engine.log.txt)         |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage` | FAIL; lines unavailable, branches unavailable; tests 12 failed                                               | 762 passed (774)                                           | [coverage-infrastructure.log.txt](coverage-infrastructure.log.txt) |
| `pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage`  | PASS; lines 98.82% ( 337/341 ), branches 94.63% ( 335/354 ); tests 495 passed                                | 5 skipped (500)                                            | [coverage-adapter-codex.log.txt](coverage-adapter-codex.log.txt)   |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage`     | PASS; lines 100% ( 246/246 ), branches 99.37% ( 160/161 ); tests 72 passed (72)                              | [coverage-api-client.log.txt](coverage-api-client.log.txt) |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`            | FAIL / interrupted; no completed coverage summary; lines unavailable, branches unavailable; tests incomplete | [coverage-api.log.txt](coverage-api.log.txt)               |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`            | FAIL; lines unavailable, branches unavailable; tests incomplete                                              | [coverage-web.log.txt](coverage-web.log.txt)               |

`pnpm.cmd format:check`: **INCOMPLETE: interrupted without a completion summary** after an extended run with only Checking formatting reported. The targeted README/NOT-KEPT formatter completed (exit 0); the README is also checked directly with the same Prettier configuration during final sealing. Full output: [format-check.log.txt](format-check.log.txt). `pnpm.cmd check:licenses` was not run: no dependency was added or changed. No generated production files were edited by QA. Coverage commands ran directly per package (no Turbo coverage cache). Infrastructure/API coverage is not claimed from partial or failing results.

### One isolated rerun per affected file

The web routing file used `pnpm.cmd --filter @graphgoblin/web exec vitest run src/editor/routing-review.test.ts --maxWorkers=1 --no-file-parallelism --reporter=verbose`. Alone means one test file at a time in this QA thread; other activity on the shared host was not controlled.

The original infrastructure run had 12 failures / 762 passes (774 tests), 5 failed / 46 passed files, duration 202.13 s. The five unchanged infrastructure files were each run once, sequentially, after broad suites stopped, with `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run <file> --maxWorkers=1 --no-file-parallelism --reporter=verbose`. No timeout was increased and no test or threshold changed.

| File/run evidence                                                                                            | Isolated result | Tests          | Duration                                                                |
| ------------------------------------------------------------------------------------------------------------ | --------------- | -------------- | ----------------------------------------------------------------------- |
| [isolated-infrastructure-src-adversarial.log.txt](isolated-infrastructure-src-adversarial.log.txt)           | FAIL            | 1 failed       | 19 passed (20)                                                          | 76.77s (tests 48%, transform 45%, import 7%) |
| [isolated-infrastructure-src-claude-process.log.txt](isolated-infrastructure-src-claude-process.log.txt)     | FAIL            | 3 failed       | 2 passed (5)                                                            | 50.16s (tests 71%, transform 22%, import 6%) |
| [isolated-infrastructure-src-claude-readiness.log.txt](isolated-infrastructure-src-claude-readiness.log.txt) | FAIL            | 1 failed       | 20 passed (21)                                                          | 35.45s (tests 85%, transform 9%, import 7%)  |
| [isolated-infrastructure-src-process-scripts.log.txt](isolated-infrastructure-src-process-scripts.log.txt)   | FAIL            | 3 failed       | 36 passed (39)                                                          | 69.19s (tests 100%)                          |
| [isolated-infrastructure-src-sqlite-upgrade.log.txt](isolated-infrastructure-src-sqlite-upgrade.log.txt)     | FAIL            | 2 failed       | 24 passed (26)                                                          | 141.47s (tests 90%, transform 5%, import 5%) |
| [isolated-web-routing-review.log.txt](isolated-web-routing-review.log.txt)                                   | PASS            | 23 passed (23) | 52.43s (tests 61%, environment 16%, transform 11%, setup 7%, import 5%) |

The unchanged API `src/retired-event-startup.test.ts` emitted one cold-start failure after 85.223 s (file 105.380 s); broad API coverage did not finish and was stopped after roughly seven minutes. Its isolated rerun was **not run**: the shared subprocess fixture unconditionally chooses ports 5600–5699, outside this brief's 5830–5839 restriction. `api-rerun-limit.log.txt` preserves that fixture evidence. This unresolved verification gap prevents a clean QA sign-off. Passing isolated tests do not change the original coverage gate result.

## Defects and observations outside scope

No #33 production defect reproduced. The broad infrastructure coverage run failed twelve tests across five unchanged files. The five isolated file reruns also failed, with ten failed tests in total. These are verification blockers with unlocalized causes, not evidence that own-session selection failed. No corrective production change is included.

| ID / severity                                | Reproduction                                                                                                                                                                                                      | Expected                                                                                                                                                                          | Actual / evidence                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-01 / major validation blocker, outside #33 | Run each of the four native-process files using the exact isolated command recorded above: `src/adversarial.test.ts`, `src/claude/process.test.ts`, `src/claude/readiness.test.ts`, `src/process/scripts.test.ts` | Native cancellation/deadline closes the process tree, bounded output stays bounded, fixtures release their directories, and no-turn preflight reports its expected deadline cause | Isolated failures respectively 1/20, 3/5, 1/21, 3/39: 30 s cancellation timeout; `EBUSY` cleanup and an output assertion; unconfirmed-stop readiness message instead of deadline; incomplete UTF-8 cancellation and two 15 s kill timeouts. All four original and isolated logs retained |
| V-02 / major validation blocker, outside #33 | Run `src/sqlite/upgrade.test.ts` once alone with the same infrastructure command                                                                                                                                  | Hash-bound review and damaged-source scenarios finish within the maintained 20 s limits                                                                                           | 2/26 still time out at lines 230 and 302; 24 pass. Original broad run had four failures in this file. See `isolated-infrastructure-src-sqlite-upgrade.log.txt`                                                                                                                           |
| V-03 / major verification gap                | Run broad API and web coverage commands recorded above                                                                                                                                                            | Both suites finish and establish package coverage over 90% lines/branches                                                                                                         | Both were interrupted without completion/coverage summaries after already emitting unchanged failures. No passing or coverage claim is made. API cold-start isolated rerun cannot meet the required port range without changing its fixture                                              |

The unchanged web routing file's single original failure was **not reproduced in its one isolated rerun**: 23/23 pass, including the seeded case (11.677 s versus 87.881 s during broad coverage). This does not make the interrupted web coverage gate pass. The isolated adversarial file did complete its failure summary (76.77 s); its sequential wrapper was interrupted after that failure, and remaining files were run separately. Earlier termination notes based on slow console delivery are superseded by the completed log.

ADR-0052 still labels its status "Proposed implementation ... independent review pending" although the task brief states the orchestrator reviewed and approved the head. Its behavioral description matches the observations; approval metadata reconciliation belongs to the orchestrator.

The diff also includes a test-only advisory suppression in `pnpm-workspace.yaml`. Normal pnpm commands parsed that configuration successfully; its security disposition was not independently reassessed in this behavioral QA.

## Coverage of criteria and limits

All four #33 acceptance criteria are **tested and passed** for GraphGoblin behavior: explicit opt-in context modes and node/run/harness isolation; worker/reviewer continuity, forks/children and real restart; optional authored resets preserving shared context; unchanged legacy policies and #244 provenance/missing-session failure. All seven case groups requested in this QA brief have independent API and/or Edge evidence. The maintained engine coverage suite also executes public RunManager scenarios for schema repairs within a visit, stale higher-attempt rows, and accepted versus unaccepted uncertain delivery.

Not tested here: native Codex/Claude provider recall or session expiry (fake-only scope; existing provider claims were not adopted); #265's explicit fresh-session recovery action (next bolt, deliberately not implemented); owner product acceptance, GitHub/CI state and merge sign-off (not this QA role). No criterion is marked passed solely from the implementer's evidence.

## Retained artifacts

Every kept artifact is linked below. Paths inside evidence are normalized to `%USERPROFILE%`. Files over 1,000,000 bytes are omitted from the kept inventory and documented with byte length and SHA-256 in `NOT-KEPT.md`. Disposable SQLite stores and generated build/coverage directories are recovery/working state, not cited report artifacts; they remain for the orchestrator to remove.

[Evidence hashes and byte sizes](evidence-manifest.json) - [Omitted captures](NOT-KEPT.md)

| Artifact                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------- |
| [adjacent-corrected.log.txt](adjacent-corrected.log.txt)                                                                               |
| [adjacent-initial-results.json](adjacent-initial-results.json)                                                                         |
| [adjacent-initial.mjs.txt](adjacent-initial.mjs.txt)                                                                                   |
| [adjacent-results.json](adjacent-results.json)                                                                                         |
| [adjacent.log.txt](adjacent.log.txt)                                                                                                   |
| [adjacent.mjs.txt](adjacent.mjs.txt)                                                                                                   |
| [api-fixture.mjs.txt](api-fixture.mjs.txt)                                                                                             |
| [api-rerun-limit.log.txt](api-rerun-limit.log.txt)                                                                                     |
| [browser-ready.log.txt](browser-ready.log.txt)                                                                                         |
| [browser-results.json](browser-results.json)                                                                                           |
| [browser.log.txt](browser.log.txt)                                                                                                     |
| [browser.mjs.txt](browser.mjs.txt)                                                                                                     |
| [build.log.txt](build.log.txt)                                                                                                         |
| [changed-systems.log.txt](changed-systems.log.txt)                                                                                     |
| [codex-cancel.json](codex-cancel.json)                                                                                                 |
| [codex-parent.json](codex-parent.json)                                                                                                 |
| [codex-refusal.json](codex-refusal.json)                                                                                               |
| [codex-reset-1.json](codex-reset-1.json)                                                                                               |
| [codex-reset-2.json](codex-reset-2.json)                                                                                               |
| [codex-reset-3.json](codex-reset-3.json)                                                                                               |
| [codex-reset-blank.json](codex-reset-blank.json)                                                                                       |
| [concurrency-overlap.json](concurrency-overlap.json)                                                                                   |
| [consolidated-results.json](consolidated-results.json)                                                                                 |
| [coverage-adapter-codex.log.txt](coverage-adapter-codex.log.txt)                                                                       |
| [coverage-api-client.log.txt](coverage-api-client.log.txt)                                                                             |
| [coverage-api.log.txt](coverage-api.log.txt)                                                                                           |
| [coverage-contracts.log.txt](coverage-contracts.log.txt)                                                                               |
| [coverage-engine.log.txt](coverage-engine.log.txt)                                                                                     |
| [coverage-infrastructure.log.txt](coverage-infrastructure.log.txt)                                                                     |
| [coverage-web.log.txt](coverage-web.log.txt)                                                                                           |
| [deps.log.txt](deps.log.txt)                                                                                                           |
| [docs-observations.log.txt](docs-observations.log.txt)                                                                                 |
| [docs.log.txt](docs.log.txt)                                                                                                           |
| [edge-1440-cleared.png](edge-1440-cleared.png)                                                                                         |
| [edge-1440-final.json](edge-1440-final.json)                                                                                           |
| [edge-1440-initial.json](edge-1440-initial.json)                                                                                       |
| [edge-1440-invalid--1.png](edge-1440-invalid--1.png)                                                                                   |
| [edge-1440-invalid-0.png](edge-1440-invalid-0.png)                                                                                     |
| [edge-1440-invalid-1-5.png](edge-1440-invalid-1-5.png)                                                                                 |
| [edge-1440-invalid-9007199254740992.png](edge-1440-invalid-9007199254740992.png)                                                       |
| [edge-1440-policy.png](edge-1440-policy.png)                                                                                           |
| [edge-390-cleared.png](edge-390-cleared.png)                                                                                           |
| [edge-390-final.json](edge-390-final.json)                                                                                             |
| [edge-390-initial.json](edge-390-initial.json)                                                                                         |
| [edge-390-invalid--1.png](edge-390-invalid--1.png)                                                                                     |
| [edge-390-invalid-0.png](edge-390-invalid-0.png)                                                                                       |
| [edge-390-invalid-1-5.png](edge-390-invalid-1-5.png)                                                                                   |
| [edge-390-invalid-9007199254740992.png](edge-390-invalid-9007199254740992.png)                                                         |
| [edge-390-policy.png](edge-390-policy.png)                                                                                             |
| [environment.json](environment.json)                                                                                                   |
| [final-audit.json](final-audit.json)                                                                                                   |
| [finalize-report.mjs.txt](finalize-report.mjs.txt)                                                                                     |
| [fixture-stop.log.txt](fixture-stop.log.txt)                                                                                           |
| [format-check.log.txt](format-check.log.txt)                                                                                           |
| [format-report.log.txt](format-report.log.txt)                                                                                         |
| [fresh.json](fresh.json)                                                                                                               |
| [gate-results.json](gate-results.json)                                                                                                 |
| [inspector-snapshot.json](inspector-snapshot.json)                                                                                     |
| [inspector.png](inspector.png)                                                                                                         |
| [invalid-reset--1.json](invalid-reset--1.json)                                                                                         |
| [invalid-reset-0.json](invalid-reset-0.json)                                                                                           |
| [invalid-reset-1-5.json](invalid-reset-1-5.json)                                                                                       |
| [invalid-reset-2.json](invalid-reset-2.json)                                                                                           |
| [invalid-reset-9007199254740992.json](invalid-reset-9007199254740992.json)                                                             |
| [invalid-reset-null.json](invalid-reset-null.json)                                                                                     |
| [isolated-admission.log.txt](isolated-admission.log.txt)                                                                               |
| [isolated-execution.json](isolated-execution.json)                                                                                     |
| [isolated-infrastructure-src-adversarial.log.txt](isolated-infrastructure-src-adversarial.log.txt)                                     |
| [isolated-infrastructure-src-claude-process.log.txt](isolated-infrastructure-src-claude-process.log.txt)                               |
| [isolated-infrastructure-src-claude-readiness.log.txt](isolated-infrastructure-src-claude-readiness.log.txt)                           |
| [isolated-infrastructure-src-process-scripts.log.txt](isolated-infrastructure-src-process-scripts.log.txt)                             |
| [isolated-infrastructure-src-sqlite-upgrade.log.txt](isolated-infrastructure-src-sqlite-upgrade.log.txt)                               |
| [isolated-web-routing-review.log.txt](isolated-web-routing-review.log.txt)                                                             |
| [layers.log.txt](layers.log.txt)                                                                                                       |
| [lint.log.txt](lint.log.txt)                                                                                                           |
| [maintained-test-source.log.txt](maintained-test-source.log.txt)                                                                       |
| [missing-row-after.json](missing-row-after.json)                                                                                       |
| [missing-row-before.json](missing-row-before.json)                                                                                     |
| [requirements.log.txt](requirements.log.txt)                                                                                           |
| [restart-after.json](restart-after.json)                                                                                               |
| [restart-before.json](restart-before.json)                                                                                             |
| [restart-requests.json](restart-requests.json)                                                                                         |
| [resume-named-second-run.json](resume-named-second-run.json)                                                                           |
| [resume-named.json](resume-named.json)                                                                                                 |
| [resume-previous.json](resume-previous.json)                                                                                           |
| [revision.log.txt](revision.log.txt)                                                                                                   |
| [runtime-corrected.log.txt](runtime-corrected.log.txt)                                                                                 |
| [runtime-corrected/browser-ready.log.txt](runtime-corrected/browser-ready.log.txt)                                                     |
| [runtime-corrected/claude-cancel.json](runtime-corrected/claude-cancel.json)                                                           |
| [runtime-corrected/claude-isolated-01M5PJBZPR0HGS4AQV3397RJ3P.json](runtime-corrected/claude-isolated-01M5PJBZPR0HGS4AQV3397RJ3P.json) |
| [runtime-corrected/claude-isolated-01M5PJBZQ96EK3Z0FEH7WCNHF2.json](runtime-corrected/claude-isolated-01M5PJBZQ96EK3Z0FEH7WCNHF2.json) |
| [runtime-corrected/claude-isolated-01M5PJC1M95T8B4RN23JHCNMED.json](runtime-corrected/claude-isolated-01M5PJC1M95T8B4RN23JHCNMED.json) |
| [runtime-corrected/claude-isolated-01M5PJC2EFZG2MXVFZFSDQ7RA4.json](runtime-corrected/claude-isolated-01M5PJC2EFZG2MXVFZFSDQ7RA4.json) |
| [runtime-corrected/claude-isolated-01M5PJC37RGEH512KY9NR14A57.json](runtime-corrected/claude-isolated-01M5PJC37RGEH512KY9NR14A57.json) |
| [runtime-corrected/claude-parent.json](runtime-corrected/claude-parent.json)                                                           |
| [runtime-corrected/claude-refusal.json](runtime-corrected/claude-refusal.json)                                                         |
| [runtime-corrected/claude-reset-1.json](runtime-corrected/claude-reset-1.json)                                                         |
| [runtime-corrected/claude-reset-2.json](runtime-corrected/claude-reset-2.json)                                                         |
| [runtime-corrected/claude-reset-3.json](runtime-corrected/claude-reset-3.json)                                                         |
| [runtime-corrected/claude-reset-blank.json](runtime-corrected/claude-reset-blank.json)                                                 |
| [runtime-corrected/codex-isolated-01M5PJBV0DBJZ6B91YRPXBJ5CX.json](runtime-corrected/codex-isolated-01M5PJBV0DBJZ6B91YRPXBJ5CX.json)   |
| [runtime-corrected/codex-isolated-01M5PJBV0YE98B2TAY3Y3APQ29.json](runtime-corrected/codex-isolated-01M5PJBV0YE98B2TAY3Y3APQ29.json)   |
| [runtime-corrected/codex-isolated-01M5PJBWVP0RW0DR5MPSCZKMKQ.json](runtime-corrected/codex-isolated-01M5PJBWVP0RW0DR5MPSCZKMKQ.json)   |
| [runtime-corrected/codex-isolated-01M5PJBXSAQTCZSAQ2GF5STEW0.json](runtime-corrected/codex-isolated-01M5PJBXSAQTCZSAQ2GF5STEW0.json)   |
| [runtime-corrected/codex-isolated-01M5PJBYK0F2SRDEAB7VMB2TA3.json](runtime-corrected/codex-isolated-01M5PJBYK0F2SRDEAB7VMB2TA3.json)   |
| [runtime-corrected/codex-parent.json](runtime-corrected/codex-parent.json)                                                             |
| [runtime-corrected/environment.json](runtime-corrected/environment.json)                                                               |
| [runtime-corrected/roundtrip-3.json](runtime-corrected/roundtrip-3.json)                                                               |
| [runtime-corrected/roundtrip-9007199254740991.json](runtime-corrected/roundtrip-9007199254740991.json)                                 |
| [runtime-corrected/roundtrip-blank.json](runtime-corrected/roundtrip-blank.json)                                                       |
| [runtime-corrected/runtime-results.json](runtime-corrected/runtime-results.json)                                                       |
| [runtime-corrected/runtime-summary.json](runtime-corrected/runtime-summary.json)                                                       |
| [runtime-initial.mjs.txt](runtime-initial.mjs.txt)                                                                                     |
| [runtime-results.json](runtime-results.json)                                                                                           |
| [runtime-summary.json](runtime-summary.json)                                                                                           |
| [runtime.log.txt](runtime.log.txt)                                                                                                     |
| [runtime.mjs.txt](runtime.mjs.txt)                                                                                                     |
| [termination.log.txt](termination.log.txt)                                                                                             |
| [tokens.log.txt](tokens.log.txt)                                                                                                       |
| [touched-source.log.txt](touched-source.log.txt)                                                                                       |
| [typecheck.log.txt](typecheck.log.txt)                                                                                                 |
| [verify-evidence.mjs.txt](verify-evidence.mjs.txt)                                                                                     |

## QA-COMMON report

1. **Verdict:** **fail** (validation incomplete/failed) at `7d76abd0e1330273e6efe3f0f82907e59061111d`; all requested #33 behavior checks passed.
2. **Defects:** no #33 functional defect reproduced; see unchanged-suite failures and isolated reruns above.
3. **Coverage of criteria:** four of four bolt criteria and seven of seven requested case groups passed within fake-harness scope. Live-provider claims and #265 recovery are excluded.
4. **Report path and evidence folder:** `docs/qa/2026-10-23-wp-f4-33-qa/README.md`; `docs/qa/2026-10-23-wp-f4-33-qa/`.
5. **Observations outside scope:** unchanged native-process/upgrade gate failures, broad-suite port/prefix deviation, and stale ADR approval status; no production fixes made.
