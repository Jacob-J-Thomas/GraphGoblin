# Issue #165: technical removal and cutover plan

Baseline: `c379f806ba8a04433779d98ded7e4196c9d4b663`, HEAD of `codex-plan-165`. Code citations refer to that commit. Supplied peer inputs are unchanged; reported peer tests were not rerun here. This research changes no product, Git state or installed instance.

Terms: API means application programming interface; PR means pull request; QA means quality assurance; DTO means data transfer object; ADR means architecture decision record; DDL means data definition language; CI means continuous integration; MAC means message authentication code. SQL denotes database statements. ULID is the repository's 26-character identifier.

## 1. Summary

Remove configured instances, settings, prerequisites, bindings, subject authority, private support scripts and services and configured assets. Delete examples/aidlc. Keep four manual starting graphs, installed catalogue and POST /templates/:id/draft. Copies are independent ordinary loops; their later GitHub effects require explicit ordinary nodes.

Move run paging first. Recommend archival retirement of configured repository executions: exact evidence remains offline while ordinary and supported Starter history stays live. Live access to retired history needs additional non-executable storage semantics. Estimate 5-7 worker days plus 1-2 days of shared-cutover participation; live access adds about 3-5 days. Confidence is high in boundaries and medium in unseen data effort.

All children target feat/format-4-integration. #164 freezes format 3 first and owns one converter, manifest and transaction. Nothing is deployed or migrated independently.

## 2. Owner decisions and open choices

The October 9 decisions are settled: retire automation, keep ordinary implementation, review and QA starting points and delete examples/aidlc. No private helper may obtain former authority from thread settings. #107-#113 are already closed; preserve Git history and prior reports and remove active installation promises.

| Choice | Recommendation and alternatives |
| --- | --- |
| Retired history | Archive it offline. Runs leave the live list and inspector and URLs return 404; original IDs, history, attempts, journals and worktrees remain indexed. Live access instead requires general non-executable versions enforced at every execution route, an amended schema and API design and 3-5 additional worker days. |
| Unfinished terminal private reports | Allow exact archive-no-reexecution retirement after writers stop, preserving uncertainty. Both peers must adopt it. Otherwise settle old reporting first. Active runs, pending deliveries and surviving unfinished effects still block. |
| Parked #118 | Recommend unpark before cutover. Alternatively require individually reviewed orphan inventory resolutions. Never guess missing versions or implicitly delete ordinary history. |
| Parked #152 | Recommend unpark. Alternatively authorize an equivalent atomic fresh schema and marker fix in shared work. Without a fix, fresh-store acceptance is blocked. |
| Parked #127 | Keep parked and run qualifying verification without cache. This does not fix cache keys. |
| #167 exits | Keep for now is the supplied medium-confidence recommendation, not an owner decision. If the continuation-node option is wanted, choose now and include it in format 4; choosing later requires another cutover. #164 must revise its design and estimate. |

Retain evidence indefinitely; no physical cleanup, key rotation or GitHub reconciliation is authorized. Architecture approval differs from later exact-manifest and installed-upgrade approval. New ADR supersedes configured ADR-0027 and ADR-0028 consequences and completes ADR-0030 (`docs/decisions/ADR-0030-templates-are-starting-points.md:17`); keep supersession links and historical text. Code waits for human plan approval and the applicable gate (`docs/15-issue-workflow.md:9`). This document unparks nothing.

## 3. Target contract

### Catalogue and drafts

Keep existing catalogue and draft schema names with one strict shape:

| Field or type | Definition |
| --- | --- |
| TemplateManifest.id | Use existing SlugSchema: letter first, then letters, digits, underscores or hyphens, at most 64 characters. |
| version | Use the semver pattern with maximum 64 characters; it identifies the asset revision only. |
| title and description | Require nonempty strings with maxima 120 and 4,000 respectively. Describe actual behavior. |
| tags | Allow at most 20 nonempty strings of at most 40 characters; default to an empty array. |
| draftFile | Require a portable relative .json path of at most 512 characters without traversal or empty components, relative to manifest folder. |
| TemplateCatalogEntry | Require exactly {manifest:TemplateManifest}. |
| TemplateListResponse | Require {items:entries[]} with at most 100 entries and unique IDs. |
| TemplateDraftRequest | Allow only {name?:string}; require a nonblank 1-120-character name and trim it as today. |
| TemplateDraftResponse | Require exactly {loop:LoopRecord,draft:LoopVersionRecord,issues:LoopIssue[]}. |

Delete kind, roles, prerequisites, requiredSecrets, parentKey, loops and supportEntry and bundle, instance, settings, prerequisite and instantiate DTOs and exports (`packages/contracts/src/template-settings.ts:14`, `:51`, `:95`; `template-manifest.ts:21`, `:49`, `:149`, `:184`; `index.ts:27`). Ordinary settings, model fields, Liquid and directory kind template remain.

Loader returns {manifest,draft:LoopDefinition}, parses current export and graph, and clones every creation. Preserve the shipped policy (`packages/domain/src/template-bundle.ts:38`): manual triggers, no scripts, subloops or heartbeat nodes, caller-only returns. It does not restrict later edits. Delete configured allocation and remapping.

Keep GET /templates and /templates/:id under loops:read; keep POST /templates/:id/draft under loops:write. Creation returns 201 from the owner-scoped loop and draft transaction, with no publication, run, child or binding. Normal invalid configuration admission stays (`apps/api/src/routes/templates.ts:44`); missing login does not block authoring. Remove configured routes and client helpers; use normal authentication and 404 handling, no compatibility handler. Strict old settings bodies reject.

Unknown IDs return 404 TEMPLATE_NOT_FOUND. Asset faults, including direct file, link, containment and size failures, return fixed sanitized 503 TEMPLATE_PACKAGE_INVALID. Handle only the trusted catalogue error, not arbitrary 5xx. #134 stays open with a narrowed scope and route evidence.

Before and after, with unrelated fields omitted:

```json
{"manifest":{"id":"review","kind":"review","loops":[],"supportEntry":"dist/templates/github/review-entry.js","draftFile":"draft.json"},"settingsSchema":{},"defaultSettings":null,"prerequisites":{}}
```

```json
{"manifest":{"id":"review","version":"2.0.0","title":"GitHub PR review","description":"Review supplied context; no automatic GitHub effects.","tags":["review"],"draftFile":"draft.json"}}
```

Increment asset revision and accept only the new shape. #164 sets definition and export version 4, independently of asset semver.

### Run reads and paging

Use canonical RunRecord; remove API-only templateSubject and loop-detail templateInstanceId (`apps/api/src/templates/run-view.ts:12`, `apps/api/src/routes/loops.ts:34`). Keep loopId, comma-separated status, parent ID or none, before, cursor and limit from 1 to 500, defaulting to 100. Remove repository, issue, pullRequest, head, mergeSha and templateInstanceId filters; strict query validation rejects them rather than widening results.

Generic cursor is bounded canonical base64url of strict {createdAt:Timestamp,id:ULID}; invalid cursors return 400 INVALID_CURSOR and before and cursor cannot be combined. SqliteRunRepository.page requires authenticated ownerId, ordinary filters and exclusive `(created_at,id)<(?,?)` with descending tuple order. Fetch limit + 1 up to 501; existing list caps the page at 500 (`packages/infrastructure/src/sqlite/runs.ts:201`). Preserve typed GET pages and the items-only wrapper; MCP timestamp paging remains separate.


## 4. Stored data and shared format-4 conversion

### Inventory and dry-run

No owner-store inventory is claimed. Later use supplied stopped-store copies and independent physical repository clones. Inventory never executes stored programs or accesses original directories and external destinations embedded in copied definitions.

| Area | Required evidence |
| --- | --- |
| Instances and definitions | Inventory all instance columns, manifests, settings, allocations, support and binding hashes, and every version of member loops. Include edited drafts and later versions, missing or foreign ownership, and unbound private-support or legacy invocations. |
| Runs and delivery | Record subjects, owners, versions, parents, children, queued subloop pins, status, failures, resumability, events, initial threads, snapshots, sessions, timers and finalization. Include all schedules, endpoints, tokens, inbound links, receipts, intents, run IDs, pinnedLoopIds and poll keys. |
| Consumption | Preserve issue attempts and PR heads, active PR, merge, QA attempt and worker-visit identities, mapped claim, PR, rework, reopen and outcome facts and signed reservations preceding node.finished. Missing completion does not prove absence of effects. |
| External evidence | Capture approved journals, temporary files, registered worktrees, dirty/untracked content, commit and tree IDs, task, fixer and proof branches and proof manifests. Use approved canonical roots, never thread-selected paths. |
| Credentials | Record original journal key references and authentication outcomes, never plaintext. Preserve necessary encrypted key material privately; do not rotate or revoke it. |

Journal locations are established by `apps/api/src/templates/github/repository.ts:24`, `:95` and `qa-history.ts:132`: `.git/graphgoblin/{implementation,review}/<runId>.json` and `.git/graphgoblin/qa/<identityDigest>.qa.json`; worktrees are under `.graphgoblin-worktrees/<runId>`. Preserve bytes, MACs and identities without re-signing. Inventory implementation intents/quarantine (`github/storage.ts:7`), review pendingGate/push/authorization/merge/close/notices (`review-storage.ts:19`) and QA proof/report/reopen/relabel/budgets (`qa-journal.ts:18`).

Reports classify automatic, reviewed and refused records and include source, schema, converter, SQL and file hashes, safe IDs and row counts, pointers, dependency closure, blockers, proposed removals, archive digests and replay checks. Missing evidence is unavailable, not zero. Full contexts remain private. Use #164's streamed inventory and hashing rather than another whole-store materialization.

### Manifest entries under #164's converter

Agree with the supplied single envelope:

```json
{"format":"graphgoblin-upgrade-manifest","targetVersion":4,"sourceHash":"...","converterHash":"...","sqlHash":"...","versions":{},"failedRuns":{},"retirements":[],"historyResolutions":[],"expectedResultHash":"...","approval":{"approvedBy":"...","approvedAt":"...","approvedPlanHash":"..."}}
```

#164 owns its schema and hashing. Propose `versions[id].resolutions.v3ToV4.templates` and the entries below within its `retirements` and `historyResolutions`. These names need one adoption by #164; there is no separate converter or runtime profile. Freeze the retired template DTO decoders and Starter producer semantics under #164's source provenance before deletion, for offline tooling only. Earlier namespaces and frozen stages remain intact. Collect changes against original IDs and pointers, reject overlap and emit only final format 4.

| Manifest location | #165 entry proposal |
| --- | --- |
| `versions[versionId]` | Keep definitionHash. Its template map contains action and nonblank reason. Actions are preserve-ordinary, convert-starter, replace-with-ordinary-draft or archive-no-reexecution. Bind instanceId, instanceHash and bindingHash when present; Starter also binds producerNodeId, instructionPointer and consumerPointers. A replacement requires its complete format-4 definition and fresh target loop and version IDs, fixed before approval. |
| Instance retirement | Use `{kind:'template-instance',ownerId,instanceId,instanceHash,bindingHash,action,loopIds,versionIds,runIds,rowSetHash,evidenceHash,reason}`. Action is unbind-starter or archive-no-reexecution. Lists are exact; no wildcard closure is inferred. |
| Row or field retirement | Use `{kind:'template-record',table,rowKey,ownerId,column,originalValueHash,action,componentId,reason}`. Column is null for whole rows; action is archive-field or archive-row-and-remove. Keys use actual primary-key fields, including runId and seq for events. Archive before removal. |
| External files | Use `{kind:'template-evidence',componentId,evidenceRef,fileHash,action:'preserve-external',reason}`. The private manifest identifies approved roots and files. It authorizes preservation, never cleanup or Git effects. |
| Terminal exception | Use `{kind:'template-terminal',ownerId,runId,runHash,componentId,action:'archive-no-reexecution',unresolvedEffects,reason}`. Each effect records identity, kind, confirmed or uncertain state and evidenceRef. Peer and owner approval are mandatory; active, pending or surviving execution cannot use it. |
| History mapping | Bind runId, event sequence or null, exact pointer, originalValueHash, action and replacement or reviewed reason. Map only proven projection facts; invent no authority, provider or terminal evidence. |
| Failed runs | Keep #164's nonresumable-replay disposition for retained affected failures. Retired runs use retirements with archive-no-reexecution, with no executable replay permission. |

All entries bind exact hashes, including automatic maps. Unknown, unused, stale or overlapping instructions refuse. approvedPlanHash covers rules, SQL, resolutions and expected result as #164 specifies; changing them requires a new dry-run and approval.

### Conversion and historical projection

| Source | Rule |
| --- | --- |
| Ordinary copied draft | Make no #165 semantic change. Preserve IDs, variables, policies, models, limits and layout; peer stages perform their own shape changes. |
| Proven original Starter | Rewrite the known literal templateSettings producer to ordinary `/vars/instruction` using its stored instruction, and update proven assistant reads. Preserve explicit model and loop configuration; remove template-owned containers, instance and binding. |
| Edited Starter | Require per-version shape and all-consumer proof because `apps/api/src/templates/runtime.ts:107` exempts it from immutable execution-hash checks. Otherwise require reviewed replacement or retirement; never reset defaults. |
| Configured repository automation | Never substitute catalogue draft.json automatically. Approve complete executable retirement; future ordinary copies get new IDs and no old budgets or authority. |
| Unbound private or legacy invocation | Identify every node, probe and path and downstream consumer. Require retirement or complete reviewed ordinary replacement, including edges, outputs, returns and directories; never translate automatically into gh. |
| Portable export or device draft without provenance | Refuse automatic retired-automation conversion, preserve original JSON and explain missing proof. Absence of a binding is not authority. |

For retained Starter history, keep old templateSettings evidence and append an instruction patch derived from the recorded literal producer to its node.finished. Map initial_thread, run.queued.initialThread and thread_snapshot consistently only with proven producer or replay-seed provenance. Bind every changed pointer in historyResolutions and archive originals. Refuse collisions, altered facts or untraceable seeds; never use current defaults.

Prove #164's replay equation at every changed checkpoint, final projection and checkpoint-plus-tail, including replay just before assistant (`packages/engine/src/run-manager.ts:809`). Preserve event types, sequences and historical configHash. Add no synthetic visits or inferred provider/authority facts. The shared provenance map relates executed source config to the current definition. Reviewed replacements create new drafts with manifest-bound IDs, not altered historical published meaning.

### Stop, resolve and preserve state

Agree with both peers: refuse every queued, running, waiting or paused run, active descendant and pending receipt. Withdraw converter-time pending abandonment. Resolve any abandonment or permanent failure under the old build or separately approved repair, then stop and reinventory. Conversion dispatches nothing and allocates no replacement execution. Owner-directed cancellation may run old GitHub finalization; it is not an implicit upgrade step.

Surviving terminal runs with unresolved returns or null finalized_at also block. Do not invent completion. New startup re-finalizes such rows (`packages/engine/src/run-manager.ts:981`). The sole requested peer amendment permits exact retirement of terminal template-only unfinished finalization after writers stop. Approve its run hash, entire non-executable component and unresolved facts in retirements; it reaches no new recovery. If #164 and #168 reject that exception, settle the old report first. It cannot excuse ordinary effects or pending receipts.

Use `gg_upgrade_archive(kind,identity,source_hash,manifest_hash,payload)` and stopped backup (`packages/infrastructure/src/sqlite/upgrade.ts:205`, `tooling/scripts/upgrade.mjs:72`). Preserve previous archives and audit-chain hashes. Archive original instances, subjects, affected definitions/runs/events/threads/snapshots and manifest with joinable IDs. Independently preserve journals, worktrees, refs, proofs and necessary encrypted keys; data-dir backup alone cannot cover them. Record file-manifest digests, never re-sign journals or remove physical evidence.

Retirement removes only approved rows in loops, loop_versions, runs, run_events, harness_sessions, timers, schedules, webhook_endpoints, webhook_receipts and affected inbound_events. Archive first and remove dependents before parents/versions. Include every version, worker and pinned dependency. A crossing ordinary loop or parent, shared inbound recipient or artifact blocks automatic removal; review a preservation resolution or explicitly name ordinary rows for archival. Migration 0012 never implicitly deletes ordinary history.

Retired hook URLs disappear; archive their token, intent and key evidence and never reuse IDs. #168 preserves all surviving endpoint tokens and consumed claims. Whole-target retirement does not reset a surviving ledger. Retired runs return 404 live and remain locatable offline. Kept history retains IDs, relationships, times, results, failures, sessions, artifacts and factual events, including old authority JSON. Apart from the proven Starter map, peer stages own history changes. Retired failures get no executable replay permission. New copies inherit no repository-wide permanent attempt budget; ordinary scripts need explicit duplicate-effect prevention.

### SQL, snapshots and transaction order

Agree with `0012_retire_template_instances` for #165, `0013_trigger_configuration` for #168 and conditional `0014_format_four_cutover` for #164 metadata. Do not create an empty 0014 or assume the undecided continuation design needs the first draft's option-B replay columns. #164 controls increasing timestamps and final hashes. Adjust only unshipped reservations if main takes a slot; leave shipped SQL unchanged.

D12 requires a new authoritative final snapshot and a no-change drizzle-kit generation check on a disposable copy. Coordinate it with #168's final schema. Available snapshots stop at 0008; repair metadata without rewriting shipped migration hashes or accepting regenerated template structures.

The only template runs column is template_subject (`packages/infrastructure/src/sqlite/schema.ts:80`); template_instances contains id, owner_id, instance and binding (`schema.ts:330`). templateInstanceId is API-only. Keep generic parent, thread, checkpoint, finalization and dedupe structures. Working-directory kind template is unrelated.

```sql
DROP INDEX template_issue_attempt_idx;
DROP INDEX template_qa_merge_idx;
DROP INDEX template_pr_head_idx;
DROP INDEX template_active_pr_idx;
DROP INDEX template_child_visit_idx;
DROP INDEX template_qa_issue_attempt_idx;
ALTER TABLE runs DROP COLUMN template_subject;
DROP TABLE template_instances;
```

The table drop removes template_instances_owner_idx. Verify exact source structures, not IF EXISTS. Test deployed libsql DROP COLUMN support; any rebuild must preserve surviving rows, columns, checks and ordinary indexes with matching counts/digests. The indexes originate in `packages/infrastructure/drizzle/0009_templates.sql:12` and `0010_qa_issue_attempt.sql:3`.

Follow #164's sequence: lock the stopped physical store, verify source and manifest and complete independent backup; begin one transaction; recheck blockers; archive every changed or dropped source; apply structural SQL and approved row removals; write transformations computed from immutable originals; validate current graphs, histories, ownership, pins, replay and expected result; stamp format 4 last; commit once. Remove dependent rows in order after their archive. Original inventory supplies subjects after the column drops. Failure rolls back DDL, ledger, rows and marker.

This changes `packages/infrastructure/src/sqlite/upgrade.ts:553`, `:575`, which runs SQL before limited archival. Used stores are never stamped independently by SQL. Fresh schema, migration ledger and marker commit together under authorized #152 or equivalent work. Existing format 3 refuses before migrations, recovery and arming; mixed or already-format-4 states follow #164's refusal and no-reapply rules.

Dry-run uses the same apply on a new copy, never rollback-only source writes. Audit checks counts, original and converted hashes, SQL and rule digests, dispositions and replay. Rehearse complete restore into another copy, confirm old logical hashes and re-upgrade. No such operation or owner-instance access occurs in this planning turn.


## 5. Runtime, API and editor changes

### Module boundaries

Abbreviated filenames in a row share the directory of its first full path.

| Source | Required change |
| --- | --- |
| `packages/contracts/src/template-settings.ts:14`, `:51`, `:95`; `template-manifest.ts:21`, `:49`, `:149`, `:184`; `index.ts:27` | Delete configured DTOs and exports; retain section 3's catalogue and draft schemas. |
| `packages/domain/src/template-bundle.ts:38`, `:82`, `:230`; `index.ts:10` | Keep the draft validator, remove allocation and remapping and preserve unrelated Liquid template.ts. |
| `apps/api/src/templates/catalog.ts:28`, `:49`, `:63`; `assets.ts:6`; `copy-catalog.ts:1`; `instances.ts:17`, `:42`; `prerequisites.ts:38` | Load and clone drafts with existing file safeguards. Delete settings, defaults, prerequisites and support closures; catalogue no longer probes models, GitHub, secrets or storage. |
| `apps/api/src/templates/binding.ts:11`; `runtime.ts:111`, `:171`, `:424`, `:543`; `scripts.ts:53`, `:64`, `:193` | Remove bindings, authority, subject, failure and result modules, private ScriptPort and admission/execution policies. |
| `apps/api/src/container.ts:241`, `:295`, `:372`, `:394`, `:413`, `:445`, `:451`, `:461`; `templates/github/reporter.ts:19` | Delete credential/authority dispatch, wrappers and installImplementationFinalization, which replaces markFinalized. Preserve ordinary lifecycle and returns. |
| `packages/infrastructure/src/sqlite/runs.ts:7`, `:123`; `admission.ts:26`, `:153`; `templates.ts:158`; `schema.ts:80`, `:330`; `index.ts:21` | Move paging before deleting TemplateTransaction and its store and template-only callbacks. Preserve transactions, compare-and-swap, admission identity, pins and postcommit notifications. |
| `apps/api/src/routes/runs.ts:101`, `:144`, `:178`; `loops.ts:34`, `:213`; `templates.ts:26`, `:68`, `:99`, `:148`; `apps/api/src/templates/run-view.ts:12`; `apps/api/src/plugins/auth.ts:46`, `:54` | Use canonical reads and general paging; remove subjects, origin and configured routes and scopes. Keep catalogue and draft routes and ordinary storage diagnostics. |
| `packages/api-client/src/resources.ts:274`; `generated/schema.ts:1385`; `apps/web/src/api/queries.ts:32`, `:69`; `apps/web/src/editor/EditorPage.tsx:79` | Delete obsolete methods, origin queries/warnings and their fixtures. Regenerate clients; preserve gallery guards, handoff recovery, errors and independent editing. |
| `apps/api/scripts/check-templates.mjs:24`; `apps/api/package.json:24`, `:27`; `.github/workflows/ci.yml:93`; `package.json:31` | Keep source, package and image draft gates and invalid-graph refusal. Remove support execution checks and verify obsolete assets/examples are absent. |

Remove template-only executionIdentity (`packages/engine/src/ports.ts:322`, `handlers/script.ts:56`, `apps/api/src/triggers/poll.ts:256`) and hooks at `ports.ts:410` if no general consumer remains. Preserve ordinary environment, stdin/stdout, cancellation, timeout and output bounds. The generic GitHub poll recipe remains without instance authority. No new package is needed.

### Every privileged node and retained graph

Promote existing draft.json files. Delete configured starter/loop.json, repository parent.json, implementation/worker.json, qa/adversary.json and exclusive configured prompts/schemas. Their settings producers, support-output routing and memory, pinned mappings, privileged waits and exits disappear. This asset replacement is not automatic instance conversion. Each table lists every support probe and node and its source line.

Implementation source: `apps/api/templates/implementation/parent.json`.

| Old node and line | Plain-graph effect |
| --- | --- |
| start poll probe, 27 | Manual input replaces issue discovery. |
| claim, 62 | No durable claim or label effect remains. |
| prepare, 75 | The ordinary directory creates no verified checkout or worktree. |
| plan, 232 | The planner proposes a plan without authenticated task allocation. |
| task-prepare, 289 | The implementer handles one task without task worktrees. |
| task-complete, 400 | Verification performs no support commit or task merge. |
| gate, 445 | The verifier assesses checks; it is not a native gate or unchanged-commit proof. |
| pr-intent, 646 | No signed intent or fixed PR contract remains. |
| pr-created, 686 | The graph performs no push or PR creation. |
| complete, 726 | It returns verification, without a PR label or report. |
| block, 783 | It returns failure, without remote label and comment reconciliation. |

Worker/gate-fixer subloops and the separate PR writer disappear. The ordinary graph plans, implements, verifies and routes success, blocked or retry. It edits accessible configured source or honestly proposes a patch when only text is supplied. Current maxIterations is 3 (`apps/api/templates/implementation/draft.json:13`); turn timeouts are 300, 900 and 300 seconds. Prompts forbid commits, pushes and GitHub effects; this is not operating-system confinement.

Review source: `apps/api/templates/review/parent.json`.

| Old node and line | Plain-graph effect |
| --- | --- |
| start poll probe, 26 | Manual change context replaces PR discovery. |
| claim, 61 | No consumed-head reservation remains. |
| prepare, 74 | The directory guarantees no fetched exact SHA. |
| gate, 130 | The reviewer reports checks; no CI polling runs. |
| verdict, 274 | An expression routes status; it posts no native approval. |
| fix-prepare, 323 | Findings reach the fixer without authenticated intent. |
| fixer-head, 425 | Local changes cause no commit or push reconciliation. |
| summary, 480 | Outputs cause no remote posting or privileged wait. |
| human, 666 | Deleted waits grant no merge or close authorization. |
| reminder, 715 | No reminder or needs-human label remains. |
| merge, 759 | The graph merges nothing. |
| close, 815 | The graph closes no PR. |
| timeout, 871 | Ordinary ceilings replace the private report. |
| block, 927 | Ordinary failure performs no remote reconciliation. |

Fresh reviewer and fixer sessions remain separate. Approval returns, blocked fails and changes-needed fixes/retries. Current maxIterations is 3 (`apps/api/templates/review/draft.json:13`), with 300-second review and 900-second fix turns. No exact-head admission, native approval, CI freshness, signed recovery or human merge policy survives.

QA source: `apps/api/templates/qa/parent.json`.

| Old node and line | Plain-graph effect |
| --- | --- |
| start poll probe, 26 | Manual evidence replaces merged-PR discovery. |
| claim, 61 | No merge or attempt reservation remains. |
| prerequisites, 74; qa-prerequisites, 368; adversary-prerequisites, 606 | Ordinary harness validation remains; no flag establishes isolation. |
| prepare, 139 | The directory supplies no trusted merge or diff preparation. |
| criteria-check, 312 | The criteria plan has no enforced completeness or depth validator. |
| proof-check, 494 | Evidence strings create no authenticated proof branch or push. |
| evidence-prepare, 550 | No isolated evidence workspace is created. |
| adversary-check, 670 | The assessment expression authenticates no proof. |
| rework-status, 741 | No previous-attempt or budget service remains. |
| qa-rework, 802 | No signed reservation or implementation handoff remains. |
| issue-reopened, 872 | The graph reopens nothing. |
| relabel, 911 | The graph changes no label. |
| rerun-prepare, 967 | A plain retry receives the challenge without durable control. |
| human, 1039 | An inconclusive result posts no GitHub request. |
| qa-outcome, 1095 | The caller gets {qa,challenge}, without remote reporting. |
| block, 1139 | Ordinary failure performs no external recovery. |

Criteria, QA and adversary produce pass, fail or inconclusive and sound, unsound or inconclusive statuses. Sound plus pass succeeds, unsound retries and other results block. Current maxIterations is 2 (`apps/api/templates/qa/draft.json:13`), with 300-second turns. This worksheet offers no enforced evidence-only isolation or authenticated proof. Production configured effects were already unavailable (`apps/api/src/templates/github/qa-native.ts:29`); deletion does not prove isolation.

Starter keeps manual input, instruction, fresh assistant and caller result, maxIterations 10 and a 300-second read-only turn with no network access (`apps/api/templates/starter/draft.json:13`). All four default to temporary directories. Missing context stays unknown. Future triggers, event choices, models, scripts, predicates, counters, timeouts, directories and secrets are ordinary configuration, with no replacement template authority guarantee. #164 maps decisions and exits; preserve current retry loop-back until #167 settles it.

### Follow-up disposition

Retirement closes a root only after its code, assets and recovery path is gone and final evidence is linked. No closure happens on plan approval. The orchestrator updates issues separately. Below, short module paths are relative to `apps/api/src/templates/`; other roots are explicit.

| Issue | Disposition with code evidence |
| --- | --- |
| #131 | Retire readiness and settings UX in instances.ts:26 and prerequisites.ts:38; general model guidance remains. |
| #132 | Retire repeated preflight in instances.ts:26, :38 and prerequisites.ts:38; test zero catalogue probes. |
| #133 | Retire binding-error classification at runtime.ts:429; preserve ordinary storage diagnostics. |
| #134 | Keep open, narrowed to catalogue and draft faults. assets.ts:6 survives; catalog.ts:98 emits 503 but `apps/api/src/plugins/errors.ts:131` preserves only 4xx. Add narrow 503 handling/tests. |
| #136 | Retire shared checkout and GitHub text at prerequisites.ts:241; no diagnostic service replaces it. |
| #138 | Retire github/process.ts:362's private pnpm resolver; ordinary scripts inherit no identity guarantee. |
| #139 | Retire cancel-label paths at github/reporter.ts:244 and github/implementation.ts:216. |
| #140 | Retire template discovery and bounds at github/implementation.ts:78 and github/runtime.test.ts:1015. Generic first-failure behavior at `apps/api/src/triggers/poll-items.ts:15` remains separate. |
| #141 | Retire the shared FETCH_HEAD race at github/review.ts:230, :231. |
| #142 | Retire five-second CI polling at github/review.ts:616-621. |
| #143 | Retire merged discovery at github/qa-client.ts:39, :49 and github/qa-native.ts:40. |
| #144 | Retire reporter recheck and marker recovery at github/qa-reporter.ts:47, :62 and `apps/api/src/container.ts:445`; preserve unresolved facts. |
| #145 | Retire materialization at github/qa-proof.ts:227, :246; keep existing files, not a proof-storage claim. |
| #146 | Retire combined gate/CI budgets at `apps/api/templates/review/parent.json:135` and github/review.ts:263, :616; ordinary timeouts stay. |
| #148 | Retire origin lookup at `apps/web/src/editor/EditorPage.tsx:79` and `apps/web/src/api/queries.ts:69`; ordinary policy explanations remain. |
| #149 | Retire digest and sequence mismatch at github/qa-support.ts:216, :411 versus github/qa-history.ts:152; archive uncertainty, not repaired authority. |
| #153 | Retire the maximum-settings authority gap at `packages/contracts/src/template-settings.ts:109`, :110 and authority.ts:82. No unmeasured overflow is asserted. |
| #32 automation | Retire QA parent/support effects (`apps/api/templates/qa/parent.json:26`, github/qa-native.ts:29). Keep the worksheet; do not claim automated proof/isolation/reopen passed or close the whole issue. |
| #28, #30, #31 | Leave retesting/closure to the owner. Draft API `apps/api/src/routes/templates.ts:26` stays; supply independent-copy and usefulness evidence and use Part of, not Closes (`docs/15-issue-workflow.md:51`). |

#137 is already closed. #107-#113 are already retired. Make no inferred disposition for #135 or #147, and do not certify arbitrary user-authored GitHub effects.


## 6. Child PR breakdown

Every #165 child uses GPT-6.1 Sol xhigh as implementer, Claude Opus 5.5 xhigh in a separate cloud session as reviewer, and a separate GPT-6.1 Sol xhigh agent for touched-system QA after approval. Planning remains solo. Supply repository code and evidence without requiring owner-instance access. Each child targets `feat/format-4-integration`, compiles and passes relevant gates; count all changed files and split at about 40.

| Order and title | Scope and approximate files | Verification and documentation |
| --- | --- | --- |
| Shared freeze prerequisite | #164 freezes format 3 and existing conversion semantics before #165 removes schemas. | Verify provenance and previous golden/refusal behavior. |
| A. Ordinary run paging and reads | 10-14 files move the tuple pager and remove template read metadata, filters and origin queries. | Check 500-row continuation, equal timestamps, owners and errors; update doc 07, client and OpenAPI and upgrade notes. |
| B. Disconnect template authority | 16-24 files remove composition, private hooks, credentials and finalization wrapping. | Check ordinary scripts, admission, transitions and finalization; add removal ADR and update doc 11. |
| C1 and C2. Delete support services | Two children of roughly 20-28 and 18-24 files remove implementation, review and QA services, entries and tests. Move catalogue loading first. | Check imports, build and retained behavior; update installed checks and doc 08. |
| D. Delete configured contracts and APIs | 26-36 files remove instance/settings APIs, DTOs, store and fakes, and prepare 0012. | Check strict old bodies, paths and filters, scope and fresh schema; update doc 07, generated references and CHANGELOG. |
| E. Keep ordinary assets and finish product docs | 25-35 files remove configured graph assets and origin fixtures, revise manifests and guides, and finalize packaging. | Check every retained graph and browser copy, error and handoff path; update doc 09, guides 08-12, ADR links/index and CHANGELOG. |
| F. Delete legacy examples | 37 deletions and at most two active references; put additional reference edits in E. | Verify live references and distribution absence. Preserve historical Git and reports. |
| Shared cutover | #164 owns final converter, manifest, SQL, snapshot repair and rehearsal. #165 contributes roughly 6-12 inventory/resolution/fixture files. | Prove archive, replay, rollback and restore behavior; finish guide 08 and generated/docs consistency. Shared routing follows #164's GPT-6 Astra/Opus labels, with independent Sol QA. |

Reorder B through E only to keep consumers and remaining types compiling. Catalogue closure imports must disappear before support modules, and paging must move before the template transaction facade. No intermediate deployment, format marker or migration is allowed. After #165, #164 completes decisions and the chosen exits, then #168 completes triggers, then the shared cutover qualifies the final branch.

Update docs 07-09 and 11 for routes, triggers, editor behavior and security posture. Supersede ADR-0027 and ADR-0028 with the new ADR and cross-link 0030. Guides 09-12 explain actual effects and ordinary configuration; guide 08 documents manifest, offline archive and restore. Update packaging checks, generated API and node references and clients, guide index and CHANGELOG upgrade notes for removed fields, endpoints, exports and device drafts. Final generation runs after peer changes. Prior release entries remain factual.

## 7. QA and acceptance evidence

After implementation approval, test every touched system on disposable stores and safe repositories. Distinguish unit, fixture, browser, native and package evidence. Mark unavailable and unexecuted cases; a fixture does not prove production isolation. No tests or server were started for this research revision.

| System | Required positive and negative cases |
| --- | --- |
| Contracts, routes and client | Four valid manifests and current drafts round-trip. Old settings, instance metadata and filters reject; removed paths and fields are absent from OpenAPI. Scope and cross-owner failures remain correct. |
| Catalogue and distribution | Source, built package and read-only image without network access load four drafts without providers. Unknown IDs return 404; malformed, missing, oversized, nonregular, linked, escaping, duplicate or invalid assets give fixed sanitized 503 without writes. Deliberately invalid graphs fail the gate. Obsolete assets and entries are absent. |
| Copies and editor | Create each template twice, edit, reload, export and publish one and prove the other copy and catalogue unchanged. Creation allocates no run, publication or child. Check pending guards, keyboard and narrow layout, failed creation, lost response and handoff recovery without automatic mutation retry. |
| Paging and history | Check empty, full and multiple pages, equal timestamps, every ordinary filter, insertion between pages, 500 plus lookahead and final null cursor. Compare ID sets. Reject malformed cursors, obsolete filters and foreign owners. Live history works without template SQL; retired IDs locate offline and return 404 live. |
| Generic runtime | Check ordinary script, manual, event, schedule, poll, webhook and subloop behavior, cancellation, pause and resume, returns and finalization. Reject stale intents, duplicate keys, invalid stored events and missing targets. Inject storage/transaction failures. No private support or report path is called. |
| Retained graphs | Run actual packaged graphs with inert harnesses through useful, blocked, malformed-output, retry and ceiling cases. Check separate sessions and explicit policy failures without fallback. Assert no automatic GitHub effects. Owner later judges usefulness on safe task context. |
| Migration and state | Cover ordinary copies, original and edited Starter, configured workers, multiple versions, subjects, journals and snapshots. Refuse stale hashes, forged or missing evidence, orphans, crossing dependencies, active writers, pending receipts and unresolved surviving finalization. Test the proposed terminal retirement exception separately, if adopted. |
| SQL and recovery | Prove archive-before-DROP, exact approved row sets, removal of six indexes/table/column, and preserved generic columns, indexes and consumption. Inject failures around archival, SQL, transformations and marker; rollback restores all DB state. New recovery runs no retired intent/helper. |
| Evidence and replay | Recover original IDs, patches, snapshots, attempts, signed bytes and worktree evidence. Compare transformed full/checkpoint/tail replay. Missing facts, config-hash conflicts, alias collisions and archive-count mismatches refuse. Verify private recovery instructions without exposing keys. |
| Debt safeguards | Prove ordinary markFinalized behavior, zero template preflight, atomic fresh schema and marker, final Drizzle generation with no change, and uncached qualifying checks. Do not claim #118, #152 or #127 implementation without authorization. |

Final gates include `pnpm.cmd check`, `format:check`, build, client generation, offline upgrade acceptance, installed image checks and Edge browser tests where web behavior changes. Keep every coverage threshold and exclusion unchanged; use Node 22 for dependency-cruiser if default Node is 23. Bypass Turbo cache for qualifying local evidence until #127 is fixed. Dependencies are not added or linked from outside the worktree to bypass missing tools.

Handoff records head and base commit IDs, file counts, model identities, commands and outcomes, coverage, schema/route/package evidence, copy IDs, paging comparison, graph results, source and manifest/archive hashes, row counts, replay and rollback and restore reports. Independent review and QA are distinct from implementation tests. The owner receives readable inventory and exact manifest before an installed upgrade is proposed.

## 8. Dependencies and reconciliation

### #163 debt register

The register is under review. Its "Observed" entries describe the sweep's reproductions; static inspection here confirms source boundaries but does not repeat those tests.

| Debt | Disposition in this plan |
| --- | --- |
| D1 | Absorbed. Remove all template seams from transitions, admission, engine hooks, scripts and finalization, including the method wrapper at `apps/api/src/templates/github/reporter.ts:19`. Keep generic transaction and lifecycle safeguards. |
| D2 | Absorbed first. Move the tuple pager out of `apps/api/src/routes/runs.ts:144` and the template facade. Keep the separate MCP contract out of scope. |
| D3 | Absorbed through shared 0012. Archive subjects/instances before removing the table, column and six indexes in `packages/infrastructure/drizzle/0009_templates.sql:1` and `0010_qa_issue_attempt.sql:3`. |
| D12 | Shared dependency and required acceptance. The final snapshot must match the removal and #168 schema; #164 owns coordinated journal/snapshot repair and the no-change generation test. Source evidence is `packages/infrastructure/drizzle/meta/_journal.json:1`; available snapshots stop at 0008. Do not accept a generator output that recreates template storage. |
| D24 | Absorbed by deletion. Remove both credential resolvers and per-kind dispatch at `apps/api/src/container.ts:372`, `:394`, `:413`. Do not consolidate a retired capability into a new helper. |
| D27 | Absorbed. Delete the example tree rooted at `examples/aidlc/README.md:1`. The register reports 1.4 MB; that measurement was not rerun here. #107-#113 are already closed, unlike the register's older closure suggestion. |

D4 (#152) and D5 (#118) are shared cutover dependencies, not silently expanded #165 implementation. `packages/infrastructure/src/sqlite/db.ts:201` separates migration from stamping, while `loops.ts:220` deletes versions without run history. Choose the parked-issue or explicit shared-fix/resolution routes in section 2. Generic orphan repair never follows from template retirement. D13 (#127) remains out of scope with uncached verification. #164 owns D6, D9, D10, D22 and D23; #165 supplies streaming inputs and preserves frozen provenance. #168 owns D7, D17, D18, D19 and D29; #165 removes hooks without weakening their replacement generic admission.

### Peer plan and exit seams

Section 4 adopts #164's manifest, numbering, freeze and transaction order, and #168's pending-state refusal and surviving consumption rules. The terminal private-finalizer exception remains a peer amendment, not agreed behavior. Without joint adoption, resolve those reports first. #168's repeat-body policy remains its owner's choice and grants no template authority.

The #167 input reports 40 passing engine scenarios with fakes and an Opus "post with changes" review. It identifies real differences in iteration, exhaustion, duration, lastOutput and evidence. Its recommendation is being revised to keep for now with medium confidence. The first #164 draft's two exit alternatives do not resolve the new middle option: if the owner selects a continuation node, #164 must specify its budget, visit/iteration split, exhausted routing, recovery and migration before final approval. Keeping now and replacing later costs another data cutover. Do not silently choose an option in retained template assets.

Shared files include contract entrypoint, loop and node schemas; domain conversion and history; SQLite repositories, schema and migration metadata; API composition, routes and polling; retained assets, clients and docs. #164 owns format and device conversion, #168 owns triggers and receipts, and #165 owns retirement. Follow section 6 and verify the integrated head.

## 9. Risks and gap analysis

Silent unbinding would allow an old graph to run without its former authority. Complete executable retirement and exact manifest closures prevent that. Pending admissions and surviving unfinished effects are blockers; an accepted archival exception preserves uncertainty rather than pretending to complete it. Evidence outside the data directory requires separate repository copies and private key-material preservation.

Live inspector access to retired automation, archive UI, replay of private graphs, a general GitHub authority service, native QA isolation and equivalent merge/reopen safety are outside the recommended scope. The live-history alternative needs an amended design. General polling defects, MCP pagination, #33 session continuity, #38 context design, #124/#125 layout and general process confinement remain separate. Historical QA reports and earlier release entries remain factual.

Real data volume and unresolved effects are unknown. No owner database or rehearsal was used in this revision. The final upgrade requires supplied-copy evidence, authorized parked prerequisites, the #167 decision, independent review and owner manifest acceptance. Missing dependencies or review capacity do not authorize owner-instance access or weaker completion claims.

## 10. Acceptance mapping

| Issue acceptance | Plan and required evidence |
| --- | --- |
| Both owner answers and an approved plan settle automation, examples, storage and guarantees | Sections 1-4 apply the recorded answers and expose history, terminal-finalization and parked-prerequisite choices. Human gate changes precede code; the exact data manifest is approved later. |
| Only independent starting points remain | Sections 3 and 5 remove configured DTOs, APIs, runtime, storage and assets. Schema, route, package and repeated-copy checks prove absence and independence. |
| Paging, history, catalogue and copies work, including failures | Sections 3 and 7 cover tuple paging, lookahead, owner scoping, strict errors, retained replay and installed/browser checks. The retired-history limitation is explicit. |
| Stored/active/pending state has disposition and preserved evidence without duplicate effects | Section 4 binds exact archive/retirement/projection rules and refusal order. Section 7 proves backup, atomic apply, no-effect recovery, rollback and restore. |
| Any retained automation proves equivalent safeguards; unavailable QA is not claimed verified | No privileged automation is retained. Section 5 identifies every deleted effect and actual plain behavior. Independent QA checks absence, not imaginary equivalence. |
| Follow-ups, owner retests, ADR, docs, packaging, generated artifacts and gates are reconciled | Sections 5-8 provide dispositions and code, owner-only closure, child/docs work, unchanged gates and debt/peer reconciliation. #134 stays narrowed; #32 automation is separate; final cutover waits for #167 and agreed exceptions. |

For review, post the summary and this technical plan as consecutive comments, summary first. This task only writes the files. The orchestrator checks the history choice, terminal exception, parked prerequisite decisions, proposed manifest namespaces, final SQL/snapshot parity and buildable child splits before implementation admission.






