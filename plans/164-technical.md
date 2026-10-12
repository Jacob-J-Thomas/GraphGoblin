# Issue #164: technical implementation plan

Baseline: c379f806ba8a04433779d98ded7e4196c9d4b663 on codex-plan-164; citations refer there. This research revision uses the three peer drafts, the under-review debt register and #167 status. It grants no approval. Original inputs remain unchanged; no product, installed-instance, server or Git operations occur.
## 1. Summary

Decisions become evaluator-specific: expressions return stable route ids from one JSONata snippet; LLMs use freeform Liquid instructions and structured routes; Jev and compatible HTTP classifiers retain Choice, Noul and Score. Stable graph identity, classifier mathematics, defaults, context behavior, errors and returns remain. There is no evaluator fallback, context redesign under #38, or continuity work under #33.

The owner can approve decisions before choosing exits. #167 recommends option 3 (variant C) at medium confidence, and I agree: policy decisions, a Continue node with repeat and exhausted connections, and terminal exits. Option 1 is variant A; option 2 is variant B. The 40 scenarios establish current facts, not a C implementation. Choosing C later requires a second cutover.

#164 estimates remain 9-14 worker days for A, 11-18 for B, and 12-19 for C. With option 3, the programme totals about 34-51: #164 12-19, #165 6-9, and #168 16-23, excluding separate #118/#152 work and review delays. The original 3-5-day estimate covered semantics; this programme includes three issues and a verified cutover. Confidence is high for decisions and medium for migration.

## 2. Owner decisions and approval boundaries

The recorded choices are classifier answer types, LLM instructions, snippets, clean format 4, independent templates and one integration branch. Only the owner changes gates; plan approval does not approve a data manifest or installation.

| Choice | Recommendation and consequence |
| --- | --- |
| #167 exits | Recommend option 3 (variant C), with medium confidence: it addresses clutter and avoids another cutover. Keep maxPasses separate from the cumulative cap and seed both from old maxIterations. |
| LLM exit confidence | Make it informational; review each old gate for deliberate removal or replacement. Keeping gates needs a revised plan. |
| Old LLM conversion | Review every new instruction; proposed text does not prove equivalent judgments. |
| #152, parked | Unpark it or authorize atomic initialization in #164. Without either, fresh initialization blocks release. |
| #118, parked | Prefer retained, disarmed provenance and repair. Otherwise approve exact restoration or archival of each orphan; unresolved cases refuse apply. |
| #127, parked | Keep its repair separate and run final checks uncached unless the owner unparks it. |

#165 still needs archive-only retirement and external evidence approval. #168 needs its repeated-body default and reviewed filter conversions. Recommend Allow for new bodies while preserving existing permanent claims; this is not approval on behalf of those issue owners.
## 3. Target contract

### Engineering defaults

The observation output below and the 2-64 expression/LLM route bound are engineering defaults, not additional owner trade-off gates. The owner may override them before implementation; an override updates the contract, conversion and validation plan. Score retains 1-64 bands.

### Common decision contract

DecisionConfig is a strict discriminated union on node.config.kind. Remove the old answer/evaluation matrix, inactive settings, and dead DecisionStrategySchema. Public types are branch-specific. There is no new package and no legacy execution path.

A route declaration is {id, label}. The id uses the existing bounded slug syntax, excludes the reserved input name in, and is stable across display changes. Labels are trimmed, nonblank, at most 120 characters, and unique within the route set. Array order controls presentation, not edge identity.

| Branch | Stored and exported fields |
| --- | --- |
| Expression | {kind:'expression', jsonata, routes}. Routes contain 2-64 declarations. The snippet uses ExpressionSchema's 1-100,000 character bound, must contain non-whitespace source, and passes domain syntax and regex checks. It must return a scalar string equal to a declared route id. |
| LLM | {kind:'llm', instructions, routes, harness, model, effort, context}. Instructions use Liquid TemplateSchema, at most 100,000 characters, with existing whitespace and syntax semantics. Routes contain 2-64 declarations. Harness is codex, the currently implemented structured-evaluation scope. Model and effort are required inherit-or-explicit selections; explicit models retain the 256-character bound and exact catalog and effort checks. |
| Classifier | {kind:'classifier', answer, model, question, context, minConfidence?, truthThreshold?, recordAlternatives}. Model is an explicit classifier catalog id. Question uses Liquid. Confidence thresholds are finite numbers in [0,1]; truthThreshold is Noul-only and defaults to 0.5. recordAlternatives defaults to true and is classifier-only. |

There are no criteria, answer selectors, thresholds, provider settings, context controls, or recording controls on expressions. LLM routes contain labels rather than mandatory classifier criteria. Unsupported harness or provider combinations fail precisely. Adding Claude, LiteLLM, or another LLM evaluator is outside this change.

Decision context retains {messages, vars?, includeLastOutput}. Messages default to last; existing selection variants remain. Omitting vars includes all variables. includeLastOutput defaults to true. Liquid instructions and questions still render against the full thread. Selected provider state remains trigger payload, selected role/content messages, selected variables, and optional bare last-output value. Expressions use threadView and have no Context tab.

| Classifier answer | Fields and unchanged rules |
| --- | --- |
| Choice | {type:'choice', options:[{id,label,criteria}]}. There are 2-64 unique ids and labels. Criteria are trimmed, nonblank, and at most 2,000 characters. Ids are provider keys and graph ports. |
| Noul | {type:'noul', true:{id,label,criteria}, false:{id,label,criteria}}. Side ids and labels differ. Probability at or above the truth threshold selects true. Chosen-side confidence is p(true) or 1-p(true), independently of the truth threshold. Equality passes the confidence minimum. |
| Score | {type:'score', anchors, bands:[{id,label,min,max}]}. At least two ordered, nonblank anchors retain their 2,000-character and provider bounds. There are 1-64 unique bands. Finite nonempty intervals cover [0,N-1] without gaps or overlap. Lower bounds are inclusive; upper bounds are exclusive except the last endpoint. Fractional scores are not rounded or rescaled. |

Classifiers do not duplicate a routes array. decisionRouteDeclarations derives ports from options, sides, or bands. Expressions and LLMs use their declared routes directly.

These excerpts show the change; the complete field requirements are above.

```json
{"answer":{"type":"choice","options":[{"id":"done","label":"Done","criteria":"All checks passed"}]} ,"evaluation":{"kind":"llm","question":"Assess {{ vars.checks }}"}}
```

```json
{"kind":"llm","instructions":"Choose done when all checks passed; otherwise continue.","routes":[{"id":"done","label":"Done"},{"id":"continue","label":"Continue"}]}
```

These are excerpts, not importable definitions. Expressions store a declared route-returning snippet.
### Requests, outputs and factual evidence

LlmRouteRequest contains rendered instructions, route declarations, prepared JSON context and resolved model and effort. Codex forces exactly route, confidence and reasoning, all required, with additionalProperties false and route constrained to submitted ids. Adapter and engine validate types, membership and finite confidence in [0,1]; persist a reasoning excerpt of at most 2,048 characters. No repair or fallback occurs. Classifier requests retain question, options or sides or anchors, prepared state and a fixed registry snapshot. Choice keeps current transport retries; Noul and Score gain none.

```ts
type DecisionPayload = {
  portId: RouteId;
  provenance: EvaluationProvenance;
  observation: EvaluationObservation;
};
type EvaluationObservation =
  | {kind:'route'; routeId:RouteId; confidence:number|null; reasoning:string|null}
  | {kind:'boolean'; holds:boolean|null; confidence:number|null; reasoning:string|null}
  | {kind:'classifier'; answer:ClassifierAnswer};
```

Provenance requires kind, provider, classifierId, model and effort; use null for inapplicable or unrecorded facts. ClassifierAnswer retains Choice {type,optionId,confidence,probabilities}, Noul {type,holds,trueProbability,confidence}, or Score {type,score,confidence,legend,probabilities}. Remove Noul's redundant evaluator kind. Keep numeric and key validation: fresh Noul needs a boolean, probability and confidence; fresh Choice needs confidence and probabilities before recording suppression; Score retains provider applicability, with actual confidence required for a configured minimum.

Outputs and lastOutput use this payload. decision.made adds diagnostics, at most three, empty for fresh emissions. Fresh expression and LLM observations are routes equal to portId. Expression confidence, reasoning and provider facts are null; LLM provenance has resolved Codex values and confidence is informational. Fresh classifiers validate spec and port. Boolean observations are allowed for predicates and historical facts, never fresh decisions. Separate emission guards retain historical nulls without accepting old configs. Predicate guards no longer fabricate a decision port. Rejected classifiers retain validated evidence without a port or patch. Preserve typed failure, resumability and cancellation boundaries; retain no provider envelope or secret-bearing error text.

One CURRENT_DEFINITION_FORMAT constant drives current literals, exports, stamps, manifest and guard. It is 4 in the shipped result; frozen literals remain unchanged. Thread outer version stays 1, and #168's eventType is not inferred for old deliveries.
### Exit variant A: #167 option 1, keep loop-back

Keep ordered criteria, at most 32, default success or loop-back, optional loopBack.targetNodeId, and return mapping and channels. Preserve max-iterations, max-duration and last-output-matches order. Channels retain their 16 limit and caller default.

A predicate is {when:'predicate', predicate, outcome:'success'|'failure'}. Expression stores kind and jsonata and requires an actual boolean; true matches. LLM stores kind, instructions, Codex harness, model and effort and forces holds, confidence and reasoning with the same bounds as decisions. Neither has an answer or match selector. Classifiers retain answer, model, question, thresholds and explicit match: a Noul boolean, unique declared Choice id set, or finite Score comparison within the rubric. Exit Noul sides have labels and criteria but no ports; Score has anchors but no bands.

Keep fixed trigger, vars, bare lastOutput, lastMessage and iteration state, including current null behavior. First match wins; rejected classifier confidence never matches false. Errors stop evaluation. Criteria precede the implicit ceiling; final matches can complete and provider failures still fail. Continuation increments once or ends exhausted; the fresh-visit cap remains. exit.evaluated separates observation, comparison, acceptance, gate and result; historical unknowns stay null and old matching facts are never fresh authoring options.

### Exit variant B: #167 option 2, decisions and ordinary edges

Terminal exits store {outcome:'success'|'failure'|'exhausted', return:{mapping,channels}}, defaulting to success, with no criteria, continuation or ports. Decisions route to exits or work. Remove fresh loop-back handling but preserve event-first finalization, returns and parent notification; old lifecycle facts remain replayable.

Replace settings.maxIterations with maxNodeVisits, retaining the 1-10,000 bound and default 10. New cap failures use MAX_NODE_VISITS; old errors remain facts. Runs start at iteration 1 and ordinary edges do not increment it. Business counts and exhaustion require authored variables and policy. This is an owner-approved behavior change.

B and C add read-only execution.elapsedSeconds to expression and Liquid views, derived from ClockPort and recorded start time. Freeze its finite nonnegative value per evaluation; do not use JSONata wall-clock time or expose mutable engine state.

Conditional exits require reviewed graphs, counters, ordering, returns and captures. Decisions overwrite lastOutput, and classifier decision rejection fails where an exit predicate would not match. Restore incoming data and approve that difference; do not hide it with fallback. Unconditional exits convert directly; ignored continuation fields or edges still require reviewed removal.

### Exit variant C: #167 option 3, Continue owns maxPasses

Use B's terminal exits. Add NodeKind continue with strict config {maxPasses:number}, an integer from 1 to 10,000, default 10. Ports are repeat and exhausted, both connected by ordinary edges. exhausted leads directly to an exhausted exit; there is no duplicated targetNodeId. Proposed design limit for owner review: at most one Continue node per loop, with none needed for nonrepeating loops. This is not settled by #167; multiple budgets need defined identities and counter semantics before implementation.

run.iteration is the engine-owned pass counter and starts at 1. Policy decisions run first. Continue increments and follows repeat below its limit; otherwise it retains the count and follows exhausted. It emits no output patch. settings.maxNodeVisits counts each node's fresh visits cumulatively across the run and never resets on repeat. A final-pass policy can still succeed before Continue is visited.

A handler-specific result carries route, from, to and limit. Atomically append continuation.evaluated and node.finished, plus iteration.incremented only on repeat. Evidence records nodeId, from, to, limit and route; the increment names the actual edge target. Project count and cursor afterward. Recovery follows durable completion without another increment; interrupted uncompleted visits reevaluate the unchanged count. Fresh guards enforce this, and no historic Continue visits are invented.

The converter seeds Continue.maxPasses and settings.maxNodeVisits from old settings.maxIterations. Lower ordered limits stay explicit checks. Multiple exits or targets need a reviewed controller or authored graph. Preserve route ids, ordinary wiring and returns before approved reference edits. Report generated ids and layout changes. Even simple loop-back proposals require review; old prompts, false matches, confidence gates, timing, rejection and lastOutput consumers remain reviewed conversions.

The editor separates policy, pass budget and cumulative safety cap. C uses three bounded children and adds 3-5 days over A. Later adoption changes stored nodes, settings and graphs and requires another cutover.

### Scope shared by A, B and C

Decision schemas, route ids, LLM enums and confidence, classifier math, context, observations, editor wiring, undo and decision conversion are identical. Frozen inputs, manifest, backup, transaction, factual replay and devices are common. Exit schemas, lifecycle events, timing, budgets, graph rewrites and executable replay maps differ. Approve decisions first if desired; settle exits before final schema and cutover approval.
## 4. Stored data and integration cutover

### Classification and reviewed conversion

Inventory names classes supported by today's source. It does not claim counts from the owner's database. The ordinary conversion rules apply only to records that survive #165 retirement.

| Source | Resolution |
| --- | --- |
| Choice expression decision | Copy exact snippet and option ids and labels to routes. List removal of unused criteria and recording controls. Invalid source refuses. Consumer changes still need review. |
| Noul expression decision | Require a reviewed route-returning snippet that evaluates once, preserves strict boolean error behavior, and maps to original side ids. Do not coerce or stringify it. |
| Choice or Noul LLM decision | Preserve route identities and provider selections as a candidate. Require complete reviewed instructions based on old question and criteria. Historical boolean or route facts remain unchanged in meaning. |
| Classifier decision | Flatten evaluator fields and preserve spec, model, context, thresholds, recording policy, and routes. Do not recompute probability or score. |
| A expression predicate | Strict boolean with match=true converts structurally. A false match needs reviewed strict negation. |
| A classifier predicate | Preserve primitive, comparison, thresholds, order, outcome, return, and continuation. |
| A LLM predicate | Require reviewed boolean instructions for old Noul or Choice matching, including false matching. |
| Any old LLM confidence gate | Require individual reviewed removal or supported replacement, even for a zero threshold. Historic rejection remains evidence. |
| B or C conditional exit | Require the chosen reviewed graph, captures, timing, budgets, rejection behavior, return mapping, and replay entry. Unconditional terminal exits can convert directly. |
| Output consumers | Trace answer.holds, optionId, probabilities, legend, confidence, whole outputs, lastOutput, dynamic paths, aliases, schema checks, scripts, subloop results, and captured variables. Require exact source or value hashes and producer evidence. |

Traverse frozen Liquid/JSONata metadata, schemas, mutations, whole-thread and opaque inputs. Dynamic lookup, eval, aliases or unproven copies require review; a negative string search is not proof. Reject unused, conflicting or stale resolutions and bind repeated node ids separately per version.

### Reconciliation with #165 and #168

Accept #165's distinction between ordinary surviving history and retired automation. Bound implementation, review, and QA components are archive-no-reexecution, not nonresumable-replay. Unbinding them would weaken their authority and is not a conversion. Archive exact instance, subject, version, run, event, session, timer, delivery, pin, and related row closure before removal. Preserve signed journal bytes and their message authentication codes, worktree and branch evidence, artifacts, and encrypted key material in a verified private external bundle. Never execute reconciliation effects, resign journals, rotate keys, or delete physical worktrees.

A proven Starter may become ordinary. Its stored literal instruction can replace a proven templateSettings producer. History needs a separately proved instruction alias from the recorded producer or replay seed, applied consistently to initial threads, queued seeds, patches, and snapshots. Keep historical templateSettings facts. Alias collisions, edited consumers, or missing provenance require review or archive. An ordinary replacement for incompatible automation is a new draft with new identity, not a rewrite claiming the old published version ran that graph.

Mixed ordinary parents, shared inbound recipients and pinned dependencies block automatic removal. The owner approves the exact closure or preservation strategy. Archival must satisfy the joint pending-state rule below; retired live ids return 404 only after approved retirement.

Adopt #168's trigger rules in the same stage: rename subtype to type; preserve Manual, Cron, Poll, and Event subscription behavior; convert webhook signing into its approved authentication recipe; retain endpoint ids, tokens, historical payloads, keys, windows, and permanent claims. Do not infer old eventType or reevaluate keys without recorded headers. All ordinary webhook intake must use atomic receipt and frozen admission identity, with a durable 2xx acknowledgment; durable fan-out for `POST /events` is a #168 backlog proposal, not cutover scope. The repeated-body default remains #168's owner choice.

Correct the peer draft's reference to a Boolean decision builder. A downstream filter or GitHub recipe must use a format-4 expression decision with declared pass and ignore route ids, not a Noul answer. A generated wrapper evaluates the old filter once with exactly the coercion `evaluatePredicate` applies today (`packages/domain/src/expression.ts:199`) and returns a route id; no Boolean proof is required. Header-dependent filters need authored review. Formerly filtered input now creates a quiet run and can consume a key; evaluation errors occur after intake. Approve these behavioral changes per version.

Restore the trigger NodeOutput before the old successor. Quiet exits have mapping none and no channels: A uses empty criteria and default success; B and C use outcome success. Ignored intake never visits Continue. Retain configHash and delivery facts; never add gate or restore visits to history.

### Joint pending-state rule (#164 authority)

The cutover refuses stores with queued, running, waiting or paused runs, pending webhook receipts or frozen admission intents awaiting admission, or unfinished child notifications or timers. The old build settles them first; the converter never abandons, drains or executes them. Resolved historical intents remain evidence, not pending work. Terminal runs with unfinished finalization are also refused, with one exception: a retired template run whose only unfinished item is its private template report may be archived through an explicit per-run retirements.privateReports[runId] disposition approved by the owner, with a recorded reason and preserved evidence. This never authorizes abandonment of a pending delivery. #165 and #168 cite this rule.

### Factual history, strict current waits, and replay

Convert proven output envelopes, not lookalike JSON. Retain recorded ports, old Noul booleans and actual confidence and reasoning; never infer a missing route from a new definition. Old Choice routes must agree with recorded ports. Preserve classifier values and exit comparisons, gates, status and outcome. Missing facts stay null; fresh emissions need complete facts.

Translate add, replace, remove, copy, move, and test patches at exact output paths, including escaped pointers and whole-document writes. Partial writes or copies into changed payloads require a proven translation or hash-bound resolution; otherwise refuse. Never rerender historic returns, redeliver outbound effects, synthesize visits, or re-evaluate providers. Retain event ids, sequence, time, node identity, attempts, results, pins, and config hashes describing what actually ran.

Absorb D22 in this pass. Current WaitSpec.startedSeq becomes required. Derive a missing historical identity only from the uniquely corresponding recorded node.started and parked visit. Normalize old input or signal timeout-at-until into timeoutAt using recorded values; keep until for timer or heartbeat deadlines. Refuse missing or ambiguous evidence. Remove bare timer keys and runtime legacy wait repair after conversion. Current wake callbacks may still discover the current wait id; that is normal behavior, not permission to accept identity-free stored waits.

Remove the SSE legacy grace for a terminal status lacking a terminal event. Keep subscribe-before-read, sequence deduplication, and normal concurrent-append handling. Validate replay before sending headers. Inconsistent terminal evidence fails precisely; inventory requires repair or archive, never a fabricated terminal event.

Require Replay4(ConvertHistory3(H)) to equal the explicit transformed projection of frozen-source Replay3(H). Check each changed patch, stored snapshot sequence, final thread, and checkpoint plus tail with open-visit state. Unchanged regions compare exactly. Changed regions compare to an approved transform. Validate status, terminal event, lastEventSeq, outputs, parent and child relationships, results, and trigger facts. Archive-only components retain exact source history rather than claim current-runtime parity.

The joint pending-state rule controls admission to cutover. Affected surviving failed runs, including transitive parents and child pins, each need nonresumable-replay with a reason. Set resumable=false consistently in the run and relevant failure facts, preserving the cause in audit. Retired failures remain archive-no-reexecution. Resume and recovery enforce the disposition.

B and C replay maps record version_id, source_node_id, target_node_id, source_definition_hash, target_definition_hash, and manifest_hash, keyed by version and source node. Executable replay first reconstructs the reached source checkpoint, then validates the approved capture or policy entry. replayOf adds entryNodeId, with null only when an older fact did not record it. It retains runId and source nodeId. Unmapped points fail with guidance to an earlier approved point or a new run. Read-only replay is always distinct from starting a new execution, which may produce different answers. Deleted or archive-only loops cannot execute through replay.

### Integration and cutover

#164 owns one definition stage, associated history stage, manifest, command, SQL allocation, guard and rehearsal. #165 and #168 contribute rules to it, not additional formats.

Freeze c379f80's format-3 schema dependency closure with revision and per-file SHA-256 provenance before edits. Keep earlier frozen stages intact; mechanically bind present v2-to-v3 behavior to frozen schemas and prove golden and refusal equivalence. Composition supports 1 to 2 to 3 to 4, 2 to 3 to 4, and 3 to 4. Namespace earlier resolutions; current input rejects stale maps.

D10's upgrade subpaths, lazy chunk loading and bundle splitting are deferred to debt-register recommendation 11. Cutover retains the existing module-loading approach and still verifies offline device conversion; bundle optimization is not a release prerequisite.

Collect nonoverlapping edits against immutable source pointers in this order: #165 retirement, #164 decisions and chosen exits, #168 triggers, shared consumers and final validation. Conflicts refuse. Archive-only data never reaches execution.

SQL reservations align with both peers: 0012_retire_template_instances belongs to #165; 0013_trigger_configuration belongs to #168; 0014_format_four_cutover belongs to #164 only when metadata is needed. B or C maps and an approved #118 deletion marker can use 0014. Omit unused DDL. This is one unshipped set refined on integration, not per-child migrations. Preserve shipped SQL through 0011 and allocate ordered journal times centrally. Reconcile any main numbering change before approval.

Repair Drizzle's stale snapshot against shipped migrations before generation. Final metadata must match coordinated tables, expression indexes and constraints. A disposable generate check must produce no migration; compare fresh and upgraded schema catalogs. #165 archives before dropping its six indexes, template_subject and template_instances.

Limit D9 to bounded-memory inventory and apply on a store of the owner's size. Batch the largest tables, traverse needed events per run and hash incrementally where required. Measure peak memory on an owner-sized fixture and supplied-copy rehearsal. Do not build a general scalability framework or change engine log performance.

Inventory covers all surviving and retired identities and dependencies described above, including supplied exports and external evidence; devices are a separate obligation. Reports bind source, tool, schema, rule, SQL, journal, row and pointer hashes, classify automatic, reviewed, refused or archived changes, and show topology, pending state, failed dispositions, archive counts and replay results. Public evidence contains safe ids, counts and hashes, not credentials.

### Exact shared manifest schema

All objects below are strict. All fields and maps are required; empty maps are allowed. Hash means 64 lowercase hexadecimal SHA-256 characters. JsonPointer means a valid RFC 6901 pointer. Rule payloads pass the appropriate current config or reviewed graph validator before apply. #165 and #168 use this layout exactly.

```ts
type Manifest = {
  format:'graphgoblin-upgrade-manifest'; targetVersion:4;
  hashAlgorithm:'sha256-canonical-records-v1';
  sourceHash:Hash; converterHash:Hash; sqlHash:Hash;
  versions:Record<VersionId,{
    definitionHash:Hash; disposition:'convert'|'archive';
    legacyStages:{v1ToV2:FrozenV1Resolutions|null;v2ToV3:FrozenV2Resolutions|null};
    resolutions:{
      decisions:Record<JsonPointer,Rule>; exits:Record<JsonPointer,Rule>;
      templates:Record<JsonPointer,Rule>; triggers:Record<JsonPointer,Rule>;
    };
  }>;
  historyResolutions:Record<Id,{
    runId:RunId; record:'initial-thread'|'snapshot'|'event'|'result';
    seq:number|null; pointer:JsonPointer; sourceHash:Hash;
    replacement:JsonValue; reason:string;
  }>;
  retirements:{
    components:Record<Id,{
      rowSetHash:Hash; externalEvidenceHash:Hash|null;
      rows:Record<TableName,RowId[]>; removeRows:Record<TableName,RowId[]>;
      disposition:'archive-no-reexecution'|'unbind-starter'; reason:string;
      unresolvedEffects:{identity:string;kind:string;state:'confirmed'|'uncertain';evidenceRef:string}[];
    }>;
    privateReports:Record<RunId,{
      componentId:Id; runHash:Hash; reportEvidenceHash:Hash;
      disposition:'archive-private-template-report'; reason:string;
    }>;
    orphans:Record<Id,{
      rowSetHash:Hash; evidenceHash:Hash; rows:Record<TableName,RowId[]>;
      disposition:'restore-evidenced-version'|'archive-no-reexecution';
      restoredVersions:Record<VersionId,FrozenVersionRecord>;
      restoredLoops:Record<LoopId,FrozenLoopRecord>; reason:string;
    }>;
  };
  failedRuns:Record<RunId,{disposition:'nonresumable-replay';reason:string}>;
  expectedResultHash:Hash;
  approval:null|{approvedBy:string;approvedAt:Timestamp;approvedPlanHash:Hash};
};
type Rule = {
  sourceHash:Hash; action:'replace'|'approve-generated'|'review-unchanged';
  replacement:JsonValue|null; proposalHash:Hash|null; reason:string;
  sourceEdits:Record<JsonPointer,{sourceHash:Hash;replacement:JsonValue}>;
};
```

Rule keys and edits address the frozen stage input; cross-node consumer edits stay in their owning namespace. replace requires a validated replacement and null proposalHash; approve-generated requires a bound proposalHash and null replacement; review-unchanged requires both null and no edits. Reasons are nonblank. Legacy fields use their frozen validators. Hashing uses length-prefixed canonical records in defined table/key order, retaining original JSON text. Apply requires approval; preview uses null. Report entries authorize only a run already in their component, not independent deletion. Removed rows must be within bound row sets. Reject stale, unused, conflicting or overlapping writes.

Dry-run locks a supplied stopped store, verifies an independent scratch copy and runs the same apply and replay checks there. It never performs rollback-only source writes. Preview may have blank approval; it produces diffs, expected result hash, replay counts and planHash. Approval is {approvedBy, approvedAt, approvedPlanHash}. planHash covers the manifest excluding approval, including all rules, SQL, resolutions and expected result. Result hashing excludes approval and audit timestamps; the final manifest is also audited. Any changed source or plan needs fresh review. Hashes record integrity, not a cryptographic signature.

Lock the physical data directory and actual file database before opening SQLite. Verify a separate complete backup of the tree, database, WAL, SHM, encrypted secrets, key material, artifacts and supplied external evidence. Keep overlap, linked-database and source-change refusals. Copies neither snapshot external targets automatically nor isolate execution destinations.

One transaction rechecks hashes and blockers, archives all originals before destructive SQL, applies retirement and coordinated structural and semantic changes, validates current schemas, relations, constraints, pins, archive completeness, replay and result hash, and stamps complete last. Commit once. Reorder today's SQL-before-limited-archive path. Failure rolls back DDL, ledger, data, maps and marker. Inspect interrupted work rather than blindly retry it. Preserve older audits as inert, hash-bound history and verify post-commit readback.
### Prerequisites, devices, and rehearsal

#152 must be unparked and completed, or its bounded initialization repair explicitly authorized in #164, before final cutover. Fresh schema creation, migration ledger and marker use one transaction; crash injection proves an empty retryable store or a complete current store. Connection pragmas are not a substitute for atomic application state. Current-format readiness uses a declarative structure and ledger descriptor, not scattered format literals or historical timestamp constants. Existing stores are refused before ordinary migrations, recovery or trigger arming until the whole offline cutover is complete.

Before apply, authorize #118 or approve each orphan resolution. Restoration requires evidence of the actual definition and identity, never a current catalog substitute. Otherwise approve exact archive-only execution closure or refuse apply. An unparked #118 retains hidden, disarmed versions and blocks new admission or executable replay of deleted loops. Future deletion policy is not implemented while parked.

Device handling preserves active, set-aside and raw archive copies, metadata, tokens and incomplete source. Do not delete the drafts store to bump its version. Archive and read back originals before replacing an active key. Convertible old drafts become unsynced current drafts; ambiguous or incomplete old copies stay inert and exportable. Incomplete current drafts still reopen for editing. An old baseToken cannot be guessed after server conversion; use a proven mapping or require explicit reload or restore-overwrite with a fresh server token. Failed preservation blocks overwriting autosave. Invalidate old event caches; no tolerant cached-event reader remains.

Rehearse supplied consistent copies only after approved children and synthetic checks. Keep an untouched baseline, backed conversion copy and separately isolated runnable copy. Verify every retained run, snapshot, archive, identity, claim and schema; restore into another copy and prove old hashes before re-upgrade. Disarm ingress and retries and isolate commands, secrets and destinations. Record safety edits. Product review uses a separate port; installation and rollback remain owner actions.

## 5. Runtime, API, editor, and documentation changes

| Source on c379f80 | Planned change |
| --- | --- |
| packages/contracts/src/evaluation.ts:339; packages/contracts/src/nodes.ts:664; packages/contracts/src/events.ts:116; packages/contracts/src/loop.ts:50 | Replace the evaluator matrix, separate fresh evidence, add the chosen exit contract, and emit only current format. |
| packages/domain/src/answers.ts:63; packages/domain/src/graph.ts:188; packages/domain/src/expression.ts:143; packages/domain/src/syntax.ts:123 | Derive stable ports by kind, preserve classifier mathematics and expression limits, and validate source fields and chosen topology. |
| packages/domain/src/upgrade-current.ts:94; packages/domain/src/upgrade-history-current.ts:93; packages/domain/src/replay.ts:53 | Freeze earlier behavior, compose one current stage, translate proven facts, and verify replay. |
| packages/engine/src/primitive-evaluator.ts:116; packages/engine/src/handlers/decision.ts:35; packages/engine/src/ports.ts:219 | Separate classifier, route, and boolean operations with typed requests, exhaustive dispatch and fakes. |
| packages/engine/src/handlers/exit.ts:119; packages/engine/src/run-manager.ts:785; packages/engine/src/run-manager.ts:1471 | Implement the chosen lifecycle, disposition enforcement and replay entry maps while preserving event-first recovery. |
| packages/adapter-codex/src/decider.ts:43; packages/adapter-jev/src/decider.ts:236; packages/infrastructure/src/http/classifier.ts:169 | Replace LLM criteria prompts with instructions and enum validation; preserve classifier requests, fractions and retry behavior. |
| apps/api/src/classifier-issues.ts:5; apps/api/src/model-issues.ts:7; apps/api/src/loop-issues.ts:8; apps/api/src/routes/loops.ts:44 | Keep create, import, draft save, validate and publish in agreement, with precise branch paths and existing draft conflicts. |
| apps/web/src/editor/DecisionKindPicker.tsx:36; apps/web/src/editor/decision-route-edges.ts:93; apps/web/src/editor/ExitPredicateFields.tsx:557 | Show only applicable controls and retain stable edges, held text, undo and validation focus. |
| apps/web/src/editor/useLoadEditor.ts:29; apps/web/src/drafts/local-drafts.ts:89; apps/web/src/runs/inspector/EvaluationDetails.tsx:310 | Preserve device originals, load conversion lazily, reconcile tokens, and show factual route, answer, budget and confidence evidence. |
| packages/api-client/src/generated/schema.ts:2635; apps/mcp/src/describe.ts:23; apps/plugin-codex/plugin/graphgoblin/skills/design-loop/SKILL.md:38 | Regenerate clients and descriptions and update current authoring and inspection guidance. |

Kind changes are one undoable edit. Retain representable route ids and edges, preview lost fields, and let cancellation restore everything. Do not truncate many routes into Noul or invent criteria. Missing new source or provider configuration stays visibly incomplete and unsaved. Renaming labels or reordering routes does not change identity; temporary invalid ids do not transfer another route's edge. JSON replacements match ids.

Update numbered docs 02-07 and 09, relevant guides, retained examples and template drafts, fixtures, goldens, generated references and plugin guidance. The new ADR supersedes relevant parts of ADR-0022, ADR-0025 and ADR-0026; B or C also revises ADR-0010. Preserve historical ADR text. CHANGELOG covers fields, exports, output paths, format, devices and the actual offline workflow.

## 6. Single integration sequence

Every row targets feat/format-4-integration. #164 and shared cutover use GPT-6 Astra xhigh, Claude Opus 5.5 xhigh cloud review, and separate GPT-6.1 Sol xhigh QA. #165 and #168 use GPT-6.1 Sol xhigh implementation, Opus review and separate Sol QA. #118/#152 routing is checked after the owner authorizes them. Each child includes relevant tests, documentation and generated artifacts; counts include deletions. Split further if the actual diff exceeds about 40 files, never leave broken intermediate contracts.

| Order and owner | Child and scope |
| --- | --- |
| 01, #164 F | Freeze format-3 sources and earlier-stage equivalence before any schema edit; about 20-35 files. |
| 02, #152 or authorized #164 repair | Commit fresh schema, ledger and marker atomically; omit only if the equivalent repair is already complete. |
| 03, #118 if unparked | Preserve deleted-loop provenance and repair known orphans; otherwise the explicit inventory-resolution route remains a cutover prerequisite. |
| 04, #164 S | Establish the format constant, declarative readiness, owner-sized bounded-memory inventory and apply, and the snapshot baseline. |
| 05, #165 A | Move ordinary cursor paging and read contracts out of the template store; 10-14 files. |
| 06, #165 B | Disconnect private runtime authority and make the loader draft-only before service deletion; 16-24 files. |
| 07, #165 C1 | Delete implementation and review GitHub services; about 20-28 files. |
| 08, #165 C2 | Delete QA GitHub services; about 18-24 files. |
| 09, #165 D | Remove settings, instances, routes, contracts and store facade; include the four reduced manifests; about 26-40 files. |
| 10, #165 E | Retain only independent starting-point assets and remove product origins; about 25-35 files. |
| 11, #165 F | Delete examples/aidlc and its active references; 37 deletions and at most two reference edits. |
| 12, #164 D1 | Introduce decision contracts, evaluators, adapters and admission with minimal typed editor support; about 30-38 files. |
| 13, #164 D2 | Complete decision authoring, inspection, edge ownership and undo; about 25-38 files. |
| 14, #164 E-A, if A | Implement fixed boolean predicates and retained loop-back; about 25-38 files. |
| 15, #164 E-B1, if B | Implement terminal exits and the ordinary-edge counter policy; about 25-38 files. |
| 16, #164 E-B2, if B | Implement reviewed graph conversion and executable replay maps; about 25-38 files. |
| 17, #164 E-C1, if C | Implement continuation, terminal exits and atomic iteration completion; about 25-38 files. |
| 18, #164 E-C2, if C | Implement reviewed policy and budget graph conversion; about 25-38 files. |
| 19, #164 E-C3, if C | Complete controller authoring, inspection, replay and recovery QA; about 25-38 files. |
| 20, #168 T1 | Present trigger type first and make presets optional; about 20-35 files. |
| 21, #168 T2 | Add editable route-based checks, output restoration and quiet finish recipes; about 25-38 files. |
| 22, #168 T3 | Switch current trigger contracts and consumers to type; about 30-40 files. |
| 23, #168 T4 | Add general bodies, metadata and unified durable intake acknowledgment; about 28-38 files. |
| 24, #168 T5 | Implement the approved repeat and business-key policies with receipt and recovery tests; about 22-35 files. |
| 25, #168 T6 | Remove trigger filters, finalize converted graph rules and retain the bounded items-poll evidence; about 25-38 files. |
| 26, #164 C1 | Compose all rules, exact manifest, orphan resolutions, D22 history normalization and copy dry-run. |
| 27, #164 C-device | Complete lossless device conversion, token reconciliation and event-cache replacement. |
| 28, #164 C2 | Finalize the one SQL set, snapshots, guard, atomic apply, audit, restore and real-copy rehearsal. |

Both files use these step ids. #165 moves draft loading to B and manifests to D for coherent deletion. #168 steps 20-25 follow the selected exit steps 14-19 without exception; T2 uses route ids. Its shared C4 is step 28, not another cutover. Splits stay in sequence and update both files before review.

Children build on fresh disposable stores and never deploy separately. Existing stores await the final SQL set. Owner checkpoints cover decisions, exits, triggers and rehearsal. Final review binds the actual integrated head.

## 7. QA plan and evidence

Independent qa:touched-systems records positive and negative cases, commands, head hashes and artifact paths. No product test is claimed executed by this planning task.

| Boundary | Required evidence |
| --- | --- |
| Contracts and domain | Parse current branches and the chosen exit model. Reject old fields, duplicate ids, unsupported providers, invalid snippets or routes, malformed probabilities, threshold errors and Score gaps. Retain expression safety tests. |
| Engine and adapters | Capture prompts and enums without criteria. Verify responses, cancellation, typed failures, no fallback, Jev/HTTP boundaries, returns, child pins and recovery. Continue crash tests must prove no duplicate count. |
| API and editor | Check all admission paths, conflicts, branch-only controls, stable edges, undo, held JSON, focus, save/reload, factual inspection, JSON/SSE and retained template/MCP behavior. |
| Converter and devices | Cover every consumer, reviewed and refused cases, patches, checkpoints, waits, stale hashes, replay maps, archive/orphan dispositions and the joint pending rule, including private-report-only approval and rejection when any other work remains. Test token, quota and navigation failures without losing originals. |
| Storage and distribution | Verify atomic initialization, SQL, rollback, backups, audits, restore, owner-sized bounded memory, unchanged dry-run source, snapshot no-op, assets and offline device conversion. |

Live evidence is capped at eight evaluations or 15 minutes: Codex route and A boolean where applicable, Jev primitives and controlled HTTP primitives. Separate native and fixture evidence. Credentials or quota block a case rather than pass it; never switch evaluators or expose credentials.

Final gates cover typecheck, lint, layers, dependencies, tokens, coverage, licenses, generated clients/references, contrast, formatting, packaging, build, offline acceptance and touched browser scenarios. Keep coverage above 90% lines and branches. Use pnpm.cmd and the documented Node 22 dependency-cruiser binary when needed. With #127 parked, use uncached Turbo checks. Rehearsal covers every retained run.

## 8. Dependencies, debt reconciliation, and cutover gates

The sweep is under review. Absorbed items require approval of this scope; a sweep recommendation is not authorization to work on parked issues.

| Debt item | Reconciliation |
| --- | --- |
| D4 and #152 | This is a prerequisite, with the owner choice in section 2. Unpark #152 or explicitly authorize the equivalent bounded repair. Fresh initialization must be transactional. Source: packages/infrastructure/src/sqlite/db.ts:201. |
| D5 and #118 | This depends on an owner choice. Recommend hidden, disarmed provenance and repair under #118; alternatively require explicit evidence-based orphan restoration or archive-only resolution in cutover. Unresolved orphans refuse. Source: packages/infrastructure/src/sqlite/loops.ts:220. |
| D6 | Absorb the single format constant and declarative current readiness in S. Historical frozen literals remain intentionally unchanged. Source: packages/infrastructure/src/sqlite/upgrade.ts:107. |
| D8 | Absorb through the evaluator-specific decisions and approved A, B or C exits. Source: packages/contracts/src/evaluation.ts:290. |
| D9 | Absorb only batching, per-run traversal and incremental hashing needed for inventory and apply in bounded memory on an owner-sized store. Broader scalability stays out. Source: packages/infrastructure/src/sqlite/upgrade.ts:233. |
| D10 | Defer all upgrade-subpath, lazy-loading and bundle work to backlog recommendation 11 (filed as #188); remove child L. Offline device preservation remains in cutover. Source: packages/domain/src/index.ts:24. |
| D12 | Absorb with #165/#168: repair the snapshot baseline, finalize the single migration set, and require generation to be a no-op. Source: packages/infrastructure/drizzle/meta/_journal.json:1. |
| D22 | Absorb provable wait and timeout normalization, required stored startedSeq, and removal of legacy SSE grace. Missing evidence refuses rather than invents facts. Sources: packages/contracts/src/run.ts:97 and apps/api/src/sse.ts:13. |
| D23 | Absorb deletion of unused DecisionStrategySchema from current exports. Keep frozen copies as source evidence. Source: packages/contracts/src/nodes.ts:162. |

D13/#127 stays outside implementation while parked; bypass caching for evidence. D25's repeated guard is narrowly absorbed into S so one current admission check precedes startup. D26's architecture prose is refreshed with the final docs. General retention, RunManager decomposition, unmeasured engine performance and unrelated distribution or probe debt stay outside.

#165 owns D1, D2, D3, D24 and D27. Its paging precedes store retirement; authority and credential duplication disappear rather than become generic helpers. #168 owns D7, D17, D18, D19 and D29. Unified atomic intake, durable acknowledgment and shared fake/SQLite admission contract tests are required. It explicitly retains both poll modes and leaves general credential, working-directory and pagination improvements outside; this is a deliberate limited resolution of D19, not a claim it disappears.

Cutover prerequisites are: recorded #164/#165/#168 plan approvals; a settled #167 exit choice; the #152 authorization and completed repair; an approved #118 path with zero unresolved orphans; template retirement and external evidence dispositions; webhook repeat and filter resolutions; the joint pending-state rule satisfied; complete frozen-stage and schema checks; verified backup, dry-run and owner manifest hash; uncached gates, independent review, QA, restore evidence, and owner product acceptance. The actual installation remains a separate owner action.

## 9. Risks and gaps

Reviewed LLM prompts may change judgments. Static analysis cannot prove arbitrary scripts or copied values. Retired automation leaves the live inspector but retains exact archives. C still needs implementation tests; the research scenarios prove only today's engine facts. Missing provenance or pending effects can block a real store. Never invent evidence to pass a gate.

New providers, context redesign, continuity, purge policy, automatic installation and broad engine refactors remain outside. No retired automation equivalence or arbitrary-script confinement is claimed.

## 10. Acceptance mapping

| Checkbox | Evidence |
| --- | --- |
| Approved contract and #167 | Sections 2-4 define choices; exits and cutover wait for approval. |
| Evaluator controls and invalid results | Sections 3, 5 and 7 require branch-only UI and strict validation. |
| LLM instructions, enum and no fallback | Sections 3 and 7 require captured requests and typed failures. |
| Jev and HTTP primitives | Sections 3 and 7 preserve serialization, math and boundaries. |
| Switching, routes, save, undo, focus and exits | Sections 3, 5 and 7 require atomic edits and browser evidence. |
| Inventory, devices, backup, audit, replay and failed runs | Section 4 and cutover children cover every retained checkpoint and disposition. |
| Positive, negative, live and browser QA | Sections 7-8 require evidence and explicit blocked cases. |
| Docs, gates, coverage and owner before merge | Sections 5-8 bind final artifacts to independent review and owner acceptance. |
