# #486 conditional implementation routing 01

**CONDITIONAL / DO NOT DISPATCH. Administrative decomposition only. No implementation, design selection, formal review, provider launch or gate satisfaction is recorded here.**

Prepared against architecture revision 03 and source HEAD `02351e2fb932b3be44e7cc3fb3943a61d568226c`, tree `d289bb12b943557584c5659bc33447d1baebc2f6`, in `G:/ggq/gg-i4-486-authored-errors/GraphGoblin`. The checkout was clean. The frozen proposal is `C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-486-architecture-03`. Its README, boundaries, verification, expression-provenance, critique-disposition and manifest are the binding design inputs. This routing adds no architecture, public API, requirement or approval.

The coordinator's supplied target main is `a84f988b89e456b0e2270e3c4750afb250b6c68f`. The local object is the #547 merge, whose first parent is the proposal base. The only packages/apps changes from the base are comments in `packages/adapter-codex/src/{isolation,options}.ts`; documentation/evidence and formatting-support metadata also changed. This is a future integration consideration, not a rebase or change of the proposal binding. Local `refs/heads/main` is older (`b3b5e187...`) and was not used as evidence of the current target. No network refresh or ref mutation was performed.

## Release conditions

Root must record the **actual Fable 03 verdict** on revision 03 (the packet scheduled earliest 2026-11-21T11:00:00Z), then its own separately catalogued delegated selection and disposition of every required revision. A scheduled time, quota result, planning probe, this routing or a positive source observation does not satisfy either condition. The packet's pending state is retained here; this task did not inspect a later verdict or selection. If the selection changes the proposal, root reconciles this routing against the selected frozen packet before dispatch.

Retain the issue's architecture-gate semantics and owner-delegated decision process: do not infer or set personal `plan-approved`. Root verifies admission and records the delegated selection under the existing authority. Consolidated owner decision review and any rework precede owner QA. No implementation or tests may be written on this routing alone.

## Roles and the four-slot ceiling

| Role | Owner and purpose | Authority |
| --- | --- | --- |
| C | Root coordinator | Gate checks, exact workspace/source admission, dispatch, immutable interface-freeze record, integration, current-target checks, review/QA routing and authorized publication/merge. No competing source edits in worker-owned files. |
| A | Designated **GPT-6.2 Astra xhigh** implementation worker, potentially a fresh root dispatch | Core architecture implementation: expression facts, safe projection, inference ordering/recovery/provenance, subloop causality, RunManager and shared interfaces. Owns shared code/barrels and behavior docs below. This is an implementer, not the reserved independent final auditor. |
| W | Approved performant GPT Sol, xhigh; root records exact version | Bounded workspace implementations, fakes, direct callers and ownership/cleanup regressions after A's interface freeze. |
| L | Approved performant GPT Sol, xhigh; root records exact version | Bounded leaf handlers and their tests after A's interface freeze. |
| T | Approved performant GPT Sol, xhigh; root records exact version | Public/API/child/receipt implementation tests after stable core behavior and a released Sol slot. No production changes. |
| Q/R | Actual independent Claude, exact approved provider/model selected by root | Opposite-family review and separate-context behavior/native/browser QA after implementation; never an OpenAI stand-in. |

At most **C + A + W + L** run concurrently. T waits for **W or L to finish/release a slot**, and for the relevant core/interfaces to be stable. C + A + one remaining Sol + T is then permitted. Review and QA wait for capacity; all active implementers, QA/review providers and coordinators count toward the operational ceiling of four. No worker spawns another agent or starts an unrecorded provider. Root is coordination and gate ownership; the core implementation is A's work.

## Contract-first sequence

1. **Blocked now.** C records the actual critique and selection, rechecks the selected packet/base/target, confirms workspace/index preservation and admits exact isolated implementation workspaces. This packet creates no branch/worktree.
2. **A only, before either Sol implementation starts.** Author working domain observation/legacy evaluator path, mutation-hook plumbing, safe engine cause/renderer/selector contracts, HandlerServices workspace outcome and WorkspacePort declaration. Preserve normal legacy behavior. Complete enough implementation to freeze real declarations and helper behavior; do not use stubs or speculative tests as a gate substitute.
3. **C records one immutable interface freeze.** Name exact source head/patch hashes, file paths, exported symbols/signatures, finite observation variants, formatter inputs/output, workspace result variants, field vocabulary/indices, error/throw behavior, and the exact helper calls each worker will consume. This routing deliberately does not choose the proposal's as-yet-unauthored symbol names. Attach focused domain/helper verification and remaining integration limitations. A owns all changes to those declarations.
4. **C dispatches W and L against that freeze; A continues core.** W adapts fakes/FS/journal wrappers/direct callers; L applies leaf-site mapping. A implements RunManager workspace preparation/file-return handling, inference and subloop logic/tests. No one edits another's files.
5. **T after slot and core release.** With stable selected outputs, T extends public/API/child/receipt tests. T returns a reproducer/expected-vs-observed discrepancy to A/W/L for any production defect; it does not fix production code.
6. **C integrates once; A makes any core correction.** Record exact combined head/patch, run finite checks below, then independently dispatch actual Claude review and separate QA. Target changes require exact new binding and relevant revalidation, not silent substitution for the proposal base.

A needed interface change stops dependent tasks. C records the concrete mismatch; A alone amends the shared files and issues a new freeze. Dependents resume only on that named version. No simultaneous edits, ownership transfer by implication, opportunistic refactor, new dependency or enlarged boundary list.

## Interfaces A must freeze first

| Interface from revision 03 | Required semantics before W/L |
| --- | --- |
| Domain concrete expression/predicate observation and explicit `packages/domain/src/index.ts` export | One underlying evaluator; concrete source/arguments only, no caller promise/function to assert provenance. Success value or existing rejection reference plus only closed local phase/reason. Once-only existing-order binding preparation has no evaluation fact. Predicate coercion is outside evaluation-rejection attribution. Source-owned winning compile/regex/budget facts stay invocation-local, never in DomainError.details/cache/registry. Ordinary public evaluation functions/options/error constructors retain values, wrapping, details and same-object passthrough. `expressionAst` remains internal. |
| Mutation rejection hook and inference mapper | Facts travel only from the immediate concrete evaluation site to the new inference mapper. Existing P01 mapper still receives its original three arguments/error and original bounded copy. Conversion, clock/ID, structured completion, serialization and storage stay outside the authored mapper. Fix exact optional-hook signature in the freeze. |
| Engine cause/render/evaluation/selector helpers | Fixed field/direction vocabulary; source-owned proof at explicit inert-run-data sites. Separate preparing views and coercing/converting values. Fixed boundary, zero-based details and one-based message ordinal; Object.entries own string-key order. Cause at most 1,000 UTF-16 units including ellipsis; existing 10,000 failure-message ceiling. New expression copy publishes no literal, expression source, raw code/runtime position, runtime argument or arbitrary error details. Reserve actual child wrapper keys. Specify exact helper signatures and safe Liquid facts. |
| HandlerServices working directory result | Success directory or local invalid-template/empty result, on engine-owned render/trim only. External resolve errors still throw. Node callers map only the local invalid outcome to their node-owned error. Fix exact union and helper name at freeze; no new public/stored directory schema. |
| WorkspacePort | `resolve(resolvedSpec, runId)` accepts **only existing temp or fixed union members**. No view argument and no template member. Keep `writeFile` contract. A owns `ports.ts`; W owns fakes and implementations/callers. Engine alone renders templates and applies identical trim. |
| Shared inference/subloop expectations for T | No new retry object on pre-intent failures, prior task information only, exact visit fold intact; only winning B18/B19 get after-result phase/copy/non-resumability. Parent mapping never reserves actual-child wrapper keys; actual child link traversal remains authoritative. T starts only after these outputs and core are stable. |

## Exclusive file ownership

All paths below are relative to the bound source checkout. A reservation is a permitted location if necessary for the selected design, not a direction to edit every file.

| Owner | Exclusive production/shared files |
| --- | --- |
| A | `packages/domain/src/{expression,index,mutations,template,errors}.ts`; `packages/engine/src/{ports,handler,index,errors,run-manager}.ts`; `packages/engine/src/handlers/{common,inference,inference-context,subloop}.ts`. Any needed new domain/engine helper file and export is named by A/C in the freeze before use. |
| W | `packages/engine/src/testing/fakes.ts`; `packages/infrastructure/src/fs/{workspace,owned-resources}.ts`; **comment only** in `packages/infrastructure/src/sqlite/workspace-references.ts`. |
| L | `packages/engine/src/handlers/{script,heartbeat,decision,wait}.ts`. |
| T | No production/shared helper ownership. Existing public testing helpers are read-only. Use file-local fixtures; request a separately named test-fixture file if reuse is necessary. |
| C | Delivery/gate/evidence records, including `docs/delivery/2026-11-17-five-intents-register.md` if later authorized. No worker edits that register. |

| Owner | Exclusive implementation tests |
| --- | --- |
| A | `packages/domain/src/{expression,mutations,template}.test.ts`; `packages/engine/src/handlers/{inference,inference-context,inference-boundaries,inference-refusal,inference-failure,inference-evidence-matrix,mutation-failures}.test.ts`; `packages/engine/src/{prompt-recovery,prompt-provenance,artifact-failure}.test.ts`. A names any required new core/helper test in the freeze; other owners cannot create an overlapping file. |
| W | `packages/engine/src/{edge-cases,run-manager}.test.ts`; `packages/infrastructure/src/fs/fs.test.ts`; `packages/infrastructure/src/sqlite/history-cleanup.test.ts`; `apps/api/src/history-cleanup.test.ts`. W owns the whole `run-manager.test.ts`, including its resolve override; A supplies requested regression cases instead of editing it. |
| L | `packages/engine/src/handlers/{flow,heartbeat-visit}.test.ts`. `flow.test.ts` contains neighboring systems; L changes only tests needed for its sites; T does not edit this file for subloop coverage. |
| T | `packages/engine/src/{child-creation,awaited-children,child-failure-parity,adversarial}.test.ts`; `apps/api/src/{subloop-failure,prompt-failure-boundaries,prompt-evidence-matrix,prompt-provenance,prompt-sdk-storage-matrix}.test.ts`. Child completion/dedup and file-receipt cases belong here. |

A alone owns behavior documentation: `docs/{04-node-catalog,05-execution-engine,06-harness-integration}.md`, `docs/guide/03-run-and-observe.md`, `CHANGELOG.md`, and one focused ADR whose exact unoccupied path C/A records before creation. No worker changes generated reference docs, package manifests/lockfile, contracts/schemas/migrations or UI. If a selected schema/route actually changes, C must first reconcile that departure against the no-new-contract plan; generated docs cannot silently expand scope. All barrels, shared helpers, HandlerServices, WorkspacePort and numbered docs have one owner.

Control-only source: `handlers/{mutate,exit,inference-turn,inference-failure}.ts`, `primitive-evaluator.ts`, `failure-publication.ts`, `run-recovery.ts`, API error plugin, adapter/provider implementations and adjacent trigger/preview paths retain existing behavior. A/C must stop and catalogue a concrete selected-plan need before any edit to an unassigned control file. There is no authorization for a generic mapper, new provider policy, historical rewrite or recovery rewrite.

## Original 26-boundary allocation and meaningful checks

Every changed site needs a successful sibling/control and a real failing authored operation. Assert code/node, exact field/cause/correction/index, recovery refusal where specified, matching row/event and actual effects. Same-class errors, name lookalikes and code/message lookalikes at external callbacks are separate controls, never origin proof.

| ID | Implementation / tests | Positive behavior and negative/effect control |
| --- | --- | --- |
| B01 | L / L | Argument render succeeds or produces indexed TEMPLATE_ERROR before dispatch; previous unresolved script consent guard wins; no new dispatch/runner on failure, workspace/secret reads may preexist. |
| B02 | L / L | Header renders in own-key order; malformed header uses ordinal without name/value; no current fetch/beat. |
| B03 | L / L | URL/body success; separate bad URL/body templates fail before fetch; HTTP/overflow/response conversion retain paths. |
| B04 | L + A workspace consumption / L | Script-probe args succeed; indexed render failure prevents workspace/runner/beat; ordinary probe effects differ from script consent. |
| B05 | L / L | Until true/false succeed normally; predicate failure follows one real probe and recorded beat; no further probe/timer after refused Resume. |
| B06 | L / L | Until success bypasses deadline; valid deadline works; Liquid and NaN deadline both fixed TEMPLATE_ERROR/false after observed beat, no raw timestamp. |
| B07 | A / T | Input message/artifact selectors succeed; per-item failure before child; built-in selectors perform no evaluation; coercion/preparation not authored. |
| B08 | A / T | Input vars evaluated in own-key order; failing ordinal not name, no child; toJson outside evaluation catch. |
| B09 | A / T | Injected content succeeds; indexed bad template before message ID/clock and child. |
| B10 | A / T | Trigger payload succeeds; bad expression before atomic admission; serializer/start/store errors remain external. |
| B11 | A / T | Valid custom patch; evaluator, wrong-shape and forbidden-region faults fixed EXPRESSION_ERROR/false; unexpected exceptions/final commit separate; completion preserved, no child wrapper keys. |
| B12 | A / T | Output vars mapped from actual terminal child; bad map ordinal parent-owned, one child/completion, no false failed-child links. |
| B13 | A / T | Output message/artifact selectors succeed/fail per item; actual succeeded child stays succeeded; post-evaluation failures keep prior handling. |
| B14 | A / A | Both input transform arms and operation kinds; safe MUTATION_ERROR/false, earlier coerce calls may exist, no main intent/turn; P01 original policy preserved. |
| B15 | A / A | Ordered real file success; second template failure preserves first bytes, no failing/later write; external partial write stays external. |
| B16 | A / A | New authored prompt error before intent; saved retry/supplied original fresh prompt bypass render; prior provenance informational; restore exact retry across restart. |
| B17 | A / A | Real canonical trim/fit succeeds; controlled pure canonical rerender failure engine-owned safe internal/true; fits/window exception retains harness map. Mark synthetic reachability. |
| B18 | A / A + T public parity | Repair prompt succeeds; render failure after real scripted result keeps last turn/session/visit, Q/false, fixed phase/result sentence, no new repair intent; stronger cleanup/timeout/etc winner no phase. |
| B19 | A / A + T public parity | Output transform success; source-owned operation failure after result uses same winning-branch rules even with no session; artifact/schema/serialization/coerce provider failures get no authored phase. |
| B20 | Preserve control / L + A existing | Decision route expression keeps EVALUATION_EXPRESSION_FAILED or invalid-response contract, fixed existing text/false, pre/post abort checks. |
| B21 | L / L | LLM instructions/classifier question succeed; bad template fails before provider; provider/refusal/response contracts unchanged. |
| B22 | L consuming A selector / L | Context message where succeeds/fails before provider after instructions/question; context construction/serialization separate. |
| B23 | L / L | Input prompt success parks; malformed prompt before wait identity/timer/wake/input; wake does not rerender. |
| B24 | L / L | Until timestamp works; Liquid/NaN fixed TEMPLATE_ERROR/false before park, raw rendered value absent. |
| B25 | Preserve request control / T | Real API signal expression HTTP 400 retains existing copy/details; same parked wait identity/status, zero signal/wake/run-failed. |
| B26 | A engine contract/render/cache/catch + W FS/fakes/callers + L script/probe consumers / W + A + T | Template success identical trim/path; fixed/temp/relative behavior, successful-only cache, temp ownership/shared canonical use unchanged. Bad/empty local template zero resolve/mkdir/journal. Port rejection external. File-return bad local outcome uses original failed-receipt catch, terminal status and before/after-commit reconciliation unchanged. |

P01/P02 and A01-A04 are **preservation controls**, not new boundaries. Preserve Mutate/Exit text, B20/B25, poll template/fireWhen/dedupe, poll selector/key, request dedupe and local preview. No new run-error code, durable transformed snapshot, public directory spec, acceptance marker, enum, schema/SQL migration, stored format, historical rewrite, automatic retry or provider privacy policy. Existing Replay remains a distinct run with current observation/consent.

## Collision/dependency ledger

- `common.ts` selectors, repair/render hooks and runMutations are shared by A/L/T: **A writes, everyone else consumes frozen exports**.
- `domain/index.ts`, `engine/index.ts`, `ports.ts`, `handler.ts`, domain mutation hooks and new formatter modules: **A only**. W/L may not add convenience exports or reinterpret union outcomes.
- `testing/fakes.ts`: **W only**. A/T request counters/fault seams or use test-local fixtures; no simultaneous inference/fake edits.
- `run-manager.ts`: **A only**, including B26 engine render/cache and original terminal file catch. `run-manager.test.ts`: **W only**.
- `flow.test.ts`: **L only**. Subloop/child tests go to T's named files.
- Both `child-creation.test.ts` and `awaited-children.test.ts`: **T only**. Replace old deterministic-resume expectations and retain a separate legitimately resumable dedup case; never erase retry coverage.
- `apps/api/src/history-cleanup.test.ts`: **W only**. Other assigned API failure suites: **T only**.
- `workspace-references.ts`: W changes the trim-owner comment only; no sweep algorithm changes.
- Shared `testing/scenario.ts` and API `testing/test-app.ts`: read-only unless C explicitly assigns a new sole owner before an actual selected-plan need. Current in-memory test-app is not disk/native/browser QA.
- Shared docs/ADR/CHANGELOG: **A only**; delivery register/publication evidence: **C only**. The a84f988b docs merge may cause later doc conflicts; C integrates while preserving target content.
- One combined gate runner, C, after workers stop editing. Workers use isolated workspaces; do not race build/coverage output in the same checkout. No stage/unstage/commit/push on implied authority.

## Finite verification commands (future, not executed by this preparation)

Run from the admitted implementation workspace. Select the runtime for each PowerShell session and confirm major 22 >=22.22.2:

~~~powershell
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
node --version
pnpm.cmd --filter @graphgoblin/domain exec vitest run src/expression.test.ts src/mutations.test.ts src/template.test.ts
pnpm.cmd --filter @graphgoblin/engine exec vitest run src/edge-cases.test.ts src/run-manager.test.ts src/handlers/flow.test.ts src/handlers/heartbeat-visit.test.ts
pnpm.cmd --filter @graphgoblin/engine exec vitest run src/handlers/inference.test.ts src/handlers/inference-context.test.ts src/handlers/inference-boundaries.test.ts src/handlers/inference-refusal.test.ts src/handlers/inference-failure.test.ts src/handlers/inference-evidence-matrix.test.ts src/handlers/mutation-failures.test.ts src/prompt-recovery.test.ts src/prompt-provenance.test.ts src/artifact-failure.test.ts
pnpm.cmd --filter @graphgoblin/engine exec vitest run src/child-creation.test.ts src/awaited-children.test.ts src/child-failure-parity.test.ts src/adversarial.test.ts
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/fs/fs.test.ts src/sqlite/history-cleanup.test.ts
pnpm.cmd build
pnpm.cmd --filter @graphgoblin/api exec vitest run src/history-cleanup.test.ts src/subloop-failure.test.ts src/prompt-failure-boundaries.test.ts src/prompt-evidence-matrix.test.ts src/prompt-provenance.test.ts src/prompt-sdk-storage-matrix.test.ts
pnpm.cmd check
git diff --check
~~~

Focused lists expand only for a named new test file or a demonstrated uncovered touched behavior. Typecheck includes tests; no any casts/threshold exclusions. Full check enforces existing package 90% line/branch coverage and repository gates. API direct tests follow build as required. Do not call Turbo directly. No install/new dependency is proposed.

Run each focused group once after its owned change is ready, then build/check once at the combined head. After a concrete correction, rerun only affected groups and required combined gates. Persistent failures or unresolved behavior return a concrete blocker/checkpoint to C; do not widen scope or loop through review/QA attempts. The repository's existing formal-scan/corrective policy remains unchanged.

## Independent review and QA are separate

Implementation tests above establish selected behavior in source/fakes/public methods; they do **not** establish independent QA, native effect reachability, browser acceptance, paid-provider behavior, merge or human acceptance. R/Q receives the exact combined source/target and its own context.

Independent Claude QA must run the revision-03 verification matrix using real disposable filesystem/context files, disk-backed SQLite shutdown/reopen, a native child script counter and loopback HTTP through the production probe adapter. Scripted harness/structured/classifier ports are explicitly labeled and counted separately. Build a disposable authenticated loopback API through the existing composition overrides; use built MCP stdio get_run/wait_for_run/list and an actual built inspector DOM/browser alert/recovery control/child links. Protect owner data/credentials and ports 4747/4748. Compare row/run.failed/REST/MCP full result and message-only surfaces, byte-stable historical records and new public copy. No production-only test flag or UI modification.

Opposite-family actual Claude adversarial review remains required. Independent behavior QA is a separate context; a planning Fable verdict is neither. Exact-head/current-target CI, ordinary coverage/license/docs/layer gates, three-total-formal-scan cap per PR, reserved fresh independent Astra MAX final audit, authorized signed merge and distinct owner decision-review/rework/QA gates remain intact. Root chooses timing and records their real outcomes. No formal scan was consumed by this routing task.

See task briefs and `source-binding.json`, `readback.json`, `SHA256SUMS` for bounded handoff and integrity. No product/test/plan bytes were changed by preparation.
