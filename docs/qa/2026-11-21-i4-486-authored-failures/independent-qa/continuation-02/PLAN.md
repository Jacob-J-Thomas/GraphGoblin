# #486 independent behavior QA · CONTINUATION PLAN (invocation 02)

Written 2026-11-21 ~16:25Z by actual Claude Code Opus 5.5 / xhigh in the independent behavior-QA role (D201), fresh provider envelope (no resume of session `df484ec2…`). Written BEFORE any 02 scenario execution. Later amendments go only in the dated "Amendments" section at the end.

## 0. What this continues (immutable inputs, read-only)

- Original plan `i4-486-independent-01/PLAN.md` SHA-256 `d2b0684a529be79ece08c5e3afbd5bbcbf05d4adba146a7ffdaf917c1caf6c83` (read in full). Its matrix IDs (J01–J20, L-PUB, B01–B26, P01/P02, EXT-*, CH-*, H-*, RES*, RETRY, W-*, S-*) are reused unchanged. This plan resolves its tentative fixture choices, adapts paths/resources to 02 and lists the rows still to run. It does not narrow the architecture-03 `verification.md` contract (required superset).
- Original transcript recovered from `i4-486-quota-checkpoint-01/i4-486-independent-01-{tool-calls,visible-text}.json` (SHA `0612cd85…`, `26053342…`) and provider files (`events.jsonl` `29635e3c…` 1,511,822 B; `result.json` `c6462974…`; `exit.json` `ecd85009…`). The original ended exit 1 / 429 / is_error true at 12:55:03Z, with no verdict. Its last actions were writing `fixtures/append.mjs` and `drivers/lib/harness.mjs`; the API boot helper was never written.
- **Inherited complete, NOT re-executed in 02:**
  - Binding 00: `i4-486-independent-01/results/00-bind/attempt-1/*`, with `binding.json` `cd3a638c…`, `dist-manifest.json` `575de962…` (1,189 entries), `source-hashes.json` `0aa1425b…` and `tsc.txt` `552535ee…`. This attempt recompiled 576 `.js`/`.d.ts` files with 0 missing and 0 different. Web is hash-bound only.
  - D1 DOMAIN-PUBLIC: `i4-486-independent-01/results/d1-domain-observe/attempt-1/d1.results.json` SHA `6a60a755376bf5c1d6d74dedbba8e5bbe39e08297a82621c4ef85ff8e239f9f4`, 36/36 PASS, driver exit 0 at 12:53:46Z. The driver is `f9da7382…`. Its `lib_sha256` `8ee54407…` is common.mjs ALONE (harness.mjs did not exist then). Reported in 02 as "inherited original01", with the original paths and hashes. It is never copied into 02 as new results.
- Unexercised original helpers: `drivers/lib/harness.mjs` `67922078…` and `fixtures/append.mjs` `1f8d4ddf…`. Hazards: original `run.sh`, `00-bind.sh` and `lib/common.mjs` hardcode the 01 packet/scratch. None of them is executed or imported in 02.

## 1. Status of every row at the start of 02

| Group | Rows | Status at 02 start |
| --- | --- | --- |
| Binding | identity, 52 sources, 576 recompiled, 1,189 dist entries | COMPLETE (original01). 02 does a cheap re-check only (R0 below). |
| D1 domain | J01–J20 (36 checks) | COMPLETE (original01, inherited). |
| D2 leaf | L-PUB, B01–B06(+c/b), B20–B25, P01, P02, PRIV, LOG, EXT-H, EXT-S, EXT-W, decision-callback EXT | UNVERIFIED |
| D3 children | B07–B13, CH-NEST, CH-INF, CH-DEDUP (both), CH-DET | UNVERIFIED |
| D4 inference | B14–B19, H-D, H-Q, H-Qn, H-UG, RES, RES-SM, FRESH, RETRY, B17 seam, B17h, STRONG/TERM, PRIOR, structured/coerce controls | UNVERIFIED |
| D5 workspace | W-T/F/R/TMP/E/L, B26, B26c, B26x, W-OWN | UNVERIFIED |
| D6 surfaces | S-AUTH, S-PAR (REST/MCP/browser), S-PRIV, S-RESTART, S-HIST | UNVERIFIED |
| In progress | none; the original API boot helper does not exist | — |

## 2. New 02-owned paths and resources

- Packet: `Q/i4-486-independent-02/{PLAN.md, drivers/, fixtures/, results/<driver>/attempt-N/, BLOCKERS.md, REPORT.md, SHA256SUMS.json}`. `provider/` is runner-owned and never touched.
- Scratch (TEMP/TMP already set by the runner): `G:/ggq/qa-scratch/i4-486-independent-02/<driver>-<attempt>/{tmp,data,cwd,sinks}`. Each driver process runs with **cwd inside its scratch** (never the checkout), so a relative fixed workspace path cannot dirty the checkout. Original scratch `…/i4-486-independent-01` is never read for state, written, deleted or reused.
- Helpers, all new 02 bytes, hashed per attempt (each file hashed separately):
  - `drivers/run.sh`. 02 paths. Refuses to overwrite an attempt. Copies the driver and libs into the attempt directory and records node/head/time/exit.
  - `drivers/lib/rec.mjs`. Recorder and hashing. Ancestry: original `common.mjs` `8ee54407…`, rewritten with SCRATCH = 02.
  - `drivers/lib/harness.mjs`. Scripted harness. Ancestry: original `harness.mjs` `67922078…`. The copy is recorded, then amended to resolve `sessionId` like the repository FakeHarness and to add per-port counters.
  - `drivers/lib/boot.mjs`. New. Uses `loadConfig(env)` with the documented GG_ env, then `createApiKey(config, …)` (exported CLI path) for a wildcard key, a run-reader key (`runs:read`) and a loops-only key. Then `createContainer(config, overrides)` → `start()` → `buildApp(container)` → `listen({host:'127.0.0.1', port})`. Overrides are ONLY the existing `ContainerOverrides` fields: harnesses (codex+claude scripted), structured, deciders, classifiers, logger (capturing) and clock. Probes and scripts are optional delegating wrappers around the real `HttpProbes`/`ProcessScripts`, injected only for named EXT rows. Events can be wrapped post-construction (precedent `classification-storage.mjs`), only for named storage-fault rows. Shutdown is an authenticated `POST /system/shutdown {action:'drain'}` → `waitForShutdown()` → `app.close()` → `dispose()`, followed by an absence check (connect refused on the port; child PIDs gone).
  - `fixtures/append.mjs`. Byte copy of original `1f8d4ddf…` (verified equal). Native child appends one JSON line to a counter file.
- Ports: driver APIs D2 5871, D3 5872, D4 5873, D5 5874, D6 5875 (reopen 5876), all on 127.0.0.1. Loopback probe listener on an OS-assigned port. MCP over stdio only. `GG_OLLAMA_ENABLED=false` and `GG_OLLAMA_URL=http://127.0.0.1:5879` (reserved and never listened on) keep 11434 untouched. Never 4747/4748/11434. Pre-check at 16:20:02Z: 5871–5879 all bindable (probe PID 46896, self-closed).
- Env for every owned process: GG_* and JEV_* removed from the inherited env, then set explicitly (GG_DATA_DIR scratch, GG_REQUIRE_API_KEY=true, GG_WEB_DIST built `apps/web/dist` for D6 else empty, GG_LOG_LEVEL silent, GG_TIMER_POLL_MS 100, GG_SHUTDOWN_GRACE_MS 30000). No HOME/CODEX_HOME change; no real harness/provider binary is ever spawned (harness overrides replace codex/claude; deciders/structured/classifiers are scripted).
- Browser: installed `playwright-core@1.63.0` with the already-present `ms-playwright/chromium-1234/chrome-win64/chrome.exe` via `executablePath`. Playwright 1.63 expects revision 1243; no install/download. If launch fails, that lane is recorded as BLOCKED, not substituted.
- MCP: built `apps/mcp/dist/main.js` child over stdio, driven by the installed `@modelcontextprotocol/sdk` client (file-URL import), `GG_API_URL=http://127.0.0.1:5875` and `GG_API_KEY=<wildcard key>`.

## 3. Evidence classes

As in the original §"Evidence classes": NATIVE, PUBLIC-API, SCRIPTED (harness/structured/decider/classifier counters), SCRIPTED-STORAGE (event wrapper), SCRIPTED-INJECT (delegating probe/script wrapper armed for one row), SCRIPTED-CLOCK (clock override armed for one row), SYNTHETIC-SEAM, MCP-STDIO, BROWSER and STATIC. Inherited D1 is DOMAIN-PUBLIC original01. Scripted counters are reported separately from native sink counts.

## 4. Re-check before new scenarios (R0, cheap, no rebuild)

HEAD `633d9ac7…`, tree `d0e38c6c…`, parent `02351e2f…`, empty porcelain (including untracked). The 52 freeze paths are re-hashed against `i4-486-source-freeze-01/receipt.json`. All 1,189 entries of the original dist manifest are re-hashed in the QA checkout. Expected: all equal. Any mismatch stops all lanes.

## 5. Fixture resolutions (tentative choices from original, now fixed)

- Liquid runtime faults: `{% include 'QA486-PATH-x' %}` parses and fails at render; D1 J19 established the render fact. Taken-branch control: `{% if true %}{% include … %}{% endif %}`. Untaken-branch control: `{% if false %}{% include … %}{% endif %}`.
- JSONata runtime faults: `$error("QA486-LIT-x")` direct; grouped `($x:=1; $error(...))`; conditional `trigger.payload.k = 1 ? $error(...) : false`; nested function; dynamic `$error("QA486-" & trigger.payload.m)` with payload `QA486-IN-x`; `$assert(false, …)`. All parse and are publishable.
- B01u (uncertain/start-failed): script `command` = nonexistent absolute path. This is an existing-policy control: SCRIPT_START_FAILED, or SCRIPT_OUTCOME_UNCERTAIN, recorded as observed.
- B07a (artifact selector): the parent gets a real artifact from a preceding scripted inference node with `captureTranscript:'artifact'`, then the subloop `input.artifacts.where` fault. If the artifact is absent at runtime, the row is reported as a setup gap.
- **CH-DEDUP-A** (child-creation.test.ts:177–190 lineage): parent merge mode, explicit vars map `{f: 'function($v){$v}'}`. Evaluation succeeds and the separate `toJson` conversion throws an ordinary TypeError (setup probe 16:2xZ: domain evaluateExpression returns a JSONata lambda, and `JSON.stringify` throws "circular structure"). Expected: ordinary unexpected mapping fault, INTERNAL_ERROR safe copy, **resumable true**. Then Resume: deterministic recurrence gives a second `run.failed`. Exactly 1 child, 1 `child_run.finished` (terminal-seq reuse), child never resumed.
- **CH-DEDUP-B** (awaited-children.test.ts:997–1044 lineage): a transient unexpected mapping fault via SCRIPTED-CLOCK. The `clock` override throws once only while the stack contains `outputMapping` (the subloop output mapping function), mirroring the author test's mapping-clock fault through public overrides. Expected: INTERNAL_ERROR resumable true, `run.failed.seq == child_run.finished.seq + 1`. Then Resume: parent succeeds, still exactly 1 child, 1 `child_run.finished`, 1 `run.woken`, 0 `run.resumed` on the child.
- CH-DET: B11 (custom patch `$error`, `"bad patch"` string and an out-of-region patch) and B12. These are deterministic. Resume refused with 409 FAILURE_NOT_RESUMABLE, and child count/finish count are unchanged after the refused Resume.
- Storage faults (RETRY): SCRIPTED-STORAGE wrapper on the event store only for the named row (precedent script).
- B17: requires a pure canonical-rerender fault. The system-chat trimming path needs `node.id==='respond'` plus a valid system-chat definition. If no public fixture reaches it without a module seam within budget, the row is reported as **UNVERIFIED (synthetic-only, not executed)**. A seam is attempted only if time permits. B17h (contextWindow/fits throw) is executed with the scripted harness.

## 6. Acceptance matrix for 02 (expected outcomes written before execution)

Unless stated otherwise: code / boundary / indices / resumable. Message = `<Field label>[ <ordinal>][ (kind)][, item n][, attempt n][, beat n] failed. <fixed cause>`, as in the original plan. Canary-absence checks apply to new authored causes only. For every authored failure: the stored row failure equals the `run.failed` failure equals the REST `/runs/:id` failure (byte-equal JSON), and GET `/runs/:id` `recovery.resume.allowed=false`. A Resume attempt with the current `observedSeq` gives 409 `FAILURE_NOT_RESUMABLE`, the events JSON is unchanged after it, and native sinks are unchanged after it.

### D2 · leaf (port 5871)

| ID | Fixture | Expected |
| --- | --- | --- |
| L-PUB | selectors with a top-level malformed `1 +`, unsafe regex, Liquid parse error `{% if %}` | publish refused 4xx. Runs +0. |
| B01 | script node `node append.mjs <counter> ok '{% include … %}'` (cwd workspace temp) | TEMPLATE_ERROR / `script.args` / argumentIndex 2 / false. Counter lines +0. `script.dispatched` 0. Resume refused; counter still +0. |
| B01c | same with valid args | succeeded. Counter +1 with the exact args. 1 `script.dispatched`. |
| B01u | nonexistent command | existing SCRIPT_START_FAILED (or uncertain) policy, recorded |
| EXT-W | env `secret:qa486-missing` | SECRET_MISSING unchanged. Counter +0. |
| B02 | http probe headers `{a:'ok', b:'{% include %}'}` | TEMPLATE_ERROR / `heartbeat.probe.headers` / headerIndex 1 / false. Listener +0. 0 beats. |
| B03u / B03b | url include / POST body include | TEMPLATE_ERROR url/body. Listener +0. 0 beats. |
| B03c | valid GET with header `x-qa: {{trigger.payload.h}}`, until `probe.status = 200` | succeeded. Listener +1 with the header received. 1 beat. |
| B04 | script probe args[1] include | TEMPLATE_ERROR / `heartbeat.probe.args` / argumentIndex 1. Counter +0. 0 beats. No temp workspace created for the run. |
| B05 | http probe, until `$error("QA486-LIT-B05")` | EXPRESSION_ERROR / `heartbeat.until` / beat 1 / false. Listener +1 exactly. 1 `heartbeat.beat`. Not waiting. Resume refused; listener still +1. |
| B05b | until `beat = 2 ? $error(...) : false`, interval 1s, maxBeats 5 | fails at beat 2. Listener +2. 2 beats. |
| B06t / B06l | until false + deadline `QA486-IN-B06` rendered from payload / deadline include | TEMPLATE_ERROR / `heartbeat.deadline` / beat 1. Fixed timestamp cause (payload marker absent) / Liquid cause. False. Listener +1. |
| B06c | until true + invalid deadline | succeeded (deadline never rendered) |
| B21l / B21c | LLM decision instructions include / classifier question include | TEMPLATE_ERROR `decision.instructions` / `decision.question`. Decider/classifier calls +0. |
| B22 | LLM decision `context.messages.where` `$error` (thread has ≥1 message) | EXPRESSION_ERROR / `decision.context.messages.where` / itemIndex 0. Decider calls +0. |
| B20 | expression decision `$error("QA486-LIT-B20")` | EVALUATION_EXPRESSION_FAILED "The evaluation expression could not be evaluated", false. No `details.boundary`. Literal absent. |
| B23 | input wait prompt include | TEMPLATE_ERROR `wait.prompt`, false. Not waiting. |
| B24 | until-wait timestamp `{{trigger.payload.ts}}` = `QA486-IN-B24` | TEMPLATE_ERROR `wait.timestamp`, fixed timestamp cause, false. Marker absent. |
| B25 | signal wait `name:'go'`, filter `$error("QA486-LIT-B25")`; POST signal | HTTP 400 EXPRESSION_ERROR, existing request copy (literal presence recorded as the established contract). Run still waiting with the same waitId. Events added 0. |
| B25c | same filter `payload.ok = true`, valid signal | woke, succeeded (positive control) |
| P01 | mutate set expression `$error("QA486-LIT-P01")` | MUTATION_ERROR "Mutation operation 1 (set) failed: …" with the literal PRESENT (P01 contract), false |
| P02 | exit returns `$error("QA486-LIT-P02")` | EXPRESSION_ERROR with the bounded expression message (literal PRESENT), false |
| EXT-H ×3 | SCRIPTED-INJECT probe throws (a) real domain ExpressionError, (b) Error named `ExpressionError`, (c) `{code:'EXPRESSION_ERROR'}` object; all with `QA486-EXT-H` text | INTERNAL_ERROR safe copy, resumable true, no `details.boundary`, marker absent publicly. 0 beats. Private log has the error (existing diagnostics). |
| EXT-S ×3 | SCRIPTED-INJECT script runner rejects with the same three | SCRIPT_OUTCOME_UNCERTAIN, 1 `script.dispatched`, `failure.script.state outcome-uncertain`, no authored boundary, marker absent |
| EXT-C ×3 | SCRIPTED classifier `choose` throws the same three | EVALUATION_PROVIDER_FAILED fixed message, false (or the existing mapping observed), no boundary, marker absent |
| PRIV / LOG | all authored rows | `QA486-LIT/IN/PATH` absent from failure/event/REST. No captured log record with `QA486-LIT`/`QA486-IN` from new JSONata sites. |

### D3 · children (port 5872)

| ID | Fixture | Expected |
| --- | --- | --- |
| B07 | parent `project` mode `messages:{where:'$error(...)'}`; the parent first appends a message via mutate | EXPRESSION_ERROR / `subloop.input.messages.where` / itemIndex 0. Children 0. `child_run.started` 0. |
| B07a | artifacts where, after a scripted inference transcript artifact | `subloop.input.artifacts.where` itemIndex 0. Children 0. |
| B07c | `messages:'all'` control | child created and succeeded |
| B08 | input.vars `{a:'1', b:'$error(...)'}` | `subloop.input.vars` mapIndex 1, message "Subloop input variable mapping 2 failed. …". Children 0. |
| B09 | inject `[ok, include]` | `subloop.input.inject.content` messageIndex 1. Children 0. |
| B10 | trigger.payload `$error` | `subloop.input.trigger.payload`. Children 0. |
| B11e / B11s / B11r | custom patch `$error` / `"bad patch"` / `[{op:'add',path:'/run/x',value:1}]` | EXPRESSION_ERROR `subloop.output.custom.patch` with evaluation / "result is not a JSON patch" / "writes outside the mutable regions". False. 1 child succeeded. 1 `child_run.finished` with failure seq = finish seq + 1. No childRunId/childNodeId/childDetails in parent details. |
| B12 | merge, explicit map `{a:'1', b:'$error("QA486-LIT-B12")'}` | `subloop.output.vars` mapIndex 1. 1 child succeeded. Resume refused; children still 1. |
| B13 | output messages where `$error` | `subloop.output.messages.where` itemIndex 0. Same completion semantics. |
| CH-NEST | B05-style fault: inline (depth 0) / direct child (depth 1) / grandchild (depth 2), using the `heartbeat.until` fault with a real listener | leaf code/boundary/resumable/message identical at every depth. Parents fail with the existing wrapper carrying `childRunId/childNodeId/childDetails`. Following links reaches the leaf. No `inference` in parent failures. |
| CH-INF | child (depth 1 and 2) with inference B19 output transform fault | parent wrapper links the child. The child snapshot carries `failure.inference`. The parent failure has no `inference`. |
| CH-DEDUP-A / B | §5 | §5 |
| CH-DET | B11/B12 rows | Resume refused; child unchanged (status, run.resumed 0) |

### D4 · inference (port 5873; scripted harness counters separate from native file checks)

| ID | Fixture | Expected |
| --- | --- | --- |
| B14 | input transform `[set literal ok, set expression $error]` | MUTATION_ERROR / `inference.input` / operationIndex 1 / operationKind set / false. Harness starts +0. No `harness.turn`. |
| B14m | one fault each: append-message template include, truncate where, drop where, replace where, replace bad regex pattern | fixed causes. operationKind per op. Regex cause "The regular expression is invalid or unsafe…" (if publish refuses the bad regex, recorded as L-PUB-like). |
| B15 | contextFiles `[ok 'a.txt', include 'b.txt', ok 'c.txt']`, fixed workspace dir | TEMPLATE_ERROR fileIndex 1. a.txt exists byte-exact; b.txt and c.txt absent. Starts +0. |
| B16 | prompt include | TEMPLATE_ERROR `inference.prompt.template`. Starts +0. No harness.turn. |
| B18 | schema `{type:object, required:[x]}`, repair prompt include; harness returns `"not-json"` | TEMPLATE_ERROR `inference.output.schema.repair.prompt` attempt 1, phase after-result, received-result sentence, no uncertainty suffix, false. Starts 1, resumes 0. |
| B19 | output transform set expression `$error` | MUTATION_ERROR `inference.output.transforms`, phase after-result, sentence, false. Starts 1. `failure.inference` = that turn. |
| B19-ns | B19 with harness announcing no session, no accepted marker | same. Submission delivery-uncertain. No "no usable session" suffix. |
| B19-art | schema mismatch, repair disabled | OUTPUT_SCHEMA_MISMATCH established, no phase |
| H-D ×3 | harness `start` throws synchronously: plain Error with code, domain TemplateError lookalike, name spoof | HARNESS_TURN_FAILED, inference.submission definitely-not-submitted, adapter text public (QA486-HAR present = established contract), resumable true (codex = H). Resume: start +1 with the identical stored prompt and turnId. |
| H-Q | after handle: session + accepted, result rejects | HARNESS_DELIVERY_UNCERTAIN, resumable true. Resume calls `resume(sessionId)` with the continuation prompt. |
| H-Qn | after handle, no session announced, result rejects | HARNESS_DELIVERY_UNCERTAIN, false, uncertainty suffix present |
| H-UG | H-Qn-class failure then Resume attempt | refused, 0 new starts, 0 context-file writes |
| RES | disable model via `PATCH /model-catalog/codex/<model>` {enabled:false}, then run | EVALUATION_UNAVAILABLE (or the observed resolver code), true, no harness.turn. Re-enable, Resume → succeeded. |
| RES-SM | resume-own session missing → HARNESS_SESSION_MISSING → disable model → recover-session/Resume → observe → re-enable → recover-session | missing first. Resolver failure while disabled keeps its own resumability with prior provenance informational. After restore, the explicit fresh session submits the saved prompt. |
| FRESH | recover-session with saved prompt vs without | saved prompt reused (no re-render) |
| RETRY | SCRIPTED-STORAGE: `harness.turn` append commits then throws → `run.failed.inference.retry`. Disable model; Resume → resumable prep failure without a `retry` object. Re-enable; Resume → start with the exact stored prompt/turnId | as stated |
| B17h | harness `contextWindow` throws ExpressionError lookalike | HARNESS_TURN_FAILED generic mapping, not INTERNAL_ERROR. Starts 0. |
| STRONG | harness holds the result; cancel the run while the output transform would fail | cancelled. No after-result phase. No run.failed. |
| TERM | harness error event `HARNESS_TERMINATION_UNCONFIRMED` + output transform fault configured | HARNESS_TERMINATION_UNCONFIRMED wins with its own copy |
| PRIOR | prep failure on re-entry after a prior accepted D/Q task | failure carries prior `inference` (same turnId). No new harness.turn. |
| B17 | §5 | synthetic-only or unverified |

### D5 · workspace and file return (port 5874; NATIVE fs)

| ID | Fixture | Expected |
| --- | --- | --- |
| W-T | template `  {{trigger.payload.dir}}\n` + script append (cwd workspace) + file return `out.json` | the script cwd equals the trimmed path. The directory is created. The return file is written in the same dir. Succeeded. |
| W-F / W-R / W-TMP | fixed absolute / fixed relative (driver cwd = scratch) / temp | created and reused. Temp under `<dataDir>/workspaces/<runId>`. |
| W-E | template `{{ trigger.payload.missing }}` | TEMPLATE_ERROR `settings.workingDirectory.template` "rendered to an empty path", false. No mkdir. Counter +0. |
| W-L | template include | Liquid cause. No mkdir. |
| B26 | exit with file return. Workspace template bad. No node used the workspace. | run status per exit (succeeded) unchanged. One `return.failed` whose error is the fixed safe workspace message. No file. No run.failed. |
| B26c | valid file return | `return.delivered`. File bytes exact. |
| B26x | return path collides with an existing directory | `return.failed` with the raw describeError text (positive raw control) |
| W-OWN | `/runs/:id/sessions` / deletion-eligibility preview of temp vs fixed runs | recorded best-effort |

### D6 · surfaces, persistence, history (port 5875 then 5876)

| ID | Check | Expected |
| --- | --- | --- |
| S-AUTH | no key / bad key: POST /loops, POST /loops/:id/runs, GET /runs/:id, resume. runs:read key: start run. | 401 / 401 / 403. Loops/runs/events/effects +0. |
| S-PAR | B05 leaf, B19 after-result, depth-two wrapper, B12 mapping | row == run.failed == REST failure. MCP `get_run` failure == REST. MCP `wait_for_run` terminal with the same failure. MCP `list_runs` reduced fields equal. Browser alert text contains the message. Resume control is not enabled for false. Child link present and navigates. Screenshots inspected. |
| S-PRIV | same | canaries absent in row/event/REST/MCP/DOM |
| S-HIST | events/rows of earlier runs hashed before a new publication + reads | byte-identical afterwards |
| S-RESTART | drain/stop, reopen the same data dir on 5876 | rows/events/REST byte-identical |

## 7. Stop rules, iterations, cleanup

- At most 3 attempts per new driver for instrumentation fixes. Every attempt is kept with exact driver/lib hashes. A valid product failure → `BLOCKERS.md` immediately, and dependent rows stop.
- No product, test, index, git or GitHub mutation. No installs. No full Windows coverage rerun.
- Every owned PID and listener is recorded. Shutdown is the authenticated drain, followed by an absence check. No broad process discovery or termination.

## Amendments

(none yet)

(The "(none yet)" line above was the state at plan-writing time. The amendments below are appended in execution order; nothing above was rewritten.)

### Amendment 1 · 2026-11-21T16:28Z · D2 attempt 2 (instrumentation)
Attempt 1 (100/104) was blocked from publishing the classifier fixtures (B21c, EXT-C ×3) by `LOOP_INVALID CLASSIFIER_SECRET_MISSING`. Attempt 2 sets a dummy `jev-api-key` secret in the disposable scratch store through `PUT /secrets/jev-api-key`. The scripted classifier registry never sends it anywhere. No other change. Both attempts are retained.

### Amendment 2 · 16:31Z · D3 attempt 2 (instrumentation)
The 02 scripted harness emitted usage key `reasoningTokens`; the contract key is `reasoningOutputTokens`. As a result, B07a and CH-INF-1/2 failed with EVENT_INVALID, which is the correct existing schema enforcement for an invalid port event. Fixed in `lib/harness.mjs` only. The inherited original harness had the same key.

### Amendment 3 · 16:36Z · D4 attempt 2 (instrumentation)
(a) The FRESH-unsaved fixture needed its decision `limit-reached` port connected (PORT_UNCONNECTED at publish). (b) The RETRY lane needs two consecutive intent-append faults. The timer-based re-arm in attempt 1 never ran between SQLite appends (they don't yield to the macrotask queue), so `boot.mjs` gained a synchronous `eventFault.times` count. (c) `rec.mjs` now deep-copies `actual` at check time. Attempt-1 `results.json` showed later-mutated counter objects (e.g. RES-SM-2 counters); the `*.raw.jsonl` at-check rows are authoritative for every attempt. D2/D3 attempts used the earlier `rec.mjs`. Their rows use freshly built objects except where noted in the REPORT.

### Amendment 4 · 16:38–16:46Z · added lanes (scope additions, no narrowing)
- D5b: read-only SQLite ownership/journal check on the retained D5 store (W-OWN).
- D2b: engine-level JSONata variants at `heartbeat.until` (port 5877).
- D4b: LLM-decider and structured-coerce lookalikes plus the B17 positive control (port 5878).
- D4c: B17 pure canonical-rerender fault via a QA-owned module-resolution seam. `lib/b17-hooks.mjs` and `lib/b17-shim.mjs` redirect only the import of `@graphgoblin/domain` from `engine/dist/handlers/inference-context.js`. No product file is touched. Port 5876 was reused after D6 closed it and refusal was verified.
- D7: A01–A03 adjacent contracts (port 5877 reused after D2b closed it).

### Amendment 5 · 16:41Z · D6 browser PID
`chromium.launch()` returns a `Browser` with no process handle, so the recorded browser PID is null and the in-driver BROWSER-cleanup check is vacuous. It is replaced by targeted absence records (`results/d6-surfaces/attempt-1/targeted-process-absence*.txt`, `results/final-process-absence-precise.txt`), filtered on the QA checkout, 02 scratch/driver paths and the chromium-1234 executable.
