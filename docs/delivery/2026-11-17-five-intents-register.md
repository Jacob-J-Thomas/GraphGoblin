# Five-intent delivery register — 2026-11-17

## Approval and admission

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
Intent 1 starts from main `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1` in isolated worktrees.
The next four intents remain ordered behind it. All review, independent QA, CI, final audit,
merge and owner-acceptance gates remain intact.

PR #501 remains a separate draft at `6fe12f412cd74b034a77cde10a521bb319e8aa96` with local Mac QA
and its reserved final audit open. CI14 passed native/browser/unit checks but failed the
dependency audit; [#503](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/503) tracks that
shared prerequisite. Its unpatched picomatch finding is not waived by this admission.
The [current-batch register](2026-11-13-four-intents-register.md) retains the historical launcher
delivery record; current issue/PR checkpoints take precedence over those earlier snapshots.

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
  architecture-plan gate and genuine native process verification.
- **U3.2 / #471:** establish the actual Windows contention failure site and cause. Do not
  call it a confirmed sharing violation or relax single-writer, record or cleanup assertions.
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
issues and two bounded diagnostics are now unparked and admitted. Intents 2–5 remain approved
future scope, not yet admitted. Admission is not implementation completion, QA, review, CI,
merge or owner acceptance. The [intent 1 execution ledger](2026-11-17-intent-1-execution.md)
records bounded ownership and gate states.
