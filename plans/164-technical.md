# Issue #164: technical implementation plan

Baseline: c379f806ba8a04433779d98ded7e4196c9d4b663 on codex-plan-164; citations refer there. This research revision uses the three peer drafts, the under-review debt register and #167 status. It grants no approval. Original inputs remain unchanged; no product, installed-instance, server or Git operations occur.
## 1. Summary

Decisions become evaluator-specific: expressions return stable route ids from one JSONata snippet; LLMs use freeform Liquid instructions and structured routes; Jev and compatible HTTP classifiers retain Choice, Noul and Score. Stable graph identity, classifier mathematics, defaults, context behavior, errors and returns remain. There is no evaluator fallback, context redesign under #38, or continuity work under #33.

The owner can approve decisions before choosing exits. A retains loop-back; B uses ordinary edges; C uses policy decisions, a dedicated Continue node with repeat and exhausted connections, and terminal exits. #167 now recommends C at medium confidence, and I agree. Its 40 scenarios establish current engine facts, not an implementation of C. Choosing C later requires a second cutover.

#164 estimates are 9-14 worker days for A, 11-18 for B, and 12-19 for C, including absorbed debt, shared tooling, review and QA. They exclude other issue implementation and owner or provider delays. Confidence is high for decisions and medium for exit selection and migration until copy inventory.

## 2. Owner decisions and approval boundaries

The owner has already chosen classifier-only answer types, instruction-driven LLMs, snippets, clean format 4, independent template starting points, and one integration branch. Only the owner changes plan gates. Plan approval does not approve an unseen manifest or installed update.

| Choice | Recommendation and consequence |
| --- | --- |
| #167 exits | #167 recommends C at medium confidence, and I agree. Under ADR-0020, parity gaps are build cost; keeping loop-back leaves the clutter and risks a second cutover. Split the maximum-pass budget from the cumulative per-node safety cap, seeding both from old maxIterations during migration. |
| Observation output | Approve the common evidence shape in section 3. It makes routing and raw answers clear, but existing output readers need updates. Keeping classifier paths needs a revised output union and consumer plan. |
| LLM exit confidence | Make it informational. Review each old gate for deliberate removal or a supported replacement. Keeping gates requires a revised proposal. |
| Routes | Keep 2-64 expression and LLM routes and 1-64 Score bands. A single route can be permitted explicitly; a larger limit needs provider and editor validation. |
| Old LLM conversion | Review every replacement instruction. Proposed text is not proof that a new prompt preserves an old judgment. |
| #152, parked | Unpark it before cutover, or explicitly authorize the bounded atomic-initialization repair in #164. Without either, fresh-store initialization blocks release. |
| #118, parked | Prefer hidden, disarmed deleted-loop provenance and repair under #118. Alternatively approve exact orphan restoration or archive-only resolution in inventory. Unresolved orphans refuse apply. |
| #127, parked | Leave its cache repair separate and use uncached final checks. Unpark it only if the owner wants that repair in this sequence. |

#165 still needs archive-only retirement and external evidence approval. #168 needs its repeated-body default and reviewed filter conversions. Recommend Allow for new bodies while preserving existing permanent claims; this is not approval on behalf of those issue owners.
## 3. Target contract

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

The change can be seen in these configuration excerpts. The complete required route and provider fields are defined above.

```json
{"answer":{"type":"choice","options":[{"id":"done","label":"Done","criteria":"All checks passed"}]} ,"evaluation":{"kind":"llm","question":"Assess {{ vars.checks }}"}}
```

```json
{"kind":"llm","instructions":"Choose done when all checks passed; otherwise continue.","routes":[{"id":"done","label":"Done"},{"id":"continue","label":"Continue"}]}
```

These excerpts illustrate the field change, not independently importable definitions. Expressions instead store a declared route-returning JSONata snippet.
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
### Exit variant A: keep loop-back

Keep ordered criteria, at most 32, default success or loop-back, optional loopBack.targetNodeId, and return mapping and channels. Preserve max-iterations, max-duration and last-output-matches order. Channels retain their 16 limit and caller default.

A predicate is {when:'predicate', predicate, outcome:'success'|'failure'}. Expression stores kind and jsonata and requires an actual boolean; true matches. LLM stores kind, instructions, Codex harness, model and effort and forces holds, confidence and reasoning with the same bounds as decisions. Neither has an answer or match selector. Classifiers retain answer, model, question, thresholds and explicit match: a Noul boolean, unique declared Choice id set, or finite Score comparison within the rubric. Exit Noul sides have labels and criteria but no ports; Score has anchors but no bands.

Keep fixed trigger, vars, bare lastOutput, lastMessage and iteration state, including current null behavior. First match wins; rejected classifier confidence never matches false. Errors stop evaluation. Criteria precede the implicit ceiling; final matches can complete and provider failures still fail. Continuation increments once or ends exhausted; the fresh-visit cap remains. exit.evaluated separates observation, comparison, acceptance, gate and result; historical unknowns stay null and old matching facts are never fresh authoring options.

### Exit variant B: decisions and ordinary edges

Terminal exits store {outcome:'success'|'failure'|'exhausted', return:{mapping,channels}}, defaulting to success, with no criteria, continuation or ports. Decisions route to exits or work. Remove fresh loop-back handling but preserve event-first finalization, returns and parent notification; old lifecycle facts remain replayable.

Replace settings.maxIterations with maxNodeVisits, retaining the 1-10,000 bound and default 10. New cap failures use MAX_NODE_VISITS; old errors remain facts. Runs start at iteration 1 and ordinary edges do not increment it. Business counts and exhaustion require authored variables and policy. This is an owner-approved behavior change.

B and C add read-only execution.elapsedSeconds to expression and Liquid views, derived from ClockPort and recorded start time. Freeze its finite nonnegative value per evaluation; do not use JSONata wall-clock time or expose mutable engine state.

Conditional exits require reviewed graphs, counters, ordering, returns and captures. Decisions overwrite lastOutput, and classifier decision rejection fails where an exit predicate would not match. Restore incoming data and approve that difference; do not hide it with fallback. Unconditional exits convert directly; ignored continuation fields or edges still require reviewed removal.

### Exit variant C: continuation owns the budget

Use B's terminal exits. Add NodeKind continuation with strict config {maxIterations:number}, an integer from 1 to 10,000, default 10. Ports are continue and exhausted, both connected by ordinary edges. exhausted leads directly to an exhausted exit. There is no duplicated targetNodeId. Allow at most one continuation per loop; zero is valid for a nonrepeating loop. Multiple independent budgets are outside scope.

Runs start at iteration 1. Policy decisions run first. Continuation increments and follows continue if below its limit; otherwise it retains the count and follows exhausted. It emits no output patch and leaves lastOutput unchanged. settings.maxNodeVisits separately bounds cycles that bypass the controller. A final-iteration policy may still succeed before the controller is visited.

A handler-specific result carries route, from, to and limit. Atomically append continuation.evaluated and node.finished, plus iteration.incremented only when continuing. Evidence records nodeId, from, to, limit and route; the increment names the actual edge target. Project count and cursor afterward. Recovery follows durable completion without another increment; an interrupted uncompleted visit reevaluates the unchanged count. Fresh guards enforce these rules; no historic continuation visits are invented.

The converter proposes policy checks, one continuation and terminal exits. Move the old global ceiling into the continuation and initially keep the same value as maxNodeVisits. Lower ordered limits remain explicit checks. Multiple exits or targets require a reviewed controller or authored replacement. Preserve original route identities, ordinary wiring and return configuration before approved reference changes; report all generated ids and layout changes. Even simple no-criterion loop-back proposals require topology and return review. Old instructions, false matches, confidence gates, timing, schema checks, rejection differences and lastOutput consumers remain reviewed conversions.

The editor exposes the controller's limit and connections; inspection separates policy from budget. C uses three bounded children for engine/contracts, graph conversion, and editor/replay QA, adding 3-5 days over A. Choosing C after format 4 changes stored nodes, settings and graphs again and requires a second cutover.

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

Use frozen source metadata to find every Liquid and JSONata field, then inspect schema, mutation patch, whole-thread, and opaque script inputs. Dynamic lookup, wildcard, closure, eval, assignment, or unproven copied data is not safe merely because a string search finds no old field. Reject unused, conflicting, overlapping, or stale resolutions. Repeated node ids in separate versions are separate approval items.

### Reconciliation with #165 and #168

Accept #165's distinction between ordinary surviving history and retired automation. Bound implementation, review, and QA components are archive-no-reexecution, not nonresumable-replay. Unbinding them would weaken their authority and is not a conversion. Archive exact instance, subject, version, run, event, session, timer, delivery, pin, and related row closure before removal. Preserve signed journal bytes and their message authentication codes, worktree and branch evidence, artifacts, and encrypted key material in a verified private external bundle. Never execute reconciliation effects, resign journals, rotate keys, or delete physical worktrees.

A proven Starter may become ordinary. Its stored literal instruction can replace a proven templateSettings producer. History needs a separately proved instruction alias from the recorded producer or replay seed, applied consistently to initial threads, queued seeds, patches, and snapshots. Keep historical templateSettings facts. Alias collisions, edited consumers, or missing provenance require review or archive. An ordinary replacement for incompatible automation is a new draft with new identity, not a rewrite claiming the old published version ran that graph.

Mixed ordinary parents, shared inbound recipients, and pinned dependencies block automatic component removal. The owner approves the exact expanded closure or preservation strategy. Ordinary pending receipts block cutover. A stopped retired component may have a receipt archived with explicit abandon-retired-target approval only when it has no surviving execution dependency and no active run. Preserve the pending original and acknowledge uncertainty; do not invent a finished run or successful effect. Kept terminal runs must settle finalization; retired unfinalized records may be archive-only with explicit uncertainty. Retired live ids return 404 after approved retirement.

Adopt #168's trigger rules in the same stage: rename subtype to type; preserve Manual, Cron, Poll, and Event subscription behavior; convert webhook signing into its approved authentication recipe; retain endpoint ids, tokens, historical payloads, keys, windows, and permanent claims. Do not infer old eventType or reevaluate keys without recorded headers. All ordinary webhook and event intake must use atomic receipt and frozen admission identity, with a durable 202 acknowledgment. The repeated-body default remains #168's owner choice.

Correct the peer draft's reference to a Boolean decision builder. A downstream filter or GitHub recipe must use a format-4 expression decision with declared pass and ignore route ids, not a Noul answer. A proposed wrapper evaluates a provably boolean old filter once and returns a route id. Nonboolean or header-dependent filters need authored review. Formerly filtered input now creates a quiet run and can consume a key; evaluation errors occur after intake. Approve these behavioral changes per version.

Restore the trigger's original NodeOutput before the old successor, using an ordinary mutation and proven outputs lookup. The quiet exit has no return effects: A uses empty criteria, default success, and mapping none with no channels; B and C use outcome success and that same return configuration. No continuation is visited on an ignored delivery. Preserve historical configHash and delivery facts; new gate and restore nodes do not appear retrospectively in old events.

### Factual history, strict current waits, and replay

Convert proven engine output envelopes, not arbitrary JSON containing answer or holds. Preserve recorded selected ports. Old nonclassifier Noul remains a boolean observation with its actual confidence and reasoning; do not derive a missing successful route from the new definition. Old Choice uses its recorded route with agreement checks. Classifier values and exit comparison, gate, status, and outcome remain factual. Unknown historical values stay null, while fresh emissions require complete applicable facts.

Translate add, replace, remove, copy, move, and test patches at exact output paths, including escaped pointers and whole-document writes. Partial writes or copies into changed payloads require a proven translation or hash-bound resolution; otherwise refuse. Never rerender historic returns, redeliver outbound effects, synthesize visits, or re-evaluate providers. Retain event ids, sequence, time, node identity, attempts, results, pins, and config hashes describing what actually ran.

Absorb D22 in this pass. Current WaitSpec.startedSeq becomes required. Derive a missing historical identity only from the uniquely corresponding recorded node.started and parked visit. Normalize old input or signal timeout-at-until into timeoutAt using recorded values; keep until for timer or heartbeat deadlines. Refuse missing or ambiguous evidence. Remove bare timer keys and runtime legacy wait repair after conversion. Current wake callbacks may still discover the current wait id; that is normal behavior, not permission to accept identity-free stored waits.

Remove the SSE legacy grace for a terminal status lacking a terminal event. Keep subscribe-before-read, sequence deduplication, and normal concurrent-append handling. Validate replay before sending headers. Inconsistent terminal evidence fails precisely; inventory requires repair or archive, never a fabricated terminal event.

Require Replay4(ConvertHistory3(H)) to equal the explicit transformed projection of frozen-source Replay3(H). Check each changed patch, stored snapshot sequence, final thread, and checkpoint plus tail with open-visit state. Unchanged regions compare exactly. Changed regions compare to an approved transform. Validate status, terminal event, lastEventSeq, outputs, parent and child relationships, results, and trigger facts. Archive-only components retain exact source history rather than claim current-runtime parity.

Refuse every queued, running, waiting, or paused run and all unresolved surviving receipts, pins, timers, returns, and finalization. The tool never drains or cancels them. Affected surviving failed runs, including transitive parents and child pins, each need nonresumable-replay with a reason. Set resumable=false consistently in the run and relevant failure facts, preserving the original cause in audit. Retired failures instead remain archive-no-reexecution. Resume and recovery enforce the disposition.

B and C replay maps record version_id, source_node_id, target_node_id, source_definition_hash, target_definition_hash, and manifest_hash, keyed by version and source node. Executable replay first reconstructs the reached source checkpoint, then validates the approved capture or policy entry. replayOf adds entryNodeId, with null only when an older fact did not record it. It retains runId and source nodeId. Unmapped points fail with guidance to an earlier approved point or a new run. Read-only replay is always distinct from starting a new execution, which may produce different answers. Deleted or archive-only loops cannot execute through replay.

### Integration and cutover

#164 owns one definition stage, associated history stage, manifest, command, SQL allocation, guard and rehearsal. #165 and #168 contribute rules to it, not additional formats.

Freeze c379f80's format-3 schema dependency closure with revision and per-file SHA-256 provenance before edits. Keep earlier frozen stages intact; mechanically bind present v2-to-v3 behavior to frozen schemas and prove golden and refusal equivalence. Composition supports 1 to 2 to 3 to 4, 2 to 3 to 4, and 3 to 4. Namespace earlier resolutions; current input rejects stale maps.

Expose conversion through @graphgoblin/domain/upgrade and frozen contracts through an upgrade-only subpath, with development, types and runtime exports. Remove root-barrel reachability. The browser lazily loads the pure synchronous converter for older drafts and precaches its chunk for offline use. Build inspection must show no frozen schemas in the initial application chunk.

Collect nonoverlapping edits against immutable source pointers in this order: #165 retirement, #164 decisions and chosen exits, #168 triggers, shared consumers and final validation. Conflicts refuse. Archive-only data never reaches execution.

SQL reservations align with both peers: 0012_retire_template_instances belongs to #165; 0013_trigger_configuration belongs to #168; 0014_format_four_cutover belongs to #164 only when metadata is needed. B or C maps and an approved #118 deletion marker can use 0014. Omit unused DDL. This is one unshipped set refined on integration, not per-child migrations. Preserve shipped SQL through 0011 and allocate ordered journal times centrally. Reconcile any main numbering change before approval.

Repair Drizzle's stale snapshot against shipped migrations before generation. Final metadata must match coordinated tables, expression indexes and constraints. A disposable generate check must produce no migration; compare fresh and upgraded schema catalogs. #165 archives before dropping its six indexes, template_subject and template_instances.

Use indexed keyset batches, incremental canonical hashing and per-run event traversal instead of whole-store arrays. Version the hash protocol's table, primary-key and column encoding; preserve original JSON text. Put dependency lookups in indexed scratch storage. Peak memory is bounded by the batch and largest needed record or thread; oversized records refuse. Measure memory and time on a large synthetic store. This changes offline traversal, not general engine log performance.

Inventory covers all surviving and retired identities and dependencies described above, including supplied exports and external evidence; devices are a separate obligation. Reports bind source, tool, schema, rule, SQL, journal, row and pointer hashes, classify automatic, reviewed, refused or archived changes, and show topology, pending state, failed dispositions, archive counts and replay results. Public evidence contains safe ids, counts and hashes, not credentials.

Manifest fields are {format, targetVersion, hashAlgorithm, sourceHash, converterHash, sqlHash, versions, retirements, historyResolutions, failedRuns, expectedResultHash, approval}. versions bind definitionHash, convert-or-archive disposition and namespaced rules. retirements bind #165 instance, binding, component, external evidence, delivery and exact row sets; archived failures cannot also be replayable. #168 binds trigger source, graph proposal, endpoint and claim facts. History entries bind run, sequence, pointer and value hash. Reject extra, unused, overlapping or stale entries and blank reasons.

Dry-run locks a supplied stopped store, verifies an independent scratch copy and runs the same apply and replay checks there. It never performs rollback-only source writes. Preview may have blank approval; it produces diffs, expected result hash, replay counts and planHash. Approval is {approvedBy, approvedAt, approvedPlanHash}. planHash covers the manifest excluding approval, including all rules, SQL, resolutions and expected result. Result hashing excludes approval and audit timestamps; the final manifest is also audited. Any changed source or plan needs fresh review. Hashes record integrity, not a cryptographic signature.

Lock the physical data directory and actual file database before opening SQLite. Verify a separate complete backup of the tree, database, WAL, SHM, encrypted secrets, key material, artifacts and supplied external evidence. Keep overlap, linked-database and source-change refusals. Copies neither snapshot external targets automatically nor isolate execution destinations.

One transaction rechecks hashes and blockers, archives all originals before destructive SQL, applies retirement and coordinated structural and semantic changes, validates current schemas, relations, constraints, pins, archive completeness, replay and result hash, and stamps complete last. Commit once. Reorder today's SQL-before-limited-archive path. Failure rolls back DDL, ledger, data, maps and marker. Inspect interrupted work rather than blindly retry it. Preserve older audits as inert, hash-bound history and verify post-commit readback.
### Prerequisites, devices, and rehearsal

#152 must be unparked and completed, or its bounded initialization repair explicitly authorized in #164, before final cutover. Fresh schema creation, migration ledger and marker use one transaction; crash injection proves an empty retryable store or a complete current store. Connection pragmas are not a substitute for atomic application state. Current-format readiness uses a declarative structure and ledger descriptor, not scattered format literals or historical timestamp constants. Existing stores are refused before ordinary migrations, recovery or trigger arming until the whole offline cutover is complete.

#118 must either be authorized or replaced by explicit orphan resolutions in inventory. Restoring an orphan's original version requires evidence of its actual definition and identity. No current catalog graph or invented replacement can establish historical provenance. If evidence cannot be recovered, the owner may approve exact archive-only retirement of the entire affected execution closure; otherwise apply refuses. If #118 is unparked, use hidden, disarmed deleted-loop records and retained versions, reject new admission and executable replay for deleted loops, and repair existing orphans explicitly. Future deletion policy is not silently absorbed while the issue remains parked.

Device handling preserves active, set-aside and raw archive copies, metadata, tokens and incomplete source. Do not delete the drafts store to bump its version. Archive and read back originals before replacing an active key. Convertible old drafts become unsynced current drafts; ambiguous or incomplete old copies stay inert and exportable. Incomplete current drafts still reopen for editing. An old baseToken cannot be guessed after server conversion; use a proven mapping or require explicit reload or restore-overwrite with a fresh server token. Failed preservation blocks overwriting autosave. Invalidate old event caches; no tolerant cached-event reader remains.

After approved children and synthetic checks, rehearse an owner-supplied consistent real-store copy, never the installed source. Keep an untouched baseline, a backed conversion copy, and a separately edited safe runnable copy. Verify every retained run and snapshot, archives, identities, claims, schema catalogs and integrity. Restore into another copy and prove old logical hashes with the old tools, then rehearse re-upgrade. Disarm copied ingress and receipt retries; isolate workspaces, scripts, secrets and return destinations before later execution. Record safety edits and their hashes. Owner product review uses a separate port and accepts behavior before main merge. Installation and complete rollback remain separate owner actions.

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
| 04, #164 S | Establish the format constant, declarative readiness, streaming inventory and safe snapshot-generation baseline. |
| 05, #165 A | Move ordinary cursor paging and read contracts out of the template store; 10-14 files. |
| 06, #165 B | Disconnect private runtime authority and make the loader draft-only before service deletion; 16-24 files. |
| 07, #165 C1 | Delete implementation and review GitHub services; about 20-28 files. |
| 08, #165 C2 | Delete QA GitHub services; about 18-24 files. |
| 09, #165 D | Remove settings, instances, routes, contracts and store facade; include the four reduced manifests; about 26-40 files. |
| 10, #165 E | Retain only independent starting-point assets and remove product origins; about 25-35 files. |
| 11, #165 F | Delete examples/aidlc and its active references; 37 deletions and at most two reference edits. |
| 12, #164 D1 | Introduce decision contracts, evaluators, adapters and admission with minimal typed editor support; about 30-38 files. |
| 13, #164 D2 | Complete decision authoring, inspection, edge ownership and undo; about 25-38 files. |
| 14A, #164 E-A, if A | Implement fixed boolean predicates and retained loop-back; about 25-38 files. |
| 14B1, #164 E-B1, if B | Implement terminal exits and the ordinary-edge counter policy; about 25-38 files. |
| 14B2, #164 E-B2, if B | Implement reviewed graph conversion and executable replay maps; about 25-38 files. |
| 14C1, #164 E-C1, if C | Implement continuation, terminal exits and atomic iteration completion; about 25-38 files. |
| 14C2, #164 E-C2, if C | Implement reviewed policy and budget graph conversion; about 25-38 files. |
| 14C3, #164 E-C3, if C | Complete controller authoring, inspection, replay and recovery QA; about 25-38 files. |
| 15, #164 L | Isolate upgrade exports and lazily load and cache browser conversion; about 12-25 files. |
| 16, #168 T1 | Present trigger type first and make presets optional; about 20-35 files. |
| 17, #168 T2 | Add editable route-based checks, output restoration and quiet finish recipes; about 25-38 files. |
| 18, #168 T3 | Switch current trigger contracts and consumers to type; about 30-40 files. |
| 19, #168 T4 | Add general bodies, metadata and unified durable intake acknowledgment; about 28-38 files. |
| 20, #168 T5 | Implement the approved repeat and business-key policies with receipt and recovery tests; about 22-35 files. |
| 21, #168 T6 | Remove trigger filters, finalize converted graph rules and retain the bounded items-poll evidence; about 25-38 files. |
| 22, #164 C1 | Compose all rules, exact manifest, orphan resolutions, D22 history normalization and copy dry-run. |
| 23, #164 C-device | Complete lossless device conversion, token reconciliation and event-cache replacement. |
| 24, #164 C2 | Finalize the one SQL set, snapshots, guard, atomic apply, audit, restore and real-copy rehearsal. |

This preserves both peer sequences. #165's loader moves into B to permit service deletion, and its reduced manifests move into D to keep strict contracts and packaged assets consistent. #168 T2 uses route ids and the chosen exit builder. Its shared C4 is the same #164 C2, not another PR or cutover. Optional fixture preparation can split a child only when required by the file budget and must be recorded explicitly in the sequence.

Children build on fresh disposable stores and never deploy separately. Existing stores await the final SQL set. Owner checkpoints cover decisions, exits, triggers and rehearsal. Final review binds the actual integrated head.

## 7. QA plan and evidence

Independent qa:touched-systems records positive and negative cases, commands, head hashes and artifact paths for every touched boundary. Tests are planned here, not claimed executed.

| Boundary | Required evidence |
| --- | --- |
| Contracts and domain | All current branches and exit alternatives chosen for delivery parse correctly. Reject old fields, duplicate ids, incompatible providers, invalid syntax, nonstring or undeclared routes, malformed probabilities, threshold errors and fractional band gaps. Preserve JSONata depth, timeout and regex checks. |
| Engine and adapters | Capture instructions and enum requests without criteria; verify strict responses, confidence bounds, cancellation, typed failures and no fallback. Test Jev and HTTP primitive serialization and exact boundaries, durable completion, child pins, returns and recovery. C must prove no duplicate increment after every crash point. |
| API, client, editor and inspector | Verify five admission paths agree, unsupported selections and conflicts fail precisely, route changes and undo preserve connections, only relevant controls appear, and historical unknowns are clear. Test keyboard focus, held JSON, save and reload, strict JSON and SSE, templates and MCP guidance. |
| Converter, data and devices | Test automatic, reviewed, refused and archived cases, all source and copied-result consumers, partial patches, every replay checkpoint, old wait identities, stale hashes and maps, active-state refusal, archive-only retirement, orphan resolution, token conflicts, quota, blocked storage and navigation races. |
| Storage and distribution | Test atomic fresh initialization, all actual SQL, injected rollback, complete backup and restore, audit counts, large-store memory, source-preserving dry-run, snapshot generation no-op, package assets and lazy offline conversion without initial frozen-schema loading. |

The shared live budget is eight evaluations or 15 minutes, whichever comes first: Codex route and A boolean where applicable, Jev Choice/Noul/Score, and compatible controlled HTTP primitives. Record native and fixture evidence separately. Missing credentials or quota is blocked evidence, not a pass. Do not switch evaluators to hide failure or expose credentials.

Final checks include typecheck, lint, layers, dependency rules, design tokens, coverage, licenses, generated clients and references, contrast, formatting, template packaging, build, offline acceptance and touched browser scenarios. Keep every package above 90% line and branch coverage. Use pnpm.cmd and the documented Node 22 dependency-cruiser binary when default Node 23 is unsupported. While #127 remains parked, run Turbo checks with --force and capture uncached results. Rehearsal covers every retained run, not a sample count.

## 8. Dependencies, debt reconciliation, and cutover gates

The sweep is under review. Absorbed items require approval of this scope; a sweep recommendation is not authorization to work on parked issues.

| Debt item | Reconciliation |
| --- | --- |
| D4 and #152 | This is a prerequisite, with the owner choice in section 2. Unpark #152 or explicitly authorize the equivalent bounded repair. Fresh initialization must be transactional. Source: packages/infrastructure/src/sqlite/db.ts:201. |
| D5 and #118 | This depends on an owner choice. Recommend hidden, disarmed provenance and repair under #118; alternatively require explicit evidence-based orphan restoration or archive-only resolution in cutover. Unresolved orphans refuse. Source: packages/infrastructure/src/sqlite/loops.ts:220. |
| D6 | Absorb the single format constant and declarative current readiness in S. Historical frozen literals remain intentionally unchanged. Source: packages/infrastructure/src/sqlite/upgrade.ts:107. |
| D8 | Absorb through the evaluator-specific decisions and approved A, B or C exits. Source: packages/contracts/src/evaluation.ts:290. |
| D9 | Absorb indexed streaming, incremental hashing and per-run offline traversal, with measured memory evidence. General engine performance work stays out. Source: packages/infrastructure/src/sqlite/upgrade.ts:233. |
| D10 | Absorb upgrade subpaths and lazy, offline-cached browser conversion in L. Broader route splitting stays out because it is not necessary for this cutover. Source: packages/domain/src/index.ts:24. |
| D12 | Absorb with #165/#168: repair the snapshot baseline, finalize the single migration set, and require generation to be a no-op. Source: packages/infrastructure/drizzle/meta/_journal.json:1. |
| D22 | Absorb provable wait and timeout normalization, required stored startedSeq, and removal of legacy SSE grace. Missing evidence refuses rather than invents facts. Sources: packages/contracts/src/run.ts:97 and apps/api/src/sse.ts:13. |
| D23 | Absorb deletion of unused DecisionStrategySchema from current exports. Keep frozen copies as source evidence. Source: packages/contracts/src/nodes.ts:162. |

D13/#127 stays outside implementation while parked; bypass caching for evidence. D25's repeated guard is narrowly absorbed into S so one current admission check precedes startup. D26's architecture prose is refreshed with the final docs. General retention, RunManager decomposition, unmeasured engine performance and unrelated distribution or probe debt stay outside.

#165 owns D1, D2, D3, D24 and D27. Its paging precedes store retirement; authority and credential duplication disappear rather than become generic helpers. #168 owns D7, D17, D18, D19 and D29. Unified atomic intake, durable acknowledgment and shared fake/SQLite admission contract tests are required. It explicitly retains both poll modes and leaves general credential, working-directory and pagination improvements outside; this is a deliberate limited resolution of D19, not a claim it disappears.

Cutover prerequisites are: recorded #164/#165/#168 plan approvals; a settled #167 exit choice; the #152 authorization and completed repair; an approved #118 path with zero unresolved orphans; template retirement and external evidence dispositions; webhook repeat and filter resolutions; no surviving active or pending state; complete frozen-stage and schema checks; verified backup, dry-run and owner manifest hash; uncached gates, independent review, QA, restore evidence, and owner product acceptance. The actual installation remains a separate owner action.

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
