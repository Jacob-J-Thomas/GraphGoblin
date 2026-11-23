# #386 corrective independent component diagnostics

**Disposition: UNACCEPTED — two confirmed production repair batches remain.** This is finite component diagnosis of the budget-stopped partial author output, not stable-candidate acceptance, a formal feature scan, or final QA. Three failing desired-outcome witnesses belong to two root causes. The original R1/R2/R3 core cases now pass, but that does not qualify the additional cold/auth schedules.

Source: root diagnostic receipt SHA-256 `4c0c18f0345323e1e7b20a5b5029f8116efb7312fb97bb1ba7ddbae01d2793ce`, 20 literal full-source files over frozen `58227ea`. All 20 disk files were verified before execution and subsequently matched immutable partial checkpoint `56e3a48bbe4b652c1d74b55cc61985ff91884075`, tree `3a7337b32dd3ed7502ae794fa86002ef94713d78`. The checkpoint remains UNACCEPTED and unsigned; root mechanical formatting is not implementation completion. See `overlay-verification.json`, exact `diagnostic-candidate-receipt.json`, and `final-source-and-probe-provenance.json`.

Owned checkout: `G:/ggq/gg-i5-truthfulness-qa/GraphGoblin`. Node 22.23.4, existing pnpm 12.8.1 installation, own TMP/TEMP. All evidence here uses the public rendered inspector/router/providers, actual API client/QueryClient and controlled FakeApi/SSE response streams in jsdom. No real HTTP listener, browser, provider, credential input, new dependency or network service was used. No product changes, Git index actions, commits or publication were performed by QA.

## Confirmed repair batch C1 — cold acknowledged tail is not an uncertainty fence

The negative public case seeds device cursor #4 covering failure #3 then resume #4 and a cached running row at #2. A cold provider starts; its actual current row GET is held. A successful observation read of the older failure #3 is installed in the actual observation QueryClient cache. The resumed SSE request starts after #4 and has no new lifecycle payload. The header nevertheless renders **failed**, when the only supported presentation is neutral synchronization. A cursor is only a negative hint, but it must prevent promoting an older marker while compatible current reads are missing.

Reproducer: `boundary C1 negative: cold acknowledged resume tail cannot promote an older successful failure observation` in the separate QA-only boundary source. `cold-initial.json` / `.log.txt` retain the failure and the `data-status="failed"` DOM. Its countercase passes: fresh terminal success #3 with delivered suffix through #5 settles from actual run/observation reads, no new SSE payload and no finalizedAt. Preserve that positive behavior when adding the cold-tail hint. Do not solve this with new requests or by blocking a compatible fresh terminal record forever.

## Confirmed repair batch G2 — old auth-generation work is rebound to the recovered generation

Two independent public witnesses fail after reject -> same-key recovery, with all current reads held:

1. **Attempt follower.** The page observation query is disabled using public QueryClient defaults, so its observation cache remains undefined. A streamed failure #3 is known while the row remains running #2. The real attempt follower sends an observation before rejection and its response is held. After same-key recovery, releasing only that old response restores **failed** in the new generation. The disabled page-query cache is checked before and after, excluding ordinary cached query rendering as the source. `follower-generation.json` / `.log.txt`.
2. **Old stream.** A controllable public SSE Response is opened before rejection. After same-key recovery its old pipe remains uncancelled. Sending the stale failure through that old pipe, with current run/observation reads still held, restores **failed** in the new generation. `stream-and-provider.json` / `.log.txt`, `boundary G2 stream negative`.

The partial code mutates the shared stream `lease` on same-key recovery (`useRunEvents.ts`, auth subscription). Both the stream flush and the follower lifecycle callback reference that mutable lease. A generation transition must retire old authority and preserve constant request/stream leases; merely changing the referenced lease lets already-issued work appear current. Root selected this as one repair batch. The ordinary page-query lease guard passes its separate late-response/rejection test; do not collapse that passing case with the failing follower/stream schedules.

## Finite 17-row matrix

PASS means only the stated controlled public-component criterion. FAIL means the retained desired-outcome assertion failed on this exact partial source. No browser or provider acceptance is implied.

| Prepared row | Diagnostic result | Raw evidence |
| --- | --- | --- |
| R1-A observation first, then older terminal replay and parked convergence | PASS | `core-eight.json` |
| R1-B stream first, then observation and parked convergence | PASS | `core-eight.json` |
| R1-C delayed predecessor terminal observation after resume | PASS | `core-eight.json` |
| R1-D duplicate prior outcome / foreign-run observation | PASS | `duplicate-and-foreign.json` |
| R2-A older same-status row cannot establish old node; fresh row converges | PASS | `core-eight.json` |
| R2-B equal-sequence terminal node explicitly attributed to record | PASS | `core-eight.json` |
| R2-C stable agreeing terminal/delivery suffix, qualified node, no perpetual Updating | PASS | `core-eight.json` |
| R3-A A -> B -> A with stale observation and cursor after resume | PASS | `core-eight.json` |
| R3-B accepted cleanup buffer advances cursor without losing supersession | PASS | `core-eight.json` |
| G1 rejection plus late old successful page observation | PASS | `auth-source-refusal.json` |
| G2 same-key/replacement recovery and old work | **FAIL** old follower and old stream; ordinary fresh recovery positives pass | `follower-generation.json`, `stream-and-provider.json`, `auth-source-refusal.json` |
| G3 client replacement with same cache; fresh provider/cache with same client | PASS for both public lifetime cases | `auth-source-refusal.json`, `stream-and-provider.json`; hot-prop-swap qualification below |
| G4 cross-tab replacement/forget and delayed old-key 401 | PASS | `auth-source-refusal.json`, `remaining-boundaries.json` |
| C1 cold retained tail, held reads, fresh stable terminal convergence | **FAIL** old marker promotion; stable terminal positive passes | `cold-initial.json` |
| C2 21 distinct public run visits, late old row, fresh terminal convergence | PASS | `remaining-boundaries.json` |
| C3 explicit actual 401/404 read refusal | PASS | `auth-source-refusal.json` |
| I1 refresh budget / persisted shape / server actions | PASS in the bounded progress case | `remaining-boundaries.json` |

The current desired-outcome set contains **24 distinct public component cases: 21 passed, 3 failed**, established across scoped invocations with no retry and no complete-24 rerun. That is **15 passing matrix rows / 2 failing rows**, not a delivery percentage. The three failures reduce to the C1 and G2 batches above. The old frozen-582 negative baseline (7 failures / 1 pass) remains separately sealed under preparation and is not mixed into these counts.

The C2 case visits 21 actual inspector routes in one provider, restores the device cursor as setup, returns to A while reads are held, releases an old in-flight run response captured before the eviction window, witnesses it in the query cache without restoring a header claim, then settles success from fresh run/observation reads with no new SSE payload. It does not inspect the new registry internals. Exact scalar capacity is supplemental source/registry-unit evidence, not something inferred solely from the public output. I1 observes eight progress batches over about one second: run reads stay within the existing 500 ms refresh budget, observation reads do not increase, sessionStorage keys/serialized event-store fields and version 2 remain unchanged, Pause stays governed by the server row, and no non-GET API call occurs. These finite checks do not claim unlimited-duration performance or full regression.

## Retained QA fixture issue and known author defects

An initial **in-place QueryClient-prop hot-swap** probe failed convergence while neutral. It invalidated the replacement cache without establishing that already-mounted React Query observers had transferred from their original cache. This is not attributed to a new product defect. The original failing output is retained in `remaining-boundaries.json` and the pre-correction QA source in `qa-overlay/boundaries-before-provider-fixture-correction.tsx`. The corrected public provider-lifetime probe unmounts/replaces Providers while preserving the exact API client, seeds the replacement QueryClient with prior cached data, keeps real reads held until the no-old-claim assertion, then requires current authorized reads to converge. It passes. No product assertion or timeout was relaxed; this changes the input lifetime to the admitted provider-replacement case.

The new QA-only file initially had four lint findings (unused import and boolean-returning act callbacks); they were corrected and scoped lint passed. Initial lint output is retained. No full typecheck was rerun, as requested, because the root's known author-fixture type failures remain explicit: `RunInspectorPage.corrective.test.tsx` widens `failure.code` at lines 94, 157, 170 and 207. Root's retained focused result is 176/177: its remaining broad `/node-a/` selector matches a recovery option. Root diagnostics also record missing documentation updates and a budget-stopped author handoff. QA did not alter those author files or weaken existing tests. These are additional completion obligations beside the two production batches.

## Preservation, limitations and handoff

Both independent probe sources are separately retained under `qa-overlay/apps/web/src/runs/`. The core source remains SHA-256 `905515571f91d0102d89b1b6bbd400d170baad7f8ed9f378404a3932fbf757b0`; the final boundary source SHA is recorded in provenance/seal. All 20 product/source copies remain byte-identical to the partial checkpoint. Original Claude E2E (`e509374e...`), held/stale fixture (`61322359...`), #385 projection (`c4446d30...`), the QA index (`a04bf3d9...`) and every prior evidence seal remain preserved. No browser startup occurred and QA ports 18786/18787 remain unbound.

Root owns actual Claude completion, publication and all subsequent gates. After C1/G2 and the known fixture/types/docs are corrected, receive a new immutable candidate, rerun relevant failed and affected positive schedules, then perform actual browser checks and the remaining ordinary gates. This diagnostic is not acceptance, does not consume the formal feature scan budget, and does not establish source-request cancellation beyond the specifically controlled old-generation witnesses described above.
