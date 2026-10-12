# Issue #167: exit loop-back versus decision-driven completion

## Summary and recommendation

**Keep the engine-managed loop-back semantics for now. Do not replace them with ordinary decision edges as a cleanup-only change. Confidence: high.** The runs show that loop-back owns useful behavior beyond choosing a route: a logical iteration counter, exhausted completion with returns, ordered limit precedence, and a durable completion-plus-increment boundary. Today's ordinary edges route and recover correctly, but do not reproduce all of those semantics.

The owner's “should we stop?” question fits a decision. The strongest future option is to separate that policy from the continuation mechanism: decisions choose success, failure, exhaustion or continuation; terminal exits return declared outcomes; an explicit continuation edge or small continuation node owns iteration and its budget. This could remove much of the exit panel while preserving meaningful execution behavior. It is a proposal, not an implemented or usability-tested design.

A plain decision cycle is already useful for local repetition with an authored counter and failure on a guard. It is not currently a drop-in substitute for exit loop-back.

Evidence: **40/40 scratch Vitest checks passed**, using production RunManager and production handlers over `@graphgoblin/engine/testing` fakes for every port. Every stored example/variant passed LoopDefinitionSchema and validateLoop with zero issues. Emitted events and final run records were schema-validated. Package test/source typechecking passed. This is engine evidence, not browser, SQLite, real-provider or real-network evidence.

Research head: `c379f806ba8a04433779d98ded7e4196c9d4b663`, branch `codex-research-167`. No tracked product files were changed; no commit, server or live-instance operation was performed.

## The two example loops

The stored definitions are `issue-167-loop-a.json` and `issue-167-loop-b.json` at the worktree root. The scratch test parses them and stores published LoopVersionRecord objects in the fake repository. Each observation contains the exact parsed definition of any variant.

Both begin at iteration 1 and use `settings.maxIterations: 4`. Input is `{k, failAt}`: done after K completed work passes; explicit failure after failAt passes. Both have the same deterministic context-mutation work step, without any script subprocess:

~~~json
{
  "operations": [
    {
      "op": "set", "path": "/vars/count",
      "value": {"kind": "expression",
        "jsonata": "($exists(vars.count) ? vars.count : 0) + 1"}
    },
    {
      "op": "set", "path": "/vars/done",
      "value": {"kind": "expression", "jsonata": "vars.count >= trigger.payload.k"}
    },
    {
      "op": "set", "path": "/vars/fail",
      "value": {"kind": "expression", "jsonata": "vars.count >= trigger.payload.failAt"}
    }
  ]
}
~~~

Operations run in order against the updated thread. A committed patch increments count once. An interrupted computation whose patch never completed is recomputed from the persisted thread.

**A — exit loop-back (3 nodes, 3 edges)**

~~~text
start --out--> work --out--> exit
                ^           |
                +--loopBack-+
~~~

Key exit config, in evaluation order:

~~~json
{
  "criteria": [
    {
      "when": "predicate", "answer": {"type": "noul"},
      "evaluation": {"kind": "expression", "jsonata": "vars.done"},
      "match": {"type": "noul", "value": true}, "outcome": "success"
    },
    {
      "when": "predicate", "answer": {"type": "noul"},
      "evaluation": {"kind": "expression", "jsonata": "vars.fail"},
      "match": {"type": "noul", "value": true}, "outcome": "failure"
    },
    {"when": "max-duration", "seconds": 5}
  ],
  "default": "loop-back",
  "loopBack": {"targetNodeId": "work"}
}
~~~

The implicit ceiling is 4 iterations and applies after no criterion matched. The loopBack graph edge also targets work; target config and edge must agree. The five-second criterion uses FakeClock and is inactive when that clock does not advance.

**B — decision with ordinary back edge (5 nodes, 5 edges)**

~~~text
start --> work --> decide --success--> success-exit
            ^       |
            |       +------failure--> failure-exit
            +-------continue
~~~

Today's expression route enum is represented through a Choice declaration:

~~~json
{
  "answer": {
    "type": "choice",
    "options": [
      {"id": "success", "label": "Success", "criteria": "Work is done"},
      {"id": "failure", "label": "Failure or limit",
       "criteria": "Explicit failure or continuation ceiling"},
      {"id": "continue", "label": "Continue",
       "criteria": "More work remains within ceiling"}
    ]
  },
  "evaluation": {
    "kind": "expression",
    "jsonata": "vars.done ? \"success\" : (vars.fail or vars.count >= 4) ? \"failure\" : \"continue\""
  }
}
~~~

Success-exit defaults to success. Failure-exit needs an always-true expression predicate with outcome failure: today there is no simple terminal outcome field. Moving routing to decisions alone therefore does not make today's exits simple success/failure terminals.

B expresses the same four-completed-pass ceiling in its decision, before another back edge, in addition to the engine's four-fresh-visits safety cap. It uses vars.count because run.iteration never advances on ordinary edges. The value 4 is duplicated: loop settings are not exposed in expression input.

**Supplement B4:** a fourth exhausted route reaches an extra exit with `criteria: [{when: "max-iterations", value: 1}]`. It really finishes exhausted and delivers returns today. This workaround reports “iteration limit of 1,” although four work passes occurred.

**Shared return config**, copied to each terminal exit:

~~~json
{
  "mapping": "{\"count\": vars.count, \"done\": vars.done, \"fail\": vars.fail, \"iteration\": run.iteration, \"workStarts\": counters.nodeVisits.work}",
  "channels": [
    {"kind": "caller"},
    {"kind": "log"},
    {"kind": "event", "eventType": "research-result"},
    {"kind": "file", "path": "result.json", "format": "json"},
    {"kind": "webhook", "url": "https://example.test/research-result"}
  ]
}
~~~

Delivery effects are captured by fake ports. The URL is never contacted; fake workspace paths are memory keys, not actual filesystem writes.

## Scenario results

Notation: status/outcome; i=run iteration; c=committed work count. Normally, work fresh visits and work starts equal c, every work attempt is 1, A visits its exit c times, and B visits its decision c times and its chosen terminal exit once. The trigger has one visit/attempt throughout. “No outcome” means a run.failed engine error rather than run.finished authored termination.

Unless stated otherwise, success, explicit failure and exhaustion each produced five return.delivered events. Full per-scenario counters, attempts, events and captured delivery effects are in `issue-167-observations.json`.

| Scenario | A observed | B observed | Difference |
| --- | --- | --- | --- |
| First-pass success, K=1 | succeeded/success; i=1, c=1 | succeeded/success; i=1, c=1 | Same terminal behavior. 15/18 total events (A/B). |
| Several continuations, K=3 | succeeded/success; i=3, c=3; 2 increments | succeeded/success; i=1, c=3; 0 increments | Same work, different iteration/context/result. 27/28 events. |
| Repetition, K=99, ceiling 4 | exhausted/exhausted; i=4, c=4 | failed/failure; i=1, c=4 | B's explicit guard reaches its failure exit, with returns; not MAX_ITERATIONS. 33/33 events. |
| B guard removed | A exhausts as above, with returns | failed/no outcome; i=1, c=4; MAX_ITERATIONS at work, nonresumable | Before fifth work start; four decision continuations; no exit or returns. B: 25 events. |
| B ceiling uses run.iteration >= 4 | A exhausts as above | Same MAX_ITERATIONS result | B never sees iteration 4. |
| B4 fourth exhausted route | A exhausted at i=4 | exhausted/exhausted; i=1, c=4; 5 deliveries | Outcome achievable; iteration and limit explanation differ. B4: 33 events. |
| Explicit failure, K=99, failAt=2 | failed/failure; i=2, c=2 | failed/failure; i=1, c=2 | Authored failure, no run.failure object, returns delivered. 21/23 events. |
| Success at ceiling, K=4 | succeeded/success; i=4, c=4 | succeeded/success; i=1, c=4 | Success wins before the limit. 33/33 events. |
| Simultaneous done/fail, K=2, failAt=2 | succeeded/success; i=2, c=2 | succeeded/success; i=1, c=2 | Authored priority preserved; A records skipped criteria, B just success. 21/23 events. |
| Duration 5s; clock +3s per work; K=3 | exhausted/exhausted after pass 2; i=2; elapsed 6s | Guarded run.elapsedMs variant sees absent field; succeeds after pass 3; i=1 | Authoritative elapsed duration unavailable in expressions. Valid B definition, ineffective duration guard. 21/28 events. |
| B $millis() minus trigger.receivedAt duration; clocks aligned | A duration result above | failed/failure after pass 2; i=1, c=2 | JSONata time functions work; approximation routes to failure, not exhausted. |
| Queue delay 6s, no work delay, K=2 | succeeded/success; i=2, c=2 | Receipt-time variant fails/failure after pass 1; i=1 | A excludes queue delay; approximation includes it. 21/18 events. |
| Restart after durable first continuation, before cursor/checkpoint update; K=3 | succeeded/success; i=3, c=3; 2 increments total | succeeded/success; i=1, c=3; 0 increments | Both follow durable completion without repeating it. Work visits 3, attempts [1,1,1]. 28/29 events. |
| Restart during second work computation, before patch commit; K=3 | succeeded/success; i=3, c=3 | succeeded/success; i=1, c=3 | Both visits 3, starts 4, attempts [1,1,2,1]; three committed increments. 29/30 events. |
| Same retry; success sought at pass 4 | succeeds; i=4, c=4; visits 4, starts 5; attempts [1,1,2,1,1] | nodeVisits >= 4 guard fails/failure at c=3, i=1; visits 3, starts 4 | nodeVisits includes attempts; not equivalent to fresh visits or logical iterations. 35/30 events. |
| Evaluation evidence durable, crash before completion | succeeds; i=3; exit visits 3, starts 4, attempts [1,2,1,1]; 4 exit.evaluated | succeeds; i=1; decision visits 3, starts 4, attempts [1,2,1,1]; 4 decision.made | Evidence repeats, committed continuation does not. 30/31 events. |
| Restart after atomic terminal append, before terminal status/save | succeeded/success; i=3, c=3; 1 run.finished | succeeded/success; i=1, c=3; 1 run.finished | Completes status/delivery without terminal exit re-evaluation. 27/28 events. |
| Persist paused after first continuation, rebuild, explicitly resume | Remains paused on restart, then succeeds; i=3, c=3 | Remains paused, then succeeds; i=1, c=3 | Preserves operator intent; 1 paused/1 resumed event, no extra work attempt. 29/30 events. |
| Restart after webhook effect, before acknowledgment | succeeds; i=3, c=3; 2 webhook effects, 5 delivery acknowledgments | succeeds; i=1, c=3; same delivery counts | At least once in both; four earlier acknowledged channels not repeated. |
| Webhook fails; defaults add duplicate caller/log and extra event | succeeds; i=1, c=1; 5 delivered, 1 failed | Same terminal/counter/delivery result | Failure does not change outcome; duplicates deduped, extra event merged. 16/19 events. |
| Return lastOutput.value, K=1 | Returns trigger payload {k:1, failAt:999} | Returns decision answer/port/provenance | Mutation preserves lastOutput; decision overwrites it. 15/18 events. |
| Expression throws on pass 4 | failed/no outcome; i=4, c=4; EVALUATION_EXPRESSION_FAILED, nonresumable | failed/no outcome; i=1, c=4; same code/resumability | Not exhaustion; A records error/skipped remainder, B no fourth choice. No returns. 27/23 events. |


## Semantic differences

### Iteration versus visits/attempts

A logical iteration starts at 1 and advances once per committed exit loop-back. B's ordinary cycle leaves it at 1 regardless of work passes. This affects expressions, templates, mappings, history, inspector metadata and downstream consumers.

Three separate counts exist:

- `countEntries(events, nodeId)`: fresh node.started entries with attempt 1. The per-node safety cap uses this.
- `counters.nodeVisits[nodeId]`: every node.started, including higher attempts. Its name can mislead authors building a ceiling.
- `attemptFor(events, nodeId)`: starts since that node's previous completion, plus one. Recovery/wake/retry in an unfinished visit increases attempt; a completed ordinary cycle starts the next visit at attempt 1.

The interrupted-work run has 3 committed passes, 3 fresh work visits, 4 work starts and attempts [1,1,2,1]. A allows four logical passes even when starts reach 5. A B ceiling based on nodeVisits stops early after that retry. A committed-pass variable avoids this specific problem, but migrated graphs must reliably maintain it.

A is not a universal cycle detector: a cycle inside the work graph can hit MAX_ITERATIONS before reaching an exit. Only the continuation primitive advances iteration. Do not reinterpret every backward-looking canvas edge as a logical iteration.

### Exhaustion versus failure

run.finished carries success/failure/exhausted and runs configured returns. An authored failure exit has status failed and outcome failure, without a resumable run.failure object. The safety cap produces run.failed, code MAX_ITERATIONS, no outcome/result delivery, and resumable false. These are different APIs and histories.

A decision has routes rather than a terminal outcome. Today's exit has no simple outcome failure/exhausted setting. B4 shows exhaustion is possible with a limit criterion: “decisions can never express exhaustion” would be incorrect. Its limit evidence is misleading for the real budget. The clean three-route B merges continuation limit and explicit failure.

Ordering matters. A checks authored predicates before the implicit ceiling: final-pass success wins and a final-pass evaluation error still fails. Explicit duration/iteration criteria act at their authored positions and can precede later predicates. B can encode priority, but conversion must preserve order rather than prepend a ceiling unconditionally.

### Elapsed-duration availability

The exit uses max(0, ClockPort.now minus run.startedAt), falling back to run.createdAt if startedAt is absent. It is wall-clock duration from execution start, checked when the exit is reached; it does not interrupt long work and does not subtract parked, paused or restart time.

Expressions receive the thread plus shortcuts. thread.run has identifiers and iteration, not startedAt, elapsedMs or loop settings. The guarded run.elapsedMs test observed no duration match; A terminated at elapsed 6s while B completed normally.

JSONata $millis()/$now() use JavaScript Date, not ClockPort. trigger.receivedAt is exposed. Combining them implements a receipt-time deadline. We aligned Date and FakeClock to test it, then demonstrated its queue-delay difference. A first-work timestamp variable is another possible workaround, but changes the origin and needs explicit clock/recovery semantics. Exact run-start duration needs engine-owned evaluation metadata for parity.

### Ordered criterion evidence versus chosen-route evidence

A completed work pass records work start/completion, exit start/evaluation, then either an atomic exit completion + iteration.incremented pair or an atomic exit completion + run.finished pair. Returns follow terminal completion.

B records the same work events, decision start, decision.made and decision completion with its selected route. Continuation follows an ordinary edge. Termination adds a separate exit's start/evaluation/completion and run.finished. Every expression decision has a strict declared string ID, null confidence/probabilities, expression provenance with null provider fields, and empty diagnostics.

A's three-pass success evidence:

| Pass | Success / failure / duration statuses | Result |
| --- | --- | --- |
| 1 | not-matched / not-matched / not-matched | looped-back; no-criterion-matched; target work |
| 2 | not-matched / not-matched / not-matched | looped-back; same target |
| 3 | matched / skipped / skipped | completed; criterionIndex 0; success |

Explicit failure ends with not-matched/matched/skipped and criterionIndex 1. Duration ends with not-matched/not-matched/matched and limit-reached/max-duration/value 5/criterionIndex 2. Implicit exhaustion has three nonmatches and limit-reached/iteration-ceiling/value 4, without a matched criterion. The error case records an error entry plus skipped later criteria.

B choices are continue/continue/success. Events do not include unchosen/short-circuited branch evaluations or which disjunct made the compound failure branch true. Explanation needs the pinned expression and reconstructed thread. The final always-true failure-exit predicate proves terminal selection rather than its preceding cause.

All tested raw expression answers were accepted; **confidence rejection was not exercised**. From source, an exit classifier answer below minimum confidence is retained as raw answer plus acceptance/rejection evidence, treated as nonmatch, and followed by later criteria. A decision classifier rejection instead fails with EVALUATION_RESULT_REJECTED and emits no route. Exit-only LLM reported-confidence matching gates also lack a corresponding decision gate. Valid false expressions, rejected confidence and skipped criteria are different facts.

One JSONata decision preserves authored priority but not automatically each branch's evidence. A chain of separate decisions exposes more choices, with more nodes/events; confidence-gate nonmatch behavior still needs a decision. Under #164's target, expression/LLM route evaluation should declare routes and return their IDs, while classifier answer primitives remain specific to classifiers. Evidence should reflect that distinction rather than fabricate primitive answers.

### Resume and recovery: atomic completion and increment

Restart tests freeze execution at a known asynchronous boundary, persist run/version/initial thread/events to a temporary JSON file, reload into fresh fake repositories without a snapshot and create a new RunManager. Finally removes the temporary file. The abandoned executor does not share the rebuilt repositories.

At A's first continuation cut, the stored run still points to exit at iteration 1, but durable completion/increment establish iteration 2 and target work. Recovery catches up; final iteration 3 has exactly two increments. B's durable decision completion similarly advances over its recorded ordinary route without re-running that completed decision.

During work, the production mutation handler had computed but not committed its second patch. Both recover at attempt 2 from the persisted thread, producing one committed increment. This is safe for this mutation, not an exactly-once guarantee for external script side effects.

exit.evaluated and decision.made precede completion and are not atomic with it. A crash immediately after evidence causes evaluation at attempt 2: four evidence events for three completed evaluation visits. Both models need explanations that distinguish evaluation attempts from committed routing. A still has only two committed iteration increments.

Both terminal exits append node.finished + run.finished atomically. Recovery completes status/returns without terminal exit re-evaluation. The five primary restart modes were rebuilt twice to check that committed completions/increments and acknowledged returns were not duplicated. Paused runs remained paused until explicit resume.

An observed read limitation: after expression failure, public getThread serves its last snapshot, whose failed-node start count trails event replay by one (A exit 3 versus replay 4; B decide 3 versus replay 4). The artifact records both readThread and authoritative replay thread; characterization tests assert this difference. Execution recovery uses the log. The inspector's event projection can reconstruct it, but the orchestrator should check whether current-thread reads need a separate follow-up. No fix is delivered.

### Return delivery

The same shared return path handles success, explicit failure and A/B4 exhaustion. All five channels produced delivery evidence. Identical vars-based mappings preserve completed work; iteration and workStarts reveal other semantic differences.

A decision patches lastOutput and outputs[decisionId]; exit evaluation does not. Returning lastOutput.value changed from the work stream's prior output to the routing result. Migration must retain/rewrite lastOutput/work-output references rather than only reconnect edges.

Both designs merge invocation defaults and deduplicate identical channels. Delivery failure records return.failed without changing terminal outcome. Recovery skips acknowledged successful or failed channels. If a channel effect occurs before acknowledgment, it repeats: the webhook test observed two effects with one acknowledgment. Exit simplification does not remove at-least-once delivery.

Child/subloop returns, real file writes, actual HTTP responses and downstream event-trigger admission were not exercised.

### Inspector explanations

These are supported by source inspection of RunInspectorPage, EvaluationDetails and projections. No browser/server was started.

| Question | A evidence | B evidence |
| --- | --- | --- |
| Why continue? | Criterion nonmatches, looped-back target, iteration increments. | continue route/provenance; pinned expression and thread supply reason. |
| Why success/failure? | Matching answer/index, earlier nonmatches, later skips. | Chosen route plus terminal exit. Compound failure does not identify its cause. |
| Why a limit? | Loop ceiling 4 or duration 5s, exhausted status/result. | Base B failure choice; unguarded B MAX_ITERATIONS; B4 misleading-for-budget iteration limit 1. |
| Passes/retries? | Advancing header iteration, timeline attempts/increments. | Header stays iteration 1; custom vars or event counts needed. |
| What repeated on restart? | Higher attempts/repeated evaluation, unchanged committed increments. | Higher attempts/repeated choices, unchanged completed routing. |
| Returned/delivered? | Result and per-channel events. | Same if an exit is reached; none for MAX_ITERATIONS. |

The inspector can render primitive confidence-gate rejection from existing typed evidence; this is source-based, not tested provider/UI behavior.

## What must change to make B equivalent

Parity means preserving outcomes, iteration, output references, ordered behavior, timing/limit origin, recovery, returns and truthful evidence.

| Layer | Work needed for parity | Accepted-change alternative |
| --- | --- | --- |
| Engine | Explicit continuation identity/budget; atomic completion/increment; recover target/counter from events. Preserve evaluation-before-ceiling. Expose authoritative timing/budget metadata. Keep fresh-visit safety separate. | Adopt custom counters/visits, with changed iteration/history/templates/results and deadline origin. |
| Contracts | Terminal outcome success/failure/exhausted plus returns; explicit continuation edge/node and exhaustion behavior; #164 expression/LLM route enums, classifier-specific primitives. Define immutable evaluation metadata and any thread format change. | Keep always-true failure and B4 limit workaround, accepting clutter and misleading limit evidence. |
| Validation | Validate marked continuation targets/routes/budget ownership and scope; define or reject ambiguous overlapping/nested boundaries. Retain reachability, ordinary-cycle safety, expression compilation and runtime route-ID validation. | Rely on MAX_ITERATIONS failures; exhaustion and returns then require authored coverage of every path. |
| Events/replay | Durable continuation/increment association; truthful count/threshold/duration-origin evidence; preserve ordered skip/rejection facts if required. Separate route evaluation from classifier answers for format 4. Keep old history factual. | Accept chosen-route-only explanations; never invent unexecuted branch evidence during conversion. |
| Editor | Decision routes, terminal outcome selection, distinct continuation edges/nodes, coherent budget editing, shared return config or deliberate per-exit overrides. Update connection/delete/undo, canvas styling, validation focus and inspector. | Raw counters and copied return blocks work, but total authoring simplicity remains unproved. |

Today's graph validator accepts B: port connectivity, reachability, syntax and loop-back consistency pass. It does not require every cycle to traverse an exit. Admission is not the missing feature; execution/evidence meanings and a clean terminal contract are.

Two shortcuts are unsafe equivalence claims: interpreting every backward canvas edge as an iteration depends on layout and breaks arbitrary cycles; turning every MAX_ITERATIONS error into exhausted changes unrelated cycle failures and still does not choose return mapping/channels. Mark the intended repetition boundary explicitly.

Provider-policy parity needs a separate decision. Confidence rejection nonmatch becomes ordinary decision failure unless preserved. Exit provider state is fixed {trigger, vars, lastOutput, lastMessage, iteration}; decisions use selected messages/vars/lastOutput. Moving a provider predicate can change judgment even before #164. No provider equivalence was tested.

B currently deliberately changes iteration (always 1), local-limit outcome (failure), evidence (chosen route), lastOutput (decision result) and the duration approximation's origin/clock. The owner must accept those changes explicitly if they are retained rather than corrected.


## Options for the owner

### 1. Keep loop-back; simplify presentation

**Cost: low relative to a semantic cutover.** Preserve existing execution/results/events; make advanced loop-back, ordered criteria and return controls clearer. Decisions can optionally precompute completion flags without forcing an engine change.

**Migration scope:** no #167 definition/history rewrite for presentation-only changes. #164 format 4 still requires its evaluator/decision conversion. Keeping loop-back does not freeze today's primitive schema. If #164 also removes primitives from expression/LLM exits, adapt predicates deliberately while retaining continuation.

**Risk:** the exit still combines completion policy, return and repetition. Hiding fields may improve the panel but leave the mental model crowded. Separate any provider/gate changes from this choice.

**Gap analysis:** retains all tested A semantics; no new cycle/recovery mechanism. The clutter concern needs concrete editor examples and owner browser review. **Recommended immediate choice.**

### 2. Replace loop-back with decisions plus ordinary edges

**Cost: medium if behavior changes are accepted; high for parity.** Routing already works. Add clean terminal outcomes and better decision authoring. Parity additionally needs iteration/timing metadata, scoped continuation, events and conversion work, largely recreating the primitive outside the exit.

**Migration scope:** rewrite affected stored versions, drafts, templates, device drafts and exports into new graphs. Inventory whole-thread, lastOutput, output-map, iteration and dynamic JSONata references, plus subloop consumers. Ordered provider criteria/confidence gates cannot silently become one decision. Coordinate with #164 format 4 to avoid another immediate cutover. Require a stopped-store backup/rehearsal and refusal of nonterminal/unresolved runs using the existing clean-cutover approach.

**History:** preserve original facts and upgrade audit. Do not collapse authored run.finished failure into run.failed/MAX_ITERATIONS. Historical loop-back/increment/evaluation events need a factual converted/readable representation, not fabricated route evidence. Affected resumable failed runs need individual replay-only dispositions if the new runtime cannot resume them.

**Risks:** changed outcomes/counts, duplicated returns, early ceilings after retries, changed provider judgments/mappings, safety failures with no return, and unchanged at-least-once delivery.

**Gap analysis:** baseline B handles first/multi-pass success, explicit failure, recovery and delivery. It loses automatic exhausted completion, logical iteration, exact duration, ordered evidence and lastOutput preservation. B4 recovers exhausted outcome using an awkward limit exit, leaving other gaps. Better editor usability is unproved.

### 3. Middle option: decisions for policy, explicit continuation, terminal exits

**Cost: medium/high, bounded by reusing the proven mechanism.** Keep the existing loop-back execution/result and atomic replay approach behind a small continue node or explicitly marked continuation edge. Decisions route; continuation owns logical iterations/budget; terminal exits declare outcome/returns. Choose one representation with one source of target truth.

~~~text
work --> decide --success--> exit(success)
            |
            +----failure--> exit(failure)
            |
            +----continue--> continuation --within budget--> work
                                  |
                                  +--budget reached--> exit(exhausted)
~~~

The budget is checked after success/failure evaluation, preserving final-pass priority. Duration is an authored decision check once authoritative timing metadata exists; its exhausted route can reach the same terminal. Ordinary-cycle safety remains separate.

An edge avoids another canvas card; a node makes budget routing explicit. Neither representation was implemented or evaluated with the owner.

**Migration scope:** mechanical expansion for proven expression criteria, reviewed resolutions for provider gates/context, output/iteration references, criteria order and return overrides. Preserve factual terminal/evaluation/increment history and audit. Coordinate with #164 format-4 offline/device-draft conversion. Do not add a tolerant legacy executor or dual runtime.

**Risks:** another abstraction, ambiguous scopes with multiple continuation boundaries, and changed decision output semantics. Ordered evidence and confidence-gate behavior still need preservation or explicit accepted changes.

**Gap analysis:** retains iterations, exhausted returns and atomic continuation/recovery while removing repetition controls from exits. Terminal outcomes eliminate the failure predicate/B4 workaround. It does not automatically preserve ordered evaluation evidence, provider context or lastOutput. Owner review of a concrete editor design must select the representation.

## Reconciliation with #99, #112 and #129

- **#99:** Not read on GitHub: gh returned HTTP 401. Local ADR-0026 preserves ordered criteria, outcomes, returns, one loop-back and once-per-continuation increments; replacement needs a new decision superseding those parts, not an assumption that evaluator reuse authorizes removal.
- **#112:** Not read; gh returned HTTP 401. Its actual constraints/dependencies remain an open reconciliation point before cutover approval; no contents/status are inferred.
- **#129:** Not read; gh returned HTTP 401. Its actual constraints/dependencies remain an open reconciliation point before cutover approval; no contents/status are inferred.

The attempted commands were `gh issue view <number> --json number,title,body,state,url`. Reads for #164 and #167 also returned HTTP 401. No alternate issue source was used and no comments were posted.

For #164, this comparison uses the owner's supplied target: answer primitives apply only to classifier evaluators; LLM decisions use freeform instructions with forced route enums; expressions return declared route IDs. The tested B Choice wrapper is today's runtime shape, not a recommendation to preserve expression/LLM answer types in format 4. #167 must decide repetition semantics independently of that evaluator cleanup.

## Appendix: reproduction, source anchors and caveats

From this worktree root in Windows PowerShell:

~~~powershell
pnpm.cmd --filter @graphgoblin/engine exec vitest run src/issue-167-scratch.test.ts
pnpm.cmd --filter @graphgoblin/engine exec tsc -p tsconfig.json --noEmit
~~~

| Artifact | Purpose/result |
| --- | --- |
| packages/engine/src/issue-167-scratch.test.ts | One scratch test file: **40 passed, 0 failed**. |
| issue-167-loop-a.json | Stored A definition, schema/graph/syntax validated. |
| issue-167-loop-b.json | Stored B definition, same validation. |
| issue-167-observations.json | 40 records: exact definitions, runs, replay/read threads, fresh visits, attempts, event counts, full events, captured returns and primary restart cut evidence. Regenerated by tests. |
| issue-167-comparison.md | This report, suitable as an issue comment. |

Final Vitest run: v5.0.3, 6.83s, 40 passed/0 failed. TypeScript passed after the extra recovery scenarios. Only this test file ran; no whole suite, coverage, build, browser or server was invoked.

Harness failures are not product findings: first 0/36 passed because I wrote evaluation.expression instead of evaluation.jsonata. Next 24/36 passed because hydration accidentally retained its initial thread as a read snapshot, and I assumed reads always equaled replay after failure. Hydration now drops snapshots; actual failure-read lag is recorded separately. Then 36/36 passed; four added recovery checks brought the final total to 40/40.

Current source anchors at the research head:

| Concern | Locator |
| --- | --- |
| Exit schemas/outcomes/limits/default/target/returns | packages/contracts/src/nodes.ts:664, :682, :743, :763 |
| Ordered exit policy, implicit ceiling | packages/domain/src/exit.ts:50, :124 |
| Run-start duration, evidence, mapping | packages/engine/src/handlers/exit.ts:45, :81, :170 |
| Attempts/fresh entries | packages/engine/src/run-manager.ts:229, :240 |
| Safety cap, every-start nodeVisits | packages/engine/src/run-manager.ts:1318, :1343 |
| Atomic terminal completion/continuation | packages/engine/src/run-manager.ts:1453, :1471 |
| Cursor recovery, log reconstruction, snapshot reads | packages/engine/src/run-manager.ts:1848, :1929, :906 |
| Decision view/evidence/output | packages/engine/src/handlers/decision.ts:50, :90, :93 |
| Expression thread view/execution | packages/domain/src/thread-view.ts:13; packages/domain/src/expression.ts:136 |
| Graph ports/loop-back consistency/reachability | packages/domain/src/graph.ts:14, :187, :234 |
| Strict context run fields | packages/contracts/src/thread.ts:131 |
| Inspector | apps/web/src/runs/RunInspectorPage.tsx:40, :68; apps/web/src/runs/inspector/EvaluationDetails.tsx:112; apps/web/src/runs/projections.ts:100 |

Settled policy read: ADR-0010, ADR-0022, ADR-0026 and numbered docs 03/04/05; no unverified older memory was used as engine evidence.

**Caveats/open checks for the orchestrator:**

1. Read #99/#112/#129 and full #164 with authenticated gh; reconcile their actual dependencies/constraints before implementation scope is approved.
2. Confirm which meanings must survive: logical iteration, exhaustion, ordered confidence-gate nonmatch behavior, run-start duration, output references and precise evidence. Accept deliberate changes explicitly.
3. Owner/editor review must determine whether extra routes/cards reduce total clutter. No UI was served or operated.
4. All ports are fakes. No SQLite transaction/process-kill test, real provider/delivery, classifier rejection, LLM gate or cancellation scenario was exercised. Restart reconstructs persisted state into fresh stores after a frozen boundary; it does not kill a real process.
5. The real mutation handler is wrapped only to advance the clock or interrupt after computation/before completion. Patch logic, decision/exit handlers and RunManager are unchanged. External work may repeat effects and needs idempotency.
6. Child/subloop return propagation and downstream event-trigger admission were not exercised. Delivery acknowledgment interruption was exercised and duplicated the fake webhook effect as expected.
7. Failure-read snapshot lag is a separate observed concern; characterization tests do not fix it or prove live inspector behavior.
8. Format-4 migration is a proposal only: inventory stored/draft/export/history references, provider/gate differences, terminal outcomes, device drafts and replay dispositions; rehearse backup/conversion/rollback before any owner-instance cutover.
9. Multiple/nested/overlapping continuation boundaries and cycles inside a pass need a model and further tests if the middle option is selected. These examples use one work node/repetition boundary.
10. Reproduction rewrites only scratch observations and creates/deletes its own temporary restart JSON files inside the worktree. No dependencies were installed/linked, no servers started, and no port 4747 or ~/.graphgoblin operations occurred. Product/index/history remained unchanged.


