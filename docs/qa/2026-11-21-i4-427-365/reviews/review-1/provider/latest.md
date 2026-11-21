# Review: #427 / #365 — **CHANGES_REQUIRED**

**What I reviewed:** head `f96a4073c3b53af7724d1ef5593eeaf03194c4cd` (tree `6a2fbb63db80d8385275cc6d721230e2bb92371b`) against base `02351e2fb932b3be44e7cc3fb3943a61d568226c`. I read `author.patch` (7 files, +100/−5) and the worktree files at head. Evidence includes the unchanged adapter, engine and contracts source, the pinned SDK 0.160.0 `dist/index.js`, D171, and the local #427/#365 snapshots. This is general scan 1 of 3.

**Decision:** one blocking finding (F1). It was introduced by this patch, a user can reach it, and the fix is a small wording change inside the contract. F2 and F3 don't block.

## F1 — P2, blocking: the docs say every model/account refusal keeps the provider's explanation, but LLM decisions deliberately drop it

**Where in the patch**
- `CHANGELOG.md:8-9` says, with no limit: "Model/account refusals retain the provider's explanation in the run record".
- `docs/guide/07-troubleshooting.md:117-138` has a heading covering any Codex model use. Its diagnosis step (119-124) depends on the provider's explanation being in the run message, and its fix (134) tells users to correct "the affected node, **decision** or default".
- `docs/guide/06-settings-and-secrets.md:47` says "If a run's provider message explicitly refuses…".

**Evidence from source**
- `adapter-codex/src/decider.ts:14-35`: the comment says "never retain provider text". A provider refusal (`HARNESS_ARGUMENTS_REJECTED`) becomes `DECIDER_HTTP_ERROR` with the message "Codex route completion failed".
- `decider.test.ts:88-106` asserts the mapping happens "without retaining provider text".
- `engine/src/decider-errors.ts:1-12,24-50` replaces the message with "Decision provider request failed".
- `primitive-evaluator.ts:83-96`: the run fails `EVALUATION_PROVIDER_FAILED` and is not resumable, because the Codex decider sets no status code.
- This is settled design: `docs/qa/2026-10-27-f2-fixes/README.md:72` records "decisions still fail EVALUATION_PROVIDER_FAILED without provider text".

**Impact:** suppose an LLM decision selects a Codex model that the login or endpoint can't use. The user sees `EVALUATION_PROVIDER_FAILED` / `DECIDER_HTTP_ERROR` / "Decision provider request failed", and nothing explains the cause. The new CHANGELOG line and guide section promise an explanation that never appears. That is an untrue statement in a patch whose whole purpose is truthful troubleshooting.

**Required outcome:** limit the retention and recognition wording to Codex inference-node turns. Then state the decision-path limit:
- the run shows only a safe category, with no provider explanation;
- the run record can't establish an account cause;
- the fix is a deliberate supported-model choice for the decision.

Don't change the decider's rule against keeping provider text in this PR; that is a separate security-boundary decision.

## F2 — P3, introduced, not blocking (best fixed in the same edit)

The new troubleshooting section uses the issue's and the CLI's terms instead of matching what GraphGoblin actually shows, and it doesn't line up with the existing guidance next to it:
- **Plan information:** `07:127-128` says "the catalogue's model/plan information is static". GraphGoblin's catalogue has no plan field (`contracts/src/catalog.ts:13-22`; seed in `sqlite/settings.ts:437-445`). The plan list (`available_in_plans`) lives in the bundled CLI, which `docs/06:505` already states correctly.
- **Restart step missing:** `07:134-135` leaves out the API restart needed after changing process defaults. `06-settings:102` and the existing row at `07:158` both require it.
- **Optional, `model_not_found`:** `07:123` relies on the code `model_not_found`, which a run message can never contain. `events.ts:195-199` prefers `type` over `code`, and `314-318` carries only the param and the provider's text. Either say where the code would be seen (CLI or session log) or drop it.
- **Optional, duplication:** the existing row "Codex rejects the model ID" (`07:158`) doesn't link to the new section, so one symptom is covered in two places.

## F3 — P3, pre-existing, follow-up candidate

Comments outside this patch still promise that overrides can't weaken the sandbox:
- `options.ts:88-92`: "overrides cannot weaken the sandbox, approval, model, or effort a node declared"
- `isolation.ts:24-25`: "which no override can weaken"
- `docs/06:518`

These now sit next to the patch's own statement that a node override can set `windows.sandbox`. The source only proves the narrower point: `--sandbox`, approval, model, effort and `sandbox_workspace_write.network_access` win over overrides of the same key (SDK `index.js:194-235`). Any other sandbox-related key that passes key validation (`codex-config.ts:3-10`) is not overridden, and whether such keys change enforcement hasn't been measured. Either narrow the comments to that precedence fact or state the limit. It falls under #365's "narrow the promise" fix shape, so it could be included here or filed separately.

## Claims I confirmed against source
- **Preflight** only checks the version, the help output for `exec` and `exec resume`, and `login status`. It sends no model turn (`cli.ts:126-233`).
- **Structured HTTP 400 refusal:** an `invalid_request_error` becomes `HARNESS_ARGUMENTS_REJECTED` and keeps the provider's message. The run records `HARNESS_TURN_FAILED` with `details.adapterCode` and is not resumable (`events.ts:202-204,314-319`; `inference-failure.ts:12-18,157-162`).
- **No retry, fallback or seed disable:**
  - Automatic retry covers only a retriable, definitely-not-submitted `HARNESS_TRANSPORT_FAILED`, and only once (`inference.ts:556-565`).
  - "Start fresh session" applies only to `HARNESS_SESSION_MISSING` (`run-manager.ts:1544-1559`).
  - No code substitutes another model or disables a seeded one.
- **Provider delivery uncertainty** is preserved, and the docs recommend no blind retry.
- **#365 sandbox claims:**
  - The SDK turns `sandboxMode` into `--sandbox` and has no option for choosing the Windows backend (`index.js:176-235`).
  - The contract defaults `sandbox` to `workspace-write`, so `--sandbox` is always sent (`nodes.ts:184-186`).
  - The adapter never sets `windows`, and an override can carry `windows.sandbox`.
  - The new text avoids promising either weakening or non-weakening.
- **`options.ts`:** the diff only touches comments.
- **Register:** the append keeps the earlier text unchanged. 14/26 equals intents 1–3's 5+4+5 core issues (`register:65-67`). The unit order and retained gates match D171. Owner #459, Mac #501 and held #460 stay separate.
- **Links and privacy:** the new anchors resolve, no app or tooling test depends on these docs, and nothing touches secrets or auth output.

## Notes for the pending independent QA (not findings)
- A model-access error in another shape is treated as a generic failure. For example, a 404 `invalid_request_error` classifies as `HARNESS_TURN_FAILED` and Codex offers Resume (`events.test.ts:207-211`; `inference-failure.ts:160`). The guide's "no Resume" sentence correctly applies only to the 400 case. QA should confirm the real CLI 0.160.0 refusal matches the 400 fixture (`failed-invalid-model.jsonl:5-6`) and include a negative check with a different shape.
- The LLM-decision case from F1 is a useful negative check.
- I did not verify how coerce/output-transform repair calls surface a refusal.

## Limits of this review
- This was a static, read-only review. I ran nothing: no CLI or binary, login, preflight, provider call, native Windows backend test, CI, or author-log hashes.
- Current model entitlement is unmeasured, and the independent public QA has not been done.
- The issue bodies come from local connector snapshots.
- I deliberately did not read `i4-427-365-opus-review-01/provider/latest.md`, to keep this review independent.
- ADR-0063:59/66 still says "Windows sandbox mode". I treat that as historical ADR wording, not a finding.