PASS

# Behaviour QA: PR #417, acceptance fixes for #319 (deliberate shutdown) and #205 (Codex effort)

Independent behaviour QA of pull request #417 at head `03493106d9176d2616a274cd9aedb9f8fa1c840d`. I did not write this change. I exercised the built product through its public interfaces only: the HTTP API, the web app in Edge, real processes, and a real Windows console receiving `CTRL_C_EVENT`. No product code or test was changed. Nothing was committed, pushed or merged.

**Summary.** All six checks pass, with 194 of 194 scenario checks passing in the final runs. No defect was found.

- **#319 D-1 is fixed.** A real console Ctrl+C now drains while a Codex turn keeps running, and the Codex CLI is no longer attached to the gateway's console.
- **#319 D-2 is fixed.** Force over a Codex CLI whose child keeps its output open ends in `force-failed` after about 5.3 s.
- **The exited-process fix holds.** In 8 of 8 runs, a fast-exiting Claude wrong-identity reply reports the identity error. Acceptance scenario E still ends in `force-failed`.
- **#205 D1 is fixed.** All 47 explicit Codex model and effort pairs are sent unchanged. GPT-5.5 offers no `max`, and every stored or submitted GPT-5.5 `max` is refused with `EFFORT_UNSUPPORTED` before any CLI request.
- **No regression** was found in the rest of acceptance C's matrix.
- **Docker:** the daemon is not running on this host, so no image was built. A Windows run of the Dockerfile's install and deploy steps applies the SDK patch.

There are three non-blocking observations and two human QA items. The live provider checks (LP-1 to LP-5 in the PR) remain with the orchestrator.

## Environment

| Item           | Value                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree, head | `.claude/worktrees/agent-a831b7dd922053d19`, detached at `03493106d9176d2616a274cd9aedb9f8fa1c840d` (`git rev-parse HEAD` confirmed before and after the interruption described under "Attempts and interruptions") |
| Node           | `v22.23.4` at `%USERPROFILE%/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node` (`node --version`, `which node`)                                                                                    |
| pnpm           | 12.8.1. `pnpm install` applied the patch: the lockfile entry is `@openai/codex-sdk@0.160.0(patch_hash=3d897be4…)`, and the installed `dist/index.js:263-267` spawns with `windowsHide: true`                        |
| Build          | `pnpm install`, then `pnpm build`: 11 of 11 tasks successful (5 cached)                                                                                                                                             |
| Browser        | Microsoft Edge 156.0.4314.42, driven headless through Playwright 1.63.0 (`channel: 'msedge'`) from `apps/web`                                                                                                       |
| OS             | Windows 11 Pro 10.0.26300                                                                                                                                                                                           |
| Docker         | Docker CLI 29.1.5 is present, but the engine is not running (`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`). I did not start Docker Desktop on the owner's machine             |
| Data and ports | Disposable stores `%TEMP%\gg-qa-417-*` only. Gateways used ports 6530 to 6539; the supplementary API tests ran with `GG_TEST_PORT_START=6250 GG_TEST_PORT_COUNT=50`                                                 |
| Provider calls | None. The fake CLIs are listed under "Method"                                                                                                                                                                       |

## Method

- **Gateways.** Every scenario starts the built API (`node apps/api/dist/main.js`) as its own process on a fresh store, and restarts it on the same store to read the durable record.
  - Terminal-signal scenarios start the gateway attached to a console of its own, as a terminal window would. The launcher is acceptance C's `launcher2`, started through PowerShell `Start-Process`.
  - A real `CTRL_C_EVENT` is delivered to that console with acceptance C's `ctrlc` helper. `conslist` (`GetConsoleProcessList`) shows which processes share the console.
- **Fake CLIs.** No live provider is involved.
  - [`scripts/qa-codex.cs.txt`](scripts/qa-codex.cs.txt) is my own fake Codex CLI. It answers the preflight probes, holds a turn until a release file appears, then completes it. With `QA_CODEX_TOOL_CHILD=1` it first starts a "tool" child that inherits its stdout pipe, the shape of acceptance C's `tree-codex.cs`.
  - The repository's `apps/web/e2e/shutdown-fake-codex.ps1`, compiled, is used for the ordinary force in check 2.
  - Acceptance A's recording CLI [`scripts/session-cli.cs.txt`](scripts/session-cli.cs.txt) is compiled as `claude.exe` and copied to `codex.exe`. It logs the argv each turn received, including `model_reasoning_effort` and `--effort`.
  - All of these were compiled with Windows PowerShell 5.1 `Add-Type`.
- **Process checks** use the operating system's own tools: `tasklist`, CIM `Win32_Process` and `GetConsoleProcessList`. The browser checks count every shutdown request the page sends.
- **Driver and fixture sources** are in [`scripts/`](scripts/). [`lib.mjs`](scripts/lib.mjs) is patterned on acceptance C's helpers. `launcher2`, `ctrlc` and `conslist` are acceptance C's sources, copied unchanged, as is `session-cli` from acceptance A.

## Checks

| #   | Check                                                                                                                                                                                                                                    | Expected                                                                                                                                                                                                                                                                                | Observed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Evidence                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | #319 D-1 fixed: one Ctrl+C during a running Codex turn drains, the turn keeps running, the notice offers a choice, releasing completes, and a later Ctrl+C forces. Repeated with a script and a Claude fake alongside (scenario D)       | Drain, turn alive, notice listing it with Keep waiting and Force stop, success and exit 0 on release, `RUN_INTERRUPTED_BY_STOP` after a later Ctrl+C                                                                                                                                    | **Met.** **Codex only (S1-A):** the CLI has its own hidden console (`conhost` under it); the gateway console holds only `node` and the launcher. After one Ctrl+C, six samples to 4.2 s show `draining`, the run `running` and in `activeRunIds`, and the CLI alive, with no turn failure in the log. `awaiting-choice` came 9.9 s after the Ctrl+C (grace 8 s). The Edge notice showed "The gateway grace period elapsed…", "Ctrl+C Codex turn A — <run>", **Keep waiting** and **Force stop**. Releasing the turn: exit 0 in 0.2 s, lock released, no browser POST. After restart the run is `succeeded` and the CLI ran once. **Later Ctrl+C (S1-B):** a Ctrl+C 4.9 s after the first forces; exit 0, CLI gone, lock released. After restart: `RUN_INTERRUPTED_BY_STOP`, `resumable: false`, `effectMayHaveHappened: true`, and no harness failure in the events. **Scenario D (S2-D1):** a script tree, a Codex turn and a held Claude turn. None is on the gateway console. Ctrl+C plus a duplicate about 300 ms later stays `draining` (coalesced). All four processes survive and all three runs stay `running`. The expiry notice lists all three. A later Ctrl+C exits 0 with everything gone; after restart all three runs are `RUN_INTERRUPTED_BY_STOP` at their nodes. **D2:** a Ctrl+C drain with a script completes, exit 0, `succeeded`. **D3 (my addition):** a Claude turn and a Codex turn that each answer 15 s after starting both finish after a Ctrl+C; exit 0, both `succeeded`, one CLI call each | [s1-ctrlc-codex.log.txt](s1-ctrlc-codex.log.txt) (22/22), [s2-ctrlc-mixed.log.txt](s2-ctrlc-mixed.log.txt) (28/28), [s1-a-expiry-notice.png](s1-a-expiry-notice.png), [s2-d1-expiry-notice.png](s2-d1-expiry-notice.png), `s1-gateway-*.log.txt`, `s2-gateway-*.log.txt`                                                   |
| 2   | #319 D-2 fixed: force with a Codex CLI child holding its stdout; and force with an ordinary Codex turn                                                                                                                                   | Leaves `forcing` within the documented 5 s acknowledgement as `force-failed` with the run listed. Force exit is offered behind its own confirmation, exits 1 and keeps the lock; restart records the failure truthfully. Without a child: a normal force with `RUN_INTERRUPTED_BY_STOP` | **Met.** **Browser force (S3-A):** `forcing` became `force-failed` 5,277 ms after **Confirm force stop**, with `unconfirmedRunIds: [run]` and `choices: ["force"]`. The CLI is gone and the tool child is alive. The run shows `HARNESS_TERMINATION_UNCONFIRMED`, `details.interruptedByStop: true`, `submission: delivery-uncertain`. The notice reads "Force stop failed", names the run and offers **Force exit**. The state is stable for 4 s with the lock held. **Force exit** opens "Force exit after failed cleanup?" and sends nothing until confirmed. Confirming exits with code 1 and keeps the lock; the browser sent exactly two POSTs. After restart the run is `failed` `HARNESS_TERMINATION_UNCONFIRMED`, `resumable: false`. It was not re-run, and Resume returns 409. **API variant (S3-C):** a Codex turn with a tool child plus a script. API force reached `force-failed` at 5,248 ms with only the Codex run unconfirmed (the script was released). A further API force exits 1 and keeps the lock. After restart: Codex `HARNESS_TERMINATION_UNCONFIRMED`, script `RUN_INTERRUPTED_BY_STOP`. **Ordinary force (S3-B, repository fake):** `forcing` then gone in 281 ms, exit 0, CLI gone, lock released, never `force-failed`. After restart `RUN_INTERRUPTED_BY_STOP`; no `HARNESS_TERMINATION_UNCONFIRMED` in the events or the log                                                                                                                                                            | [s3-force-cli-child.log.txt](s3-force-cli-child.log.txt) (32/32), [s3-a-force-failed-notice.png](s3-a-force-failed-notice.png), [s3-a-force-exit-confirmation.png](s3-a-force-exit-confirmation.png), `s3-gateway-*.log.txt`                                                                                               |
| 3   | Exited-process release: a fast-exiting Claude wrong-identity reply (acceptance A O1), and a script tree that really cannot be confirmed (acceptance C scenario E)                                                                        | The identity error, not `HARNESS_TERMINATION_UNCONFIRMED`; E still ends in `force-failed`                                                                                                                                                                                               | **Met.** **O1:** across 8 runs, the fixture exits right after its wrong-identity reply (acceptance A's s3 case, no linger). Each run failed with `HARNESS_DELIVERY_UNCERTAIN` and the message "…Claude resumed session does not match the requested session…": `resumable: false`, no resumed-session claim, two CLI calls (no fresh fallback). None reported `HARNESS_TERMINATION_UNCONFIRMED`, and no log line mentions it. Controls: the same reply with the process kept alive 3 s gives the same outcome (acceptance A's s3b result), and Codex wrong identity is still `HARNESS_SESSION_MISSING`. **E:** the root exits after 0.5 s while a detached grandchild holds the pipe. Browser force gave `force-failed` with the run unconfirmed, `choices: ["force"]` and the grandchild really alive. The state is stable; Force exit, behind its own confirmation, exits 1 and keeps the lock. After restart: `SCRIPT_TERMINATION_UNCONFIRMED`, `details.interruptedByStop: true`. The limit of the O1 sample is under "Observations"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [s4-exited-release.log.txt](s4-exited-release.log.txt) (15/15), [s4-e-force-failed-notice.png](s4-e-force-failed-notice.png), `s4-gateway-*.log.txt`                                                                                                                                                                       |
| 4   | #205 D1 fixed: Codex inference and LLM decision `max` are sent and recorded as `max`; GPT-5.5 offers no `max` and a stored GPT-5.5 `max` is refused before any request; every other effort and the inherited defaults match what is sent | argv equals the saved and recorded effort everywhere; GPT-5.5 `max` refused with `EFFORT_UNSUPPORTED` and nothing sent                                                                                                                                                                  | **Met.** Details follow this table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [s5-effort-api.log.txt](s5-effort-api.log.txt) (28/28), [s5b-decision-record.log.txt](s5b-decision-record.log.txt) (6/6), [s6-effort-browser.log.txt](s6-effort-browser.log.txt) (14/14), [s7-stored-effort.log.txt](s7-stored-effort.log.txt) (11/11), `s6-*.png`, [scripts/s7-store-edit.mjs](scripts/s7-store-edit.mjs) |
| 5   | No regression in acceptance C's matrix that the change touches                                                                                                                                                                           | An API drain with a Codex turn completes; keep waiting has no hidden timer; force works by browser and by API; recovery is truthful (no auto-resume, Resume refused, explicit Replay works)                                                                                             | **Met.** **R1, API drain:** a Codex turn and a script keep running. After the 5 s grace, **Keep waiting** in Edge; for 26.5 s (five graces) the phase stays `draining`, with no second expiry and nothing killed, and the browser sent one POST. Releasing both gives exit 0; both runs `succeeded`. **R2, scenario C:** a script tree, a Codex turn, a parent waiting on a child, a durable wait and a queued run. Active work lists the script, Codex and child runs, not the wait or the queued run. The notice names them; **Go back** sends nothing. The confirmed force exits 0; tasklist and CIM show nothing left and the lock is released. After restart, the three runs are `RUN_INTERRUPTED_BY_STOP` at their nodes, attempt 1, non-resumable, effects may have happened. The wait is still `waiting`, the queued run ran and `succeeded`, and the parent did not succeed. There was no blind replay, Resume returns 409, and the inspector shows "Explicit force-stop interrupted this run; external effects may have happened". **R3, API force:** exit 0. After restart both runs stay interrupted and nothing re-ran. Resume returns 409 for both. Explicit `POST /runs/{id}/replay` from `infer` and from `hold` returns 202 with new runs, which succeed; the sources keep their interruption                                                                                                                                                                                                            | [s8-regression.log.txt](s8-regression.log.txt) (30/30), [s8-r1-after-keep-waiting.png](s8-r1-after-keep-waiting.png), [s8-r2-expiry-notice.png](s8-r2-expiry-notice.png), [s8-r2-force-confirmation.png](s8-r2-force-confirmation.png), [s8-r2-inspector-codex-after-restart.png](s8-r2-inspector-codex-after-restart.png) |
| 6   | Container build applies the SDK patch                                                                                                                                                                                                    | `docker build`; the patched `windowsHide` line is in the image's SDK                                                                                                                                                                                                                    | **Not run with Docker:** the engine is not running here, and I did not start Docker Desktop on the owner's machine. **Proxy on Windows:** I ran the Dockerfile's own build-stage steps on a copy of exactly the paths it copies, taken from the PR head (`git archive`): `pnpm install --frozen-lockfile`, then `pnpm --filter @graphgoblin/api deploy --prod --legacy`. Both applied the patch. The installed SDK has `windowsHide: true` at line 266, and so does the deployed API's `node_modules/.pnpm/@openai+codex-sdk@0.160.0_p_56da0388…/dist/index.js`, which is what the runtime stage copies to `/app`. This is not the Linux image; the PR's CI image job covers that                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [docker-sim.log.txt](docker-sim.log.txt)                                                                                                                                                                                                                                                                                   |

### Check 4 in detail

- **API catalog.** GPT-5.5 lists `minimal` to `xhigh` and no `max`; every other Codex model lists `max`.
- **Explicit Codex matrix.** Every seeded Codex model was run with every effort it lists: 8 models, 47 runs. Each CLI argv equalled the saved effort, and the session row recorded the same model and effort. `max` was sent as `model_reasoning_effort="max"` on all seven models that list it.
- **Inherited layers.** Process `GG_DEFAULTS`, owner Settings and loop defaults resolved field by field. Both families sent exactly the inherited values, for example `gpt-6-sol/minimal`, then `/high`, then `gpt-6.1-sol/high`. A loop default of `gpt-6-luna/max` sent `max`.
- **Claude (regression).** `max` sends `--effort max` and `low` sends `--effort low`. `minimal` is refused 400 `EFFORT_UNSUPPORTED`.
- **LLM decisions.** `luna/max`, `6.1-sol/max`, `6.1-sol/xhigh`, `gpt-5.5/xhigh` and an inherited selection each sent exactly the expected values. The decision record (`decision.made.provenance`, copied into `node.finished`) names the same model and effort.
- **GPT-5.5 `max` refused before any CLI request.**
  - As a node, an LLM decision, an owner Settings default or a loop default: refused 400 with `EFFORT_UNSUPPORTED` (problem code `EVALUATION_INVALID_CONFIGURATION`).
  - Explicit `max` with `gpt-5.5` inherited from Settings: refused at create. The same with `xhigh` is sent unchanged.
  - `GG_DEFAULTS` with `gpt-5.5/max`: startup is refused with "Invalid GG_DEFAULTS: The default reasoning effort is not supported by its model".
- **Editor (Edge).**
  - With GPT-6 Sol inherited, Effort offers `max` as a plain option. Choosing it saves `max`, survives reload, is sent as `max` and is recorded as `max`.
  - Default (medium) sends `medium`. After owner Settings set `high`, the editor shows Default (high) and `high` is sent.
  - Switching the model to GPT-5.5 shows the kept value as "max (not supported by this model)" with a not-supported description, and offers `minimal` to `xhigh` only.
  - The editor cannot store that change: the server refuses the draft save with 400 `EFFORT_UNSUPPORTED`, the header shows "Save failed", and Publish shows "Publish failed". Nothing was stored, published or sent. See O-1.
  - Choosing `xhigh` saves, publishes and sends `xhigh`.
  - In the LLM decision editor, GPT-5.5 offers no `max` and GPT-6 Luna does. Its `max` is saved, sent and recorded as `max`.
- **Stored data from an older build (simulated).** I edited the stopped store's SQLite file ([s7-store-edit.mjs](scripts/s7-store-edit.mjs)):
  - **Catalog.** The `gpt-5.5` catalog row was set back to the old seed with `max`. Restart refreshes it to no `max`.
  - **Stored node and decision.** A published inference node and LLM decision at `gpt-5.5/max` are each admitted (202) and then fail `EVALUATION_INVALID_CONFIGURATION` with `details.code: EFFORT_UNSUPPORTED`, with no CLI request. This matches the existing `model-effort.spec.ts` expectation for a saved unsupported effort. A `gpt-6-luna/max` control still sends `max`.
  - **Owner default.** A stored owner Settings default of `gpt-5.5/max` fails an inheriting run the same way before any request.

## Additional probe (my addition): other abort paths

The Codex harness now arms its acknowledgement bound on every abort, and `cancel()` now rethrows unconfirmed termination. I therefore checked the other abort paths through the API ([s9-cancel-timeout.log.txt](s9-cancel-timeout.log.txt), 6/6).

- A user cancel of an ordinary Codex turn is `cancelled` within 16 ms. The CLI is gone and there is no termination failure.
- A node timeout (`timeoutSeconds: 3`) fails `INFERENCE_TIMEOUT` at 3.2 s, and the CLI is gone.
- A user cancel of a Codex turn whose CLI child holds its output ends after 5,048 ms as `failed` `HARNESS_TERMINATION_UNCONFIRMED` with `interruptedByStop: false`. The tool child really is alive. A later normal drain still exits 0 and lists the run in `unconfirmedRunIds`. See O-2.

## Defects

None.

## Observations (non-blocking)

- **O-1 (low, existing editor presentation, newly reachable).** The trigger is a Codex node at `max` switched to GPT-5.5 in the editor. Before this PR every Codex model listed `max`, so this state could not arise from a model switch.
  - What the editor shows:
    - The field help says "This effort is not supported by the selected model. The saved choice stays until you change it."
    - The header reads "Save failed" next to "Ready to publish".
    - The banner is the generic "invalid evaluator or model configuration (EVALUATION_INVALID_CONFIGURATION)".
    - Publish adds "Publish failed — The draft could not be saved; fix the issues below first."
    - No node-level marker or inline effort error appears ([s6-gpt55-max-save-refused.png](s6-gpt55-max-save-refused.png), [s6-gpt55-max-publish-attempt.png](s6-gpt55-max-publish-attempt.png)).
  - The behaviour is safe: nothing is stored or sent. Choosing a supported effort recovers.
  - The same presentation will meet the owner when acting on the CHANGELOG upgrade note for loops that hold a stored GPT-5.5 `max`. Raised as HQ-2.
- **O-2 (behaviour change, truthful).**
  - **What changed.** When a process started by the Codex CLI keeps the CLI's output open, the run now records a failure. A user **cancel** ends after five seconds as `failed` `HARNESS_TERMINATION_UNCONFIRMED`, not `cancelled`. A node **timeout** most likely ends as `HARNESS_TERMINATION_UNCONFIRMED` too. I inferred that from the code path and did not test it with a child. Before this change, such a run waited on the CLI's output indefinitely.
  - **Where it is documented.** The shutdown docs describe this for force: ADR-0049, guide 07 and docs/05. The PR's `docs/06` Cancellation text covers the harness behaviour generally.
  - **No action needed.** The record is truthful (the tool process is alive), so this is noted only so the owner is not surprised.
- **O-3 (evidence limit for check 3).** The fixture exits right after its reply, but whether it had already exited by the time the adapter stopped it is not observable from outside. Two things together carry the verdict:
  - acceptance A's single observation of the defect under the same fixture;
  - the implementer's held-handle reproduction of the old `killTree` result.

  Because I did not build the pre-fix code, I have no before-the-fix run of my own.

- **Docker (check 6)** was simulated, not built; see the table.

## Human QA items

- **HQ-1 (from acceptance C, unchanged, not re-judged here).** It covers the notice's explanation of active work and its wording around the choice, with steps in `docs/qa/2026-10-26-acceptance-c/README.md` on `main`.
  - This PR adds one new place the owner may want to look at during that review: `force-failed` now also occurs for Codex turns.
  - In that state the notice says "Shutdown cleanup failed… Inspect logs and native processes" and lists the run under "Unconfirmed termination evidence (may be from an earlier stop)". Only the run page says that "a process it started may still be running". Guide 07 tells the operator to find that process by its command line ([s3-a-force-failed-notice.png](s3-a-force-failed-notice.png)).
- **HQ-2 (new, from O-1): is the editor's handling of a kept GPT-5.5 `max` acceptable?**
  1. On a build of this PR, start the API on a spare port with a disposable `GG_DATA_DIR` and `GG_REQUIRE_API_KEY=false`.
  2. Create a loop with a Codex inference node.
  3. In the editor, open the node and set Effort to `max`. Close the node and wait for "All changes saved".
  4. Reopen the node, change Model to GPT-5.5 and close it.

  Expected observations:
  - The Effort field shows "max (not supported by this model)" with the warning "The saved choice stays until you change it."
  - The header shows "Save failed".
  - The banner says "invalid evaluator or model configuration (EVALUATION_INVALID_CONFIGURATION)".
  - Clicking **Publish** shows "Publish failed — The draft could not be saved; fix the issues below first", with no issue marked on the node.
  - Changing Effort to `xhigh` saves and publishes.

  Decide whether the generic banner and the absent node marker are enough guidance, or whether the editor should name the node and the unsupported effort.

## Live provider checks (not run here; for the orchestrator)

LP-1 to LP-5, as listed in the PR and in `docs/qa/2026-10-26-acceptance-fixes-319-205/README.md`:

- real Ctrl+C during a Codex turn;
- force during a real long command;
- provider-side stop;
- a real `max` turn and LLM decision;
- `minimal` on a GPT-6 model.

Fake-CLI results do not establish live-provider behaviour.

## Supplementary (component and test level)

I ran the PR's own native and controller shutdown tests once against this build. `apps/api`: `GG_TEST_PORT_START=6250 GG_TEST_PORT_COUNT=50 pnpm exec vitest run src/shutdown-console.test.ts src/shutdown-controller.test.ts` passed 11 of 11 in 2 files ([unit-api-shutdown.log.txt](unit-api-shutdown.log.txt)). The verdict rests on the scenarios above.

## Attempts and interruptions

These were corrected script faults or interruptions, never a retry of unchanged code to reach a pass.

- **S1.** The first full run passed 22/22 but recorded nominal rather than measured sample times. I changed the sampler to record real elapsed milliseconds and reran.
  - That rerun was cut off by the orchestrator's usage-limit stop after check A3. It left one store and no process.
  - On resuming I confirmed the head, removed that store and reran S1 in full (22/22). The record is the final run; the earlier runs' logs were overwritten and are not kept.
- **S2.** The first two starts stopped before any shutdown action:
  - creating the Claude loop needed an explicit supported sandbox policy;
  - publishing it needed an explicit effort, because Claude has no default effort here.

  These were fixture faults. [lib.mjs](scripts/lib.mjs) now sets both for Claude, as acceptance A did. The logs of those starts were overwritten and are not kept.

- **S5b.** The first run's check counted every effort named anywhere in the events and so caught the pinned process default (`run.queued.pinned.defaults…`). The check now reads the decision's own record. The first log was overwritten and is not kept.
- **S6.** Attempt 1 assumed the editor stores a GPT-5.5/`max` draft. It does not: the server refuses the save. Kept: [attempts/s6-attempt1-unsaved-draft-assumption.log.txt](attempts/s6-attempt1-unsaved-draft-assumption.log.txt), its result and its [request summary](attempts/s6-attempt1-gateway-requests.log.txt).
  - That attempt also confirms no `gpt-5.5/max` request was ever made: its one extra run used the published `gpt-6-sol/medium`.
  - A crash in my own process-listing helper (an unescaped control character in an unrelated command line) left that store behind. It was removed by hand, and the helper now sanitises the text.
- **S7.** Attempt 1 edited the stored owner default and the stored nodes at once. The invalid owner default then failed every Codex run, explicit ones included, by design ("defaults are configuration"), so the node cases were not isolated. The phases are now separate. Kept: [attempts/s7-attempt1-settings-poisoned-all-runs.log.txt](attempts/s7-attempt1-settings-poisoned-all-runs.log.txt) and its result.

## Files

- `README.md` (this record).
- `docker-sim.log.txt`: check 6.
- `unit-api-shutdown.log.txt`: supplementary.
- Per scenario:
  - `s<N>-*.log.txt` is the narrative with every check;
  - `s<N>-*-result.json` is the check list;
  - `s<N>-gateway-*.log.txt` are the gateway logs;
  - `*.png` are browser captures.

  S0 is the harness smoke check. S1 to S9 map to the checks as in the table.

- `scripts/`:
  - the drivers (`s0`–`s9` `.mjs`), [lib.mjs](scripts/lib.mjs), [s7-store-edit.mjs](scripts/s7-store-edit.mjs), [requests-from-log.mjs](scripts/requests-from-log.mjs) and [audit-record.mjs](scripts/audit-record.mjs) (size and redaction audit);
  - the C# fixtures as `.cs.txt`. Compile them with Windows PowerShell `Add-Type -TypeDefinition (Get-Content -Raw <file>) -OutputAssembly <exe> -OutputType ConsoleApplication`, into `%TEMP%\gg-qa-417-tools`. `session-cli.cs.txt` compiles to `claude.exe`.
- `attempts/`: kept earlier attempts.
- The profile path, machine name and SIDs are redacted. `scripts/audit-record.mjs` reports 0 problems. Every file is under 1,000,000 bytes, so there is no `NOT-KEPT.md`.

## Cleanup

- Every disposable store (`%TEMP%\gg-qa-417-*`), the Docker-simulation copy and the compiled-tools folder were removed.
- The tool children that survive a Codex force by design (ADR-0049 N10) were each ended by their recorded PID right after the scenario. The orphaned grandchild of scenario E was handled the same way.
- A final CIM listing found no process whose command line or executable path names a `gg-qa-417-` directory.
- Ports 4747/4748, `~/.graphgoblin`, the main checkout and other worktrees were not touched. No process was ended by image name.
