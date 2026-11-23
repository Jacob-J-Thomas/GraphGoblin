# #486 formal implementation review, cycle 2: APPROVE

**Verdict: APPROVE.** I found no blocking or change-requiring defect in the six-file delta `633d9ac..4d982162`. F1 is corrected and F2's missing evidence is supplied. Three low-severity notes follow; none needs a change in this batch.

This is general review slot 2 only. It is not QA, CI or the reserved Astra MAX scan 3. The Opus QA verdict stays CONDITIONAL and I did not use it as review evidence.

I had Read, Glob and Grep only, so I ran nothing. Every test outcome below is read from the author's sealed raw output.

## Source binding

- **Confirmed by reading:**
  - The branch ref holds `4d982162…`, and the reflog shows `633d9ac…` to `4d982162…` with the commit subject.
  - Loose objects exist for the commit, tree `b9e4ce64…` and the parent.
  - `receipt.json` matches the expected head, tree and parent, with 174 members and seal `5004d257…`. Its six path, byte and hash entries equal the author's `binding.json` and `final-state.json`.
  - `commit.stdout` reports 6 files, +454/−43, which equals my line count of the reviewed patch.
  - The commit message is one subject line with no attribution.
- **Not verifiable with my tools:** any SHA-256, that the commit resolves to tree `b9e4ce64…`, and working-tree or index cleanliness. These rest on root's verification.
- **Delta read:** the complete author patch, and the final checkout bytes of `failure-publication.ts`, `inference-context.ts` and both test files in full. For `run-manager.ts` I read the changed region and its surroundings, plus the 633 original of that region. For docs/05 I read lines 468–491. Checkout content matched the patch hunk for hunk.
- **Interacting paths read:** `inference.ts` in full, `inference-turn.ts`, `errors.ts`, `authored-failure.ts`, `decider-errors.ts`, `subloop.ts:290–351`, `run-recovery.ts`, domain `template.ts`, the testing fakes and scenario, and ADR-0088.

## Findings (all non-blocking)

**N1 (P4, latent): the diagnostic survives only one of the engine's rebuild sites.**
- `run-manager.ts:2673–2681` copies it. `inference.ts:927–930` rebuilds an `InternalRunFailureError` without it, and `subloop.ts:331–335` downgrades to a plain `RunFailureError`.
- Neither is reachable today: the admission failure is rethrown at `inference.ts:464`, before the main `try` at `:549`.
- If admission ever moves inside that `try`, the diagnostic would be dropped silently, because `:824–844` skips logging for this class. No test pins this.

**N2 (P4, docs wording): `docs/05-execution-engine.md:486` says "including when prior task provenance is attached" without qualification.**
- This is true of the code, but production cannot reach it: `inference.ts:446–450` disables history trimming whenever a pending turn exists, and `run-manager.ts:2671` reads the same event array.
- The test comment at `inference-workspace.test.ts:197–198` says so; the numbered doc does not.

**N3 (P4, record accuracy): the author report does not say that the engine-wide lint ran before the typing correction.**
- Commands 17, 18 and 19 started within 20 ms of each other (16:49:02.9Z); 20 and 21 started together at 16:50:19Z.
- So the engine-wide lint (18) and the 262-case run (19) used the pre-correction bytes of `inference-workspace.test.ts`. The report discloses this for 19 only.
- The final bytes are covered by 20 (typecheck) and 21 (12 cases, eslint on that file, prettier on all six, diff check), so nothing is missing in substance.

## F1 disposition: corrected

| Check | Result |
| --- | --- |
| Single origin | Only `inference-context.ts:34–40` supplies a diagnostic. The one other three-argument construction is the copy at `run-manager.ts:2680`. Every other construction passes two arguments (`run-manager.ts:2355, 2542, 2654, 2767, 2829`; `subloop.ts:322, 345`; `inference.ts:840, 929`). |
| Never public | `toFailure()` (`errors.ts:54–68`) reads code, message and options only, and `failRun` (`run-manager.ts:3085–3098`) publishes that. `RunFailureError` appears nowhere outside `packages/engine/src`, and `failure-publication.js` is not re-exported from the engine index. `#diagnostic` is a native private slot (target ES2022), the getter is a non-enumerable prototype accessor, and no `cause` is set. |
| Survives reconstruction | `:2680` is needed even with no prior task, because every pre-turn inference failure is rebuilt to add `nodeId`. The two public cases in `inference-context.test.ts` cover that; the handler-injection case covers the prior-provenance arm. |
| A2 preserved | Typed authored failures reach the log site as plain `RunFailure` objects, so the new branch cannot fire and the old condition is unchanged. `inference.test.ts:520–522` is unmodified and still asserts the marker is absent from logger lines. |
| Legacy, provider, lookalikes | Decider failures still take the `warn` branch. A foreign error is still logged through the old fallback. A `diagnostic` property on a foreign object is never read, since the read needs `instanceof` and the private slot. `DeciderFailureError.diagnostic` belongs to an unrelated class. |
| Code, node, resumability | The public failure uses the same options; the delta changes only the third constructor argument and the log spread. |
| Precedence | Timeout and cancellation at `inference.ts:455–463`, and child cancel, forced stop, deadline and abort at `run-manager.ts:2608–2643`, all still come first. In those cases the diagnostic is dropped unlogged, as at 633. |
| Admission | Only the catch body changed. `errorDiagnostic` cannot throw there, because `renderTemplate` rejects only with `TemplateError` (`template.ts:39–82`). |

Control evidence, read from the author's raw output:
- **Original 633 (16a):** exit 1, 2 failed and 12 skipped. Both fail at `inference-context.test.ts:221`, with the safe log line present and `error` absent.
- **Candidate (16c):** 2 passed.

## F2 disposition: evidence supplied, no product change

- **Counts:** 11 cases pass on 633 (16b) and on the candidate (16d); the final file passes 12 (21).
- **Honest labelling:** the fixture comments at lines 77–79 and 197–198 call the history synthetic.
- **Non-vacuous assertions:**
  - Seeded events go through `events.append`, which validates each one (`fakes.ts:174–181`).
  - `all()` returns a copy (`fakes.ts:262–264`), so the before/after comparisons are real.
  - The `resolved`, `started`, `resumed` and `rows` arrays are real recorders, and `ports.harness` is the object registered as `harnesses.codex` (`fakes.ts:1421–1422`).
- **No fabricated retry:** `provenance` emits `retry` only when `intentUnconfirmed` is set (`inference-turn.ts:121–132`), which seeded history never sets.
- **Earlier guards are handler-level:** `recoveryFailure` and `canContinueTurn` are used only in `inference.ts:304–305` and `:339`, and `recover()` only re-enqueues (`run-manager.ts:2098–2100`). Because the fixture's template is invalid, the failure code itself proves the ordering; the `observeTemplate` spy adds to that but has no positive control of its own.

## Parked and unchanged

- **F3 and F4:** remain in #554. `HandlerServices.render` is still at `run-manager.ts:2431–2435`, untouched.
- **T1:** keeps the D188 policy recorded in D204.

## Coverage and reachability limits

- **No execution by me.** There is no mutation control isolating `:2680` or `:2697`; the 633 control removes all three production changes at once. The reconstruction case was never run against 633. From source, it and both public logger cases would fail without `:2680`.
- **Canonical renderer fault is spy-only.** Its combination with prior provenance additionally needs handler injection.
- **Stored-history fixtures are synthetic.** A parse failure with a prior turn cannot arise naturally. A render or empty-path failure could, from my reading of the per-process directory cache at `run-manager.ts:3373–3385`, arise only after a restart with a thread-dependent template; that path is not exercised.
- **Fakes only.** Logger evidence uses `CapturingLogger`; I did not read the real logger adapter. Nothing was exercised over REST, MCP, native process or browser at this head.
- **Gates not run by me, and not claimed by the author:** full engine suite on final bytes, the 90/90 coverage gate, cross-package typecheck, and hosted CI.

Still pending elsewhere: independent corrective QA, the fresh Astra MAX scan 3, current-target CI, and signed merge.