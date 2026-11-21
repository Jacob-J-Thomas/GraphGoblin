# #486 formal general review, cycle 1 (invocation 02): APPROVE

**Verdict: APPROVE.** I found no blocking defect in the frozen candidate against architecture revision 03 with A1/A2. There are four non-blocking findings established from source and one theoretical concern.

This approval covers general review slot 1 only. It is not QA, CI, native, browser or final-audit evidence.

## Bindings and what I actually did

- **Source:** `G:/ggq/gg-i4-486-authored-errors/GraphGoblin`, stated frozen at `633d9ac72c10fe4b8d76f7ba50221f9ed8557cb9`, tree `d0e38c6c…`, parent `02351e2f…`. Head, tree, cleanliness and all 52 hashes are root/preparation-verified; I cannot recompute them with Read/Glob/Grep.
- **Plan:** architecture-03 (README, boundaries, expression-provenance, verification, critique-disposition), D188 with A1/A2, the admission receipt, D200/D201, ADR-0088, and the #486 entries of the five-intents register.
- **Coverage:** I read the full `staged-complete.patch` (all 52 files: 20 production, 26 test, 6 docs) and the complete frozen files for every changed production module except `ports.ts`, `testing/fakes.ts` and `sqlite/workspace-references.ts`, which I read as hunks only, and `run-manager.ts`, where I read the hunks and the surrounding regions. I also read the unchanged controls: `mutate.ts`, `exit.ts`, `script-dispatch.ts`, `inference-turn.ts`, `inference-failure.ts`, `failure-publication.ts`, `run-recovery.ts`, `event-validation.ts`, the `primitive-evaluator.ts` expression path, the JSONata patch and the liquidjs 10.30.0 error classes.
- **Original invocation 01:** no verdict. Its last Read (`script-dispatch.ts`) did return a result (events.jsonl line 662), immediately before the rate-limit rejection. No analysis followed it, so I carried nothing over and re-derived everything here.
- **Not done:** no commands, tests, gates, hash recomputation, provider, native, REST/MCP or browser work.

## Findings

**F1 (P3, source-established): the canonical-rerender (B17) cause is discarded and never logged.**
- `inference-context.ts:28–33` replaces the rejection in `.catch(() => …)`.
- `run-manager.ts:2687–2698` adds `errorDiagnostic` only when the error is not an `InternalRunFailureError`.
- Trigger: a canonical-template rerender rejects after `contextWindow`.
- Expected: the public copy says "See the server logs for this run", and the docs/05 "Bug" row sends raw diagnostics to logs.
- Observed: the logs hold only the safe projection.
- Reachability is synthetic only (spy-driven tests). The template is a system constant, so A2 does not restrict logging it.
- Needed evidence: a logger line with run, node and the synthetic marker, with the marker still absent from row, event and REST.

**F2 (P3, evidence gap): the inference arm of B26 has no test.**
- `inference.ts:340–343` uses `nodeWorkingDirectory`, but every templated-workspace failure fixture drives a script node, a heartbeat script probe or the exit file return.
- The B26 row requires "retain prior inference task evidence when present".
- The shared code path looks correct (`run-manager.ts:2664–2681`, exercised for B14), so this is missing evidence, not a demonstrated defect.
- Needed:
  - an inference node with an invalid or empty template, asserting the typed failure, zero `workspace.resolve`, and zero `harness.turn` or start;
  - a re-entry arm with prior definitely-not-submitted and delivery-uncertain tasks, asserting the prior provenance without `retry` and unchanged submission events and session rows.

**F3 (P3, cleanup): `HandlerServices.render` has no production caller left.**
- It remains at `handler.ts:58` and `run-manager.ts:2431–2435`; only test stubs reference it.
- It is the unattributed render path, so a future handler using it would reintroduce `INTERNAL_ERROR` and raw logging at an authored field.
- Remove it or mark it as not for authored fields.

**F4 (P3, copy and dead vocabulary).**
- `mutations.ts:337` tags a malformed coerce `source` pointer as `target`, so the message says "The target is invalid". I did not check whether publish validation already rejects such pointers.
- `mutations.ts:339` can never yield a `schema` fact, because `validateJson` returns compile errors instead of throwing (`json-schema.ts:71–84`). The `schema` copy at `authored-failure.ts:100–104` is therefore unreachable.
- The closed `details.boundary` vocabulary (`authored-failure.ts:16–44`) appears in no numbered doc; a grep of `docs/**/*.md` for three sample identifiers found nothing. The issue's "enumerate each boundary" criterion is met only in prose in docs/04.

**T1 (theoretical, plan-conformant): the wall-clock time limit is now non-resumable.**
- `expression.ts:216–220` raises it; `authored-failure.ts:67` gives it fixed copy and `:155` sets `resumable: false`.
- A host stall during a correct expression (suspend, long GC) would refuse Resume after a recorded probe (B05) or a received provider result (B19); the old `INTERNAL_ERROR` fallback was resumable.
- README items 1 and 4 select this, so I am not asking for a change. It belongs in the owner's decision catalogue.

## Conformance checked from source

| Area | Result |
| --- | --- |
| JSONata facts (`expression.ts:156–193`) | Compile and unsafe-regex reasons attach only to the top-level compile; `$eval` failures are neutral (A1). Binding preparation and predicate coercion carry no reason. Limit reasons need same-invocation error identity. Legacy errors and wrapping are unchanged. |
| Liquid facts (`template.ts:39–72`) | Phase plus validated line and column only when the token belongs to this template. Every `LiquidError` constructor reads its token, so the access is safe. |
| Mutation hooks (`mutations.ts:69–108, 223–226, 384–389`) | The fact mapper fires only at the immediate site. Mutate keeps its three-argument mapper and original error. JSON conversion, IDs, clock and provider calls stay outside. |
| External errors and lookalikes | No class, name or code test on port errors was added. True domain errors and spoofs from workspace, secrets, probe, runner, decider, structured completion, resolver, `startChild` and harness callbacks keep their prior handling. |
| Leaf handlers and subloop (B01–B13, B21–B24) | Order and effects match the matrix. The region catch is limited to `MutationError`. Parent mapping failures keep the child completion in the same append and carry no child keys. |
| Inference | The unusable-uncertain guard precedes the resolver (`inference.ts:304–305`); session-missing follows it (`:339`). Preparation writes no intent or submission. B18/B19 set an identity-checked failure (`:640–648, :741–748, :884`), so stronger cleanup, timeout or cancellation evidence replaces it and loses the phase and sentence. |
| Prior provenance (`run-manager.ts:2664–2681`) | Attached only when no new `harness.turn` exists and the failure has none. No `retry` is emitted. `run-recovery.ts` and the web controls read `resumable`, the failure code and `missingSession`, never `inference`. |
| B17 | Only the two rerenders are wrapped; `window.fits`, cloning and view construction stay outside. |
| B26 and workspace port | The engine renders and trims; the port receives fixed or temp only; the cache is set after success. The file-return path throws a plain `Error` into the existing try/catch, with the success receipt still inside it. |
| A2 logging | At the newly typed sites the raw evaluator error no longer reaches a logger; several suites assert marker absence in logger lines. |
| Scope | No contracts, migration, dependency or stored-content file is among the 52. Both child-dedup tests keep a genuinely resumable unexpected-mapping arm. |

## Still pending, not established here

- **Local gates (root-reported):** the combined gate failed four timing cases. Serial coverage passed domain (484) and engine (1998), then failed 52 infrastructure cases whose names match the clean-base control. This is not a passed full gate and does not prove runtime correctness.
- **Required before merge:** independent Opus behaviour QA across native, REST, MCP and browser (D1 is partial, with no verdict); integration proof for the separate PR553 branch; full hosted Linux CI and coverage at current head and target; the reserved fresh Astra MAX final audit; signed merge; owner review of delegated decisions.