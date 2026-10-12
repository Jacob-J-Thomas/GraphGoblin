# Issue #167: move completion decisions out of the exit node

I recommend decisions for completion policy, a dedicated Continue node for bounded repetition, and terminal exits for outcomes and returns, with medium confidence because the engine evidence is strong but the proposed editor has not been tested with the owner. Today's differences are implementation and migration costs under ADR-0020, not reasons to preserve a cluttered exit; if the owner wants this design, decide now and include it in #164's single format-4 cutover.

## Decision needed

1. **Keep exit loop-back:** defer the structural change and retain today's execution behavior; this leaves the owner's clutter concern unresolved.
2. **Use decisions and ordinary edges:** simplify exits and accept visit-based repetition, or build explicit iteration and exhaustion semantics into those edges.
3. **Use decisions, a Continue node, and terminal exits:** simplify exits while keeping the pass budget and exhausted route visible; this is my recommendation, with medium confidence.

Keeping loop-back through #164 and moving to option 3 afterward would require two stored-data cutovers. If option 3 is wanted, choose it before the format-4 contract and converter are finalized and fold both changes into #164; do not recommend "keep now, change later" without naming that extra cost.

## Plain gains and losses

- Keeping loop-back avoids new repetition machinery, but leaves exit policy, repetition, and returns in one panel.
- Ordinary decision edges move the stopping rule onto the canvas, but need an authored budget or an accepted change to how passes and exhaustion work.
- A Continue node removes repetition from exits and shows the budget and exhausted path, but adds a card and some engine and converter work.
- All options can return the same work result; exposing run timing and selecting the work's output in a mapping are small fixes.
- Format 4 already changes evaluator contracts and expression evidence; decide the repetition design now to avoid a second data cutover.

## What option 3 would look like

The exit panel would show only a terminal outcome and the result contract:

~~~text
Exit: Success
  Outcome: Success | Failure | Exhausted
  Return mapping: outputs.work.value, or selected variables
  Destinations: Caller, File, Webhook, Event, Log
~~~

The decision panel would hold the expression or evaluation instructions and declared routes. The Continue panel would show the pass budget and its two connections:

~~~text
Continue
  Maximum passes: 4
  Repeat: connected to Work
  Exhausted: connected to Exhausted exit
~~~

The connections are the single source of target truth; there is no second target ID to edit. The canvas would make both the stopping choice and the repetition limit visible:

~~~text
Start --> Work --> Decide --success--> Exit: Success
           ^         |
           |         +------failure--> Exit: Failure
           |         |
           |         +-----continue--> Continue
           |                              |
           +----------------------repeat--+
                                          |
                                          +--exhausted--> Exit: Exhausted
~~~

The initial work pass counts as pass 1. After the decision chooses continue, Continue either advances the pass and follows repeat, or follows exhausted when the budget is reached. Success or failure on the final pass still wins because the decision runs first. A duration route can also go directly from the decision to the exhausted exit.

<details>
<summary>Evidence and the two runnable examples</summary>

## Evidence and provenance

The original research ran production RunManager and production handlers with testing fakes for every port: **40/40 scratch checks passed**, and TypeScript checking passed. Claude Opus 5.5 independently re-ran the unchanged scratch file, also obtained **40/40**, and confirmed the engine facts and the fairness of the examples. No test was changed or re-run for this document-only revision.

The engine code investigated was main at `c379f806ba8a04433779d98ded7e4196c9d4b663`. The orchestrator committed the comparison, loop fixtures, and scratch test at `9711f6a8d7f14743c793048502c47828a107a755` on `research/167-exit-comparison`. This revision stays on that branch and is uncommitted. The observations JSON is a generated scratch artifact, not one of the files in that commit.

All example variants passed LoopDefinitionSchema and validateLoop with zero issues. Emitted events and final run records were schema-validated. The tests support execution claims about today's code, not usability claims about the proposed editor or behavior of real providers, storage, or network delivery.

## Shared work and return contract

The stored definitions are `issue-167-loop-a.json` and `issue-167-loop-b.json`. The test parses each definition and stores a published LoopVersionRecord in the fake loop repository. Each observation also contains the exact parsed definition of any variant.

Both start at iteration 1 and use `settings.maxIterations: 4`. This one setting supplies both the iteration ceiling and the cumulative per-node visit cap; neither count is reset by loop-back. Input is `{k, failAt}`: work is done after K completed passes and explicitly fails after failAt passes.

Both use the same deterministic context-mutation step, with no script subprocess:

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

Operations run in order against the updated thread. A completed patch increments count once. A computation interrupted before completion is recomputed from the persisted thread.

The shared return config is copied to each exit:

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

These delivery effects are captured by fake ports. The URL is not contacted, and fake workspace paths are memory keys rather than filesystem writes.

## A: exit loop-back

A has three nodes and three edges:

~~~text
Start --> Work --> Exit
           ^        |
           +loopBack+
~~~

Its exit criteria are ordered as follows:

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

The loopBack edge also targets work; the config and edge must agree. The implicit four-iteration ceiling applies after no criterion matched. The duration criterion uses FakeClock and does not fire when that clock is not advanced.

## B: decision with an ordinary back edge

B has five nodes and five edges:

~~~text
Start --> Work --> Decide --success--> Success exit
           ^         |
           |         +------failure--> Failure exit
           +---------continue
~~~

Today's contract represents the expression's route enum through a Choice declaration:

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

Success-exit defaults to success. Failure-exit uses an always-true expression predicate with outcome failure, because today's exit has no direct terminal outcome field. Adding that field is part of either replacement design, not a reason to keep the present panel.

B expresses the same four-completed-pass ceiling before taking another ordinary back edge. It uses vars.count because ordinary edges do not advance run.iteration. The number 4 is repeated in the expression because loop settings are not available in its input today.

Supplement B4 adds an exhausted route and an extra exit with `criteria: [{when: "max-iterations", value: 1}]`. It does finish exhausted and deliver returns, so exhaustion is expressible today. Its exit evidence reports an iteration limit of 1 despite four work passes; a direct exhausted terminal would remove this workaround.

Under #164, the expression would instead be a route-ID snippet with declared routes, without a Choice answer wrapper. The fixtures intentionally run today's format-3 code rather than inventing a format-4 contract.

</details>


<details>
<summary>Observed scenarios and event evidence</summary>

## Scenario results

Here, i is the run's iteration and c is the number of completed work passes. In uninterrupted runs, work has c separate visits and every execution attempt is 1; A visits its exit c times, while B visits its decision c times and the chosen terminal exit once. The trigger has one visit and one attempt in every case.

"Failed without an outcome" means an engine error recorded as run.failed, rather than an authored terminal failure recorded as run.finished. Success, authored failure, and exhaustion each produced five return.delivered events unless the row says otherwise. Detailed event counts and complete records remain in the observations artifact rather than crowding this table.

| Scenario | A observed | B observed | Meaning for the design choice |
| --- | --- | --- | --- |
| Success on the first pass, K=1. | It succeeded with outcome success, i=1, and c=1. | It succeeded with outcome success, i=1, and c=1. | Both can produce the same result. |
| Success after continuations, K=3. | It succeeded with i=3, c=3, and two iteration increments. | It succeeded with i=1, c=3, and no iteration increments. | Ordinary edges need an accepted pass-count model or new iteration behavior. |
| Continue until the four-pass ceiling, K=99. | It finished exhausted with i=4 and c=4. | Its explicit guard reached a failure exit with i=1 and c=4. | The chosen terminal route controls outcome; a direct exhausted terminal would make this clean. |
| B's explicit ceiling guard is removed. | A still finishes exhausted with returns. | It failed without an outcome, with MAX_ITERATIONS at work before a fifth visit; no exit or returns ran. | The safety cap is an error guard, not an authored exhausted completion. |
| B's guard uses run.iteration >= 4. | A still reaches iteration 4. | It hits the same MAX_ITERATIONS failure because iteration stays 1. | A migration must change the guard or preserve logical iterations elsewhere. |
| B4 adds an exhausted route and limit-based exit. | A exhausts at i=4 and c=4. | B4 exhausts at i=1 and c=4 and delivers all five channels. | Exhaustion is achievable today, but its reported one-iteration limit is a workaround. |
| Explicit failure, K=99 and failAt=2. | It finishes failed with outcome failure, i=2, and c=2. | It finishes failed with outcome failure, i=1, and c=2. | Both deliver returns and have no resumable run.failure object. |
| Success exactly at the ceiling, K=4. | It succeeds with i=4 and c=4. | It succeeds with i=1 and c=4. | Both authored orders let final-pass success win. |
| Done and failure are both true, K=2 and failAt=2. | It succeeds and records the later criteria as skipped. | It chooses success through the first conditional branch. | Priority can be preserved without requiring identical expression evidence in format 4. |
| Five-second duration, clock advances three seconds per work pass, K=3. | It exhausts after pass 2 at elapsed six seconds. | A guarded run.elapsedMs check sees no field and allows success after pass 3. | This is a small missing timing-view feature, not an architectural blocker. |
| B uses $millis() minus trigger.receivedAt with aligned clocks. | A's duration limit exhausts after pass 2. | B's receipt-time check reaches its failure route after pass 2. | JSONata time functions work, but direct engine timing would avoid the approximation. |
| Queue delay is six seconds, then work takes no fake time, K=2. | A succeeds after two passes because execution-start duration excludes the queue. | B's receipt-time check fails after one pass. | Exposing engine start or elapsed time is the small fix needed for equal timing origin. |
| Restart after the first completed continuation, before the saved position catches up, K=3. | It succeeds with i=3, c=3, and exactly two increments. | It succeeds with i=1 and c=3. | Both follow the completed route without redoing that completion; work attempts are [1,1,1]. |
| Restart during pass 2 before its patch completes, K=3. | It succeeds with i=3 and c=3. | It succeeds with i=1 and c=3. | Both have three separate work visits, four starts, and attempts [1,1,2,1]; the work count advances only three times. |
| The same retry occurs while success is sought at pass 4. | A succeeds with four visits, five starts, and attempts [1,1,2,1,1]. | A B guard based on nodeVisits >= 4 fails after three completed passes. | A start counter includes retries; it is the wrong counter for a completed-pass budget. |
| Evaluation evidence is saved before a crash, but node completion is not. | A succeeds at i=3; its exit has attempts [1,2,1,1] and four evaluation records. | B succeeds at i=1; its decision has the same attempts and four choice records. | Evidence can repeat for an unfinished evaluation without repeating a completed continuation. |
| Restart after the combined terminal completion record, before terminal status is saved. | A succeeds with one run.finished and no repeated terminal evaluation. | B does the same. | Both recover terminal status and return delivery from the log. |
| Pause after the first continuation, persist, rebuild, and explicitly resume. | It remains paused on restart, then succeeds at i=3 and c=3. | It remains paused, then succeeds at i=1 and c=3. | Both preserve operator intent without an extra work attempt. |
| Restart after the webhook effect but before its acknowledgment. | It succeeds; two webhook effects have one delivery acknowledgment. | It does the same. | Both deliver at least once; the four previously acknowledged channels are not repeated. |
| Webhook delivery fails; caller defaults add duplicate caller/log plus another event. | It succeeds with five delivered channels and one failed channel. | It does the same. | Delivery failure does not change outcome; identical channels are deduplicated and the extra event is merged. |
| The return mapping reads lastOutput.value, K=1. | It returns the trigger payload because this mutation leaves lastOutput alone. | It returns the decision's answer and route. | A small output-specific mapping rewrite preserves the intended work result. |
| The expression throws on pass 4. | It fails without an outcome at i=4, with EVALUATION_EXPRESSION_FAILED and no returns. | It fails with the same code at i=1 and no returns. | Errors remain errors; A records a criterion error and later skips, while B emits no fourth choice. |

## What the events establish

A records a work start and completion, an exit start, and exit.evaluated. Continuing records the exit completion and iteration.incremented in one append. Terminating records exit completion and run.finished in one append; returns follow.

B records work start/completion, decision start, decision.made, and decision completion with its chosen route. Continuation follows an ordinary edge. Termination adds a separate exit's start/evaluation/completion and run.finished.

Every emitted expression decision in today's code has a declared string option ID, null confidence and probabilities, expression provenance with null provider fields, and empty diagnostics. These are format-3 facts; they do not prescribe a Choice answer wrapper in #164.

The three-pass success run gives this A evidence:

| Pass | Success, failure, and duration criteria. | Recorded result. |
| --- | --- | --- |
| 1. | All three do not match. | The exit loops back to work because no criterion matched. |
| 2. | All three do not match. | The exit loops back to work for the same reason. |
| 3. | Success matches; failure and duration are skipped. | It completes successfully at criterion index 0. |

Explicit failure ends with a success nonmatch, a failure match, and a skipped duration criterion. Duration expiration ends with two predicate nonmatches and a duration match, reporting limit value 5 at criterion index 2. Implicit exhaustion records three nonmatches and the loop ceiling value 4, without a matched criterion.

B records continue, continue, and success. Its expression event does not trace unchosen branches or identify which part of a compound failure condition was true. The pinned expression and reconstructed thread explain that choice. Under #164, this lighter route evidence is an expected expression contract, not a requirement to rebuild the old per-criterion skip list.

All tested expression answers were accepted. Classifier confidence rejection, LLM calls, and provider gate behavior were not exercised.

</details>

<details>
<summary>Execution meanings, the small fixes, and required implementation work</summary>

## Passes, visits, and retries

A logical run iteration begins at 1 and advances once per completed exit loop-back. B's ordinary cycle leaves it at 1. This distinction affects templates, mappings, inspector metadata, and consumers that use iteration as progress.

Today's `settings.maxIterations` is one number with two jobs: it limits exit-controlled iterations and separately caps fresh visits to each node over the whole run. The per-node count is cumulative and is never reset by loop-back. A cycle inside one work pass can therefore hit MAX_ITERATIONS before reaching an exit.

For implementation purposes, these counters are different:

- `countEntries(events, nodeId)` counts node.started with attempt 1 and supplies the fresh-visit safety cap.
- `counters.nodeVisits[nodeId]` counts every node.started, including retry attempts.
- `attemptFor(events, nodeId)` increases when an unfinished visit is executed again; after completion, the next separate visit begins at attempt 1.

The work-restart case has three completed passes, three separate visits, and four starts. A nodeVisits-based budget stops early after that retry. An authored completed-pass variable works for the example, but a Continue node would own the pass counter directly.

**For option 3, I recommend splitting the settings.** Continue owns the maximum-pass budget, while a separately named loop-level safety cap limits cumulative fresh visits per node. Proposed names are `Continue.maxPasses` and `settings.maxNodeVisits`; these are design suggestions, not current fields. Migration would seed both from today's maxIterations, preserving its numerical limits initially, and would not reset the safety cap on continuation. The editor should distinguish normal budget exhaustion from a graph-cycle safety error.

A single Continue boundary can preserve today's run.iteration. Multiple or overlapping boundaries need an explicit scope model before admission; they are not a reason to retain a mixed exit panel, but they are additional design work if supported.

## Exhaustion and priority

An authored success, failure, or exhausted exit emits run.finished and delivers its return payload. A terminal failure has status failed and outcome failure without a resumable run.failure object. MAX_ITERATIONS is an engine failure recorded as run.failed, has no authored outcome or return delivery, and is nonresumable.

Today's exit lacks a simple outcome field, but adding terminal outcomes would remove B's always-true failure predicate and B4's one-iteration limit workaround. These are implementation tasks under the clean-design policy.

Preserve or explicitly change evaluation-before-cap. Success on the final pass must still be allowed; an evaluation error must not silently become exhaustion. Explicit authored limits retain their intended priority. In option 3, the decision runs first and only its continue route reaches the pass-budget check.

Neither interpreting a backward-looking canvas edge as an iteration nor renaming every MAX_ITERATIONS error to exhausted provides this model. Layout does not define logical repetition, and a safety error does not select return mappings or destinations.

## Timing is a small view change

The exit currently measures max(0, ClockPort.now minus run.startedAt), falling back to run.createdAt if needed. It checks wall time when the exit is reached, includes paused or parked time after execution began, and does not interrupt long work.

Expressions see identifiers and iteration in the thread's run view, but no authoritative start or elapsed time. JSONata $millis() and trigger.receivedAt provide a receipt-time approximation, which includes queue delay and uses Date rather than ClockPort.

Expose engine-owned run.startedAt or run.elapsedMs in the run evaluation view, using the engine clock consistently, and test queue delay and restart behavior. This is a cheap contract/view addition within format 4. It should not inflate options 2 or 3 into a major parity project.

## Output-specific return mappings are a small rewrite

A decision writes lastOutput and outputs[decisionId]; exit evaluation does not. Returns can instead read `outputs.work.value` when the work node produces a recorded output, so the routing decision no longer hides the work result.

This particular work node only mutates variables and does not create outputs.work. Its normal return mapping already reads vars.count, vars.done, and vars.fail. To preserve the exact trigger payload returned by its lastOutput test, the replacement mapping can read outputs.start.value. Migration must identify the intended source and rewrite references, but this is a cheap mapping change rather than a structural blocker.

## Evidence and gates in the format-4 target

#164 makes LLM confidence informational and expressions route-ID snippets. Do not build a replacement exit-only LLM confidence gate, and do not treat loss of expression per-criterion skips as an expensive parity requirement. Selected route, pinned expression, relevant state, and typed error evidence are the intended new basis for explaining expression decisions. Historical gate and skip records remain factual history; they are not invented or discarded merely because new events are simpler.

**Only classifier confidence gates remain a substantive gate-policy question.** Today, a low-confidence but valid exit classifier answer is retained and treated as a nonmatch, allowing later criteria to run; a decision classifier rejection instead fails with EVALUATION_RESULT_REJECTED. Format-4 migration must explicitly decide whether the affected classifier check fails or takes an authored next-check/continue route. It must not introduce an implicit fallback to another evaluator.

Exit and decision provider inputs also differ today: exits use fixed trigger/vars/lastOutput/lastMessage/iteration state, while decisions select messages, variables, and last output. Moving a classifier evaluation can change its input and judgment. This needs review and focused tests, not a claim of provider parity from expression-only examples.


## Recovery and return delivery

The restart checks froze execution at a known boundary, persisted the fake run, version, initial thread, and events to temporary JSON, rebuilt fresh repositories, and started a new RunManager. The temporary files were removed in finally. The abandoned executor did not share the rebuilt stores.

After A's completed loop-back, the durable completion and iteration increment recover the next pass even if the saved run position is behind. After B's completed decision, its recorded route recovers the next node without redoing that decision. Both re-execute unfinished work with a higher attempt, producing one completed counter patch in the tested mutation.

Evaluation evidence precedes completion in both designs. A crash after exit.evaluated or decision.made can repeat that evaluation, while completed continuation remains singular. Both exits record node.finished and run.finished together and recover final status and delivery without evaluating that terminal exit again. The five primary restart cases were rebuilt a second time to check that completed work and acknowledged returns did not repeat.

Option 3 should reuse those recovery principles: the Continue node's repeat completion and iteration increment must be saved together, and recovery must follow the connected repeat target from that completed record. Its exhausted completion follows the connected exhausted exit without advancing the pass counter.

Return delivery is shared across the designs. Success, authored failure, and exhaustion all produced caller/log/event/file/webhook evidence. Identical channel defaults are deduplicated; channel failure records return.failed without changing the terminal outcome. A delivery effect without an acknowledgment can repeat, as the webhook case demonstrated. Neither simpler exits nor a Continue node implies exactly-once external work or delivery.

## Inspector explanations

These observations come from inspector source and event evidence, not a browser test.

| Question | A can explain today. | B can explain today. | Format-4 implication. |
| --- | --- | --- | --- |
| Why continue? | It shows criterion nonmatches, the target, and an incremented iteration. | It shows the selected continue route and expression provenance. | Show the chosen route and Continue budget; old expression skip lists need not survive in new evaluations. |
| Why succeed or fail? | It shows the matched criterion and later skips. | It shows the route and separate terminal outcome. | Use route and outcome together; retain classifier rejection facts where relevant. |
| Why stop at a limit? | It names the iteration or duration limit and exhausted outcome. | Base B shows failure, unguarded B shows MAX_ITERATIONS, and B4 names a one-iteration workaround. | A Continue card and direct exhausted terminal can give the actual budget and result. |
| How many passes and retries? | Iteration advances, and the timeline shows attempts. | Iteration remains 1; custom counters or the timeline supply the pass count. | Preserve a logical pass counter with Continue or explicitly accept a visit-based model. |
| What returned? | The result and each channel appear. | The same facilities work when B reaches an exit. | Keep return destinations on exits, independently of the budget's location. |

## What must change

This table separates meaningful execution choices from small fixes and changes already planned by #164. Parity costs are engineering estimates, not arguments against a cleaner design.

| Area | Proposed work for option 3. | Cost or deliberate change. |
| --- | --- | --- |
| Contracts. | Add terminal exit outcomes and a Continue node with repeat/exhausted outputs; split pass budget from the cumulative safety cap. | This is substantive schema/converter work to include in format 4. |
| Engine. | Move logical pass advancement and its budget check to Continue; save completion/increment together and recover the recorded route. Keep success/error evaluation before the implicit budget check. | This is substantive but can reuse today's event-driven execution approach. |
| Validation. | Connect both Continue outputs; derive targets only from edges; validate budget ownership and supported scopes while retaining port, reachability, and expression checks. | This is bounded graph validation work for one continuation boundary; broader nesting needs a model. |
| Timing view. | Expose engine-owned run start or elapsed time with consistent clock semantics. | This is a small fix with queue/restart checks. |
| Return mappings. | Select the intended outputs.work.value or variable rather than whichever node most recently wrote lastOutput. | This is a small reference rewrite; this mutation-only fixture uses variables or outputs.start.value. |
| Evaluation evidence. | Use #164 route evidence for expression/LLM evaluation, with confidence informational for LLMs. Preserve historical facts. | Do not rebuild expression skip traces or exit-only LLM gates; those are accepted target changes. |
| Classifier gates. | Resolve low-confidence nonmatch versus decision failure explicitly for affected definitions. | This remains a substantive behavioral and migration choice requiring focused tests. |
| Events and history. | Give Continue truthful budget/exhaustion facts; preserve completion/increment association and historical exit evidence in the audit/readable event contract. | Never fabricate new routes, unexecuted criteria, or current classifier facts for old events. |
| Editor. | Show route decisions, a visible Continue budget and two outputs, terminal outcomes, and returns on exits; update connect/delete/undo and inspector explanations. | This is the main product-design work; the extra card needs owner review. |

Today's graph validation already accepts B's ordinary cycle. The work is to choose its execution meaning and clean terminal/evidence contracts, not to remove an admission restriction.

Either replacement option supersedes the relevant parts of **ADR-0010**, which locates the visible recursive edge on exits; **ADR-0026**, which preserves ordered exit evaluation, evaluate-before-cap, and loop-back behavior; and **docs/05-execution-engine.md**, which says only an exit loop-back increments iteration. A new ADR must name all three and explain what remains, including return mappings and destinations on exits. ADR-0020 supplies the policy for a clean replacement and one-off conversion rather than parallel legacy execution.

</details>

<details>
<summary>Options in detail and migration timing</summary>

## Option 1: keep exit loop-back as a deferral

**Gain and loss:** It retains tested behavior with little new repetition machinery, but leaves stopping policy, repetition, and returns in one panel. Hiding advanced fields does not resolve the owner's structural clutter concern.

**Cost and migration:** This avoids immediate #167 graph conversion, while #164 still changes exits and evaluator contracts in format 4. Selecting option 3 afterward would require a second stored-data cutover. Choose this only as an explicit schedule deferral, not as a resolution or the recommended path to option 3.

**Risks and gaps:** Panel rearrangement has not been shown to solve the problem. #99's repetition behavior remains, and #129 can proceed as written. Confidence in the engine facts does not establish that keeping the panel is the best design.

## Option 2: decisions and ordinary edges

**Gain and loss:** It focuses exits on terminal outcomes and uses existing routing. The author needs a visible graph budget; the owner must accept visit-based progress or choose new logical-pass behavior.

**Cost:** Moderate contract, editor, and converter work remains. Preserving engine-managed iterations and exhausted completion adds repetition mechanics to edges. Exposing timing and rewriting return sources are cheap; expression skip traces and exit-only LLM confidence gates are not extra format-4 parity obligations.

**Migration scope:** Rewrite affected versions, drafts, device drafts, exports, and published templates. Keep examples/aidlc retired under #165. Inventory iteration, whole-thread, lastOutput, output-map, dynamic JSONata, and subloop references; resolve classifier gates and provider input selection explicitly. Include this choice in #164 format 4 if selected now.

**History and risks:** Preserve authored terminal failure separately from MAX_ITERATIONS; keep factual exit/increment/evaluation history and the audit. Provide reviewed replay guidance where failures cannot resume. Raw back edges can obscure exhaustion versus safety failure, retry counters can stop early, and returns can be duplicated across exits.

**Gap analysis:** Tested B handles success, explicit failure, restart, and delivery; B4 demonstrates exhaustion. Direct outcomes, timing metadata, and output-specific mappings close the small gaps. The substantive choice is where the budget and logical pass counter live. Accepted visit-based semantics are a valid documented design change under ADR-0020.

## Option 3: decisions, a dedicated Continue node, and terminal exits

**Gain and loss:** It clears policy and repetition from exits while keeping bounds and exhaustion visible on the canvas. It adds a card, which needs owner review.

**Representation:** Recommend a Continue node rather than a marked edge. Its panel holds the maximum-pass budget and repeat/exhausted outputs; connections alone determine targets. The budget and both destinations are visible with one source of target truth.

**Budget:** Split maximum passes from a cumulative loop-level per-node safety cap. Seed both from old maxIterations during migration and never reset the safety count on continuation. Preserve run.iteration for the initial single-boundary model; define admission rules before supporting multiple or overlapping boundaries.

**Cost:** Moderate engine/event/validation/editor/converter work can reuse today's recovery mechanism. Budget/exhausted routing is substantive; timing and return mapping changes are small. #164 already replaces expression skip traces and makes LLM confidence informational. Classifier gate policy remains a real behavioral choice.

**Migration timing:** If the owner wants option 3, decide now and fold it into #164's single format-4 cutover. Keeping loop-back through format 4 and replacing it later would require two stored-data conversions. Today's parity gaps are build costs, not a clean-design reason to retain the old shape.

**Migration scope and gaps:** Expand eligible exit checks into route expressions, Continue, and terminal outcomes while retaining authored priority. Resolve ambiguous expressions, classifiers, gates, input selection, references, and replay dispositions; convert drafts/device drafts/exports and preserve factual history/audit. Rehearse stopped-store conversion and rollback. Use one current runtime, not compatibility schemas or dual execution.

A new ADR must re-home evaluate-before-cap and iteration advancement, supersede ADR-0010 and the relevant ADR-0026 and docs/05 statements, and keep returns on terminal exits. Multiple-boundary scope and the added card remain design risks. This is the recommended direction with medium confidence, not an implemented or browser-tested design.

</details>

<details>
<summary>Reconciliation with #99, #112, #129, and #164</summary>

The issue facts below were supplied by the cross-vendor reviewer, who read the public issues. This revision uses that supplied review evidence and does not claim a new independent GitHub fetch.

- **#99** was delivered through PR #126/#151, including shared evaluation in exit criteria and format 3, and remains open for the owner's acceptance; it hands the loop-back question to #167. Option 1 leaves that repetition behavior unchanged. Option 3 re-homes evaluate-before-cap and supersedes the relevant ADR-0026 parts.
- **#112** was closed as not planned on 2026-10-09 after the owner retired examples/aidlc in #165. It places no constraint on #167; its goal of keeping bounds visible in the graph rather than scripts fits either the existing exit design or a decision/Continue design.
- **#129** is open backlog UI polish covering inspector iteration and ceiling, return destinations, and clearer criterion cards. Under option 1 it can proceed as written. Under option 3 the ceiling moves to Continue while returns stay on exits, so park #129 until #167 is decided and then adjust its scope.
- **#164** already plans a format-4 cutover covering exits: answer primitives apply only to classifier evaluation, LLM decisions use freeform instructions with a forced route enum and informational confidence, and expressions return declared route IDs. Decide #167 before that contract/converter is finalized to include the selected repetition design in the same cutover.

</details>


<details>
<summary>Reproduction, source locators, and limits of this research</summary>

## Reproduction

Run from the worktree root in PowerShell:

~~~powershell
pnpm.cmd --filter @graphgoblin/engine exec vitest run src/issue-167-scratch.test.ts
pnpm.cmd --filter @graphgoblin/engine exec tsc -p tsconfig.json --noEmit
~~~

The equivalent commands in Bash are:

~~~bash
pnpm --filter @graphgoblin/engine exec vitest run src/issue-167-scratch.test.ts
pnpm --filter @graphgoblin/engine exec tsc -p tsconfig.json --noEmit
~~~

The unchanged scratch test has 40 checks. The original run and the cross-vendor rerun each passed all 40; original typechecking passed. Reproduction regenerates observations and cleans up its temporary restart JSON files.

| Artifact | Purpose. |
| --- | --- |
| packages/engine/src/issue-167-scratch.test.ts | It runs today's engine scenarios and records observations. |
| issue-167-loop-a.json and issue-167-loop-b.json | They store the validated examples. |
| issue-167-observations.json | It stores exact variant definitions, runs, threads, counters, events, and fake deliveries. |
| issue-167-comparison.md | It contains this owner decision comment. |

## Source locators

Exit contracts are at packages/contracts/src/nodes.ts:664, :743, and :763. Ordered evaluation and the ceiling are at packages/domain/src/exit.ts:50 and :124. Duration is computed at packages/engine/src/handlers/exit.ts:45 and :81.

Attempts, the safety cap, and start counting are at packages/engine/src/run-manager.ts:229, :240, :1318, and :1343. Terminal and continuation completion are at :1453 and :1471; recovery is at :1848 and :1929. Decision output is at packages/engine/src/handlers/decision.ts:90 and :93.

## Caveats and open decisions

1. The owner must choose the repetition design before #164 format 4 is finalized and decide the remaining classifier gate policy and supported continuation scopes.
2. The Continue panel and extra card are proposals. No editor or inspector browser session was run; owner review must judge the clutter tradeoff.
3. All ports are fakes. There was no SQLite/process-kill, real provider, classifier rejection, real delivery, cancellation, subloop-return, or downstream event-admission test.
4. The work wrapper only advances time or interrupts after the real mutation computes but before completion. External work and delivery can repeat effects; idempotency remains necessary.
5. Implementation and migration are unperformed. Inventory references and history, then rehearse stopped-store backup, conversion, and rollback.
6. This revision changes only Markdown. It starts no server, touches no live instance, changes no test, and makes no Git commit or index operation.

</details>

