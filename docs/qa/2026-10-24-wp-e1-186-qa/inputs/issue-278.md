# #278 GraphGoblin roadmap — owner-approved intents, UoWs and bolts

state: OPEN | milestone: Later | labels: type:epic, area:engine, backlog, status:approved-held
parent: -
sub-issues: #279(OPEN), #280(OPEN), #281(OPEN), #282(OPEN), #283(OPEN), #284(OPEN), #285(OPEN), #286(OPEN), #287(OPEN), #288(OPEN), #289(OPEN), #290(OPEN), #291(OPEN), #326(OPEN), #327(OPEN), #328(OPEN), #329(OPEN), #330(OPEN), #331(OPEN), #332(OPEN), #333(OPEN), #334(OPEN), #335(OPEN)
created: 2026-10-17T19:57:55Z updated: 2026-10-18T23:38:37Z

## Body

<!-- graphgoblin-approved-roadmap:2026-10-17:ROOT -->

<!-- graphgoblin-approved-revision:2026-10-18 -->

**Owner-approved consolidated revision, 2026-10-18. Implementation remains held by #279.** Latest owner decisions in #278 supersede older proposals and historical comments. This approval authorizes backlog publication only; no implementation, owner-environment change, or provider run is dispatched.

Authority and complete owner decision record: #278. Current text supersedes older model proposals and historical scheduling/approval statements; comments remain historical evidence, not a competing current specification.

## Approved order

| Priority | Intent                                                           | Outcome                                                                                                               |
| -------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1        | #283 Make automated delivery evidence trustworthy                | Passing checks reliably cover the code and behavior being delivered, including executable examples.                   |
| 2        | #284 Start reliably with a valid current-format store            | Bad records cannot disable healthy work, and development format changes have a clear fresh-start path.                |
| 3        | #285 Keep runs correct through waits, edits and shutdown         | A run follows the definition and logical visit it started with and remains controllable across interruption.          |
| 4        | #286 Complete child work and external effects predictably        | Parents await their children, failures follow consistent rules, and recovery does not silently repeat uncertain work. |
| 5        | #287 Keep sustained loops responsive and resource use controlled | Long-lived loops and large contexts remain observable and controllable without unbounded incidental buffering.        |
| 6        | #288 Make repeated model work predictable                        | Model choices, limits and conversation continuity behave explicitly across repeated node visits.                      |
| 7        | #289 Make run history and completion trustworthy                 | The UI, API and MCP agree on what executed, what happened and whether completion includes outstanding delivery.       |
| 8        | #290 Make authored loops save, connect and publish as intended   | The graph and configuration the owner sees are the ones stored, published and executed.                               |
| 9        | #291 Open the local app without managing services manually       | Opening GraphGoblin reuses or starts the required local services and opens a working UI.                              |

The ordering is a preference, not an all-or-nothing serial chain. Start I01 gate repairs and I05 measurements together; critical history truthfulness accompanies runtime corrections. The full finite test audit does not block every urgent fix.

## Native hierarchy and dispatch

Intents contain UoWs; UoWs contain canonical bolts. Overlapping source reports are closed as duplicates of their canonical bolts; their requirements and evidence remain linked, with one open delivery record for each scope. Native blocked-by relations express the bolt graph. #279 holds publication separate from implementation. Protected Claude issues are referenced only through #280 and #281; their bodies, gates, comments and relations are not changed.

## Owner decision ledger

### Authority and vocabulary

The owner approved the final plan and its priority order in this conversation, then explicitly authorized GitHub publication only. Latest explicit human input supersedes older model proposals, historical issue text and old compatibility assumptions. The hierarchy is intents → UoWs → bolts; campaigns/phases are not additional delivery layers.

### Dispatch hold

Do not start implementation. Every runnable bolt remains parked with no aidlc-ready, human-in-the-loop or approval gate labels. Plan approval is recorded in the body; a later explicit dispatch decision releases the hold. Deferred work stays parked and is not made implementation-ready by this publication.

### Protected work

Leave #38, #97, #98, #118, #152, #164, #165, #166, #168, #169, #171, #173 and newly observed related #341, and PRs #275/#277/#340 unchanged, including closed records. Preserve their native/inverse parent, sub-issue, dependency and duplicate relationships. #280/#281 reference external acceptance without adding inverse links. Do not redirect or message Claude.

### Owner environment

Never restart, reconfigure, write to or start runs on the owner app at ports 4747/4748, its store or checkout. Eventual verification uses a separate instance, alternate port and disposable data. No implementation, reset, provider call or installer execution is part of this publication.

### Accepted delivery

Retain completed #9, #11, #21, #26, #28–31, #99, #158–161 and #170. #9 is completed, not not-planned. Prior evidence and owner acceptance remain distinct; this update does not claim new live smoke tests. #32 is accepted as sufficient at its delivered scope; repository-specific QA loops are owner-led usage/testing with no new product follow-up.

### Current UI

The owner is happy with the current UI. Keep cards minimal. Optional toasts/skeletons are #210; light-mode repair is #211, System theme selection is #172, and mascot work is #10. Broad JSON-editing/Advanced refinements wait for concrete needs; direct model/effort visibility is the explicit exception in #205.

### Decision configuration

Evaluation method is primary at the top of decision configuration and controls field visibility. Classifiers alone expose Choice/Noul/Score answer types; LLM decisions use freeform instructions and structured result validation; expressions use snippets with only relevant options. This is captured outside protected #97/#98/#164, not imposed by editing their active scope.

### Authoring follow-ups

Use one visible effort dropdown and keep model/effort out of Advanced. Connections belong on the canvas for all node kinds after conformance is verified. Undo/Redo stay at fixed positions. Prevent equivalent duplicate loop names including import/copy. Preserve saved geometry; readable default spacing follows more serious bugs.

### Human defect reports

An AI model must reproduce human-reported defects before a corrective implementation; explicitly flag inability to reproduce. Missing reproduction is not disproof. Owner product review is required, especially #125/#221. The decision-output screenshot was captured after reload, when attempted connections appeared.

### Pre-1.0 data

Prefer clean current-format code and explicit operator resets over historical conversions. Preserve current-format durability. Old stores/imports/device drafts refuse clearly; startup never silently wipes data. Existing damaged history may be deleted explicitly or manually repaired; automatic historical preservation/repair is not required. Apply future cleanup after the currently protected cutover/editor boundary.

### Definition lifetime

All executions, including draft runs, retain the original immutable definition through their entire lifetime, waits, resume and restart. Only new executions use subsequent edits. This is settled, not a fresh product question.

### Child composition

Always await child/subloop completion and pass its configured exit output back to the parent, or no output if none is configured. A child exit is not a parent exit. Child failures follow ordinary parent-node failure rules. Future parallel branches must also join/wait, but branching/merging is deferred.

### Shutdown

Stop new independent admission while active parent/child work can finish and queued work stays recoverable. After a configurable several-minute interactive grace, explain active work and offer keep waiting or force. Waiting has no hidden kill timer. Without UI, normal stop waits indefinitely if necessary; explicit force interrupts. Browser tab closure is not shutdown.

### Waits and heartbeats

Durable timers and observed-wait identities prevent lost/cross-visit wakes. Past wall-clock waits become eligible after restart; paused runs stay paused. Heartbeat counts reset on a genuine visit and persist across its beats/retries/restart. The natural competing-wake race remains an investigation, not a proven defect.

### External effects

Use stable child/delivery identities. Do not blindly repeat uncertain non-idempotent scripts; require explicit retry. Eligible outbound-webhook retries are bounded and preserve identity; recipient deduplication is not assumed.

#343 adds durable POC Event intake: require one stable loop ID and unambiguous entry; retain webhook URL targeting; durably save accepted admission and recover it without duplicate runs. Independent targeted requests may execute concurrently within configured capacity. This admission guarantee is not universal exactly-once external effects.

#345 is parked pre-1.0: a configured-but-missing outbound signing secret prevents the request and produces a safe visible delivery failure. Deliberately unsigned delivery remains supported. No repeated attempt while that required configuration remains missing.

### Sessions and limits

- Context modes are fresh/isolated with authored task and selected inputs; current main-loop context supplied deliberately; or an independent conversation owned by this node within this execution. A fresh provider session can still receive selected loop context.
- Persistent memory means previous visits during one execution, not separate executions. Isolate node/run/harness identities, replay forks and children. Outputs enter the main thread only through the normal configured output behavior.
- An explicitly chosen reset-after-N-visits policy is valid. It must be visible and optional, never an imposed hidden ten-visit reset, and must not erase the main-loop context.
- Preserve prompt-delivery provenance: definitely unsubmitted work retains its authored prompt; uncertain accepted work is not blindly resent; a missing provider conversation requires an explicit fresh-session recovery choice.

Loop guardrails are visible, disableable controls for loop execution (iterations/node visits and optional elapsed deadlines). Do not impose cost/token/subscription budgets or substitute provider-turn ceilings. Users may author their own usage-aware script/decision nodes. Quota exhaustion currently fails explicitly; only positively identified transient failures safe to repeat receive bounded retries. Future same-model allowance waiting/resumption is #335.

### Model selections

Explicit provider switches choose a valid configured compatible default or supported ecosystem default when none exists (#204). Model and reasoning effort remain directly visible with one effort control (#205). #206 is the separate high-priority pre-1.0 Sonnet/Haiku bolt, verified against installed capability and actual isolated turns.

#262 is parked post-1.0, including its authoring-validation test changes. Unavailable means user-disabled or removed from GraphGoblin support, not quota/authentication/transient failure. Warn before disabling a referenced model, identify affected loops, and unpublish affected published loops if confirmed. GraphGoblin retirement requires an explicit tested compatible successor and clean upgrade of definitions/settings for new executions. Running definitions/models and historical evidence remain unchanged. Runtime failures never silently substitute a model.

#335 is post-1.0 same-model usage-exhaustion recovery; it replaces the fallback-model candidate. No model-substitution capability is scheduled.

### Sustained execution

Sustained loops are central to the POC. Start #190/#268 measurements early alongside gate reliability; prioritize bounded streaming #186. Measure before targeted optimization; no general RunManager rewrite or invented latency SLA. Critical state/finalization fixes accompany runtime changes rather than waiting behind UI polish.

### History deletion

Only specifically user-confirmed delete-ready history is eligible for automatic cleanup. Age/terminal status is not consent; failed runs need no special rule. Protect active/required retained data. Cleanup is pressure-driven and off by default with ample storage, with a subtle visible warning. Explicit loop deletion must clearly cover any associated history it removes.

### Test quality

Review maintained unit, integration, regression, browser and restart/concurrency evidence through supported component/public methods. Private-method access, reflection, invasive casts and monkey-patching the tested component are errors. Legitimate public dependency injection, fake clocks, malformed external inputs and real storage faults remain valid. Keep coverage protections and truthful denominators; no fake-only claim of native integration success.

### Paid validation

Existing subscriptions may be used for bounded real Codex/Claude validation through installed logins. Jev uses its existing API path. An API key may be discussed only if actually required; do not add direct API adapters solely for tests, export credentials, schedule recurring paid jobs or infer unbounded quota approval.

### Recovery/evidence UI

Resume/Replay eligibility must be truthful. Preserve useful loopback-node capabilities/evidence when decisions replace them (#129); nothing is dropped without an equivalent. Pinned execution metadata, complete paging, raw values and explicit finalization must agree across API/MCP/browser.

### Later priorities

MacOS follows most POC development but precedes final distribution preparation. Installer/setup #34–36/#39 are final pre-1.0 checks. #100 is a high-priority post-1.0 deferral just ahead of #25. Mobile is separately parked. Accessibility follows adoption after 1.0. Light mode is low pre-1.0 priority; mascot follows pressing work; guidance/navigation is mostly near 1.0.

### Installation

Detect existing harnesses and offer normal externally usable installations when missing. The lightweight Windows launcher is early usable product work; a full installer is separate. HTTP MCP is started only when applicable, and stdio remains client-owned.

### Historic proposals

Historical comments remain attributable history, not a second operative specification. The current approved body and this ledger supersede contradictory old caps, silent session fallbacks, compatibility requirements, scheduling and approval statements. Do not edit or erase human comments. Protected active issues remain unchanged and are reconciled only at the explicit external acceptance gate.

## Shared completion standard

- Exercise supported public/component interfaces; do not access private state, use reflection to bypass encapsulation, monkey-patch the component under test or add test-only production exports.
- Use appropriate unit, real storage/process/API integration and browser evidence. Regression tests must demonstrate faulty behavior on the applicable baseline and corrected behavior after the change.
- Human reports require reproduction before a corrective implementation; if unreproduced, preserve the report and evidence and request owner disposition rather than guessing a fix.
- Test relevant positive, negative, cancellation, concurrency and restart cases; a fake or controlled failure fixture is identified as such.
- Keep strict coverage and quality protections; no lowering thresholds, arbitrary exclusions, suppressed assertions, retry-to-green or repeated broad suites without cause.
- Update changed contracts, generated references, relevant behavior docs and ADRs within the bolt. Residual documentation polish can remain later.
- Default proposed delivery routing is GPT-6.1 Sol xhigh implementation, opposite-vendor Claude review and independent QA per repository workflow. No agent is launched by this plan.
- UI bolts require owner product acceptance. Architecture/cutover plans require owner approval. All these gates are proposed metadata, never self-applied plan-approved labels.
- Only isolated workspaces, alternate ports and disposable data may be used. Never operate on owner port 4747 or its store.
- Research/diagnostic bolts can end with an evidence-backed no-change result; conditional corrective bolts require the reproduction or measurement they depend on.

## Engineering parameters

Existing accepted configuration is retained when applicable. Unsettled numeric grace periods, execution defaults, retry/backoff values, storage-pressure thresholds and performance budgets are engineering parameters to document and justify in their owning bolt; no invented number is represented as owner-approved.

## Integrated acceptance

- **Restart and shutdown with nested work:** Active parent/child work drains normally, explicit force yields truthful recoverable state, no stale wake crosses a visit and no child or uncertain script is silently duplicated. Dependencies: #318, #247, #272, #226, #224, #242, #251, #320, #321.
- **Sustained observable execution:** The measured long-running workload remains observable and controllable with pinned definitions and intended session/limit behavior; resource/latency evidence includes the tested workload and remaining limits. Dependencies: #190, #186, #259, #268, #243, #33, #116, #185.
- **User-approved retention:** Only explicitly approved history is cleaned under simulated pressure; active/required references and paging remain consistent after interruption. Dependencies: #187, #322, #231.
- **Authoring to execution:** An owner-reviewed graph saves/publishes the intended version, preserves connections/inputs and runs with the selected available provider; later edits affect only new executions. Dependencies: #247, #204, #205, #206, #64, #125, #221, #237, #207, #209, #273, #235.
- **Current-format fresh start:** Current examples work from a clean store, valid current data reopens, old formats refuse clearly and explicit reset has precisely bounded scope. Dependencies: #223, #318, #230, #234, #266, #188, #250.

## Later intents — all parked

- #326 **Support macOS:** After most POC development, before final 1.0 distribution checks.
- #327 **Install and configure a release:** Final pre-1.0 readiness; manual prerequisites suffice for the POC.
- #328 **Make release guidance and settings discoverable:** Mostly pre-1.0; earlier only for a concrete blocking need.
- #329 **Finish light theme and theme selection:** Low priority before 1.0.
- #330 **Extend model-provider choices:** High-priority deferred work beyond 1.0.
- #331 **Support mobile interaction:** Deferred; no new release commitment.
- #332 **Expand accessibility:** After 1.0 if adoption warrants it.
- #333 **Develop the mascot and icon set:** Behind pressing product reliability work; no newly assigned release date.
- #334 **Consider optional UI feedback:** Parked; no broad polish commitment.
- #335 **Resume after provider usage exhaustion:** Post-1.0 same-model waiting/resumption; no fallback-model implementation is scheduled.
- #262 **Disabled/retired-model lifecycle:** Post-1.0; retained under U16 for ownership but excluded from current intent completion.
- #344 **Plugin-builder output guard:** Parked final pre-1.0 under #327.
- #345 **Missing configured signing secret:** Parked pre-1.0 under #184, linked to #246; not a POC blocker.

## Longer-term candidates, not approved implementation

- Per-loop concurrent-run policy: Historical draft idea; no approved new intent or matched dedicated open issue.
- Parallel branches and joins: Deferred; the owner requires waiting for actually started branches, but has not approved implementing fan-out/fan-in.
- Hosted or multi-user execution: Historical draft idea; not a 1.0 or current POC commitment.
- Context summarization or compaction: Historical draft idea; not refined or approved.
- Provider-specific trigger presets: Historical draft idea; do not duplicate Claude's generic trigger redesign.
- Error/debug nodes: Conditional historical idea; not approved and must not replace agreed ordinary failure handling.

The live vision document still calls implemented Claude support future work and contradicts current retention/reset decisions. Its remaining ideas are candidates to reconcile under #254, not automatically approved backlog work. Repository-specific AIDLC loops remain owner-led usage/testing per prior decision, not a newly mandated product intent.

## Canonical bolt map

| Intent / UoW | Bolt                                                                              | Source requirements                    |
| ------------ | --------------------------------------------------------------------------------- | -------------------------------------- |
| #283 / #292  | #263 B01: Align the verified development runtime                                  | #263                                   |
| #283 / #292  | #127 B02: Invalidate checks after dependency changes                              | #127                                   |
| #283 / #292  | #67 B03: Remove the two-tab test race                                             | #67                                    |
| #283 / #292  | #241 B04: Restore mandatory functional browser gates                              | #241                                   |
| #283 / #293  | #316 B05: Produce a finite test-quality inventory                                 | #241, #264                             |
| #283 / #293  | #317 B06: Replace invasive tests at supported boundaries                          | #241, #264                             |
| #283 / #293  | #264 B07: Close critical coverage and assertion gaps                              | #241, #264                             |
| #283 / #294  | #274 B08: Parse grouped license expressions correctly                             | #274                                   |
| #283 / #294  | #114 B09: Resolve the current development dependency finding                      | #114                                   |
| #283 / #294  | #250 B10: Make shipped examples executable                                        | #250                                   |
| #284 / #295  | #223 B11: Validate generated durable events                                       | #223                                   |
| #284 / #295  | #318 B12: Recover healthy runs beside damaged history                             | #223                                   |
| #284 / #296  | #230 B13: Preserve null separately from absence                                   | #230                                   |
| #284 / #296  | #234 B14: Publish complete artifacts atomically                                   | #234                                   |
| #284 / #297  | #266 B15: Define and implement current-format initialization and reset            | #188, #266                             |
| #284 / #297  | #188 B16: Remove obsolete conversion paths and fixtures                           | #188, #266                             |
| #285 / #298  | #247 B17: Pin every execution definition                                          | #247                                   |
| #285 / #298  | #272 B18: Bind answers to observed waits                                          | #272                                   |
| #285 / #298  | #226 B19: Close the timer parking window                                          | #226                                   |
| #285 / #298  | #257 B20: Scope heartbeat counters to a logical visit                             | #257                                   |
| #285 / #298  | #225 B21: Resolve the competing-wake hypothesis                                   | #225                                   |
| #285 / #299  | #224 B22: Implement normal drain and explicit force-stop                          | #224                                   |
| #285 / #299  | #319 B23: Expose the interactive shutdown choice                                  | #224                                   |
| #285 / #299  | #233 B24: Honor client wait cancellation and deadlines                            | #233                                   |
| #285 / #300  | #227 B25: Check every mutated patch location                                      | #227                                   |
| #285 / #300  | #140 B26: Investigate surviving poll starvation                                   | #140                                   |
| #286 / #248  | #242 B27: Enforce awaited parent-child execution                                  | #242, #248                             |
| #286 / #248  | #251 B28: Apply ordinary failure and recovery semantics                           | #248, #251                             |
| #286 / #184  | #320 B29: Make child creation recovery idempotent                                 | #184                                   |
| #286 / #184  | #321 B30: Expose uncertain script outcomes                                        | #184                                   |
| #286 / #184  | #246 B31: Bound webhook retry and final outcomes                                  | #184, #246                             |
| #286 / #184  | #232 B32: Decode script streams incrementally                                     | #232                                   |
| #286 / #301  | #256 B33: Show eligibility-aware Resume and Replay                                | #256                                   |
| #287 / #302  | #190 B34: Establish repeatable long-run and large-context measurements            | #190, #268                             |
| #287 / #303  | #186 B35: Bound streaming replay and slow-consumer buffering                      | #186                                   |
| #287 / #303  | #117 B36: Bound probe bodies before parsing                                       | #117                                   |
| #287 / #303  | #259 B37: Bound large-value rendering                                             | #259                                   |
| #287 / #303  | #268 B38: Correct measured engine/API hot paths                                   | #190, #268                             |
| #287 / #304  | #187 B39: Record explicit deletion eligibility                                    | #187                                   |
| #287 / #304  | #322 B40: Apply pressure-driven bounded cleanup                                   | #187                                   |
| #288 / #305  | #179 B41: Make capability/readiness checks precise                                | #179                                   |
| #288 / #305  | #204 B42: Choose compatible models on explicit harness changes                    | #204                                   |
| #288 / #305  | #205 B43: Expose model and effort directly                                        | #205                                   |
| #288 / #305  | #262 B44: Manage disabled/retired models — deferred post-1.0                      | #262, #271                             |
| #288 / #306  | #243 B45: Apply visible defaults and genuine unlimited mode                       | #243                                   |
| #288 / #306  | #270 B46: Enforce structured-completion deadlines                                 | #270                                   |
| #288 / #307  | #244 B47: Preserve authored prompts until confirmed submission                    | #244                                   |
| #288 / #307  | #33 B48: Add per-node own-session continuity                                      | #33                                    |
| #288 / #307  | #265 B49: Recover explicitly from missing sessions                                | #265                                   |
| #288 / #307  | #102 B50: Diagnose Windows command-launch failure                                 | #102                                   |
| #289 / #308  | #116 B51: Reconcile snapshot and event tails                                      | #116, #183, #239                       |
| #289 / #308  | #245 B52: Seed replay from the actual initial thread                              | #245                                   |
| #289 / #308  | #236 B53: Show truthful latest-run summaries                                      | #236                                   |
| #289 / #309  | #185 B54: Separate execution outcome from delivery completion                     | #185, #249                             |
| #289 / #310  | #231 B55: Carry opaque cursors and validate history filters                       | #231, #238, #252                       |
| #289 / #310  | #240 B56: Expose manual Events refresh                                            | #240                                   |
| #289 / #310  | #255 B57: Show exact values and execution context                                 | #121, #123, #128, #255                 |
| #289 / #310  | #129 B58: Preserve completion evidence after exit redesign                        | #129, #258                             |
| #290 / #311  | #64 B59: Reproduce and correct union-field state                                  | #64                                    |
| #290 / #311  | #323 B60: Reproduce saved geometry and output-connection reports                  | #125, #221                             |
| #290 / #311  | #125 B61: Preserve demonstrated saved geometry                                    | #125                                   |
| #290 / #311  | #221 B62: Make displayed decision ports consistently connectable                  | #221                                   |
| #290 / #311  | #237 B63: Reconcile saves and publish confirmations                               | #156, #237                             |
| #290 / #312  | #207 B64: Make canvas the connection-editing surface                              | #207                                   |
| #290 / #312  | #209 B65: Prevent duplicate loop names                                            | #209                                   |
| #290 / #312  | #273 B66: Repair understood node-ID references                                    | #273                                   |
| #290 / #313  | #208 B67: Keep Undo/Redo stationary and improve default spacing                   | #124, #208                             |
| #290 / #313  | #228 B68: Track real expression nesting                                           | #228                                   |
| #290 / #313  | #229 B69: Scope JSON Schema compilation correctly                                 | #229                                   |
| #290 / #313  | #235 B70: Preserve explicit empty input                                           | #235                                   |
| #291 / #314  | #276 B71: Launch or reuse one healthy gateway                                     | #276                                   |
| #291 / #314  | #324 B72: Manage only applicable persistent MCP services                          | #276                                   |
| #291 / #315  | #325 B73: Verify launch, browser closure and deliberate stop                      | #276                                   |
| #286 / #184  | #343 B74: Admit targeted Events durably                                           | Owner-approved Event delivery decision |
| #288 / #305  | #206 B75: Add current supported Sonnet and Haiku — high-priority pre-1.0          | #206                                   |
| #327         | #344 B76: Guard plugin-builder output — parked pre-1.0                            | Review candidate G3                    |
| #286 / #184  | #345 B77: Refuse delivery with missing configured signing secret — parked pre-1.0 | Host policy observation H1             |

## Status and evidence limits

Plan publication is complete only after hierarchy, dependencies, parked labels and protected-issue read-back are verified. The completed Fable review and host counterchecks supplied static evidence; provider reports remain verbatim. This publication claims no implementation, new live test, provider run or owner product acceptance. No goal/campaign/phase layer is introduced.

## Complete issue disposition after roadmap cleanup

The owner authorized this structural cleanup after identifying reports outside the native hierarchy. Refinement decisions and implementation hold are unchanged. Every snapshotted open issue is either inside this roadmap or explicitly listed below as protected external work; newly observed related #341 is protected and remains outside the tree. Closed duplicate reports preserve provenance and do not imply delivery.

### Canonical delivery and deferred work

The nine delivery intents and their order, 26 UoWs and ten existing deferred intent groups are retained. B01–B77 are canonical tracking identifiers after this revision: B44 is post-1.0, B76/B77 are parked pre-1.0 safeguards, and the other 74 bolts are approved-held. #206 is reopened as B75, no longer a duplicate of #204. Deferred children are excluded from current POC intent completion. The dispatch hold is #279. No pickup labels are applied.

### Consolidated reports: one open delivery record

| Consolidated report                                                                        | Canonical bolt |
| ------------------------------------------------------------------------------------------ | -------------- |
| #121 — Run inspector: show values added by array-append patches                            | #255           |
| #123 — Run inspector: readable route labels and probability formatting                     | #255           |
| #124 — Editor: readable default node spacing when a loop loads                             | #208           |
| #128 — Exit evidence: distinguish cancellation and use accurate provider diagnostics       | #255           |
| #156 — Loop list can retain stale name and description after a saved draft edit            | #237           |
| #183 — Engine: current-thread reads omit the last node start after an expression failure   | #116           |
| #238 — History pages: expose paging for Runs and Events beyond the first page              | #231           |
| #239 — Run history: show every resumed attempt after an earlier terminal event             | #116           |
| #249 — API client: settle event subscriptions when the terminal cursor is already consumed | #185           |
| #252 — Runs API: validate status filters before querying                                   | #231           |
| #258 — Exit authoring: make suppressed return destinations understandable                  | #129           |
| #271 — Model defaults: define repair behavior when catalog capabilities narrow             | #262           |

Each report above is closed with GitHub's duplicate reason and native duplicate target. The target bolt retains the agreed scope, evidence requirements, priority and owner acceptance. No requirement is dropped or declared implemented.

### Retirement checks remain open and parked

#131, #132, #133, #134, #136, #138, #139, #141, #142, #143, #144, #145, #146, #148, #149, #153. These are native children of #280. They require individual removal/survival evidence after baseline acceptance; they are not assumed obsolete and are not assigned to Claude.

### Protected external work — deliberately unchanged

#38, #97, #98, #118, #152, #164, #165, #166, #168, #169, #171, #173, #341. Their issue bodies, labels, states, comments, parents and dependency relationships are outside this cleanup. Coordination is through #280/#281; #173 remains Claude's debt epic. A reference here never authorizes taking over those issues.

### Superseded planning indexes

#3, #5, #222 are closed as duplicate planning indexes of this roadmap; their finding maps and historical references remain accessible. Previously closed #1/#2/#4 are left as found. These administrative closures are not product-completion claims.

## Approved consolidated review revision

The owner explicitly approved this consolidated change set on 2026-10-18 for GitHub publication only. Preserve all prior human decisions except where replaced by the latest explicit decisions above. The nine-intent order is unchanged; ordinary engineering acceptance refinements do not create new product approval questions.

- Tighten I01 public-interface test quality, real integration evidence, cache/browser gates and coverage protections.
- Tighten I02 bounded valid failure persistence, healthy-run isolation, explicit repair/reset and converter retirement boundaries.
- Tighten I03 pinned definitions, visit-bound waits/timers and usable controls throughout managed shutdown.
- Tighten I04 awaited-child failure/recovery and uncertain-effects semantics; add durable targeted Event intake #343.
- Measure sustained work early in I05, preserve lossless history access and bound incidental memory. Cleanup requires selected eligibility plus ownership/reference checks.
- In I06, restore standalone high-priority #206, defer #262, reframe #335, separate loop guardrails from usage, and preserve the three context modes with optional explicit reset within one execution.
- Reconcile I07 history/finalization and remaining paging consumers; retain I08 focused reproduction-first authoring fixes and I09 disposable native lifecycle evidence.
- Park #344 and #345 before 1.0 with their explicit acceptance criteria; neither blocks immediate POC work.

Existing closed acceptances and other deferrals retain their dispositions. Update current canonical bodies and relationship metadata, preserve historical comments, and do not reopen duplicate tracking except the explicitly restored #206. No pickup labels, implementation, PR changes, protected issue changes or owner-environment actions are authorized.

## Comments (0)
