# Five-intent delivery register — 2026-11-17

## Approval and admission

This section records the November 17, 2026 approval and admission snapshot. The linked issues,
PRs and dated [execution checkpoints](2026-11-17-intent-1-execution.md) own subsequent gate,
finding and delivery states; this scope register does not replace their exact-head records.

The owner approved the proposed next batch on November 17, 2026:

> I approve this plan. Send it to the main thread to implement the five intents in order after the macOS launcher, preserving all AIDLC gates and using Claude Code for UI and other implementation work that claude is better suited for, QA, and adversarial review.

The main workflow received the complete handoff and independently read back that user message
in Codex chat `01a1e73c-108c-7333-bb8d-5359783ff9f1`, turn
`01a1eadd-c1e3-7751-94da-a384406a4dd5`, message
`01a1eadd-c2fd-7800-8837-02792093dedc`. The approval and forwarded scope are retained in the
external `2026-11-17-five-intents/owner-approval-receipt.json` delivery record. The prior
recommendation to overlap intent 2 with intent 1 is superseded by this strict sequence.

**Intent 1 admitted on November 17.** The owner subsequently clarified the sequencing:

> Start the five intents now, in order; keep all technical gates (Recommended)

The question explicitly identified that PR #501 remained draft with Mac QA and the dependency
audit blocker unresolved. This answer supersedes only the previous Mac-first admission
dependency. [Recorded owner amendment](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/279#issuecomment-6969001971).
Intent 1 started from main `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1` in isolated worktrees.
The next four intents remain ordered behind it. All review, independent QA, CI, final audit,
merge and owner-acceptance gates remain intact.

At that admission, PR #501 was a separate draft at `6fe12f412cd74b034a77cde10a521bb319e8aa96`
with local Mac QA and its reserved final audit open. CI14 passed native/browser/unit checks but failed the
dependency audit; [#503](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/503) tracks that
shared prerequisite. That admission did not waive its then-unpatched picomatch finding.
The [current-batch register](2026-11-13-four-intents-register.md) retains the historical launcher
delivery record; current issue/PR checkpoints take precedence over those earlier snapshots.

On November 18 the owner approved the exact-lock, seven-day nonrenewing #503 exception and
continued the five intents in order with every other AIDLC gate intact. The owner also
authorized blocker decisions with their rationale and alternatives catalogued in the final
QA sign-off. GitHub had already withdrawn the advisory before that approval, and the
unchanged ordinary audit passed without using the exception. [#503's decision and verification](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/503)
and the linked execution checkpoints retain the dated evidence. This changes neither the
approved intent sequence nor the review, independent QA, current-head/current-target CI,
fresh Astra MAX final audit, merge and owner-acceptance gates.

The owner authorized the named scope and appropriate un-parking/reconciliation at admission.
This does not approve an unresolved architecture plan, resolve a refinement gate, release
PR #460's separate hold, or admit unrelated parked work. Recheck live main, issue state,
existing implementation, native hierarchy and dependencies before each admission. Do not
ask again whether the owner wants this approved batch implemented.

## Intent and unit sequence

The identifiers below are local delivery units, not newly created GitHub issues or native
parent relationships. There are **26 core issues**, two bounded diagnostic additions and one
conditional refinement-gated addition. Parent, UoW and intent trackers are counted separately.
Each unit is a bounded reviewable change or evidence-backed disposition, not an obligation
to manufacture a code fix. Finish each admitted intent's engineering work and dispositions
before admitting the next intent. Independent units within an intent may run concurrently
only when dependencies and workspace ownership permit it.

| Order | Intent                                                    | Units in recommended order                                                             | Admission dependency                                               |
| ----- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1     | Make every delivery gate dependable and auditable         | U1.1 #495; U1.2 #488; U1.3 #496; U1.4 #407; U1.5 #466                                  | Owner-approved November 17 sequencing amendment                    |
| 2     | Preserve authored data and make identity rules consistent | U2.1 #481; U2.2 #429; U2.3 #473; U2.4 #472                                             | Intent 1 engineering delivery                                      |
| 3     | Keep local startup, shutdown and recovery ownership safe  | U3.1 #459; U3.2 #471; U3.3 #437; U3.4 #434; U3.5 #409                                  | Intent 2 engineering delivery; retain #459 plan gate and #460 hold |
| 4     | Make model readiness and execution failures actionable    | U4.1 #427; U4.2 #448; U4.3 #362; U4.4 #363; U4.5 #364; U4.6 #365; U4.7 #486; U4.8 #442 | Intent 3 engineering delivery                                      |
| 5     | Keep run evidence readable, consistent and available      | U5.1 #386; U5.2 #385; U5.3 #416; U5.4 #420                                             | Intent 4 engineering delivery                                      |

### Intent 1: dependable delivery gates

- **U1.1 / #495:** establish whether supported pnpm commands can skip checks through aliased
  checkout paths. Use deliberate invalid-input controls. Existing source/probe evidence is a
  plausible mechanism, not a reproduced supported-command bypass. Correct only a confirmed
  reachable defect, or record the bounded evidence and disposition.
- **U1.2 / #488:** measure Gates scheduling and workload bottlenecks behind repeated whole-job
  deadlines. Preserve every required check, its failure semantics and meaningful evidence.
- **U1.3 / #496:** restore downloadable native Windows artifacts and inspect their actual
  contents, revision and run bindings before further Windows process/filesystem delivery.
- **U1.4 / #407:** remove API subprocess port-allocation interference.
- **U1.5 / #466:** ensure timed-out probes settle their owned asynchronous work and cleanup
  before subsequent tests. Preserve unrelated processes and resources.

Diagnostic additions **D1 / #453** and **D2 / #489** have unresolved causes. Define finite
diagnostic budgets and discriminating observations at admission; do not promise speculative
fixes or turn an unreproduced failure into an indefinite blocker for the whole batch.

Acceptance requires deliberately broken inputs to fail, every required check to execute,
artifacts to match the tested revision, and owned test work to settle. No weakened coverage,
assertions, ownership checks, or retry-to-green substitutions.

### Intent 2: authored data and identity

- **U2.1 / #481:** establish current public/browser behavior for duplicate edge IDs, whose
  controlled store witness changed an unrelated edge's port. Preserve unrelated records,
  Undo/Redo, saving and recovery when ownership is ambiguous. Claude owns editor changes;
  GPT owns shared domain and identity architecture.
- **U2.2 / #429:** consistently refuse invalid/prototype-sensitive override keys during
  authoring and validation. Existing downstream protection means the current report is a
  contract-consistency issue, not an established isolation bypass.
- **U2.3 / #473:** align MCP loop-name lookup with existing naming rules, exact-ID priority,
  owner scope, ambiguity refusal and truthful not-found guidance. Verify both Codex- and
  Claude-plugin-facing behavior.
- **U2.4 / #472:** add the bounded public API regression for deleting a loop and reusing its
  equivalent name. Do not change correct runtime behavior solely to add the test.

Acceptance requires edits to affect only intended records, invalid configuration to be
refused clearly, and authoring/API/MCP identity rules to agree.

### Intent 3: local runtime ownership

- **U3.1 / #459:** begin with the owned helper-descendant lifecycle design. Preserve its
  architecture decision record and genuine native process verification. The November 20
  D160 amendment below changes the timing of this issue's human plan review only.
- **U3.2 / #471:** complete the bounded Windows contention characterization and defensive
  recovery engineering accepted in D161. The original incidents' failing code call site,
  marker-identity relation, final owner-record readback and underlying Windows status remain
  **NOT ESTABLISHED — dispositioned**. The captured Node `unlink` EPERM is not a confirmed
  sharing violation. Preserve every single-writer, record and cleanup assertion; the conservative
  present-path guard-removal residual is tracked separately in #542. See the
  [D161 completion amendment](#november-21-amendment-d161-471-bounded-completion).
- **U3.3 / #437:** the approved recommendation is to refuse secret-bearing launcher
  overrides, without another acknowledgement path and without echoing secret values.
- **U3.4 / #434:** make reset manifests and completion/failure output accurately account for
  database ownership sidecars and reclaim guards.
- **U3.5 / #409:** provide clear stack-free guidance when another process holds the store.

Use disposable data and real Windows process/filesystem evidence where required, including
positive, negative and concurrent cases. Preserve PID identity, unrelated processes and
replacement-owner records. Establish the intended integration baseline for work overlapping
PR #460; this approval does not permit merging that held PR.

### Intent 4: model readiness and execution failures

- **U4.1–U4.2 / #427/#448:** reconcile account/model availability and read-only preflight with
  actual startup. Reverify historical provider restrictions against the then-supported CLI
  and account configuration. Offline preflight preserves stored-row precedence and remains
  read-only.
- **U4.3–U4.5 / #362/#363/#364:** reconcile current source, then correct established
  process-start classification, long temporary-path handling and misleading executable-not-found
  diagnostics. Old reports are not proof that their original implementation is still present.
- **U4.6 / #365:** document actual inherited sandbox configuration. Do not describe a
  documentation/contract mismatch as an established permission defect.
- **U4.7 / #486:** extend bounded authored-error diagnostics at the remaining evaluator
  boundaries, preserving provenance, cancellation, side-effect uncertainty and appropriate
  resumability.
- **U4.8 / #442:** expose supported skipped-plugin diagnostics or explicitly state when the
  CLI cannot establish health. Do not build a replacement plugin manager or infer loaded
  tools from configuration alone.

Users must be able to distinguish unavailable models, invalid configuration, startup failure,
authored errors and missing plugin capabilities. No automatic model substitution, blind replay
of uncertain work, private stack leakage or unsupported health claims.

### Intent 5: run evidence

Deliver stale terminal-status correction **#386** and correct array-append patch values **#385**
before clearly marked last-known offline evidence **#416** and legible long Timeline numbering
**#420**. Keep displayed state and changes truthful while preserving useful evidence during
outages.

**C1 / #379** is conditional on resolving its existing `needs-refinement` gate with the owner.
The possible addition opens stored transcript detail with explicit bounds/truncation information.
Claude designs and implements the interaction; GPT independently reviews data and state
behavior. This is not approval for a broad inspector redesign.

## Acceptance alongside delivery

After macOS engineering delivery, arrange an integrated-build owner acceptance session for
editor, Claude plugin and launcher observations. Record the tested build, observations and
remaining limitations, and close only items whose existing owner-closure requirements are
actually satisfied. These separate human obligations need not block unrelated engineering.

Revisit **#64/#125/#221/#323** against the integrated build and any available original owner
examples. They need reproduction and disposition; historical bounded non-reproduction is
neither a fix nor current-build acceptance. This work is not dispatched before macOS delivery.

## Exclusions

Keep full distribution/setup **#34–#36/#39**, additional providers, mobile, themes and cosmetic
expansion out. Keep **#413** deletion cleanup and **#415** actor attribution out until their
separate product decisions are refined. Keep cloud-placeholder compatibility **#499** out
pending an appropriate native environment. Narrow follow-ups **#467/#468/#476/#477/#491/#493/#494/#498/#502**
remain separately parked unless the owner explicitly expands scope.

## Model ownership and gates

Use actual Claude Code substantially for UI design/implementation, other implementation suited
to Claude, behavior/native QA, design critique and adversarial review. GPT owns architecture,
domain and backend work as appropriate; use stronger architecture models for difficult process
ownership and ambiguous state. Delegate bounded tests, documentation and evidence collection to
faster approved agents. Match tier/effort to difficulty and preserve approved provider/model
requirements without silent substitutions.

GPT-authored work requires independent Claude adversarial review; Claude-authored work requires
independent GPT review. Behavior QA uses a separate independent context. Retain isolated
workspaces, concrete scope contracts, required architecture/refinement decisions, meaningful
regressions and negative controls, touched-system QA, all coverage requirements, current-head/
current-target CI, and fresh independent Astra MAX final audit. The three-total-formal-scan cap
per PR and existing correction/closure policy are unchanged; new heads or agents do not reset it.
Human post-merge acceptance remains distinct from engineering, review, QA, CI and merge.

Preserve owner environments, real stores, credentials, ports and unrelated dirty work. Retain
the existing scoped permissions for commits, publication and merges without broader authority.
No paid overages, personal plugin installation, marketplace publication or new provider access
is included. Follow [docs/15](../15-issue-workflow.md) at each admission. Intent 1's five core
issues and two bounded diagnostics were unparked and admitted on November 17. Each later
intent requires its preceding intent's engineering delivery under the approved sequence.
Admission is not implementation completion, QA, review, CI,
merge or owner acceptance. The [intent 1 execution ledger](2026-11-17-intent-1-execution.md)
records bounded ownership and gate states.

## November 19 checkpoint

Intent 1 completed engineering at main `d3f651c83779ded401878094d35374ac2f494d3d`.
Five of the 26 core issues in the ordered batch had merged. The two bounded diagnostic
issues remained open. Their original causes are unresolved. The Mac GUI handoff and
PR #460's separate hold continued. [Intent 1 delivery record](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/279#issuecomment-6996568162)

| Core issues   | Final integration record                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| #488 and #496 | [CI scheduling and native Windows evidence](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/508#issuecomment-6991155749)         |
| #407          | [API subprocess port ownership](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/507#issuecomment-6992685770)                     |
| #495          | [Gate entry through aliased checkout paths](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/504#issuecomment-6993532974)         |
| #466          | [Probe cancellation, timeout reporting and cleanup](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/505#issuecomment-6996556265) |

Intent 2 entered the pipeline at that commit. The four issues received their approved
delivery gate and named independent QA agents after checking their states, native
relationships and open PRs. [Intent 2 admission and model assignments](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/279#issuecomment-6996675245)

## November 20 amendment: D160, #459 decision timing

After delegating blocker decisions and choosing a consolidated decision review before owner
QA, the owner corrected the coordinator's halt: "Why did you stop working? We need all intents
fully completed before work should be halted." Under that delegated authority the coordinator
selected the written #459 architecture that independent Claude Fable design review had cleared,
so implementation can proceed before the consolidated review. This changes this specific
preimplementation human timing gate; it does not state that the owner personally approved the
technical plan, and no `plan-approved` label is inferred or set. The owner reviews the decision
and any requested rework collectively before the owner QA walkthrough.

The initial 15-second work cap, helper-only private jobs, host-policy refusal on warm clicks,
two-stream closure, and two-second cleanup reserve are recorded in ADR-0086. Independent native
QA, opposite-family review, the three-total-formal-scan cap, exact-head/current-target CI and a
fresh independent Astra MAX final audit remain required. PR #460 remains separately held.
[Issue authority amendment](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459#issuecomment-7054679201)
and [batch authority amendment](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/279#issuecomment-7054680224).

## November 21 amendment: D161, #471 bounded completion

The coordinator closed #471 as completed bounded engineering and Windows characterization under
the owner's catalogued blocker-decision authority. D161 explicitly supersedes the original U3.2
historical-attribution demand and its earlier partial closure condition. The original logs captured
Node `unlink`, EPERM and a UUID recovery-marker path; their missing call-site, marker-identity,
final owner-record and Windows-status observations remain **NOT ESTABLISHED — dispositioned**.
The finite native characterization and merged #529 engineering do not identify the cause of those
two historical incidents. [Accepted disposition and completed closure](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/471#issuecomment-7055233879)
supersedes the [earlier partial disposition](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/471#issuecomment-7043540017).

The conservative refusal when a guard pathname is present remains fail-closed and is accepted as a
separate diagnostic limitation in parked [#542](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/542),
outside the 26 core issues. Earlier failed runs and the naturally unobserved vanished-marker read
branch keep their documented limits. No deletion retry, relaxed native assertion, new permission
or race reproduction, or previously rejected instrumentation is authorized by this disposition.
It admits no other issue or intent by itself. #459 engineering continues under D160 with its own
delivery gates, and PR #460's separate hold remains in force.

## November 21 amendment: D163, #459 platform refusal evidence

Under D160's delegated engineering authority, D163 refines the reviewed plan's specific outer
UI-restriction refusal fixture to match the observed platform capability. The independent probe
read the outer UI restrictions back as effective, but the tested Windows 11 build still permitted
the launcher's nested creation shape. That run is a compatible-host control; the original
UI-specific incompatibility remains C14 **LIMIT**, not PASS.

A separate outer job's verified active-process limit made process creation fail. Independent cold
and warm clicks refused with `helper-containment` before any helper ran, while preserving the
unrelated sibling, sentinel and existing warm gateway. This supplies the measured host-policy
refusal evidence without adding UI restrictions to the production job or changing host policy.
[Accepted D163 evidence amendment](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459#issuecomment-7055986230)
retains the original UI-specific limit and the other independent QA limits.

This is an acceptance-evidence refinement, not personal human plan approval, a product change or
a waiver of review, QA, exact-head/current-target CI, final audit or merge gates. D160's
consolidated owner decision review and any requested rework remain before owner QA. The approved
intent order and PR #460's separate hold continue to apply.

## November 21 amendment: D164, #459 bounded dialog evidence

Under D160's delegated authority, D164 permits proceeding through the technical gates with the
scoped independent native observations, separately attributed hosted tests and compiled public-method
privacy checks, plus the source's shared sanitized-message callsite for stderr and MessageBox.
These are process, text and source evidence, not visual dialog QA. Two Computer Use bootstrap
attempts failed before application initialization; no fixture or application opened. The visual
dialog remains **NOT PERFORMED** for the consolidated owner review and QA.
[Accepted D164 evidence disposition](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459#issuecomment-7056081015).

The original independent C14 and C25-C31 LIMIT entries remain unchanged. Source-only claims remain
review obligations, not waived requirements. D164 admits the bounded evidence to review; it is not
merge approval, visual acceptance or personal plan approval. Opposite-family review, exact-head
and current-target CI, the fresh independent final audit and signed merge remain required. D160's
consolidated owner decision review and any rework stay before owner QA, and PR #460 remains held.

## November 21 amendment: D166, #459 final-audit corrections

The independent Astra MAX second general scan held PR #541 at `2164cd11` for two introduced
findings: malformed or duplicate-name ownership responses could authorize a startup attempt,
and cleanup first observed at or after the two-second deadline could count as timely confirmation.
The coordinator accepted both as in-scope corrections under the delegated blocker-decision
authority. The separate API store lock remains intact; no store mutation was established.
[Original audit](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/541#issuecomment-7056864776)
and [D166 correction contract](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459#issuecomment-7056880570).

The corrected source at `37803eee` validates raw ownership output with a strict, ownership-only
JSON parser and samples monotonic elapsed time after the complete cleanup observation pass.
The [correction archive](../qa/2026-11-21-windows-helper-corrections/README.md) retains the
independent held-source characterization, the exact corrected-source replay, author regressions,
original failures and evidence limits. Independent Claude Code QA establishes 16/16 corrected
ownership cases with 176/176 controls, eight shared cleanup-decision cases and three grouped
native controls. The timing seam does not establish a kernel race or the unconfirmed-cleanup
runtime mappings; those mappings remain source integration evidence. D164's visual limit stands.

This checkpoint records correction and bounded QA, not final acceptance. Corrected-head CI,
bounded opposite-family corrective review and the fresh independent final audit remain required.
The general-scan budget remains two of three consumed. #543 and #544 stay separately parked,
PR #460 stays held, and owner decision review and any rework remain before owner QA.

## November 21 amendment: D167, preserve the caller's work deadline

The third and final general scan returned **CHANGES REQUIRED** at `c6f08d4a`: F3 and F4 were
resolved, but F5 showed that setup before a new helper stopwatch could extend a held retry's
admitted work into its cleanup reserve. The counterexample is established by source ordering;
it is not an observed late gateway start, store mutation or OS scheduling race.
[Original third audit](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/541#issuecomment-7058520258)
and [D167 correction contract](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459#issuecomment-7058549018).

Source `184c95ac2d08590e258c084723eb9ab379f0bbe5` carries one monotonic absolute work cutoff
through argument/environment preparation, resource setup, native admission, output validation
and ownership-result consumption. Initial identity and ownership checks each retain a separate
15-second budget. A held retry expires at the earlier of admission plus 15 seconds and the
outer release deadline minus the two-second cleanup reserve. Equality expires. Synchronous
operations are charged when they return; they are not claimed to be interruptible. The strict
ownership parser, independent cleanup deadline, prior-sample/200-ms admission and closed
failure precedence remain intact.

All **three general scans are consumed**. The existing D-035/D-042 completion path now requires
the bounded Fable correction review, independent Opus behavior QA, fresh exact-head/current-target
CI and native artifact verification, and an explicit coordinator disposition before signed merge.
It does not create a fourth general scan, renew Astra sign-off or erase the original negative
verdict. The [deadline evidence archive](../qa/2026-11-21-windows-helper-deadline/README.md)
records source bindings, actual verification results, original failures and remaining limits.
The earlier C14/C25–C31 and visual-dialog limits remain unless a named new observation directly
addresses one. #543/#544 stay parked, PR #460 stays held, and consolidated owner decision
review and any requested rework remain before owner QA.

## November 21 amendment: intent 3 engineering delivered; D171 admits intent 4

PR [#541](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/541) merged with verified signed
commit `02351e2fb932b3be44e7cc3fb3943a61d568226c`. Intent 3 engineering is complete: **14/26 core
issues (53.8%)**, **3/5 intents**. [Verified engineering roll-up](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/279#issuecomment-7059784448).
This does not complete #459's separately open, parked owner/visual QA, Mac #501 or held #460.
The original negative audits, corrected-source evidence and remaining limits remain historical.

Under the owner's delegated blocker-decision authority,
[D171](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/427#issuecomment-7059806202) admits
the eight intent 4 units in registered order: #427, #448, #362, #363, #364, #365, #486 and #442.
Independent units may overlap only with explicit file ownership. Admission records no completed
implementation, QA, review or owner acceptance. Intent 5 remains behind intent 4 engineering.

D171 refines #427 to distinguish dated account refusal, static catalogue metadata and current
account/endpoint availability. Start with explicit guidance and prove the existing structured
refusal recognition through independent disposable public-interface QA. A documentation-only
disposition depends on that proof; a narrow demonstrated diagnostic gap requires a bounded
correction. Do not substitute a model, globally disable a seed from one account result, promise
that an API-key login fixes access, or claim current entitlement without evidence. No paid
provider request or owner configuration change is needed. #365 reconciles inherited Windows
sandbox/backend documentation without changing permissions or backend behavior.

#448 retains its owner-only closure requirement. #362 needs evidence of its current already-landed
behavior before disposition; #486 requires its separate boundary/recovery architecture selection.
#442 uses supported diagnostics or states the observability limit and does not close related
owner acceptance. Each unit retains independent behavior QA, actual Claude contribution,
opposite-family review, unchanged coverage, exact-head/current-target CI and the registered fresh
independent Astra MAX final audit within the three-general-scan cap. No human `plan-approved`
label is inferred. Consolidated owner decision review and any requested rework remain before
owner QA; #460, Mac #501, parked #542/#543/#544 and conditional #379 retain their separate gates.

## Intent 5 inspector candidate — November 22, D222–D229

Signed PR #553 completed intent 4 before this lane began. At admission, the approved five-intent batch stood at 22/26 engineering units and 4/5 intents; owner acceptance and deployment remained separate. The #386/#385 candidate is based on signed main `3a6943a136594162665667a7a55e2b46520912eb` and freezes product/support source at `8632538fea2c95c3a528ef91ddbaefebf3d3bfba`.

Actual Claude owns the production correction; GPT supplies bounded supporting tests/docs. [Exact-source evidence](../qa/2026-11-22-i5-inspector-truthfulness/README.md) records 3,102 passing web tests with 98.65% line and 94.44% branch coverage, 36 distinct independent component outcomes across qualified invocations, and six fresh browser passes. Both prior CHANGES_REQUIRED reviews, budget-stopped author terminals and failed checks/fixtures retain their historical outcomes. This candidate record closes no issue by itself.

Actual Claude targeted review of the final supporting correction, the fresh independent Astra MAX third/final audit, exact-head/current-target ordinary CI/native and signed merge remain required. Preserve the three-scan cap and current owner gates; no fourth general scan, fabricated provider completion or weakened coverage is implied. #416 then #420 follow this pair's engineering delivery. Final owner decision review/rework precedes owner QA; Mac #501, #448/#459 owner obligations, #460 and conditional #379 retain their separate status. Later completion records belong in the linked issue/PR discussions and subsequent register entries.

## Intent 5 offline evidence and Timeline candidate — November 23, D240–D241

Signed PR #557 delivered #386/#385 before this #416/#420 candidate. Product source is frozen at
`a0ce7b781e333b70f4711b5e9201ef63c157df1d`, tree
`3f47fed82c18930fc0a56bc8e2598e7190ba8f3c`, against signed main
`0f6c325becf3e3e0562ae69dfae2c42bcf1d7129`. The inspector retains qualified last-known evidence
during relevant outages while keeping write authority tied to a matching fresh read and new
consent. Same-visit pending session actions and their refusal feedback survive temporary run
section removal. Long Timeline numbers remain separately legible from event types.

The [source and QA archive](../qa/2026-11-23-inspector-offline-timeline/README.md) retains actual
Claude UI implementation and GPT architecture provenance, the scoped Fable core critique,
both negative opposing reviews, original failures, bounded corrections and independent QA.
Current evidence is 233 focused passes, independent fresh2 and full63 passes, and 3,179 whole-web
passes with 98.68% line and 94.46% branch coverage. The fresh native browser run passed 11/12
without retries. Strict G1 still fails the pre-existing 320px/200%-text whole-page overflow;
all 12 current Timeline samples have zero number/type overlap or clipping. The retained-main
comparison and current-source disposition support #420's bounded criterion, with broader
reflow separately parked in #563. #561/#562 also remain outside this batch.

This records a candidate and completed local evidence, not delivery or owner acceptance.
Repository gates, exact-head/current-target CI and native artifact verification, the fresh
independent Astra MAX formal pass 3, and verified signed merge remain required. Historical
CHANGES REQUIRED verdicts remain preserved; the two consumed formal passes and one general
scan are not reset. Engineering stays 41/48 overall, 24/26 core and 4/5 intents until merge.
The catalogue keeps D01–D03 first and adds D240/D241 outcomes and declined alternatives.
Consolidated owner accept/rework stays before owner QA. Mac #501, #448/#459 owner obligations,
held #460, refinement-gated #379 and the four conditional post-Mac issues retain their gates.
