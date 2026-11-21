# #486 independent touched-system behavior QA · REPORT (original01 + continuation02)

**Verdict: CONDITIONAL. No product failure was found.** Every executed public/native/scripted check in the final attempts passed: 430/430 new checks in 02, plus the inherited original-01 D1 36/36. Coverage of the architecture-03 superset is incomplete, and §6 lists every unexecuted control explicitly. Root should accept or cover those controls (author tests, hosted CI, review) before treating behavior QA as complete. This verdict is not a review, coverage, CI, integration or final-audit result.

- QA identity: actual Claude Code **Opus 5.5 / xhigh** (D201 behavior-QA role), fresh provider envelope 02. Original session `df484ec2…` was not resumed and makes no completion claim.
- Candidate: `633d9ac72c10fe4b8d76f7ba50221f9ed8557cb9`, tree `d0e38c6c0212e312e6b605ac3d6bc8f7af5a129f`, parent `02351e2f…`. Checkout `G:/ggq/gg-i4-486-qa/GraphGoblin`, porcelain empty before every attempt and after every attempt (`porcelain_after=0` in each `attempt.txt`). Node v22.23.4.
- Build: the binding is **inherited from original01** (`results/00-bind/attempt-1`: 576 recompiled `.js/.d.ts`, 0 missing/different; 1,189-entry dist manifest `575de962…`). In 02, **R0** (`results/r0-recheck/attempt-1`, 4/4) re-verified HEAD/tree/parent, empty porcelain, 52/52 frozen source bytes+hashes and 1,189/1,189 dist files against that manifest. No rebuild was done. Web dist is hash-bound only, with no independent Vite recompilation.
- Draft PR553 / integrated head `d1177f1…` was **not** tested. All results bind to 633 only.

## 1. Inherited vs new

| Lane | Status | Evidence |
| --- | --- | --- |
| Binding 00 | INHERITED original01, not re-executed | `i4-486-independent-01/results/00-bind/attempt-1/*` (binding.json `cd3a638c…`) |
| D1 domain observe J01–J20 | INHERITED original01, 36/36, exit 0 12:53:46Z, not re-executed | `i4-486-independent-01/results/d1-domain-observe/attempt-1/d1.results.json` `6a60a755…`; lib hash `8ee54407…` = common.mjs alone |
| R0, D2, D2b, D3, D4, D4b, D4c, D5, D5b, D6, D7 | NEW in 02 | `i4-486-independent-02/results/<driver>/attempt-N/` |

## 2. Attempts (every attempt retained)

| Driver (sha256 of final bytes) | Attempts → result | Port | Class |
| --- | --- | --- | --- |
| r0-recheck `b3c9ae22…` | 1 → 4/4 | — | STATIC-IDENTITY |
| d2-leaf `ceba16ff…` | 1 → 100/104 (4 setup: classifier secret) · 2 → **108/108** | 5871 | PUBLIC-API, NATIVE, SCRIPTED, SCRIPTED-INJECT |
| d2b-jsonata-variants `4aa643d3…` | 1 → **62/62** | 5877 | PUBLIC-API |
| d3-children `fd4ba98c…` | 1 → 68/71 (QA harness usage key) · 2 → **71/71** | 5872 | PUBLIC-API, NATIVE listener, SCRIPTED, SCRIPTED-CLOCK |
| d4-inference `90b16a4c…` (att1 `ca38cfe6…`) | 1 → 89/92 (fixture port, fault re-arm) · 2 → **93/93** | 5873 (+restart) | PUBLIC-API, SQLITE, NATIVE files, SCRIPTED, SCRIPTED-STORAGE |
| d4b-extras `49b5df5a…` | 1 → **8/8** | 5878 | SCRIPTED, PUBLIC-API |
| d4c-b17-seam `6e258447…` | 1 → **4/4** | 5876 | SYNTHETIC-SEAM |
| d5-workspace `2a243d62…` | 1 → **24/24** | 5874 | NATIVE fs/script, SCRIPTED-STORAGE |
| d5b-ownership `ee2d75a1…` | 1 → **3/3** | — | NATIVE-SQLITE (read-only) |
| d6-surfaces `dcaf71c7…` | 1 → **47/47** | 5875, reopen 5876 | PUBLIC-API, MCP-STDIO, BROWSER, NATIVE-SQLITE |
| d7-adjacent `5a20a5bd…` | 1 → **6/6** | 5877 | PUBLIC-API + real poll scheduler |

No driver needed a third attempt. Library bytes per attempt are recorded in each `attempt.txt` and copied to `lib-copy/`. Final libs: boot `fffcee2f…`, checks `d91bac0d…`, harness `eccc28f4…` (ancestry: original `67922078…`, copied to `ancestry/`), rec `ae8a7990…` (ancestry: original common `8ee54407…`), append fixture `1f8d4ddf…` (byte-identical copy of the original). Earlier lib versions used by d2 att1–2 and d3 att1–2 are in their `lib-copy/` dirs. `*.raw.jsonl` holds the at-check snapshots and is authoritative (PLAN Amendment 3).

## 3. Composition used (no production test hook)

The disposable API used the existing composition only: `loadConfig(env)` → `createApiKey(config)` (wildcard key, plus a `runs:read,loops:read` key) → `createContainer(config, ContainerOverrides)` → `start()` → `buildApp()` → `listen(127.0.0.1)`. Settings: `GG_REQUIRE_API_KEY=true`, real disk SQLite in the scratch data dir, real `ProcessScripts`/`HttpProbes`/`OwnedRunResources`/scheduler/timers. Ollama disabled and pointed at the never-listened 5879. Only existing override fields were used: harnesses, structured, deciders, classifiers, logger and clock. Delegating probe/script wrappers forward to the real adapters and inject only for named EXT rows. The event store is wrapped only for named storage-fault rows (precedent: `classification-storage.mjs`). No real provider, account CLI, personal credential, owner store, or port 4747/4748/11434 was touched.

## 4. Criterion-by-criterion (final attempts)

Abbreviations: **parity** = stored row failure == `run.failed` failure == REST snapshot failure (canonical JSON). **refuse** = `recovery.resume.allowed=false`, an actual Resume returns 409 `FAILURE_NOT_RESUMABLE`, and events plus native sinks are unchanged afterwards. **priv** = QA486 canaries absent from the new projection.

### 4.1 The 26 boundaries (all executed publicly unless marked)

| ID | Result | Key observed evidence |
| --- | --- | --- |
| B01 script.args | PASS | TEMPLATE_ERROR `script.args` argumentIndex 3, "Script argument 4 failed. The template could not be rendered at line 1, column 1…", false. Native counter +0, 0 `script.dispatched`. Parity, refuse (counter still +0), priv. Control B01c: counter +1 with exact args, cwd = temp ws. |
| B02 headers | PASS | headerIndex 1, "Heartbeat probe header 2 failed…". Listener +0, 0 beats. Parity, refuse, priv. |
| B03 url/body | PASS | URL and POST-body faults: listener +0, 0 beats. Control B03c: listener +1 with rendered header/body, 1 beat. |
| B04 probe.args | PASS | argumentIndex 2. Script-probe counter +0. **No temp workspace created**. Control B04c: counter +1. |
| B05 until | PASS | Literal / beat-2 (B05b) / dynamic (B05d). Exactly 1 (or 2) real listener requests and the same number of beats. Not waiting. Refuse with listener unchanged. |
| B06 deadline | PASS | Payload `QA486-IN-B06` gives the fixed timestamp cause (marker absent). Include gives the Liquid cause. Beat 1, false, listener +1. B06c: until true wins and the invalid deadline is never rendered. |
| B07 input selectors | PASS | messages.where and artifacts.where (artifact from a real transcript artifact). itemIndex 0. 0 children, 0 `child_run.started`. B07c `all` control creates a succeeded child. |
| B08 input.vars | PASS | mapIndex 1, "Subloop input variable mapping 2 failed…". 0 children. |
| B09 inject | PASS | messageIndex 1. 0 children. |
| B10 trigger.payload | PASS | 0 children. |
| B11 custom patch | PASS | Evaluation / "result is not a JSON patch" / "writes outside the mutable regions". False. 1 succeeded child. `run.failed.seq = child_run.finished.seq + 1`. No child-link keys. Refuse. Child events unchanged; child itself not resumable. B11c control succeeds. |
| B12 output.vars | PASS | mapIndex 1. Child result marker absent. Same completion/refuse semantics. |
| B13 output selector | PASS (messages.where) | itemIndex 0. Same completion semantics. *`output.artifacts.where` not executed.* |
| B14 input transforms | PASS | set expression (op 2), set template, append-message, truncate/drop/replace `where` (with `, item 1`), invalid regex: "regular expression is invalid or unsafe". All MUTATION_ERROR `inference.input` with operationKind. Harness starts 0, no `harness.turn`. |
| B15 context files | PASS | fileIndex 1. a.txt written byte-exact `A-ctx-ok`; b.txt/c.txt absent. Starts 0. |
| B16 prompt | PASS | Starts 0, no turn. |
| B17 canonical rerender | PASS (**SYNTHETIC-SEAM** fault) + PASS (public positive control) | D4c seam: INTERNAL_ERROR fixed internal message, resumable true, node `respond`, after the contextWindow call, 0 starts/turns, marker absent. Resume with the seam disarmed trims and succeeds. D4b real system-chat trim: oldest pair omitted, recent pair kept, context retained 1 / omitted 1. B17h: contextWindow throw stays HARNESS_TURN_FAILED. |
| B18 repair prompt | PASS | `inference.output.schema.repair.prompt` attempt 1, phase after-result, received-result sentence, no uncertainty suffix, false. Starts 1, resumes 0. `failure.inference` = the authored turn. |
| B19 output transforms | PASS | Phase after-result + sentence. `failure.inference` = the turn with session. B19-ns: delivery-uncertain, no session, **no unusable-session suffix**, false. B19-art: OUTPUT_SCHEMA_MISMATCH, no phase. B19c control succeeds. |
| B20 route expression | PASS | EVALUATION_EXPRESSION_FAILED "The evaluation expression could not be evaluated", false, no boundary, literal absent. Parity, refuse. |
| B21 instructions/question | PASS | LLM and classifier. Decider/classifier calls +0. |
| B22 decision selector | PASS | itemIndex 0, decider +0. B22c control: decider +1, succeeded. |
| B23 wait.prompt | PASS | Never parked (no wait events). |
| B24 wait.timestamp | PASS | Fixed timestamp cause, payload marker absent, false. |
| B25 signal filter | PASS (preserved) | HTTP 400 EXPRESSION_ERROR request copy (literal present = established). Run still waiting with the same waitId. **0 added events** (no signal/wake/failure). B25c control wakes and succeeds. |
| B26 workspace/file return | PASS | W-E empty path / W-L Liquid: TEMPLATE_ERROR `settings.workingDirectory.template`, no script, no mkdir anywhere, parity, refuse. File return with a bad workspace: run **succeeded**, exactly one `return.failed` with the fixed safe message, no run.failed. B26c delivered byte-exact. B26x raw EISDIR receipt (positive raw control). Receipt append fault before/after commit: file written, status unchanged, ≤2 receipts, no re-delivery. |

### 4.2 Preserved contracts

| ID | Result |
| --- | --- |
| P01 Mutate | PASS: "Mutation operation 1 (set) failed: expression failed: QA486-LIT-P01", false (literal present = contract). Also visible through MCP and DOM. |
| P02 Exit | PASS: EXPRESSION_ERROR "expression failed: QA486-LIT-P02", false, no boundary. |
| B20 / B25 | PASS (above). |
| A01 poll fireWhen | PASS: 0 runs, private `POLL_TRIGGER_FAILED` warn, literal not logged. Control fires exactly one deduplicated run. |
| A02 poll item key | PASS: 0 runs, `POLL_ITEMS_INVALID KEY_FAILED items.dedupeKey itemIndex 0`. |
| A03 event dedupe | PASS: 422 `EVENT_KEY_EXPRESSION_FAILED` fixed copy, 0 runs. Control 202 + 1 run. |
| A04 web preview | **UNVERIFIED** (not executed; `apps/web/src/forms/preview.ts` is unchanged by the candidate). |

### 4.3 Engine-level JSONata variants (D2b at heartbeat.until) and A1

The following all use the identical fixed field/cause/action and the same parity/refuse/priv results: direct literal, grouped, taken conditional, nested function, dynamic (input-derived), `$assert`, a 5,000-character literal, special characters (newline/quote/`<script>`/U+2603), type error, **malformed `$eval`, unsafe-regex `$eval` and input-supplied `$eval` (neutral evaluation copy, never compile/unsafe copy, A1)**. Real recursion gives "exceeded its nesting limit". A real 2 s budget gives "exceeded its time limit". Untaken conditional, valid `$eval`, `[1]` and `{a:1}` predicates succeed. No captured log record contains QA486-LIT/IN (A2 scoped logging). Top-level compile/unsafe/Liquid-parse fixtures are **refused at publish** (L-PUB), so the compile/unsafe-regex reasons are synthetic-only (covered by inherited D1 J10).

### 4.4 Per-site external controls (genuine domain error, Error with the same name, object with the same code)

| Site | Result |
| --- | --- |
| Heartbeat HTTP probe port (EXT-H ×3) | PASS: INTERNAL_ERROR safe copy, true, no boundary, marker absent, 0 beats, listener +0. Error retained only in the private log. |
| Script runner after dispatch (EXT-S ×3) | PASS: SCRIPT_OUTCOME_UNCERTAIN, 1 dispatch, `outcome-uncertain`. Recovery `SCRIPT_CONSENT_REQUIRED`. |
| Classifier callback (EXT-C ×3) / LLM decider (EXT-LLM ×3) | PASS: EVALUATION_PROVIDER_FAILED "Decision provider request failed", false, provenance only. |
| Structured coerce during input prep (EXT-COERCE ×3) | PASS: INTERNAL_ERROR true, not `inference.input`, 0 harness starts. |
| Harness sync `start` throw (H-D: plain+code / real TemplateError / name spoof) | PASS: HARNESS_TURN_FAILED, definitely-not-submitted, adapter text public (established), true. Resume submits the **identical stored prompt with the same turnId** via start. |
| Harness after-handle with usable accepted session (H-Q) | PASS: HARNESS_DELIVERY_UNCERTAIN, true. Resume calls `resume(sessionId)`, no new start. |
| After-handle without session (H-Qn) | PASS: false, existing uncertainty suffix. Resume 409, 0 harness calls. |
| contextWindow throw (B17h) | PASS: HARNESS_TURN_FAILED, not internal/authored. |
| Missing secret (EXT-W) | PASS: SECRET_MISSING unchanged. |
| Workspace/context-file port, secret-lookup lookalikes, script-probe runner rejection, harness `resume`/repair sync throw | **UNVERIFIED** (no existing override for the workspace/secret ports; the other two were not executed). |

### 4.5 Inference ordering (R2/R4/S3)

PASS: RES (disabled catalog model → EVALUATION_UNAVAILABLE true, no turn; re-enable → Resume succeeds). H-UG: after a SCRIPTED-STORAGE crash path left a resumable INTERNAL_ERROR over an unusable-Q turn, Resume with the **model disabled** produced HARNESS_DELIVERY_UNCERTAIN (guard before resolver), 0 harness calls, and the context file was not rewritten. RES-SM: missing session → (storage-faulted classification) → resolver unavailable keeps true with prior provenance (same turnId, informational) → restored resolver reaches actionable HARNESS_SESSION_MISSING → `recover-session` submits the **saved authored prompt** fresh. FRESH-unsaved (resume-own, no recorded handle) renders the prompt for the fresh start. RETRY: intent append and reconcile both faulted → `run.failed.inference.retry {harness, prompt}`, D, 0 harness calls → later resumable prep failure (EVALUATION_UNAVAILABLE) with the **same turnId and no re-emitted retry** → **clean drain/shutdown and reopen of the same store** → Resume performs the exact retry (same prompt, same turnId, start) and succeeds.

Stronger outcomes (PASS): TERM, where termination-unconfirmed cleanup wins over B19 with its own copy/false and no phase. STRONG-cancel, where explicit cancel while the result is held gives cancelled and no run.failed. STRONG-timeout, where the node timeout gives INFERENCE_TIMEOUT and no phase. WEAK, where a generic cleanup failure stays secondary: the B19 cause wins, the cleanup text is not appended, and only a private "harness cleanup failed" log is written.

### 4.6 Children and history (R5/S1)

PASS:
- CH-NEST: leaf code/boundary/beat/message/node identical inline, at depth 1 and at depth 2. The parents use the existing `childRunId/childNodeId/childDetails` wrapper, and following the links reaches the leaf. No `inference` is copied.
- CH-INF (depth 1 and 2): the leaf child carries authoritative `failure.inference` (after-result), and the parents carry no inference.
- **CH-DEDUP-A** (child-creation lineage): the ordinary conversion fault gives INTERNAL_ERROR true. Resume fails again. Still 1 child, 1 `child_run.finished`, 2 `run.failed`, 1 `run.woken`, 0 child `run.resumed`.
- **CH-DEDUP-B** (awaited-children lineage, SCRIPTED-CLOCK transient mapping fault): failure seq = finish seq + 1. Resume **succeeds** with 1 child, 1 finish (terminal seq reused), 1 wake, child events byte-unchanged.
- CH-DET: B11/B12 refused, child unchanged.

### 4.7 Public surfaces, persistence and history (D6)

PASS:
- S-AUTH: no key / bad key gives 401 for POST /loops, start, GET run and resume. The `runs:read` key gives 403 to start and 200 to read. Loops, runs, events and the native counter are unchanged.
- S-PAR for leaf, depth-two wrapper (+mid, +leaf), B19 inference, B12 mapping, P01 and EXT internal: parity. MCP `get_run` failure (structured and text) == REST. MCP `wait_for_run` finished true with the same failure. MCP `list_runs` reduced `{code,message}` == REST (compared as a reduced projection only). MCP privacy holds. P01 literal visible via MCP (control). MCP child PID 41992 exited.
- Browser (playwright-core 1.63.0 with existing chromium-1234, headless, 1400×1000): every inspector alert shows `Failed: <code>` + the full stored message. Resume is disabled for false and enabled for the resumable EXT internal failure. A "failed child run" link appears only for actual child wrappers, and clicking twice navigates depth-2 → child → leaf. The B12 mapping failure has no child link. Page text omits the canaries. Network stayed on the owned origin. Screenshots `screens/*.png` were inspected, and the visuals match the DOM claims.
- S-HIST: after a new publication/run and REST/MCP/browser reads, existing row/event/REST hashes are unchanged.
- S-RESTART: after drain/stop and reopen on 5876, REST/row/event hashes are identical, and raw SQLite `runs`/`run_events` bytes read by a read-only client with the server stopped are identical (8 runs).

### 4.8 R1–R6 / S1–S6 summary

R1 PASS (partial, resume-path sync throw unexecuted). R2 PASS. R3 PASS. R4 PASS. R5 PASS. R6 PASS. S1 PASS. S2 PASS (fault synthetic-only, positive control public). S3 PASS. S4 PASS (inherited D1 J13–J15 domain + public EXT lookalikes). S5 PASS (fixed copy; literal/input/path markers absent at every new site). S6 PASS (template/fixed/relative/temp computed paths identical, cache/reuse, temp-only ownership claim + shared journal from D5b durable rows).

## 5. Native vs scripted accounting

- NATIVE sinks: append-counter files under `<scratch>/sinks`, loopback listener request logs, workspace/context/return files on disk, SQLite files (retained under each attempt's `data/`).
- SCRIPTED counters are separate: harness starts/resumes/results/cancels/contextWindow, decider/classifier/structured calls, probe/script injection counts, storage/clock fault fire logs. They appear in the row `actual`s and `finish` summaries.
- No scripted result is reported as native, and the B17 fault is reported only as SYNTHETIC-SEAM.

## 6. Unverified / not executed (explicit gaps)

- Harness `resume`/repair synchronous throw lookalikes. Acknowledged transport retry (`HARNESS_TRANSPORT_FAILED` retriable D, one retry). #427 pinned argument/model refusal. Init-only inherited Q without durable acceptance (resume-named/previous).
- STRUCTURED_COMPLETION_TIMEOUT. Artifact write failure (`ARTIFACT_WRITE_FAILED`). Final thread/serialization vs executor-commit faults. Coerce repair-prompt/target-write authored sites. Decision transient/≥500 mapping. Run deadline and forced-stop races against after-result. INFERENCE_TIMEOUT before admission.
- Workspace-port / context-file-write / secret-lookup lookalike rejections (no existing override). Script-probe runner rejection.
- B13 `output.artifacts.where`. Liquid fixed-position fallback. 1,000-unit cause clipping (fixed vocabulary keeps public causes short; formatter-only/synthetic).
- A04 web preview.
- Historical rows written by the **pre-change** build (02351e2): not produced, since no base build was run. History checks cover rows written earlier by the candidate itself.
- Draft PR553 integrated head and current-main target: not tested. Full Windows coverage was not rerun. D195/D196 failures and combined-gate timing failures remain as recorded.

## 7. Resources and cleanup

- Ports: 5871 D2, 5872 D3, 5873 D4 (twice, restart), 5874 D5, 5875 D6, 5876 D6 reopen then D4c, 5877 D2b then D7, 5878 D4b. Probe listeners used OS-assigned loopback ports. Pre-check at 16:20:02Z showed all 5871–5879 free. Every API was stopped with an authenticated `POST /system/shutdown {drain}` (202) → `waitForShutdown` → `app.close()` → `dispose()`, and the port then refused. Final check 16:44:33Z: 5871–5879 all ECONNREFUSED (`results/final-port-absence.json`).
- PIDs: driver PIDs are in each `finish` summary. MCP stdio child 41992 exited. Script children (append.mjs) ran to completion. The browser PID is unavailable from `chromium.launch()` (PLAN Amendment 5). The targeted check at 16:44:43Z found no chrome/node process from the QA checkout, 02 scratch, 02 drivers or chromium-1234 (`results/final-process-absence-precise.txt`).
- **Disclosure:** one earlier read-only listing (`final-process-absence.txt`) used an overbroad `*apps\mcp\dist\main.js*` filter and displayed 8 unrelated owner MCP processes from `C:\Users\98jak\source\repos\GraphGoblin`. Nothing was signalled or changed. The root bounded-runner node.exe also appeared in one D6 listing and was untouched.
- Scratch `G:/ggq/qa-scratch/i4-486-independent-02/<driver>-<attempt>/` (data, sinks, ws, cwd, tmp) is retained for inspection. The disposable store secret is a dummy `jev-api-key`. Original-01 scratch, packet and checkpoint were not modified. No product/index/git/GitHub mutation, install or global setting change was made.

## 8. Hashes

`SHA256SUMS.json` (this packet, excluding runner-owned `provider/`) lists every 02 file: plan, drivers, libs, fixtures, ancestry copies, and all attempt outputs including screenshots. Referenced immutable inputs: original PLAN `d2b0684a…`, D1 results `6a60a755…`, original provider events `29635e3c…`, result `c6462974…`, exit `ecd85009…`, checkpoint tool-calls `0612cd85…`, visible-text `26053342…`.
