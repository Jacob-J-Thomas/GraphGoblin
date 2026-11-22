# #486 independent touched-system behavior QA · PLAN

Written 2026-11-21 before any scenario execution. Author: actual Claude Code (Opus 5.5, xhigh) in the independent QA role, not author/reviewer/auditor. Any later amendment to this plan is appended in the "Plan amendments" section with time and reason; nothing above it is rewritten.

## Identity and preconditions (verified before writing this plan)

- Checkout `G:/ggq/gg-i4-486-qa/GraphGoblin`, detached HEAD `633d9ac72c10fe4b8d76f7ba50221f9ed8557cb9`, tree `d0e38c6c0212e312e6b605ac3d6bc8f7af5a129f`, parent `02351e2fb932b3be44e7cc3fb3943a61d568226c`. `git status --porcelain` empty.
- Root preparation `i4-486-qa-candidate-preparation-01/receipt.json`: sourceClean true, filesVerified 52, buildExitCode 0, Node v22.23.4.
- Independent source binding: all 52 `i4-486-source-freeze-01/receipt.json` paths re-hashed in this checkout, 52/52 SHA-256 and byte length equal; `git diff --name-only 02351e2..HEAD` is exactly those 52 paths.
- Independent build binding: the root build replayed 9/12 Turbo tasks from cache, so I recompiled `contracts, domain, engine, infrastructure, adapter-codex, api-client, api, mcp` with the checkout's own `tsc -p tsconfig.build.json --outDir <scratch>` and compared every emitted `.js`/`.d.ts`: 576 files, 0 differences, 0 missing. Web `dist/` was a Turbo cache miss (fresh Vite build); web source is unchanged versus parent and is bound by hash manifest only (no independent Vite rebuild, to avoid mutating `dist`).
- Runtime: project Node v22.23.4 first on PATH. Every owned process gets `TEMP`/`TMP` under `G:/ggq/qa-scratch/i4-486-independent-01`. No global HOME/CODEX_HOME change. No product source, index, commit, push, GitHub mutation, install or dependency change.

## Evidence classes (used on every result row)

- **NATIVE**: real Node child process (`ProcessScripts`) appending to a disposable counter file; real filesystem workspace/context/file-return bytes (`OwnedRunResources`); real disk-backed SQLite file (libsql) with shutdown/reopen; real loopback HTTP listener owned by the driver reached through the production `HttpProbes` adapter.
- **PUBLIC-API**: built API composed by `loadConfig → createContainer(config, overrides) → start → buildApp → listen(127.0.0.1)` with Bearer API key created by the exported `createApiKey`; REST over real loopback sockets.
- **SCRIPTED**: QA-written harness/structured/decider/classifier ports passed through the existing `ContainerOverrides`; every call counted per port (starts, resumes, results resolved/rejected, cancels, contextWindow, structured completes, decider/classifier calls). A QA-written wrapper around `container.ports.events` is used only for injected storage faults (precedent: `apps/api/scripts/failure-evidence/classification-storage.mjs`); it is labelled SCRIPTED-STORAGE.
- **DOMAIN-PUBLIC**: direct calls of exported `@graphgoblin/domain` built functions (`observeExpression`, `observePredicate`, `observeTemplate`, `evaluateExpression`, `evaluatePredicate`, `renderTemplate`, `checkExpression`).
- **SYNTHETIC-SEAM**: a QA-owned Node module-resolution hook that substitutes a controllable `renderTemplate` export for the engine's import of `@graphgoblin/domain` (B17 only). No product file changes. Reachability is synthetic-only and stated as such.
- **MCP-STDIO**: built `apps/mcp/dist/main.js` as a child process over stdio, driven by the repository's installed `@modelcontextprotocol/sdk` client.
- **BROWSER**: installed `playwright-core@1.63.0` with its already-present Chromium against the owned API serving built `apps/web/dist`; DOM, network log, viewport and screenshots retained.
- **STATIC**: source reading only; never counted as behavior evidence.

## Owned resources

- Ports: one API port per driver chosen from 5871–5879 (never 4747/4748/11434); loopback HTTP probe listener on an OS-assigned port (listen 0) on 127.0.0.1. MCP uses stdio only.
- Each driver records its PID, listener ports, child PIDs it spawns (MCP), and performs authenticated `POST /system/shutdown`-style drain only if that route exists; otherwise `app.close()` + `container.stop()` (the composition's own drain) and then verifies the port no longer accepts connections and the MCP child has exited. No broad process termination.
- Data: per-driver data directory under `G:/ggq/qa-scratch/i4-486-independent-01/data/<driver>-<attempt>`; disk SQLite in that directory (default `GG_DB_URL`). Retained after the run for byte checks.

## Fixture rules

- Every loop is published through `POST /loops` + `POST /loops/:id/publish` and must publish (HTTP 200) — a fixture rejected at publish counts as a setup failure, not a boundary pass. Liquid runtime faults use `{% include "<marker>" %}` (parses; fails at render because includes are disabled) or a taken-branch filter fault; JSONata runtime faults use runtime-only constructs (`$error`, `$assert`, type errors, `$eval` of malformed/unsafe strings, recursion depth).
- Canary markers: `QA486-LIT-*` (literal `$error`/`$assert` arguments, author-label text), `QA486-IN-*` (evaluated input data: trigger payload, probe response, child result), `QA486-EXT-*` (injected external exception messages), `QA486-PATH-*` (include/path names), `QA486-HAR-*` (harness adapter text, positive-control raw contract).
- "Absent" checks apply only to new authored/canonical causes. Positive raw controls (unknown harness text, unexpected file receipt error, P01/P02 text, B25 request copy) assert presence where the existing contract publishes it.

## Acceptance matrix (expected outcome written before execution)

Notation: code / `details.boundary` / indices / `resumable`; effect counts are deltas measured on the real sink unless marked SCRIPTED. "Resume refused" means `POST /runs/:id/resume` with current `observedSeq` returns 409 `FAILURE_NOT_RESUMABLE` and event bytes are unchanged afterwards.

### D1 · domain-observe (DOMAIN-PUBLIC)

| ID | Input | Expected |
| --- | --- | --- |
| J01 | `$error("QA486-LIT-J01")` on `{a:1}` | observe: ok false, reason `evaluation-rejected`; legacy `evaluateExpression` rejects ExpressionError whose message contains the literal (legacy contract retained) |
| J02 | grouped `($x := 1; $error("QA486-LIT-J02"))` | reason `evaluation-rejected` |
| J03 | conditional taken `a = 1 ? $error("…") : 2` / untaken `a = 2 ? $error("…") : 7` | taken: `evaluation-rejected`; untaken: ok true value 7 |
| J04 | nested function `($f := function($v){ $error("…") }; $f(1))` | `evaluation-rejected` |
| J05 | dynamic `$error("QA486-" & a)` with input carrying `QA486-IN-J05` | `evaluation-rejected` |
| J06 | `$assert(false, "QA486-LIT-J06")` | `evaluation-rejected` |
| J07 | length: `$error` literal of 5,000 chars; character: literal with newline, quotes, emoji, `<script>` | `evaluation-rejected` for both |
| J08 | type error `$length(123)`, `$substring(1)` | `evaluation-rejected` |
| J09 | `$eval("1 +")` (malformed runtime string) and `$eval("$match('a', /(a+)+$/)")` (unsafe runtime regex) | `evaluation-rejected` (A1: never `compile`/`unsafe-regex`) |
| J10 | top-level malformed `1 +` and top-level unsafe regex `$match(a, /(a+)+$/)` | reason `compile` / `unsafe-regex` (SYNTHETIC reachability: publication refuses these, see L-PUB) |
| J11 | depth `($f := function($n){ $n = 0 ? 0 : 1 + $f($n-1) }; $f(5000))` | reason `depth` |
| J12 | time: CPU-heavy expression with `timeoutMs: 50` | reason `time` |
| J13 | binding preparation: options.bindings with enumerable getter that throws ExpressionError / plain Error | no `reason`; error identity preserved for ExpressionError; plain error legacy-wrapped; getter read once |
| J14 | external callback: binding function that throws a genuine ExpressionError (rethrown earlier depth error from J11) | identity preserved; reason `evaluation-rejected`, NOT `depth` (cross-call ownership) |
| J15 | external name-spoof `Error{name:'ExpressionError'}` and code-spoof `{code:'EXPRESSION_ERROR',message}` thrown by binding | reason `evaluation-rejected` only; error wrapped by legacy policy; no reason derived from name/code |
| J16 | predicate coercion: `observePredicate` with result a Proxy whose ownKeys trap throws | observation rejects/throws without authored reason (SYNTHETIC: unreachable with JSON run data) |
| J17 | predicate success controls true/false/null/[]/[1]/{}/{a:1} | values false/false/false/false/true/false/true... per existing coercion |
| J18 | overlapping evaluations of same cached source, one failing one succeeding | independent outcomes |
| J19 | Liquid `observeTemplate`: `{% include "QA486-PATH-T" %}` at line 2; render error via missing filter arg in taken branch; untaken-branch control; parse error | render fact with line 2/column; parse fact for parse error; untaken succeeds; fact contains only phase/line/column |
| J20 | fact closure | every observation's keys ⊆ {ok,value,error,reason}; reason ∈ closed set; template fact keys ⊆ {phase,line,column} |

### D2 · leaf boundaries over the built API (PUBLIC-API + NATIVE + SCRIPTED)

| ID | Boundary | Fixture | Expected |
| --- | --- | --- | --- |
| L-PUB | publish validation | top-level malformed expression / unsafe regex / Liquid parse error in a selector | publish refused (4xx), zero runs; shows J10 is synthetic-only |
| B01 | script.args | native append script; args[0] ok, args[1] `{% include "QA486-PATH-B01" %}` | TEMPLATE_ERROR, `script.args`, argumentIndex 1, message "Script argument 2 failed. The template could not be rendered at line 1, column 1…", false; native counter lines +0; 0 `script.dispatched`; Resume refused, counter still +0 |
| B01c | control | same loop, args valid | succeeded; counter +1 exactly, same file |
| B01u | uncertain dispatch control | script command path that cannot spawn? (see note) | existing SCRIPT_START_FAILED/SCRIPT_OUTCOME_UNCERTAIN policy unchanged (record only) |
| B02 | heartbeat.probe.headers | http probe, headers `{a:"ok", b:"{% include %}"}` | TEMPLATE_ERROR, headerIndex 1, "Heartbeat probe header 2 failed…", false; listener requests +0; 0 beats |
| B03 | heartbeat.probe.url / body | url include fault; body include fault (POST) | TEMPLATE_ERROR url/body; listener +0; 0 beats |
| B03c | control | valid url/body/headers, until `probe.status = 200` | succeeded; listener +1; 1 beat; headers/body received byte-exact |
| B04 | heartbeat.probe.args | script probe args[1] include fault | TEMPLATE_ERROR argumentIndex 1; native counter +0; 0 beats; workspace not resolved (temp dir absent) |
| B05 | heartbeat.until | http probe; until `$error("QA486-LIT-B05")` | EXPRESSION_ERROR `heartbeat.until`, beat 1, "Heartbeat until predicate, beat 1 failed. The expression could not evaluate this input…", false; listener +1 exactly; 1 `heartbeat.beat`; no timer/park; Resume refused; listener still +1 |
| B05b | beat-2 variant | until `beat = 2 ? $error(...) : false`, interval 1s, maxBeats 5 | fails at beat 2 after one park; listener +2; 2 beats |
| B06 | heartbeat.deadline | until false, deadline `not-a-date` (renders) and deadline include fault | TEMPLATE_ERROR fixed "must render to a timestamp" (no rendered value echoed) / Liquid reason; false; listener +1; 1 beat |
| B06c | until wins | until true, deadline invalid | succeeded (deadline never rendered) |
| B21 | decision.instructions / question | LLM decision with include fault; classifier decision question include fault | TEMPLATE_ERROR; SCRIPTED decider/classifier calls +0 |
| B22 | decision.context.messages.where | messages where `$error(...)` on item 2 (index 1 first true for index 0) | EXPRESSION_ERROR itemIndex per first failing item; decider calls +0 |
| B20 | expression decision route | route expression `$error("QA486-LIT-B20")` | existing `EVALUATION_EXPRESSION_FAILED`, fixed existing message, false, no `details.boundary`; literal absent |
| B23 | wait.prompt | input wait with include fault | TEMPLATE_ERROR `wait.prompt`; no waiting, no wait identity/timer |
| B24 | wait.timestamp | until-wait renders `QA486-IN-B24` (from payload) | TEMPLATE_ERROR fixed timestamp cause, false; payload marker absent |
| B25 | signal filter | signal wait with filter `$error("QA486-LIT-B25")`; send signal | HTTP 400 EXPRESSION_ERROR with existing request copy (literal presence recorded as established contract); run still waiting with same waitId; events added 0 (no signal/wake/failure) |
| P01 | Mutate | mutate set expression `$error("QA486-LIT-P01")` | existing MUTATION_ERROR shape with bounded authored text (literal present = established P01 contract), resumable false |
| P02 | Exit | exit returns `$error("QA486-LIT-P02")` | existing EXPRESSION_ERROR exit shape retained (record literal presence), false |
| PRIV | privacy | B05/B22/B24 stored failure + run.failed + REST | `QA486-LIT-*`, `QA486-IN-*`, `QA486-PATH-*` absent from new causes; failure JSON == run.failed failure JSON == REST snapshot failure |
| LOG | logging | capturing logger passed via overrides | no log record containing any `QA486-` canary emitted by new JSONata/Liquid sites |
| EXT-H | heartbeat HTTP port rejection | scripted `probes` override throwing (a) real `ExpressionError`, (b) Error named `ExpressionError`, (c) object `{code:'EXPRESSION_ERROR'}` | each: INTERNAL_ERROR safe copy, resumable true, no `details.boundary`, `QA486-EXT` absent; 0 beats |
| EXT-S | script runner rejection after dispatch | scripted `scripts` override throwing the same three | SCRIPT_OUTCOME_UNCERTAIN, 1 dispatch marker, no authored boundary |
| EXT-W | workspace/secret | secret lookup missing → SECRET_MISSING unchanged | SECRET_MISSING retained |

Note on B01u: if a non-spawnable command yields `SCRIPT_START_FAILED` it is recorded as an existing-policy control only.

### D3 · children (PUBLIC-API + NATIVE counter in child + SCRIPTED harness where used)

| ID | Fixture | Expected |
| --- | --- | --- |
| B07 | parent project mode, input messages where `$error` on item 2 | EXPRESSION_ERROR `subloop.input.messages.where` itemIndex 1, parent node, 0 child runs, 0 `child_run.started` |
| B07a | artifacts where variant | same on `subloop.input.artifacts.where` (requires a seeded artifact; if no public way to seed an artifact without a harness transcript, use inference transcript artifact) |
| B07c | built-in selection modes `all`/`last` | no evaluation, child created |
| B08 | input.vars map 2nd key `$error` | `subloop.input.vars` mapIndex 1 "…variable mapping 2…"; 0 children |
| B09 | inject[1] content include fault | `subloop.input.inject.content` messageIndex 1; 0 children |
| B10 | trigger.payload `$error` | `subloop.input.trigger.payload`; 0 children |
| B11 | custom patch `$error` / non-patch result / region outside mutable | E patch eval; "result is not a JSON patch"; "writes outside the mutable regions"; all false; child succeeded (1 child), one `child_run.finished`, adjacent failure; no `childRunId/childNodeId/childDetails` in parent failure details |
| B12 | output.vars explicit map 2nd key `$error` reading child result marker | mapIndex 1; 1 child succeeded; child's own failure absent; parent Resume refused; child count still 1; child not resumable action |
| B13 | output messages where `$error` | itemIndex; same completion semantics |
| CH-NEST | inline vs direct child vs depth-two: same B22-style decision selector fault (or B05) inside leaf | leaf code/boundary/resumable identical at depth 0/1/2; parent failures are the existing child-failure wrapper with `childRunId/childNodeId/childDetails`; following links reaches leaf; no `inference`/turn copied into parent |
| CH-INF | depth-one and depth-two inference child with after-result B19 failure | parent wrapper links child; child snapshot carries authoritative `failure.inference`; parent failure has no `inference` field copied from child |
| CH-DEDUP | genuinely resumable parent mapping fault: output vars map reads a child-produced value through an injected storage fault? — chosen: transient `INTERNAL_ERROR` from SCRIPTED-STORAGE on the parent's first post-child append | one child, adjacent completion/failure, Resume allowed, after Resume: still one child, `child_run.finished` not duplicated (terminal-seq reuse), one wake, child never resumed |
| CH-DET | deterministic mapping fault (B12) | Resume refused, 1 child, child status unchanged |

### D4 · inference (PUBLIC-API + SCRIPTED harness/structured + NATIVE context files)

| ID | Fixture | Expected |
| --- | --- | --- |
| B14 | input transform set expression `$error` op index 1 | MUTATION_ERROR `inference.input` operationIndex 1 operationKind `set`; harness starts +0; no `harness.turn`; false |
| B14m | input transform each op kind (set template, append-message, truncate where, drop where, replace where/pattern, coerce target) one fault each | fixed safe cause per kind; regex invalid → "regular expression is invalid or unsafe" |
| B15 | contextFiles [ok, include-fault, ok] | TEMPLATE_ERROR fileIndex 1; file 0 exists byte-exact; file 1 and 2 absent; harness +0 |
| B16 | prompt include fault | TEMPLATE_ERROR `inference.prompt.template`; harness +0; no harness.turn |
| B18 | schema repair prompt include fault; harness returns invalid structured | TEMPLATE_ERROR `inference.output.schema.repair.prompt` attempt 1, `phase:"after-result"`, received-result sentence, no uncertainty suffix, false; harness starts 1, resumes 0 (no repair turn) |
| B19 | output transform `$error` | MUTATION_ERROR `inference.output.transforms`, phase after-result, sentence, false; starts 1; `failure.inference` = last turn (turnId/visitId/kind/submission) |
| B19-ns | B19 with harness announcing no session and no accepted marker | same; submission `delivery-uncertain`; no "no usable session" suffix |
| B19-art | artifact/schema control: invalid structured, repair disabled → OUTPUT_SCHEMA_MISMATCH | established code/policy, no `phase` |
| H-D | harness `start` throws synchronously before handle (plain Error with code, and domain-lookalike TemplateError / name spoof / code spoof) | HARNESS_TURN_FAILED, submission definitely-not-submitted, adapter text public (QA486-HAR marker present = established contract); Resume allowed for codex (H); resume re-sends exact stored prompt (same turnId), starts +1 |
| H-Q | iterator/result rejection after handle with session + accepted marker | HARNESS_DELIVERY_UNCERTAIN, Q, Resume allowed (H&&U) → harness.resume with same session id |
| H-Qn | result rejection after handle, no session | HARNESS_DELIVERY_UNCERTAIN, false, uncertainty suffix present |
| H-UG | unusable Q guard: after H-Qn, force a Resume path? (Resume refused) — and replay not used. Additionally: a run whose prior Q is unusable reaching the handler again through a resumable prep failure | guard fires before resolver: catalog disable has no effect on the code (HARNESS_DELIVERY_UNCERTAIN), 0 prep effects (no context-file writes, no input-transform evaluation) |
| RES | resolver: disable model via `PATCH /model-catalog/codex/<model>` then start | EVALUATION_UNAVAILABLE, true, no harness.turn; re-enable; Resume → succeeded |
| RES-SM | session-missing then resolver unavailable then restored | first: HARNESS_SESSION_MISSING (resume-own session, harness error session-missing); disable model; Resume refused (session-missing false) → use recover-session? Per contract: missing-session is false; resolver failure on re-entry keeps prior provenance informational. Sequence driven: fail Q→ resumable prep failure w/ prior; then restore; reaches HARNESS_SESSION_MISSING actionable failure; then `recover-session` (explicit fresh) with saved prompt → new start with same prompt |
| FRESH | explicit fresh session with saved prompt vs without (prompt rendered) | recover-session submits stored prompt (no re-render: template now irrelevant) |
| RETRY | exact retry evidence: SCRIPTED-STORAGE fault on `harness.turn` append (commit then throw) → run.failed.inference.retry; then resumable prep failure (catalog disabled) on Resume → second run.failed has no `retry`; restore catalog; Resume → harness start with exact stored prompt, same turnId/context/resumeSessionId | as stated; no repeated retry object; starts +1 total after repair |
| B17 | SYNTHETIC-SEAM: canonical rerender throws `TemplateError("QA486-EXT-B17")` during trimming | INTERNAL_ERROR fixed internal message, resumable true, node `respond`, no harness.turn, marker absent; positive control: same chat run without fault trims history and succeeds (harness start +1, prompt fits) |
| B17h | contextWindow throws / fits throws (no seam) | HARNESS_TURN_FAILED generic harness mapping (adapter text public), not INTERNAL_ERROR |
| STRONG | abort/cancel race: harness result held; cancel run while output transform would fail | run cancelled; no after-result phase; no new run.failed |
| TERM | termination-unconfirmed stronger outcome vs B19 | stronger evidence keeps HARNESS_TERMINATION_UNCONFIRMED code/copy (if reachable via harness error event `HARNESS_TERMINATION_UNCONFIRMED`) |
| PRIOR | prep failure on re-entry with prior accepted turn | failure carries prior `inference` provenance (same turnId), no new harness.turn/submission; no invented marker |

### D5 · workspace and file return (PUBLIC-API + NATIVE)

| ID | Fixture | Expected |
| --- | --- | --- |
| W-T | template working directory `  {{trigger.payload.dir}}\n` | script cwd equals trimmed absolute path; directory created; file-return written there; same path reused by file return |
| W-F / W-R / W-TMP | fixed absolute, fixed relative, temp | created/reused; temp under `<dataDir>/workspaces/<runId>` |
| W-E | template rendering empty (`{{ vars.missing }}`) | TEMPLATE_ERROR `settings.workingDirectory.template` "rendered to an empty path", false; no mkdir anywhere; script counter +0 |
| W-L | template include fault | TEMPLATE_ERROR Liquid reason; no mkdir |
| B26 | exit file-return in a loop whose workspace template is bad but no node used workspace | run terminal status per exit (succeeded) unchanged; `return.failed` receipt with error = fixed safe message; no file written; no run failure; one failed receipt |
| B26c | file-return control (valid) | `return.delivered`/success receipt, file bytes exact |
| B26x | unexpected file write error (path collides with an existing directory) | existing `describeError` raw receipt text (positive raw control) |
| W-OWN | after runs: temp workspace journal claims (via history deletion eligibility / owned resources) | temp claimed only for temp runs (observed via `/runs/:id/sessions`? or deletion eligibility) — recorded best-effort |

### D6 · public surfaces, persistence and history (PUBLIC-API + MCP-STDIO + BROWSER + NATIVE SQLite)

| ID | Check | Expected |
| --- | --- | --- |
| S-AUTH | unauthenticated `POST /loops`, `POST /loops/:id/runs`, `GET /runs/:id`, resume | 401 each; zero loops/runs/events/effects added; read-only scoped key cannot start runs (403) |
| S-PAR | for B05 (authored leaf), B19 (after-result), CH-NEST depth-two wrapper, B12 parent mapping | stored row failure JSON == run.failed failure == REST `/runs/:id` failure; MCP `get_run` full structured failure equal to REST; MCP `wait_for_run` terminal finished true with same failure; MCP `list_runs` reduced `{code,message}` equal to the same fields; browser inspector alert text contains the full message, recovery controls reflect resumable false (no enabled Resume), child link present for the wrapper and navigates to the child |
| S-PRIV | same runs | QA486 canaries absent in all of: row, event, REST, MCP get/wait/list, DOM text, screenshots' DOM |
| S-RESTART | clean shutdown, reopen same data dir with a fresh container | rows/events byte-identical (SHA-256 of sorted canonical query output) before vs after reopen and after new publication + reads; REST/MCP outputs identical |
| S-HIST | rows captured before later publications and reads | byte-identical afterwards |

## Effect accounting

Every scenario records before/after: native counter file lines and bytes, listener request log (method/path/headers/body), directory listings of workspace targets, event counts by type, SCRIPTED port counters. Expected deltas are those in the tables above; any mismatch is a FAIL row with raw data retained.

## Stop rules

- Max three attempts per driver for instrumentation fixes; each attempt kept under `results/<driver>/attempt-N` with its exact driver bytes hash.
- A valid product failure stops only the dependent scenarios and is reported immediately in `BLOCKERS.md` and the final report.
- Known gate limits (combined gates failed 4 timing cases; Windows serial coverage infra failures D195/D196) are not rerun or reinterpreted.

## Plan amendments

(none yet)
