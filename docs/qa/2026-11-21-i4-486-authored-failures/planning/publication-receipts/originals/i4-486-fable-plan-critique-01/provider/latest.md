# REVISE PLAN — independent critique of the #486 architecture packet

The core design holds against source at `02351e2`, but six parts of the frozen text need narrow amendments before selection. This is a critique only: I ran no commands or tests, and the issue stays `needs-plan-approval`.

## What holds (checked in source)

- **Anchors:** all 26 anchors in `boundaries.md` match this head. A sweep of engine and infrastructure evaluator call sites found none outside B01–B26, P01–P02.
- **Source-local catch is sound:** the evaluators are pure, with no port callback inside. Caller bindings are only `thread`/`index` (`handlers/common.ts:121,136`; `domain/src/mutations.ts:119`; `run-manager.ts:1700–1702`).
- **Separate safe-facts field is needed:** the API serialises `DomainError.details` (`apps/api/src/plugins/errors.ts:192–194`).
- **Guard-first ordering:** strictly reduces effects on blocked visits.
- **Script consent:** untouched (`script-dispatch.ts:60–64,67–94`).
- **No port builds a `RunFailureError`:** zero references in `packages/infrastructure/src`, `packages/adapter-codex/src` and `apps/**/src`.

## Required amendments

### R1. The harness-callback rule rewrites harness policy (README inference bullet 6; verification item 3)

- **Source:**
  - A throw from `start`/`resume` with no handle is classified `definitely-not-submitted` unless the adapter says otherwise (`inference.ts:709–712,797–806`).
  - The maintained matrix asserts this and expects the exact saved prompt on Resume (`testing/inference-failures.ts:131–136`; `inference-evidence-matrix.test.ts:108–117`).
  - Unknown adapter errors legitimately publish their message through the generic fallback (`inference-failure.ts:157–162`; `edge-cases.test.ts:677–689`; `claude.test.ts:398–410`).
  - That same fallback carries the #427 refusal text (`apps/api/src/provider-refusal.test.ts:80–82`).
  - Resumability there is harness-specific (`inference-failure.ts:160`).
- **Fact for root:** same-class harness exceptions are not private today. They publish as `HARNESS_TURN_FAILED` with the raw message and `details.adapterCode` set to the domain code. They never receive T/E/M.
- **Reachable case:** a `DomainError` thrown synchronously by `resume` on a repair turn.
  - Today it is not-submitted, and Codex Resume resends the exact repair prompt.
  - Under "retain delivery-uncertain" it becomes a continuation prompt, or non-resumable for an authored turn with no session.
  - "Safe internal copy" also swaps the code to `INTERNAL_ERROR`, bypassing the Claude `retriable` rule and the `HARNESS_DELIVERY_UNCERTAIN` conversion (`inference.ts:823–829,871–874`).
  - Name/code matching is unsound: the repo has an unrelated `TemplateError` with its own codes (`apps/api/src/templates/errors.ts:1–8`).
- **Amendment:**
  - Delete the "insufficient evidence of non-submission / retain delivery-uncertain" sentence and "project safe internal copy".
  - The only harness-side change #486 needs is lifting the two pure renders out of the `contextWindow`/`fits` catch (`inference.ts:432–443`).
  - If root wants true evaluator instances private, limit it to `instanceof DomainError` at the existing observation sites. Substitute only the evidence text (generic code, fixed message, private log) before the unchanged fold, so rank, submission, code conversion and resumability equal a code-less `Error` today.
  - Name/code lookalikes stay ordinary unknown adapter errors.
  - Replace "source and change scope determine exact expected code" with a per-site table of expected code, submission and resumable equal to current values.

### R2. "Restrict recovery" on resolver failure strands a missing-session visit (README inference bullet 1)

- **Source:**
  - `missingFailure` needs the resolved model and effort (`inference.ts:298–302,320–345`).
  - Restorable resolver failures are resumable (`run-manager.ts:2444–2492`).
  - Start fresh session requires the current failure to be `HARNESS_SESSION_MISSING` carrying `missingSession` (`run-manager.ts:1540–1559`; `run-recovery.ts:90–122`).
- **Reachable case:** the process stops after `harness.submission: session-missing` is logged but before `run.failed`. On restart the catalogue temporarily lacks the model.
  - Today: resumable `EVALUATION_UNAVAILABLE`; the next Resume reaches the missing-session failure and its explicit action.
  - Plan: non-resumable with no `missingSession`, so Replay only.
- **Amendment:**
  - Keep the resolver's own code and resumability; attach prior provenance as information only. Guard-first makes that safe.
  - State that the unusable-uncertain guard runs before the resolver, since it needs no model.

### R3. File-return changes exceed the render failure (README subloops bullet 3)

- **Source:** one channel `try` covers resolve, write and receipt append; its catch records `describeError(error).slice(0, 4000)` (`run-manager.ts:3004–3034`). `adversarial.test.ts:379–417` asserts that raw text for `file` and `log`.
- **Reachable case:**
  - "Fixed public delivery copy" for unexpected write failures breaks that contract for `file` only.
  - "Receipt persistence outside any provenance catch" can be read as moving the `return.delivered` append out of the channel catch. A receipt-append failure after a successful write would then fail finalisation and write the file again on reconciliation.
- **Amendment:** add exactly one branch. A local render failure or empty path appends one bounded `return.failed` and skips resolve and write. Leave the existing try/catch, its text and the append position unchanged.

### R4. After-result failures need explicit copy and scope (README inference bullet 5; B18/B19)

- **Source:** any typed failure in the main catch gets `recoveryFailure(pending).message` appended when the turn is `delivery-uncertain` without a usable session (`inference.ts:831–837`; `inference-turn.ts:173–182`).
- **Reachable case:** a harness that never reports a session ID (`edge-cases.test.ts:691–699`) completes, then an output transform fails. The message would end "Prompt delivery is uncertain and no usable session was established…", contradicting the received result.
- **Amendment:**
  - For B18/B19, skip that suffix and use the fixed after-result sentence.
  - Add a fixed `details.phase: "after-result"`.
  - Keep the `delivery-uncertain` enum and leave `accepted` untouched; that part is conservative and invents nothing.
  - Scope the "result received" fact to B18/B19 publication. Applying it to every post-result failure (artifact write, schema mismatch) is a separate harness-policy decision.

### R5. Reserve the child-link keys (B11–B13)

- **Source:** top-level `details.childRunId` drives `PARENT_RECOVERY_REQUIRED` for that child (`run-recovery.ts:61–83`), the inspector's "failed child run" link (`apps/web/src/runs/RunInspectorPage.tsx:57–70`) and wrapper recognition (`failure-publication.ts:48–56`).
- **Reachable case:** an implementer records the mapped child as an "observed effect fact". The succeeded child is then shown as failed and its own Replay is refused.
- **Amendment:** state that new authored details never use `childRunId`, `childNodeId` or `childDetails` at top level. The same-append `child_run.finished` already links the child.

### R6. Name the mapper split and close verification gaps

- **Mapper split:**
  - B14/B19 may share only the hook plumbing (`mutations.ts:45–49,169–171`; `common.ts:266–311`).
  - They must not share Mutate's cause text (`mutate.ts:22–27`), which publishes library messages that tests pin (`mutation-failures.test.ts:87–99`).
  - "Reuse the existing mapper" as written invites raw evaluator text from inference transforms.
- **Missed test:** `awaited-children.test.ts:997–1044` uses `$error("broken")` in `custom.patch`, asserts `resumable` true and resumes to prove completion reuse. It needs the same treatment as `child-creation.test.ts:177–190`.
- **Effect counters (item 4):**
  - Require real sinks through real adapters: a script appending to a counter file, a loopback HTTP log, real filesystem and SQLite.
  - Label harness, structured-completion and classifier counts as scripted-port evidence, not native provider proof.
- **Marker-absence assertions:** exclude P01/P02/B25, and exclude wrappers of pre-change child rows, which copy typed text verbatim (`failure-publication.ts:124–131`).

## Recommended simplifications (optional)

- **S1. Drop `details.childInference` and the recognizer extension.** The existing link reaches the child's authoritative `failure.inference`. If kept: a strict pick of the direct child's own provenance, omitted when absent. Legacy sanitising survives only if `isChildWrapper` accepts exactly that key.
- **S2. Make B17 engine-owned.** The template is a canonical system constant (`inference-context.ts:13–17,42`) that already rendered once. Publish a failure there as a safe internal error rather than a new authored label the author cannot fix.
- **S3. Drop the `intentUnconfirmed`/`retry` re-emission.** The `visitTurn` fold over the earlier `run.failed` already retains the payload across a second preparation failure (`inference-turn.ts:46–66`). Add a regression test instead.
- **S4. Keep only the concrete-evaluator helper form.** A promise-accepting helper cannot stop a port promise being passed. Route `services.render` through the same helper.
- **S5. Tighten the static literal.**
  - Specify ASCII `[A-Za-z0-9 _-]`, non-empty, with an explicit maximum well under 1,000, so the cap (`failure-publication.ts:28–31`) never cuts a label.
  - Add a contract test pinned to jsonata 2.2.2 for the root AST shape and `D3137`.
  - Document that `cond ? x : $error("label")` and `$assert` get fixed copy.
  - Record that the decision contract keeps the same literal private (`flow.test.ts:124–132`).
  - For B08/B12, publish the slug variable name (`contracts/src/nodes.ts:536–539,575–579`) instead of an ordinal.
  - Header ordinals follow JS key order, not strictly declaration order.
- **S6. Workspace tidy-up.** Keep `.trim()` identical and update the comment at `sqlite/workspace-references.ts:55–58`, since the sweep mirrors it. `run-manager.test.ts:38` also overrides `resolve`.

## Root's questions

- **Prior-intent guard and preparation:** preserves prompts, uncertainty and consent, except for R1 (exact retry becomes continuation or refusal) and R2 (fresh-session consent lost).
- **After-result markers:** conservative; no acceptance is invented. Needs R4 for copy and scope.
- **Workspace port:** a clean change with no dual path, provided `view` is removed and the port type excludes `template`. All implementers and callers were found. The journal is unaffected: the SQL triggers read the definition JSON (`drizzle/0023_run_resource_ownership.sql:76–100`).
- **Static literal allowlist:** implementable, since `ast()` is already used (`expression.ts:63,222–224`). `run` must capture the thrown code it currently discards (`expression.ts:150–155`). Sound for root-only, but narrow in usefulness.
- **Nested child shape:** safe and bounded if strict; S1 is simpler.
- **QA:** row/event/REST/MCP/DOM parity is adequate. Counter-effects need the tiering in R6.

## Rejected alternatives

- **Executor-wide `DomainError` catch:** global shape dispatch already misattributes; a workspace error with a `DECIDER_*` code gets decider copy (`run-manager.test.ts:32–66`).
- **A new `PromptSubmission` value for "result received":** contract ripple; the enum plus `details.phase` suffices.
- **Aligning Mutate/Exit to safe causes now:** root's constraint. They remain bounded raw text and can echo runtime values; that is a follow-up issue.
- **Matching `$error` literals anywhere in the AST:** needs an exhaustive walk and leaks value equality.
- **Resumable continuation after B18/B19:** would re-invoke the provider.
- **Resumable expression time-limit failures:** inconsistent with P01/P02/B20. The residual is that a load-induced timeout after an effect forces Replay.

## Evidence limits

- Source reading only; nothing was executed.
- `node_modules` is absent in the worktree, so the jsonata 2.2.2 AST and `D3137`, and the liquidjs 10.30.0 error classes and token position, are unverified against installed bytes.
- Not read: the live issue and admission links, `inventory.json`, and ADRs 0044/0045/0061.
- Only the tests cited were read.
- I did not establish how an out-of-process built API obtains a scripted harness; the in-repo API tests inject `FakeHarness` in process.