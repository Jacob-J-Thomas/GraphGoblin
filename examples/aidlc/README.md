# AIDLC: first seven-loop set

Seven ordinary GraphGoblin exports and plain Node support scripts, with no product-code changes. **All seven imported, validated and published; the positive, fix-now and future-issue live scenarios passed.** The parent completed planning through merge, QA and issue closure. Live experiments are recorded separately from the real-engine tests with fake ports. See [full-v1-report.md](full-v1-report.md) and [full-v1-evidence.json](full-v1-evidence.json) for outcomes, counts and GitHub readback.

The separately delivered trial remains in [codex-first.loop.json](codex-first.loop.json), [trial-README.md](trial-README.md), [trial-report.md](trial-report.md) and [trial-evidence.json](trial-evidence.json). Its earlier counts do not count toward this set. [structured-output-schemas.json](structured-output-schemas.json) retains the trial/research contracts.

## The set

| Export                                               | Behavior and return                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [planning.loop.json](planning.loop.json)             | Jev Choice selects configurable plannerA/plannerB criteria. Uncertainty gets forced-schema LLM judgement. Returns `Plan` including needs-input/blocked.                                                                                                    |
| [implementation.loop.json](implementation.loop.json) | Jev UI classification, uncertain judgement, code/visual implementer slots. Scripts own branch preparation, commits, configured checks, authoritative SHA/files/proof and actual UI-file verification. Returns `Implementation`.                            |
| [review.loop.json](review.loop.json)                 | Fresh reviewer derived from actual implementer family. Exact-head acceptance/findings, draft PR and comments, authorized WONT FIX rationale, linked nonblocking future issues with acceptance criteria. Returns `Review`; parent owns fix cycles.          |
| [pr-ci.loop.json](pr-ci.loop.json)                   | Local gates and bounded remote CI poll on exact head. Structured verdict comment and configured label; policy-authorized exact-SHA merge and observation. Returns `PrCi`; bounded input wait for gated merge.                                              |
| [qa.loop.json](qa.loop.json)                         | Checkout verified merge SHA; execute locked checklist with QA slot; hash-verify proof and persist dedicated proof branch. Returns `{qa: Qa, proofLinks}`. Fail keeps/reopens issue and requests rework; strict audit mode blocks before an audit worker.   |
| [closing.loop.json](closing.loop.json)               | Verify merge/checklist/proof, succeeded QA run and sibling-parent provenance, no remaining tasks and closure policy. Close issue and return `Closure`.                                                                                                     |
| [parent.loop.json](parent.loop.json)                 | Manual admission/claim; planning followed by sequential delivery children. Expressions inspect child status **and outcome** before results. Three review cycles and one QA rework per task; close after every planned task passes. Returns `ParentReport`. |

No parallel workers or native fan-out. The parent orchestrates with data checks. At the review cap it returns `needs-human`, reports the pending task and stops; #31's extra-cycle/reminder service is not implemented. Gates, stale heads, wrong UI routes and unaccepted blocking findings block delivery. Blocking findings cannot be deferred.

## Settings and bounds

[full-v1.settings.json](full-v1.settings.json) is the instantiation source. Application settings live in declared `vars.config`; generic product `LoopSettings` is unchanged. Literal role/classifier bindings are compiled into nodes. Every script pins hashes of settings and runtime dependencies, so edits require regeneration and publication.

| Setting                                      | Default / contract                                                                                                                                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `roles.plannerA`                             | Codex `gpt-6-astra/high`; deep reasoning slot intended for **Opus 5.5** after #26 provides a verified Claude binding.                                                                                                                                                          |
| `roles.plannerB`                             | Codex `gpt-6.1-sol/high`; routine slot intended for **Fable 5.1** once executable provider/model/family metadata is verified. #26 alone does not establish Fable's identity.                                                                                                   |
| `roles.codeImplementer`, `visualImplementer` | Codex Sol/high and Astra/high. Separate configurable slots.                                                                                                                                                                                                                    |
| `roles.reviewer`, `familyMap`                | Fresh Astra/high mapped from OpenAI implementers. Full mode refuses same-family; Codex-only mode records the relaxation. Unsupported map routes fail before a worker.                                                                                                          |
| `roles.qa`, `judgment`                       | Luna/high QA and Sol/medium soft routing. Every inference forces native JSON Schema, permits one repair turn, then fail-run.                                                                                                                                                   |
| `routing`                                    | Jev `jev`, Choice, threshold 0.8; planner/UI criteria and actual UI-file pattern. Unavailable/low-confidence routes to judgement; provider exceptions fail per current product contract.                                                                                       |
| `labels`                                     | Configurable trigger, in-progress, PR-open, blocked, needs-human, verdict and future names, all prefixed `aidlc-`.                                                                                                                                                             |
| `checks`, `requiredChecks`                   | Explicit programs/argument arrays/deadlines; `node --test` and remote `aidlc-test`. Missing/skipped/cancelled/failed checks cannot pass.                                                                                                                                       |
| `bounds`                                     | 3 tasks, 3 review cycles/task, 1 QA rework/task, 24 CI polls at 5 seconds, 2,400-second deadline, finite graph visit cap. Inputs can reduce these limits.                                                                                                                      |
| Budget                                       | `.tmp/aidlc-control/aidlc-budget.json`: 30 worker turns, 30 Jev evaluations. Each inference reserves **two** turns including repair; each Jev node reserves one evaluation. Actual counts come from events. Never reset the ledger during a trial or overlap live invocations. |
| `policy`                                     | Merge/closure authorization, approval mode, human gate, QA depth, strict audit gate, allowed WONT FIX ids, deferral permission, proof branch, non-closing linkage and title prefix. Inputs can reduce authorization.                                                           |
| Checklist                                    | Input must equal immutable `aidlc-checklist.lock.json`. Unique ids; each requires a result and nonempty hash-verified proof at merge SHA. Full-regression requires an owner-supplied complete checklist; supplemental criteria generation is future work.                      |

Helpers deliberately refuse every GitHub mutation destination except `Jacob-J-Thomas/gg-aidlc-scratch`. This is a trial allowlist, not product semantics. Workspaces must be independent physical repositories under **this worktree's `.tmp/`**, named `aidlc-*`, with no links and the exact allowed origin. Workers cannot change checklist, scratch instructions, ignore rules or CI. Use separate physical workspaces and serialized invocations for separate issues. Prompt/read-only/network restrictions are not demonstrated hostile-worker confinement.

Approval means **a head-bound structured verdict comment plus configured label**, not an approving GitHub review. `PrCi.approvedHeadSha` stays null. A second eligible identity/App is required for actual approval. A changed head invalidates prior verdict/review/CI. PR linkage is `Part of #N` so GitHub does not close before QA.

## Setup and import order

Dependencies must already exist in this worktree. Support uses Node built-ins, git and authenticated gh; no new dependencies or links. The helpers never restart the owner instance or open its private data directory. Remote setup and workspace creation must run as the **API owner's Windows identity**. Sandbox gh credentials do not determine whether owner-process script nodes can authenticate; never recreate an API-owned workspace from the sandbox.

```powershell
# Once, as the API owner, before live acceptance (already done for this trial):
node examples/aidlc/support/scratch.mjs --remote
pnpm.cmd exec prettier --write examples/aidlc/support examples/aidlc/full-v1.settings.json
node examples/aidlc/support/instantiate.mjs
node examples/aidlc/support/install.mjs
```

Remote setup creates the private repository only if absent, pushes baseline without force, installs configured labels and creates/reconciles one task issue. Ambiguous/existing conflicting state is refused. Initialize once: pushing the baseline again after remote merges may refuse a non-fast-forward update.

Order: **planning, implementation, review, PR/CI, QA, closing, parent**. `install.mjs` imports/updates only the seven exact named loops, validates/publishes children, then regenerates the parent with returned child ids. Evidence/ids are retained under `.tmp/aidlc-control`. Raw exports contain this worktree's Node/helper paths and installed child ids; another location/instance requires re-instantiation/rebinding. #28's gallery/helper installer is future work.

## Trigger contracts

Use the complete positive input generated at `.tmp/aidlc-control/aidlc-positive-input.json`. Common required fields are `message`, `repository`, `workspacePath`, `issueNumber`, locked `checklist`, `bounds` and `policy`.

```json
{
  "message": "Reject reversed clamp intervals, preserve valid clamping and add a regression test.",
  "repository": "Jacob-J-Thomas/gg-aidlc-scratch",
  "workspacePath": "<absolute worktree path>/.tmp/aidlc-scratch",
  "issueNumber": 1,
  "checklist": [
    {
      "id": "aidlc-required",
      "system": "clamp",
      "scenario": "Reject a reversed interval",
      "polarity": "negative",
      "steps": ["Assert clamp(5, 10, 0) throws RangeError"],
      "expected": "RangeError"
    }
  ],
  "bounds": { "maxTasks": 1, "reviewCycles": 3, "qaReworks": 1 },
  "policy": { "allowMerge": true, "allowClose": true }
}
```

The compact example explains the fields; the generated input has **all three** actual locked criteria and must use the returned real issue number. Parent admission requires the issue open with the trigger label. Named claim/rework outputs in the run event log are authoritative; the reader uses `GET /runs` and per-run events, never inbound events/comments. An exclusive local file guards the interval before claim persistence. This manual version refuses repeated independent claims; QA rework stays inside the existing parent, rather than admitting a new top-level attempt after termination.

## Live acceptance through REST

The owner authorized REST for every start and observation: `POST /loops/{id}/runs` with `{ "triggerNodeId": "start", "input": payload }`, then `GET /runs/{id}` and `/runs/{id}/events`. The MCP tool's separate approval restriction does not govern these REST calls. `support/live.mjs` serializes acceptance starts, counts fresh/repair sessions and Jev attempts from events, and saves run/thread/transcript API evidence under `.tmp/aidlc-control`. Do not reset its ledger or the helpers' conservative reservation ledger during acceptance.

```powershell
node examples/aidlc/support/live.mjs start aidlc-full-v1-parent .tmp/aidlc-control/aidlc-positive-input.json positive
node examples/aidlc/support/live.mjs collect
```

The two negative experiments use standalone implementation/review invocations with explicit result handoffs, rather than repeating the parent's merge/QA/closure path. `acceptance-control.mjs install` publishes the temporary `aidlc-acceptance-support` script-only loop; its `fixtures` action clones isolated workspaces and creates experiment issues **inside the owner process**. Its `inventory` action records every scratch issue, PR, comment, label, review, check and branch SHA for owner verification. `acceptance-control.mjs cleanup` deletes that throwaway loop after evidence collection; the seven finished loops remain.

Actual instance counts were 10 fresh Codex starts, no repair/resume turns, and 5 Jev evaluations; maximum acceptance-worker concurrency was 1. The scratch repository's existing Codex GitHub integration also auto-reviewed PR #2 when marked ready, outside the instance ledger and overlapping QA. The report records that one external review activity separately; global serialization across that integration is not established. Negative PRs stayed draft. `verify-live.mjs` asserts the three captured outcomes, and `audit.mjs` reconciles counts, worker intervals, published exports and owner-process inventory.

For fix-now, a real implementer deliberately removes the guard/regression as fault injection; three retained tests pass, but the locked checklist stays unchanged. Fresh review must reject it. `handoff.mjs fix` preserves the candidate and binds findings to its head; a fresh implementer restores the guard/test, followed by another fresh review. For future-issue, a real implementer adds finite-input documentation; fresh review may defer the optional non-finite policy/tests with rationale and concrete acceptance criteria. Both experiments prohibit merging and closing, and retain their draft PRs/open issues as evidence. These controlled hints test routing and side effects; they do not measure unbiased discovery rates or the live parent cycle cap.

| Child          | Additional payload fields                                                  |
| -------------- | -------------------------------------------------------------------------- |
| Planning       | None.                                                                      |
| Implementation | `task`, optional `plan`, previous `implementation`, head-bound `feedback`. |
| Review         | `task`, `implementation`, optional `reviewHints`.                          |
| PR/CI          | `task`, `implementation`, accepted `review`.                               |
| QA             | Observed merged `prCi`, optional `task`.                                   |
| Closing        | `prCi`, `qa`, `qaRunId`, `proofLinks`, `remainingTaskIds`.                 |

Children get explicit project mappings and resolve their own workspaces. Each task must preserve the global checklist; combine jointly dependent acceptance changes into one task. To execute, describe/start the published parent through GraphGoblin run tools, then wait/read events to terminal. Do not use another run-start surface to evade a tool approval rejection. A stopped parent reports pending ids and labels/comments the scratch issue where remote access permits. Proof uses immutable commit URLs on the configured proof branch.

## Checks and future changes

```powershell
pnpm.cmd --filter @graphgoblin/contracts build
pnpm.cmd --filter @graphgoblin/domain build
pnpm.cmd --filter @graphgoblin/engine build
node --experimental-import-meta-resolve --test examples/aidlc/support/core.test.mjs examples/aidlc/support/runtime.test.mjs examples/aidlc/support/graphs.test.mjs
pnpm.cmd format:check
pnpm.cmd check:docs
```

The import-meta flag resolves existing `@graphgoblin/*` entry points without creating links. Tests cover real helper admission, changed hashes/checklists, exact-head CI, missing/tampered proof, family/exception policy, graph syntax/schema, and real-engine/fake-port pass, fix-now, future issue, review cap and QA rework.

- **#26:** verified Claude/Fable role ids and family bindings, compiled reviewer routes for every actual implementer family and opposite-family session evidence. Do not enable full mode with current same-family settings.
- **#33:** opt the fixer into per-node continuity after the contract exists; preserve fresh review/QA sessions and head-bound handoffs. Current visits are all fresh.
- **#29:** add signed webhook/poll entry adapters and dedupe using the same payloads. Parent is manual; QA is synchronous after merge observation today.
- **#28/#31/#32:** gallery/prerequisite UX, independently admitted future attempts, extra human cycles/reminders, supplemental QA criteria and canary-tested evidence-only audit remain open. Strict audit mode fails closed; input filtering/read-only mode does not substitute for isolation.
