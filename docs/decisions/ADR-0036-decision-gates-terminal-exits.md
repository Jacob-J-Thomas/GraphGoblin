# ADR-0036: Decision gates and terminal exits

Status: Accepted (owner design approved 2026-10-14; exits checkpoint pending)

## Context

Repeated work needs explicit limits and inspectable pass counts. Exit predicates combined evaluation, routing, limits and return delivery in one node. The owner rejected a new Continue node to keep the palette small. This decision supersedes the loop-back and iteration-limit portions of [ADR-0010](ADR-0010-exit-return-channels.md), section 1 of [ADR-0015](ADR-0015-wp-d2-open-questions.md), the exit-predicate design of [ADR-0026](ADR-0026-exit-primitives-and-format-three.md), and the temporary exit contract in [ADR-0035](ADR-0035-evaluator-specific-decisions.md). Their historical text remains intact.

## Decision

Extend the decision node. At most one route, Choice option, Noul side or Score band may carry `repeat: true`; the canvas never infers it. A repeat route must lead through the graph back to that decision. Require `maxPasses` and allow optional `maxRunTimeSeconds`. Reject limits without a repeat marker. Reserve `limit-reached` as a dedicated output; it exists only on gates and must be connected.

Evaluate first, then check limits only if the chosen route repeats. A non-repeat choice wins on the last pass or after the time limit. An allowed repeat increments one-based `gates.<nodeId>.passes`; a finishing or blocked choice does not. Each gate starts at 1, so maximum passes 3 permits two repeats. Maximum run time is elapsed seconds from `run.startedAt`, including waits, pauses and recovery downtime, with `createdAt` as the fallback. It is a gate check, not a watchdog. If both limits stop a repeat, record `max-passes`.

The chosen actual port and absolute count are appended atomically in `decision.made` with `node.finished`. `gate` evidence records previous/current passes, repeat route, configured limits, elapsed seconds and stopping limit. Raw observation retains the evaluator's choice; `portId` may instead be `limit-reached`. Recovery/resume follow durable routes without recounting. Replay forks retain checkpoint counts and get a new run clock. `/gates` is engine-owned.

Exits become strict terminal `{outcome, returns, destinations}` nodes, with Success, Failure or Exhausted; JSONata return mapping or `none`; and caller/webhook/file/event/log destinations. No criteria, predicate, default routing, loop-back or output port remains. Outcome maps to `succeeded`, `failed` or distinct `exhausted` status. Exhausted means the authored graph stopped further repetition, normally after a gate limit. Every outcome delivers the same mapped value unchanged. Neither Failure nor Exhausted creates a resumable node failure; a return-mapping error still follows normal failure handling. `exit.evaluated` contains node ID and outcome and commits with completion.

Rename the independent per-node visit safety cap to `maxNodeVisits`, default 10, maximum 10,000. It stops unintended cycles with nonresumable `MAX_NODE_VISITS`. Fresh entries count; wakes/recovery/retries of the same visit retain existing attempt semantics. Fresh `run.iteration` stays 1; historical iteration events remain factual and replayable.

If maximum passes exceeds the visit cap, report a field warning naming both limits and the repeat-cycle nodes. Continued repetition will hit the safety cap first, but an earlier non-repeat choice or time limit can still achieve the author's intent, so publication remains allowed. The current failure-code contract has no `MAX_ITERATIONS` alias; frozen upgrade schemas retain their historical enum.

## Authoring and consequences

The palette remains nine kinds. Repeat switches are mutually exclusive. Limits appear only for gates, and Limit reached is visible even in an incomplete gate. Unmarking previews removal of limits and its edge; confirmation is one undoable edit. Kind/answer conversions preserve representable markers and limits. Exits expose outcome, returns and destinations; loop settings describe maximum node visits as a safety cap.

Use `outputs.<workNodeId>.value` in exit mappings when a gate intervenes: its decision replaces `lastOutput`. The shipped template retry exits become constant-repeat gates with the old iteration ceiling as maximum passes and separate Success/Exhausted exits. Ordinary copies remain independent drafts.

This is an atomic format-4 change, with no compatibility parser, client aliases or exit predicate evaluator. Old stores/exports require the later integrated cutover; frozen format-3 conversion stages remain historical. All producers/consumers must rebuild together. The exits checkpoint reviews this design and browser evidence; implementation tests do not constitute owner sign-off.
