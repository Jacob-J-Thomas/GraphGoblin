# ACCEPT REVISED PLAN — revision 03

Revision 03's two amendments resolve the provenance ambiguities the 40-case probe found, and I found no regression against behaviour pinned at `02351e2`. R1–R6 remain resolved. Two one-sentence clarifications (A1, A2 below) should be folded in at selection; neither needs another recheck. This is planning only: I ran nothing and edited nothing, and the original REVISE PLAN verdict on revision 01 stands as history.

## S4, the phase observer: sound

- **The three phases exist in source.** One `try` covers the binding spread, the budget reads and the awaited call (`packages/domain/src/expression.ts:143–155`). Predicate coercion runs afterwards (`:204–208`). Splitting them with identical catch bodies changes no value or rejection.
- **Compile and unsafe-regex facts are already per call.** Both throw before `cache.set` (`:58–75`), so a failing source is re-parsed every time and nothing needs caching.
- **Depth and time need no marker on the error.**
  - The hooks are a per-call closure (`:166–187`).
  - Pinned JSONata rethrows the same object (`jsonata.js:4935–4944, 5029–5036, 5696–5699`).
  - `$eval` unwraps to the inner error by identity (`expression.ts:122–135`).
  - So a closure-local record of what this call's hook threw is enough, and it cannot transfer to another call.
- **The data-only precondition holds at every listed site by construction**, so it is a static property and needs no runtime scan.
  - B05: `heartbeat.ts:137–138`, with the probe already `toJson` output (`:42,84,98`).
  - B07/B13/B22: `common.ts:121,136`, bindings literally `{thread, index}`.
  - B08, B10, B11, B12: `subloop.ts:61, 222, 99–105, 139`, default bindings.
  - B14/B19: `mutations.ts:91,119`.
  - Threads come from the store and are Zod-parsed after each patch (`run-manager.ts:2731`). Child outcomes come from the store (`:3245–3274`). B19's working thread adds only `toJson` values (`common.ts:58,70`).

## S5, no literal publication: sound

- **Nothing public is lost.** Every newly projected JSONata site publishes fixed `INTERNAL_ERROR` text today (`run-manager.ts:2645–2660`; `subloop.ts:321–324`; `inference.ts:789–792`). A search for `$error(` finds one use at such a site, `awaited-children.test.ts:1018`, which asserts only resumability.
- **It matches precedent.** B20, poll items and webhook keys already discard the evaluator's message (`primitive-evaluator.ts:279–285`; `poll-items.ts:77–81`; `trigger-service.ts:474–476`).
- **One inconsistency grows.** Mutate and Exit still publish the author's text (`mutation-failures.test.ts:85–87`; `exit.ts:18`). The same operation in an inference transform will not. The ADR should say so.

## Guarded-literal alternative: I agree with declining it

- **The array caveat is real.** `jsonata.js:5651` reads `input.sequence` (`:7532–7534`) before the AST is evaluated at `:5691`, inside the same async call. Its throw cannot be separated by phase. It needs an accessor on an array input, which JSON-derived data cannot carry.
- **It is sound only under the same data-only restriction** the fixed copy already relies on.
- **It buys little.** Only a bare root `$error("literal")` qualifies, an expression that always fails. The conditional and grouped forms (C06, C08–C10) stay fixed copy.
- **It costs a lot.** It needs raw-code capture at `expression.ts:150–155`, an AST-shape contract pinned to 2.2.2, an alphabet that admits a space-only label, and an own-`error` exclusion that also rejects the real built-in (S07).

## R1–R6

- **R1: resolved.** The plan no longer touches `mapHarnessFailure` or the fold. I re-traced three table rows and they equal current values:
  - `contextWindow`/`fits`: `inference.ts:432–443`.
  - A synchronous `start`/`resume` throw: `:541–543, 709–712, 797–806`.
  - A rejection after a handle: `:823–837, 871–874`; `inference-failure.ts:157–162`.
  - B17's typed internal error passes the existing branch at `:441`, after the timeout and abort checks.
- **R2: resolved.**
  - The unusable-uncertain guard needs only `pending` (`inference-turn.ts:164–171`), so it can precede the resolver.
  - `missingFailure` still gets resolved model and effort (`inference.ts:320–345`).
  - Resume eligibility reads `failure.resumable` and the code, never `failure.inference` (`run-recovery.ts:90–126`), so attached provenance is inert there.
- **R3: resolved.** One local throw inside the existing `try` reaches the unchanged catch (`run-manager.ts:3004–3034`). The `return.delivered` append stays at `:3027`.
- **R4: resolved.**
  - At B18/B19 the handle is still set (`inference.ts:608, 699`), so the no-handle observation at `:709–712` does not fire.
  - The mapped cause survives unless timeout, cancellation or rank ≥ 4 evidence wins (`:747–767`).
  - The suffix to suppress is exactly `:831–837`.
  - `resumable` is already false through `:871–874`.
- **R5: resolved.** The reserved keys match the wrapper recogniser and the recovery lock (`failure-publication.ts:48–56`; `run-recovery.ts:61–83`). Typed parent-mapping failures keep the bundled completion (`subloop.ts:307–311`).
- **R6: resolved.** The mapper split, both child-retry tests, sink tiering and marker exclusions are all carried in the revision 03 text. S4 strengthens the split: the Mutate mapper keeps its three-argument call and its pinned raw text (`mutate.ts:14–33`).

## S1–S6

- **S1, S2, S6:** carried unchanged from revision 02. I re-read the B17 path and the workspace port (`workspace.ts:24–27`) and found nothing new.
- **S3:** sound. `provenance()` emits `retry` only when `intentUnconfirmed` is set (`inference-turn.ts:121–132`), so a second preparation failure cannot re-emit it. The fold keeps the first prompt (`:51–66`).
- **S4, S5:** as above. The ordinal policy is unchanged.

## Exact amendments

- **A1, compile scope.** Add to `expression-provenance.md` §2: "Compile and unsafe-regex reasons attach only to the top-level `compile(expression)` of the invocation's own pinned source (`expression.ts:195`). The same checks reached through `CHECKED_EVAL` (`expression.ts:98`) fail a run-time string inside the evaluator call and yield only the neutral evaluation-rejected fact." Without this, a malformed data-derived `$eval` string could tell the author to fix the syntax of a field that parses.
- **A2, private diagnostics.** Add to README item 5 and the ADR: "At the newly typed JSONata sites the evaluator's own message is neither published nor logged, as at B20." This is the one direct consequence of the revision 03 delta.
  - Today that message reaches the server log through the internal fallback (`run-manager.ts:2667–2677`; `subloop.ts:312–320`; `inference.ts:779–788`), and `docs/05-execution-engine.md:479` promises it.
  - "No logging added" therefore removes an existing private record. Revision 02 allowed one.
  - Decision for root: confirm the removal and update that doc row, or keep one correlated private record.

## Gates for implementation

- **Legacy compatibility:** existing `expression.test.ts` passes unmodified, including the overlap and deadline tests (`:42–125`).
- **A1:** `$eval` of a non-compiling string and of an unsafe-regex string at an eligible site gives the generic direction.
- **Coercion:**
  - At `mutations.ts:119` the existing `.catch` encloses coercion as well as evaluation. A rejection with no fact must leave the new mapper unmapped.
  - The Mutate mapper must receive exactly three arguments and the same error object.
  - A real coercion failure appears reachable through the public API, unexecuted: a binding that returns a Proxy whose `ownKeys` throws.
- **Unchanged contracts:** P01, P02, B20 and B25 outputs are compared before and after (`mutation-failures.test.ts:79–108`; `flow.test.ts:124–132`).
- **Synthetic reachability:** `validateLoop` already reports non-compiling sources (`graph.ts:326`). Engine-level compile and unsafe-regex cases need a definition that bypasses publish; disclose that, as for B17.

## Evidence limits

- **Hashes:** I matched the digest strings in `SHA256SUMS` and `manifest.json` to the brief. I could not hash any file bytes with read-only tools.
- **Probe:** I read the report and spot-checked `results.json` (40 empty mismatch arrays; the S02 and S10 records). I did not rerun it.
- **Revision 02 to 03 diff:** done by reading. The inference, workspace and child sections and the 26 rows read identical.
- **Not re-traced:** the other verification table rows, the Liquid sites, and liquidjs behaviour.
- **Live issue #486:** not read, so I cannot say whether it expects the author's `$error` text to be shown.
- **Continuation note:** its sentence about a UI worker and web files does not match this read-only brief. I took no action on it.