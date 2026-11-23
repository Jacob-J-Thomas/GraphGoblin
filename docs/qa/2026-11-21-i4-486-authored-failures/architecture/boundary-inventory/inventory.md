# #486 authored evaluator boundary inventory

Source-only readiness evidence for later architecture. **Intent 4 is not admitted.** No architecture, public code, contract, recovery-policy change, implementation, review scan, QA or acceptance is selected here.

Pinned source: `47ca4640793a81efa5bec661dba25627de314774`, tree `c0ff3509016ce0db415fd1f35939ad39a7a9ac9d`, clean detached checkout `G:/ggq/gg-459-qa-main/GraphGoblin`. Before/after checks and SHA-256 hashes are in `provenance.json` and `source-manifest.json`; `source/` preserves exact inspected source bytes. All product citations below are repository-relative at this pin. `inventory.json` contains the per-boundary catch, emitted fields, effect position, recovery, cancellation and test anchors.

The first supplied path was a different clean candidate branch. Inspection stopped at governing docs, and the parent supplied this corrected checkout. That administrative mismatch is retained in provenance; it is not product evidence.

## Existing publication and precedence

- **E — executor:** ordinary non-abort handler errors currently publish safe `INTERNAL_ERROR`, current node, `resumable: true`, no public raw details. Typed `RunFailureError` uses its code/options; default resumability is true. The handler catch prioritizes child cancellation; unconfirmed termination retains its safety status; forced stop, run deadline and cancellation precede ordinary error classification. Successful late returns are checked again for cancellation and deadline. Final thread validation is separate and yields non-resumable internal failure. [Source: `packages/engine/src/run-manager.ts:2604-2704`, `:2729-2745`; `packages/engine/src/errors.ts:54-67`.]
- **I — inference:** preparation and main execution have distinct catches. Main execution preserves turn identity/submission, folds cleanup/provider evidence, applies node timeout/cancellation, adds inference provenance and constrains resumability by usable-session evidence. Acceptance cannot be downgraded to safe resend. An inherited authored session ID alone does not authorize continuation. [Source: `packages/engine/src/handlers/inference.ts:707-879`; `packages/engine/src/handlers/inference-turn.ts:136-180`; `packages/engine/src/handlers/inference-failure.ts:52-99`.]
- **S — script:** prior unfinished visit/dispatched work is refused before preparation; generic failures after an undisposed dispatch become `SCRIPT_OUTCOME_UNCERTAIN`. Deadline/stop retain their code and uncertainty evidence. Recovery requires explicit script consent despite the stored resumable flag. [Source: `packages/engine/src/handlers/script-dispatch.ts:16-93`; `packages/engine/src/run-recovery.ts:85-125`.]
- **N — child/nested:** child code/resumability/script survive; parent node becomes its subloop node, details wrap child run/node/details, and message is prefixed. Top-level child `failure.inference` is **not copied** by this wrapper. Parent resume can resume the same resumable failed child; crash re-entry alone does not request that resume. Terminal child output mapping and its completion-record handling are separate. [Source: `packages/engine/src/handlers/subloop.ts:188-208`, `:238-326`.]

## Runtime boundary map

The table reports existing source branches, assuming no higher-priority interruption. “Internal” refers to E's safe internal failure. “I” includes its submission/usable-session restriction. Side-effect statements concern the current visit, and do not claim that earlier workflow work never occurred.

| ID | Authored boundary and source | Current error path | Position relative to external work |
| --- | --- | --- | --- |
| B01 | Script args: `handlers/script.ts:39-40` | Render escapes to E, internal, default resumable | Before dispatch marker/runner; event/workspace/secret callbacks already happened; prior ambiguity checked first |
| B02 | Heartbeat HTTP headers: `handlers/heartbeat.ts:18-20` | Outside fetch try; E internal | Before current HTTP call |
| B03 | Heartbeat HTTP URL/body: `handlers/heartbeat.ts:22-40` | Shared try catches body-overflow only; render escapes to E | Arguments render before fetch; same catch also encloses external fetch rejection |
| B04 | Heartbeat script args: `handlers/heartbeat.ts:49-71` | Render outside runner try/finally; E internal | Before workspace/runner; heartbeat does not use ordinary script dispatch markers |
| B05 | Heartbeat until: `handlers/heartbeat.ts:129-149` | Predicate escapes to E | **After probe and awaited beat append**; before exhaustion checks |
| B06 | Heartbeat deadline: `handlers/heartbeat.ts:151-171` | Render => internal; rendered NaN => typed `TEMPLATE_ERROR`, node, default resumable, no details | After probe/beat; skipped if until succeeds |
| B07 | Subloop projected messages/artifacts: `handlers/subloop.ts:53-55`, `common.ts:108-139` | Predicate escapes to E | Before new child; reuse check already ran |
| B08 | Subloop input vars: `handlers/subloop.ts:58-64` | Expression escapes to E; serialization distinct | Before child creation |
| B09 | Subloop injected messages: `handlers/subloop.ts:66-74` | `services.render` => E | Before child; ID/clock callbacks follow render |
| B10 | Subloop trigger payload: `handlers/subloop.ts:219-233` | Expression => E; serialization distinct | After seed, before atomic child/start service |
| B11 | Subloop custom output: `handlers/subloop.ts:98-124,301-325` | Evaluator => engine-owned safe internal; bad result shape/nonmutable patch => typed `EXPRESSION_ERROR`, node, default resumable | **After terminal child**; completion records retained with failure |
| B12 | Subloop explicit output vars: `handlers/subloop.ts:134-146,301-325` | Same output catch; internal, parent node | After child; parent patch not committed |
| B13 | Subloop output selections: `handlers/subloop.ts:148-160,301-325` | Common predicates => same output catch | After child; retry uses same child and deduplicates completion |
| B14 | Inference input transforms: `handlers/inference.ts:305-308` | `runMutations` has **no mapper**, before main try => E; typed repair failures retained | Before authored harness turn; coerce structured provider may already run before later operation fails |
| B15 | Inference context files: `handlers/inference.ts:311-317` | Render => E, before main try | Each render precedes its write; **earlier files may be written**; also before pending-turn guards |
| B16 | Inference initial prompt: `handlers/inference.ts:346-396` | Render => E before node timeout/main try | After context files; saved pending/fresh-session prompt can bypass render |
| B17 | Canonical-chat prompt re-render: `handlers/inference-context.ts:51-70`, `inference.ts:397-443` | Same catch as contextWindow/fits: timeout, abort, typed failure, else `mapHarnessFailure`; ordinary TemplateError => `HARNESS_TURN_FAILED`, details.adapterCode, harness-dependent resumability | Before turn intent/start; after context files and contextWindow callback; failure reachability not reproduced |
| B18 | Same-session repair prompt: `handlers/inference.ts:598-635` | Inside main try => I safe internal unless higher evidence wins | **After previous successful turn**, before completed handle/pending identity is replaced by repair intent |
| B19 | Inference output transforms: `handlers/inference.ts:663-705` | No mutation mapper; inside I | **After harness work**, possible repairs/artifact publication; coerce may make separate structured call; parent thread patch not yet committed |
| B20 | Decision route expression: `primitive-evaluator.ts:269-286` | Fixed `EVALUATION_EXPRESSION_FAILED`, current node, false, no details; abort rethrows | Before observation, no provider call for expression kind |
| B21 | Decision instructions/question: `handlers/decision.ts:56-73` | `services.render` occurs before evaluator/provider catch => E | Before current provider dispatch |
| B22 | Decision message selection: `handlers/decision.ts:15-32,56-73` | Common predicate => E | Before provider; after instructions/question render |
| B23 | Wait input prompt: `handlers/wait.ts:24-33` | `services.render` => E | Before initial park, not on wake |
| B24 | Wait until: `handlers/wait.ts:6-15,40-42` | Render => internal; rendered NaN => typed `TEMPLATE_ERROR`, node, default resumable | Before park/timer |
| B25 | Signal wait filter: `run-manager.ts:1647-1708` | **Request path**; DomainError => HTTP400 `EXPRESSION_ERROR` with message/details, not a newly recorded run failure | Before signal.received/wake; existing wait remains unless another operation changes it |
| B26 | Workspace template: `infrastructure/src/fs/workspace.ts:14-35`, `run-manager.ts:3338-3351` | Handler caller => E; **file-return delivery caller** => `return.failed` with error text slice4000 | Render precedes mkdir; service also crosses filesystem I/O and caches after success |

Table shorthand `handlers/`, `common.ts`, `primitive-evaluator.ts` and `run-manager.ts` refers to `packages/engine/src/`; full paths and ranges are in JSON.

Existing precedents:

- **P01 mutate** supplies the mapper at authored template/expression/predicate/target/patch boundaries, returning non-resumable `MUTATION_ERROR` with zero-based operation index, kind, cause code and <=1000-character cause. Nested evaluators include set template/expression, append/inject templates and truncate/drop/replace predicates. Coerce repair prompt maps only the renderer's TemplateError; resolver/completion and final thread validation stay outside attribution. [`packages/engine/src/handlers/mutate.ts:10-34`; `common.ts:225-248,266-311`; `packages/domain/src/mutations.ts:80-121,166-243,318-331`.]
- **P02 exit** maps ExpressionError only from the evaluator promise to non-resumable `EXPRESSION_ERROR` with bounded message; subsequent `toJson` is outside the catch. [`packages/engine/src/handlers/exit.ts:14-23`.]

## Crossed callbacks and same-class errors

The origin is the call boundary, not merely the exception class. Storage/event/session writes, model-catalog resolution, structured completion, HTTP fetch, workspace resolve/write, contextWindow/fits and harness start/resume/iterator/result/cancel all remain distinct from authored evaluation.

- A heartbeat HTTP TemplateError thrown by fetch reaches E just as a template failure currently does; fetch may have already acted. A script runner rejection after dispatch is explicitly uncertain rather than an argument-template failure. [`handlers/heartbeat.ts:22-40`; `handlers/script.ts:63-78`.]
- Inference provider iterator/result rejections are observed as harness evidence. Session/event recording failures inside consume are outside that iterator catch. A same-class exception from either has different provenance and can follow a different public mapping. Main inference storage failures receive safe internal publication; submission/status recording diagnostics retain operation names only. [`handlers/inference.ts:140-179,198-267,707-879`.]
- Mutation mapper source encloses authored calls and authored patch writes. The maintained negative controls inject TemplateError from completion/model resolution and expect private resumable internal failure; final thread validation expects non-resumable internal failure. [`handlers/mutation-failures.test.ts:152-193`.]
- Output transformations, subloop mappings and final JSON/thread validation must be distinguished from provider rejection. Source order proves previous work can exist; this inventory does not choose a new retry policy.

## Other current evaluator consumers

These are adjacent surfaces recorded for completeness, **not additions to intent-4 implementation scope**.

| ID | Consumer | Current behavior and effect boundary |
| --- | --- | --- |
| A01 | Poll probes/templates, fireWhen/dedupe: `apps/api/src/triggers/poll.ts:143-179,209-225,235-269` | Templates before probe; predicates/dedupe after probe; before run admission. Target-wide catch logs fixed `POLL_TRIGGER_FAILED` unless a recognized typed probe/items error; returns no runs. Catch also crosses store/admission callbacks. |
| A02 | Poll item selector/key: `packages/domain/src/poll-items.ts:71-93` | Evaluator-only catches become `POLL_ITEMS_INVALID`, reason SELECTOR_FAILED/KEY_FAILED, path/index. Whole candidate set curated before dedupe/admission I/O. |
| A03 | Webhook/event dedupe: `apps/api/src/triggers/trigger-service.ts:463-475,617-627` | Local catches produce fixed HTTP422 EXPRESSION_FAILED or EVENT_KEY_EXPRESSION_FAILED before this receipt/run admission. |
| A04 | Editor preview: `apps/web/src/forms/preview.ts:19-27` | Local sample-thread result `{ok:false,error:message}`; expression timeout500ms, no run error/recovery. |

Static parse/authoring validation is not an execution-failure mapper. The sweep covered direct runtime `renderTemplate/evaluateExpression/evaluatePredicate` consumers in `packages/` and `apps/`, plus indirect `services.render` and mutation callers. It does not claim every hypothetical injected exception is reachable in published definitions.

## Persistence and public projection

1. **Bounds:** strict RunFailure has enum code, message <=10000 JS characters, required resumable and optional node/details/script/inference/missingSession. details uses `z.json()` without a per-cause size cap. `boundedFailure` truncates only message with original-length marker; malformed failure metadata becomes non-resumable EVENT_INVALID without node/details. `boundedAuthoredCause` caps1000 including ellipsis only where explicitly called. Expression's separate1000 helper adds suffix/prefix and does not guarantee1000 total; domain TemplateError may carry first200 template characters. [`packages/contracts/src/run.ts:159-168`; `packages/contracts/src/common.ts:21-22`; `packages/engine/src/event-validation.ts:26-39`; `failure-publication.ts:28-31`; `packages/domain/src/expression.ts:113-154`; `template.ts:33-43`.]
2. **New failure/event/row:** script evidence classification, safe internal projection and whole-message bound run before `run.failed` append, then failed-row transition. SQLite persists failure JSON and validates generated events transactionally; read decoders validate current schemas. Child projection strips only recognized historical engine diagnostic slots when creating a new parent failure; historical source rows are not rewritten. Typed messages/details are not globally semantically sanitized by this path. [`packages/engine/src/run-manager.ts:3040-3075`; `failure-publication.ts:73-130`; `packages/infrastructure/src/sqlite/events.ts:27-45,63-109`; `runs.ts:19-49,60-85`; `run-decoding.ts:64-81`.]
3. **REST:** run snapshot returns manager fields plus authoritative recovery. History/observation expose event schema. Signal filter failures are request DomainError400 and outside run-failure bounding. [`apps/api/src/routes/runs.ts:185-198,314-345`; `apps/api/src/plugins/errors.ts:192-194`; `packages/engine/src/run-manager.ts:1258-1277`.]
4. **MCP:** `get_run` forwards the full API snapshot; completed `wait_for_run` returns full observation result. Listing `summarizeRun` keeps failure code/message; adds script/resumable only with script metadata, and omits arbitrary details/inference. [`packages/api-client/src/resources.ts:145-146`; `apps/mcp/src/tools.ts:214-245,252-261`; `describe.ts:126-155`.]
5. **Inspector:** failure alert renders code and React text message, with fixed script-start/uncertainty copy, uses recovery.resume.allowed for resumable indication and details for child links. Event/list projections retain code/message. No live DOM/browser behavior is claimed. [`apps/web/src/runs/RunInspectorPage.tsx:208-222`; `projections.ts:84-85`; `RunsPage.tsx:215`.]

## Maintained test source anchors and gaps

No tests were run. JSON links each boundary to inspected maintained test source; nearby happy-path tests are not a claim of focused failure coverage.

- Existing precise authored controls: mutate evaluator/repair/index/target failures, same-class external negatives and final thread validation [`packages/engine/src/handlers/mutation-failures.test.ts:79-199`]; exit runtime depth-guard failure and refused resume [`handlers/exit.test.ts:33-69`]; decision expression safe failure [`handlers/flow.test.ts:124-132`].
- Heartbeat/wait tests cover rendered invalid timestamps and ordinary probes [`handlers/waiting.test.ts:142-150,194-309`]. These do not by themselves establish every renderer/predicate failure and same-class I/O negative.
- Inference maintained tests cover repair intent before/after-commit failures, provider/cleanup precedence and exact recovery prompts [`handlers/inference-boundaries.test.ts:65-244`; `apps/api/src/prompt-failure-boundaries.test.ts:31-211`]; coerce/node deadline distinction [`packages/engine/src/repair-deadline.test.ts:14-140`]. These are not a new authored-runtime-boundary acceptance matrix.
- Parent parity tests compare inline/child failures and test nested recovery [`packages/engine/src/child-failure-parity.test.ts:270-323,509-530`]; retrying bad parent output mapping retains one child/completion [`child-creation.test.ts:177-189`]. API child failure controls exist [`apps/api/src/subloop-failure.test.ts:44-123`].
- Public projection source tests exist for MCP summaries and inspector failure/child/cancel display [`apps/mcp/src/units.test.ts:221-235`; `describe.test.ts:9-29`; `apps/web/src/runs/RunInspectorPage.test.tsx:605-663,880-893`]. No new stored-row/event→REST→MCP→browser chain was executed.

Readiness omissions now captured are B17 and B21–B26, the placement of input/file preparation before pending-turn guards, completed-turn provenance at repair render failure, parent omission of top-level inference provenance, existing typed timestamp/patch-shape cases, and full-versus-summary projections. They are factual inventory additions, not newly validated defects.

No provider/account, owner store/auth/config, browser/native process lifecycle, dependency, build, test, GitHub write or review reservation was accessed. Live issue/gate/PR state was not independently refreshed. Future admission must refresh main and issue state and preserve strict intent order, parking/refinement/architecture approval and owner gates. [Governing source: `docs/15-issue-workflow.md`; `docs/delivery/2026-11-17-five-intents-register.md:128-148`.]

