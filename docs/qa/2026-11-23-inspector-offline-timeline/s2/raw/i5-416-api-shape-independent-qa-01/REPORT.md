# S2 independent API-shape and provenance QA

**Bounded S2 passes after one explicitly approved fixture-oracle correction.** The corrected program's first invocation exited0 at08:24:58UTC on2026-11-23. It obtained exactly three unmodified GET bodies from an actual disposable IPv4 loopback API listener, validated RunSnapshotSchema and matching run IDs, and observed positive committed proof through public QueryClient/trackInspectorRead/getInspectorRead. This is API/core-adapter evidence with controlled fake inference. It is not mounted useRun, inspector UI, outage recovery, browser performance, layout, real-provider or final #416/#420 acceptance.

Source was frozen COREQA `458f6cb06eded5cfeb2cf243093b60521a46f676`, tree `09b29aabeef6ab7e4c4d53dc4f8d2b3b5444d5d6`. Root authority is ROOT-ADMISSION.json and ROOT-FIXTURE-CORRECTION.md. The sole new checkout overlay is `apps/web/e2e/independent-416-api-shape.qa.ts`; executed corrected SHA256 `9201430afe081f64c02e3d8d3bc68af0dc7a93a745079da8d4c7376f79292ce6`. No production edit, Git/index mutation, install, dependency copy, provider or browser execution occurred. Existing D236/D240 QA was not rerun or edited.

## Actual native responses

Corrected attempt used `http://127.0.0.1:52695`, one createTestApp, two engine runs, an in-memory database, contained fresh physical temp store and synthetic test key. Its explicit configuration had Ollama disabled and no static directories; existing fake harness/decider/classifier/structured ports remained. All creation, publication, run-start and input writes used native HTTP; public idle() drained engine work. There were seven successful POSTs and exactly three GETs, with10s request deadlines and no retries. No injected browser globals or private receipt state was used.

| Untouched response | Bytes | Status/result | Public committed/pending | GET to captured body |
| --- | ---: | --- | --- | ---: |
| 01-waiting.raw.json | 1,609 | waiting; actual waitId/recovery | 1 / 0 | 19.247ms |
| 02-completed.raw.json | 1,433 | same run succeeded; result `{ok:true}` | 2 / 0 | 14.055ms |
| 03-large-controlled.raw.json | 1,130,986 | second run succeeded; exact controlled result | 3 / 0 | 135.041ms |

All files are under attempt-02. Each body was captured by a pass-through response clone without altering the response, passed strict RunSnapshotSchema directly, and equalled the returned client body and committed cache content. The public core adapter's eligibility check used the matching ID and product schema condition. Its three receipts had loss0: **this schedule did not exercise a loss**. Returning client values and cached values need not be the same object reference after structural sharing.

The large result was one existing FakeHarness turn with8,192 two-field JSON rows and112 ASCII payload characters per row. The real engine returned1,129,396 result bytes, SHA256 `91865f14761bc6c78b6a71fb9b5c03f049d6d1bd41f36e74cc72e5b5602500a7`. Exact content/row count and one harness turn were asserted. This is a scripted fake result persisted and returned through real engine/API infrastructure; no actual Codex/Claude/Ollama execution is claimed. Actual key sets and response digests are in attempt-02/RESULT.json.

## Observational cost

Each exact captured text received three warm-up and ten measured JSON.parse + schema checks. Raw individual samples are in RESULT.json; TIMING-SUMMARY.json holds min/median/max. Node22.23.4 observations in milliseconds:

| Body | JSON min / median / max | Schema min / median / max |
| --- | --- | --- |
| waiting | 0.015 / 0.023 / 0.045 | 0.046 / 0.073 / 0.103 |
| completed | 0.019 / 0.020 / 0.021 | 0.061 / 0.064 / 0.067 |
| large controlled | 2.354 / 2.432 / 4.532 | 15.755 / 16.949 / 19.719 |

These are finite observations with no pass/fail performance threshold. GET timing includes response-clone capture; it does not isolate browser main-thread parsing, actual useRun rendering, recovery latency or service-worker behavior. Those remain later browser criteria.

## First failures and named correction

Initial web typecheck passed. First lint exited1 because the fixture threw an unknown caught value; it now throws that Error or wraps a non-Error with its original cause. First formatting check exited1; Prettier formatted only the allowed overlay. Initial bytes and all command logs are retained. Final type/lint/format checks passed before each behavior invocation; receipts01–07 and09–11 contain exact commands, Node path/version, raw streams and exits.

The initial behavior invocation08 exited1 after two native GETs. Waiting passed; completed passed untouched schema, ID, client/raw equality and positive committed/pending checks, then fixture line233 incorrectly required reference equality between fetchQuery's returned object and cached object. FIRST-FAILURE.json/PROGRAM-ERROR.json, both original raw bodies, executed-fixture.ts and CLOSURE.json remain intact. No large-result or timing observation ran in that invocation; it is not reclassified as passing.

Root approved exactly this oracle correction, mechanically verified in PARITY.json:

```diff
- assert.equal(queryClient.getQueryData(queryKey), body);
+ assert.deepEqual(queryClient.getQueryData(queryKey), exactBody);
```

Initial executed SHA256 was `446a8ec98a42ac9128dc415df6673e9115b2b9f2cab2193a7f6567a03ced0a02`. The second version differs only in that line. It retains raw schema/ID/equality, receipt, state/result, three-GET, timing, deadline and cleanup assertions. It ran in fresh attempt-02 with its own app/store/output. Alternatives declined: changing product cache sharing, removing cache/proof checks, skipping completed/large bodies, retrying the unchanged invalid oracle, or substituting fabricated responses. This is a named fixture correction under D240/S2, not a product fix or relaxed accepted requirement.

## Closure and parity

Both programs closed their own listener/store in finally. Original listener57627 and corrected listener52695 were not listening; both data directories were absent, with no close error. Native read-only lookups found recorded Node PIDs42800 and37596 absent; no process was killed. CLOSURE.json preserves the initial tsx compilation-cache residuals separately from app-store closure.

Automatic review rejected the first guarded recursive-temp cleanup command before execution, stating only **`blocked by policy`**; no more specific reason was supplied. CLEANUP-REJECTION.md records the denied action. The safer readable close-owned-temp.ps1 was accepted and exited0: it checked literal owned roots, absolute containment, no reparse points and Node absence, then removed individual files and checked-empty directories without recursive removal. NATIVE-CLEANUP.json records inventory/counts/bytes/digests and both scratch roots absent. Root's later instruction to retain diagnostic cache arrived after that command completed; the ordering was reported immediately. No further deletion or behavior ran afterward. This did not affect preserved raw program evidence.

Read-only before/after-first/after source inventories and selected module receipts establish:

- Exact head/tree, raw index SHA256 `6c49a9223faba9b61f6da8e73a82e357e61bab116283dbfa6cc552477d725276`, ordered staged-entry digest and common-index absence remained stable.
- All1,768 physically materialized tracked files stayed byte-identical. Of41,003 Git descriptors,39,235 sparse omissions were exclusively docs/qa; no non-QA omission. NUL-delimited paths avoid quoted-path ambiguity. No claim that omitted files were physically hashed.
- Both earlier QA overlays, pnpm lock, three pnpm metadata files, selected resolved dependency files and Node executable identity remained unchanged. This is selected dependency evidence, not exhaustive installation identity. The final new overlay matches the corrected executed copy.

PARITY.json gives the mechanical comparison. PREFLIGHT-NOTE.md preserves the ancillary initial PowerShell quoting failure in a read-only Git probe. No owner ports4747/4748/7443/11434, owner store/private configuration or live-provider route were used. No packet-captured universal network-absence claim is made. The heavy slot was released after final readback; only report/seal work followed.

## Explicit limits and remaining gates

This successful-body witness does not prove all postheaders/body-read transport failures map to the offline category. Root's separate source inspection found openapi-fetch0.17.0's body text/json awaits outside its onError catch, while the GraphGoblin wrapper classifies only status0 as offline. That preexisting, source-based limitation is parked in [#561](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/561); neither native nor browser reproduction is claimed here. It adds no approved batch scope and waives no required UI listener case.

Original component C1-C8, browser B1-B3, real Timeline geometry/keyboard/history budgets, final numerical/general gates, independent review, CI, audit and delivery gates remain separately required against the completed immutable actual-Claude UI candidate. S2 closes only this bounded real API-shape/core-eligibility/cost witness.
