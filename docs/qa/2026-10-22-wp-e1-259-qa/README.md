# 1. Verdict

**FAIL** at **a52299c685bd3a08ba4962f6eb90ea5962eccc5f**. Ordinary controls, exact JSON contents, storage preservation and the #380 width regression pass the exercised workloads. Returning to a previously expanded event restores its complete multi-megabyte presentation without a new Show all action (QA-259-01). Full-thread downloads also fail the requested byte comparison with the API's pretty JSON because property order differs (QA-259-02).

Independent QA only: production code and maintained tests were unchanged; no staging, commits, branch switches or GitHub mutations. The actual QA branch is **codex-qa-wp-e1-259**, at the exact requested PR head; the PR source branch is **wp-e1-259-large-values**. Base: **f69646b7956ea7b90e9cc91d861ddb703ff826cd**. Only this QA directory was added. See [environment](environment.log.txt).

# 2. Defects

## QA-259-01 — major — returning to an event restores unbounded expansion

1. Open the mutate fixture run and select the replace node.finished event (A).
2. Choose Show all of Variables. The full Variables JSON contains **2,322,721 characters**.
3. Select the seed node.finished event (B). Its Variables value starts collapsed.
4. Return to A. Do not choose Show all again.

Expected: the changed selected value starts with its 4,096-character preview. Actual: Show less is already displayed and all **2,322,721 characters** are rendered again. Reproduced at **1440 and 390 px**. This bypasses bounded presentation during ordinary timeline navigation. The measured explicit expansion of this value also produced long tasks of **891/892 ms**, so restoring it has a material rendering cost; those expansion measurements do not establish an exact re-selection stall duration.

Evidence: the two failed expansion-reset checks in [primary results](browser-results.json), the final observational reproduction in [supplemental results](full-thread-results.json), [390 px screenshot](restored-expansion-390.png), and the replayable [supplemental script](extra-browser.mjs.txt). Adjacent positive cases pass: expanding one component does not expand another, A -> B initially collapses, and a genuinely new latest reconstruction collapses after a live append.

## QA-259-02 — minor — full-thread text/download differs in object property order

1. Select the mutate run's current run.waiting event, open Full thread JSON, and choose Show all.
2. Download Full thread JSON.
3. Compare its UTF-8 bytes with JSON.stringify(GET /runs/{id}/thread value, null, 2).

Expected under this brief: identical bytes. Actual at both widths: the reconstructed thread puts **lastOutput after counters**, while the API value puts **lastOutput before gates**. Both parse to identical JSON values. The same discrepancy exists in the expanded text. No stored value was modified.

Download SHA-256: **8c957d29c9f25b0a615e32887b91786006fd0ef79ef232c6e1836deea332f1cd**. API-formatted value SHA-256: **e2aafd2a43b2d95a9320f481b4a91c349bd1804407ad0e2e13a863163ae290e7**. First difference at character **2,378,822**; full text length **2,379,185**.

Evidence: [comparison](thread-comparison.json), [full-thread results](full-thread-results.json), [1440 px download](thread-1440.json), [390 px download](thread-390.json), [API thread](mutate-thread-before.json), and [comparison script](analyze-thread.mjs.txt). Result, Variables and Events downloads match their API values byte for byte under the same formatting convention.

# 3. Coverage of criteria

## Environment and scope

- Windows 11; Node **v22.14.0** first on PATH; pnpm; built web app served by the built API/container over a real SQLite file store.
- Headless installed Microsoft Edge **155.0.4283.62** through Playwright; **1440 x 900** and **390 x 844**.
- API **127.0.0.1:5720**; loopback fake controls **127.0.0.1:5721**. Disposable data: system-temp/**gg-qa-e1-jR04hz**. The built API minted a QA API key; its token is excluded from evidence.
- **Fake-only provider evidence**: FakeHarness inference/progress and an injected fake decision port. Real loop validation, mutate handlers, run execution, HTTP, SQLite, web bundle, browser and native process restart. No live provider turn.
- Systems enumerated: bounded prefix serializer; Result; Messages; Variables; both Patch diff columns; full-thread disclosure; reconstruction cache/live selection; progress drawer; wait prompt and input form; decision details; Events payload table/accessibility; downloads; ordinary run controls; session persistence and restart; frontend docs/CHANGELOG.
- Required orientation and review claims were read. The worktree register predates this review; a read-only GitHub connector recovered the current register's round-4 claim after gh returned HTTP 401. Claims are preserved separately in [review claims](review-claims.txt), [PR metadata/body](pr-382-claims.json), and [#380](issue-380.json). They are not counted as QA results. [Measured #259 inputs](measured-inputs.txt) informed loaded-value synchronization and the timings below.

## Criterion disposition

| Criterion                                                              | Disposition                                                              | Evidence / limit                                                                                                                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #259: bounded previews and ordinary inspector controls                 | **FAILED on re-selection**; other exercised paths pass                   | QA-259-01; primary matrix and CDP timings                                                                                                                                                                     |
| #259: exact full values accessible                                     | JSON contents **passed**; requested full-thread byte equality **failed** | QA-259-02; other downloads match                                                                                                                                                                              |
| #259: no stored-data modification or execution-context truncation      | **Passed**                                                               | Original API thread/events/run values match before/after viewing and after native restart; 2,118,337 compact bytes in the nested object and the full 50,000-character message persist                         |
| #259: large nested values, expansion and navigation                    | **Passed except restored expansion**                                     | Main and supplemental Edge matrices                                                                                                                                                                           |
| #380: long-line Node progress fits both widths                         | **Passed**                                                               | Before/after document widths 1440/1440 and 390/390; original four Edge tests pass                                                                                                                             |
| Live appends, earlier selection, switching runs, session reset, reload | **Passed**                                                               | Live matrix; two similar logs switched A/B/A; cleared session/reload; native restart                                                                                                                          |
| Keyboard and accessible semantics                                      | **Passed** for the requested DOM/keyboard checks                         | Tab reaches both actions, expanded pre is role=region/tabindex=0, Shift+Tab focuses it and PageDown scrolls; collapsed Events pre is unnamed and row name contains payload text                               |
| Full-thread JSON only opens on demand                                  | **Passed for observable DOM/network behavior**                           | No thread-json DOM while closed; no new requests during disclosure expansion; content removed on close. The API thread object is fetched during initial inspector load                                        |
| One expansion independent; changed value collapses                     | **Partially failed**                                                     | Independent controls and genuinely new live values pass; A/B/A fails                                                                                                                                          |
| A 16 KiB stored progress summary                                       | **Not testable through the current contract**                            | The fake accepts a 16,384-character item, but the engine projects the stored summary to 2,000 characters. The public run-event schema rejects summaries over 2,000; the browser tested that stored projection |

## Fixtures and exactness convention

The [fixture script](fixtures.mjs.txt) creates all data through public REST routes and scripts the injected fakes through their public interface. It stores a 20,000-character result, a **2,118,337-byte compact nested object** (12 nested array/object levels over 512 records), a 50,000-character message, a 20,000-character replacement on each diff side, a 1 MiB Events string payload, a 10,000-character wait prompt, and a 2,048-character reasoning excerpt. The fake was scripted with 16 KiB and 20,000-character item summaries; both persisted progress summaries are **2,000 characters**, because of the existing progress projection/contract. Their full JSON progress values are 2,081 and 2,077 characters and their previews are 1,024 characters. The 16 KiB stored-summary UI case is therefore not claimed. [Contract/projection results](progress-contract.json) preserve both observed lengths and public-schema boundary checks at 2,000 / 2,001 / 16,384 characters. API snapshots are indexed below.

For JSON downloads, the comparison oracle is **UTF-8 JSON.stringify(the parsed API value, null, 2)**. This matches the product's advertised pretty JSON format; the HTTP transport's compact whitespace is not the oracle. The raw downloaded files are retained unchanged. Escaping and property order are included in byte comparisons. Array holes serialize to null before the API receives JSON; the stored/API nulls are the oracle.

Show all/Show less exist on large Result, Variables, message, diff, generic progress, full-thread, prompt and payload values. Direct Download JSON exists on **Result, Variables, full-thread and Events payloads**. Message/diff/progress/prompt components provide exact expanded text without a direct download action; messages and changed variable values are also accessible in thread downloads. The contract-bounded reasoning excerpt is shown completely and wraps, with no expansion/download control. These availability limits were recorded rather than treating missing actions as exercised downloads.

## Primary browser matrix

These are the final independently scripted checks after selector corrections. The final primary run has **21 passed / 4 failed**; its four failures are the two defects at two widths. An expanded value's focus and scrolling are checked before downloading. [Replay script](browser.mjs.txt), [execution log](browser-final.log.txt), [network](browser-network.json), [browser errors](browser-errors.json).

| System / case                                                 | Steps                                                                          | Expected                                                                  | Actual                                                                                                                                                                                                                   | Result | Evidence                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------- |
| 1440: result, all/less, exact download and region             | Open inference run; expand; Shift+Tab/PageDown; download; collapse             | Exact bounded preview/full value; controls work; fit viewport             | 4096-character preview; full 20002; expand 147.2 ms, collapse 54.8 ms; 1440 px; 20002 download bytes, SHA-256 equal                                                                                                      | PASS   | [results](browser-results.json) |
| 1440: Node progress #380 exact long-line reproduction         | Open inference run; measure width; expand Node progress; measure again         | Exact bounded preview/full value; controls work; fit viewport             | document before/after 1440/1440 px; click 55.3 ms                                                                                                                                                                        | PASS   | [results](browser-results.json) |
| 1440: bounded generic progress values                         | Expand both progress previews; focus/scroll; collapse                          | Exact bounded preview/full value; controls work; fit viewport             | 1024-character preview; full 2081; expand 100.4 ms, collapse 78.2 ms; 1440 px; exact expanded text; 1024-character preview; full 2077; expand 157.2 ms, collapse 118.3 ms; 1440 px; exact expanded text                  | PASS   | [results](browser-results.json) |
| 1440: nested variable and exact Unicode download              | Open mutate run at current wait; expand Variables; download; collapse          | Exact bounded preview/full value; controls work; fit viewport             | 4096-character preview; full 2322721; expand 979.1 ms, collapse 65.8 ms; 1440 px; 2322734 download bytes, SHA-256 equal                                                                                                  | PASS   | [results](browser-results.json) |
| 1440: message 50000 characters                                | Expand/collapse stored 50,000-character message                                | Exact bounded preview/full value; controls work; fit viewport             | 4096-character preview; full 50000; expand 111.1 ms, collapse 121.1 ms; 1440 px; exact expanded text                                                                                                                     | PASS   | [results](browser-results.json) |
| 1440: patch large before and after                            | Select replace node.finished; expand/collapse both sides                       | Exact bounded preview/full value; controls work; fit viewport             | Before: 1024-character preview; full 20002; expand 92.9 ms, collapse 155.0 ms; 1440 px; exact expanded text; After: 1024-character preview; full 20002; expand 635.7 ms, collapse 157.8 ms; 1440 px; exact expanded text | PASS   | [results](browser-results.json) |
| 1440: full thread lazy DOM and exact download                 | Select current run.waiting; open disclosure; expand; download; collapse; close | Lazy text; exact full JSON and API-formatted download bytes; fit viewport | full text mismatch Full thread JSON; actual 2379185, expected 2379185                                                                                                                                                    | FAIL   | [results](browser-results.json) |
| 1440: 10000-character prompt and form responsiveness          | Expand/collapse Prompt; type into answer; select timeline event                | Exact bounded preview/full value; controls work; fit viewport             | 4096-character preview; full 10000; expand 167.7 ms, collapse 139.5 ms; 1440 px; exact expanded text                                                                                                                     | PASS   | [results](browser-results.json) |
| 1440: expansion independent and selection resets              | Expand A; select B; return to A                                                | Changed selection starts collapsed; other values remain independent       | returning selection remained expanded                                                                                                                                                                                    | FAIL   | [results](browser-results.json) |
| 1440: 2048-character decision reasoning                       | Select decision.made; inspect excerpt and page width                           | Exact bounded preview/full value; controls work; fit viewport             | 2,048 characters exact; document 1440 px; selection 139.9 ms                                                                                                                                                             | PASS   | [results](browser-results.json) |
| 1440: Events 1MiB payload exact prefix/download/row name      | Open Events; compare prefix to API JSON; expand/download/collapse where large  | Exact bounded preview/full value; controls work; fit viewport             | 1024-character preview; full 1048658; expand 568.6 ms, collapse 197.9 ms; 1440 px; 1048658 download bytes, SHA-256 equal                                                                                                 | PASS   | [results](browser-results.json) |
| 390: result, all/less, exact download and region              | Open inference run; expand; Shift+Tab/PageDown; download; collapse             | Exact bounded preview/full value; controls work; fit viewport             | 4096-character preview; full 20002; expand 50.0 ms, collapse 324.7 ms; 390 px; 20002 download bytes, SHA-256 equal                                                                                                       | PASS   | [results](browser-results.json) |
| 390: Node progress #380 exact long-line reproduction          | Open inference run; measure width; expand Node progress; measure again         | Exact bounded preview/full value; controls work; fit viewport             | document before/after 390/390 px; click 143.9 ms                                                                                                                                                                         | PASS   | [results](browser-results.json) |
| 390: bounded generic progress values                          | Expand both progress previews; focus/scroll; collapse                          | Exact bounded preview/full value; controls work; fit viewport             | 1024-character preview; full 2081; expand 197.3 ms, collapse 213.3 ms; 390 px; exact expanded text; 1024-character preview; full 2077; expand 230.6 ms, collapse 158.8 ms; 390 px; exact expanded text                   | PASS   | [results](browser-results.json) |
| 390: nested variable and exact Unicode download               | Open mutate run at current wait; expand Variables; download; collapse          | Exact bounded preview/full value; controls work; fit viewport             | 4096-character preview; full 2322721; expand 954.2 ms, collapse 313.4 ms; 390 px; 2322734 download bytes, SHA-256 equal                                                                                                  | PASS   | [results](browser-results.json) |
| 390: message 50000 characters                                 | Expand/collapse stored 50,000-character message                                | Exact bounded preview/full value; controls work; fit viewport             | 4096-character preview; full 50000; expand 83.5 ms, collapse 116.4 ms; 390 px; exact expanded text                                                                                                                       | PASS   | [results](browser-results.json) |
| 390: patch large before and after                             | Select replace node.finished; expand/collapse both sides                       | Exact bounded preview/full value; controls work; fit viewport             | Before: 1024-character preview; full 20002; expand 285.7 ms, collapse 202.7 ms; 390 px; exact expanded text; After: 1024-character preview; full 20002; expand 60.4 ms, collapse 393.3 ms; 390 px; exact expanded text   | PASS   | [results](browser-results.json) |
| 390: full thread lazy DOM and exact download                  | Select current run.waiting; open disclosure; expand; download; collapse; close | Lazy text; exact full JSON and API-formatted download bytes; fit viewport | full text mismatch Full thread JSON; actual 2379185, expected 2379185                                                                                                                                                    | FAIL   | [results](browser-results.json) |
| 390: 10000-character prompt and form responsiveness           | Expand/collapse Prompt; type into answer; select timeline event                | Exact bounded preview/full value; controls work; fit viewport             | 4096-character preview; full 10000; expand 48.6 ms, collapse 122.1 ms; 390 px; exact expanded text                                                                                                                       | PASS   | [results](browser-results.json) |
| 390: expansion independent and selection resets               | Expand A; select B; return to A                                                | Changed selection starts collapsed; other values remain independent       | returning selection remained expanded                                                                                                                                                                                    | FAIL   | [results](browser-results.json) |
| 390: 2048-character decision reasoning                        | Select decision.made; inspect excerpt and page width                           | Exact bounded preview/full value; controls work; fit viewport             | 2,048 characters exact; document 390 px; selection 95.0 ms                                                                                                                                                               | PASS   | [results](browser-results.json) |
| 390: Events 1MiB payload exact prefix/download/row name       | Open Events; compare prefix to API JSON; expand/download/collapse where large  | Exact bounded preview/full value; controls work; fit viewport             | 1024-character preview; full 1048658; expand 509.7 ms, collapse 133.9 ms; 390 px; 1048658 download bytes, SHA-256 equal                                                                                                  | PASS   | [results](browser-results.json) |
| keyboard: Tab reaches Show all and Download JSON              | Run the named scripted API/browser sequence                                    | Exact bounded preview/full value; controls work; fit viewport             | {"reached":[{"tabs":7,"name":"Show all of Result"},{"tabs":8,"name":"Download Result as JSON"}]}                                                                                                                         | PASS   | [results](browser-results.json) |
| two similar logs, SPA switching, reload and cleared session   | Run the named scripted API/browser sequence                                    | Exact bounded preview/full value; controls work; fit viewport             | 3 comparisons/items passed                                                                                                                                                                                               | PASS   | [results](browser-results.json) |
| negative: viewing never changes stored thread, events, result | Run the named scripted API/browser sequence                                    | Exact bounded preview/full value; controls work; fit viewport             | 15 comparisons/items passed                                                                                                                                                                                              | PASS   | [results](browser-results.json) |

## Additional exactness and boundary matrix

The twenty Events cases below cover escapes, controls, Unicode, lone high/low surrogates and a valid pair at the 1,024-character quoting-chunk boundary, long keys, nulls/holes and payloads immediately below/at/above the 1,024-character display boundary. All twenty pass. API responses are preserved in [exact events](exact-events.json).

| System / case               | Steps                                                                         | Expected                                                      | Actual                                                                                   | Result | Evidence                      |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ | ----------------------------- |
| 1440: exact controls        | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 31216 characters; 1,024-character prefix and exact expansion/download; page 1440 px | PASS   | [results](extra-results.json) |
| 1440: exact pair-1023       | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 8041 characters; 1,024-character prefix and exact expansion/download; page 1440 px  | PASS   | [results](extra-results.json) |
| 1440: exact lone-high-1023  | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 8046 characters; 1,024-character prefix and exact expansion/download; page 1440 px  | PASS   | [results](extra-results.json) |
| 1440: exact lone-low-1023   | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 8045 characters; 1,024-character prefix and exact expansion/download; page 1440 px  | PASS   | [results](extra-results.json) |
| 1440: exact unicode         | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 15016 characters; 1,024-character prefix and exact expansion/download; page 1440 px | PASS   | [results](extra-results.json) |
| 1440: exact long-key        | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 12020 characters; 1,024-character prefix and exact expansion/download; page 1440 px | PASS   | [results](extra-results.json) |
| 1440: exact holes-and-nulls | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 8071 characters; 1,024-character prefix and exact expansion/download; page 1440 px  | PASS   | [results](extra-results.json) |
| 1440: exact below-bound     | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 1023 characters; complete; no expansion controls; page 1440 px                      | PASS   | [results](extra-results.json) |
| 1440: exact at-bound        | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 1024 characters; complete; no expansion controls; page 1440 px                      | PASS   | [results](extra-results.json) |
| 1440: exact above-bound     | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 1025 characters; 1,024-character prefix and exact expansion/download; page 1440 px  | PASS   | [results](extra-results.json) |
| 390: exact controls         | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 31216 characters; 1,024-character prefix and exact expansion/download; page 390 px  | PASS   | [results](extra-results.json) |
| 390: exact pair-1023        | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 8041 characters; 1,024-character prefix and exact expansion/download; page 390 px   | PASS   | [results](extra-results.json) |
| 390: exact lone-high-1023   | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 8046 characters; 1,024-character prefix and exact expansion/download; page 390 px   | PASS   | [results](extra-results.json) |
| 390: exact lone-low-1023    | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 8045 characters; 1,024-character prefix and exact expansion/download; page 390 px   | PASS   | [results](extra-results.json) |
| 390: exact unicode          | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 15016 characters; 1,024-character prefix and exact expansion/download; page 390 px  | PASS   | [results](extra-results.json) |
| 390: exact long-key         | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 12020 characters; 1,024-character prefix and exact expansion/download; page 390 px  | PASS   | [results](extra-results.json) |
| 390: exact holes-and-nulls  | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 8071 characters; 1,024-character prefix and exact expansion/download; page 390 px   | PASS   | [results](extra-results.json) |
| 390: exact below-bound      | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 1023 characters; complete; no expansion controls; page 390 px                       | PASS   | [results](extra-results.json) |
| 390: exact at-bound         | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 1024 characters; complete; no expansion controls; page 390 px                       | PASS   | [results](extra-results.json) |
| 390: exact above-bound      | Open Events; compare prefix to API JSON; expand/download/collapse where large | Exact bounded preview/full value; controls work; fit viewport | JSON 1025 characters; 1,024-character prefix and exact expansion/download; page 390 px   | PASS   | [results](extra-results.json) |

The corrected loaded-history full-thread checks and the independent reset reproduction are recorded separately:

| System / case                                        | Steps                                                                          | Expected                                                                  | Actual                                                                                                                                               | Result | Evidence                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------- |
| 1440: full thread exact content, lazy network, bytes | Select current run.waiting; open disclosure; expand; download; collapse; close | Lazy text; exact full JSON and API-formatted download bytes; fit viewport | 4,096-character preview; 2379185 full characters; semantic equality=true; API byte equality=false; 2379198 download bytes; new requests on opening=0 | FAIL   | [results](full-thread-results.json) |
| 390: full thread exact content, lazy network, bytes  | Select current run.waiting; open disclosure; expand; download; collapse; close | Lazy text; exact full JSON and API-formatted download bytes; fit viewport | 4,096-character preview; 2379185 full characters; semantic equality=true; API byte equality=false; 2379198 download bytes; new requests on opening=0 | FAIL   | [results](full-thread-results.json) |
| expansion reset reproduction: select A, B, A         | Expand A; select B; return to A                                                | Changed selection starts collapsed; other values remain independent       | A expanded=true; B collapsed=true; returning A expanded=true; 2322721 characters                                                                     | FAIL   | [results](full-thread-results.json) |

## Prefix work and memory

The exported serializer passed **1335/1335** comparisons across **89** independently generated values/keys and 15 bounds (0, 1, 2, 3, 5, 12, 1023, 1024, 1025, 2048, 4095, 4096, 4097, 8192, 100000). Each result is retained in [prefix results](prefix-results.json); [script](prefix-checks.mjs.txt). The unchanged public utility is compiled with TypeScript for this isolated check; it is not monkey-patched.

For a Variables value whose full pretty JSON is **2322721 characters**, isolated Node 22 measurements, after GC and excluding fixture/compiler setup:

| Prefix limit | Elapsed | Additional heap at call return | Actual prefix   | Exact |
| ------------ | ------- | ------------------------------ | --------------- | ----- |
| 1024         | 0.8 ms  | 27168 bytes                    | 1024 characters | true  |
| 4096         | 0.4 ms  | 35632 bytes                    | 4096 characters | true  |

[Memory measurements](prefix-memory.json) establish bounded prefix work on this fixture, not a retained-heap ceiling or a browser heap benchmark. The full API value remains present by design.

## Responsiveness measurements

The following CDP measurements start after scrolling the target into view and dispatch real mouse/text input, with the **2,322,721-character Variables value expanded**. Wall time includes UI/server completion. Event Timing input delay measures event dispatch delay separately. Long tasks use PerformanceObserver's standard 50 ms threshold. Shared-host measurements are workload observations, not an owner-approved latency SLA.

| Width   | Timeline selection | Pause    | Resume   | Text input | Max Event Timing input delay | Max long task across load/expansion/interactions |
| ------- | ------------------ | -------- | -------- | ---------- | ---------------------------- | ------------------------------------------------ |
| 1440 px | 21.2 ms            | 127.6 ms | 121.4 ms | 32.9 ms    | 6.4 ms                       | 891 ms                                           |
| 390 px  | 39.7 ms            | 142.4 ms | 193.1 ms | 33.8 ms    | 7.9 ms                       | 892 ms                                           |

The maximum long tasks include full-value layout after an explicit expansion. The controls' measured click/paint records and CDP scripting/layout/task deltas are retained in [performance data](performance.json), with [script](performance.mjs.txt). Earlier Playwright auto-wait/scroll-inclusive live timings reached about 2.2 seconds; those observations are preserved below and are distinct from input delay. No routine rendering SLA is inferred from them.

## Live, concurrency, cancellation and sessions

| System / case                                                  | Steps                                       | Expected                                                      | Actual                                                                           | Result | Evidence                     |
| -------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ | ---------------------------- |
| live append: earlier selected event stays exact                | Run the named scripted API/browser sequence | Exact bounded preview/full value; controls work; fit viewport | 8 -> 16 events; Thread at event 6 unchanged; 20022 selected characters unchanged | PASS   | [results](live-results.json) |
| live selection changes collapse changed value                  | Run the named scripted API/browser sequence | Exact bounded preview/full value; controls work; fit viewport | {"ms":2005.1859,"width":{"window":1440,"document":1440}}                         | PASS   | [results](live-results.json) |
| live controls Pause and Resume with large variable visible     | Run the named scripted API/browser sequence | Exact bounded preview/full value; controls work; fit viewport | Pause 1679.7 ms; Resume 180.6 ms; page 1440 px                                   | PASS   | [results](live-results.json) |
| input form submission appends while another tab stays selected | Run the named scripted API/browser sequence | Exact bounded preview/full value; controls work; fit viewport | {"ms":2156.3411000000006,"twoTabSelection":true}                                 | PASS   | [results](live-results.json) |
| latest selected changing expanded value collapses on new event | Run the named scripted API/browser sequence | Exact bounded preview/full value; controls work; fit viewport | {"status":"succeeded"}                                                           | PASS   | [results](live-results.json) |
| live reload and cleared session reconstruct correctly          | Run the named scripted API/browser sequence | Exact bounded preview/full value; controls work; fit viewport | {"marker":"FINAL_"}                                                              | PASS   | [results](live-results.json) |
| 390 px live Pause Resume Cancel with expanded large values     | Run the named scripted API/browser sequence | Exact bounded preview/full value; controls work; fit viewport | Pause 2112.3 ms; Resume 2007.0 ms; Cancel 1919.4 ms; page 390 px                 | PASS   | [results](live-results.json) |

The live fixture advances real wait/mutate nodes through 8 -> 16 events while event 6 stays selected. A second tab follows the latest event independently. Two additional similar runs are switched A/B/A, reloaded and tested after clearing session storage. The [live fixture snapshot](live-fixture.json) preserves the emitted events and final thread. Fake-only provider scope applies.

## Native stop/restart and preservation checks

The original Node process stopped cleanly, and a new Node process reopened the same SQLite data directory. The recovered fake harness reports **0 started / 0 resumed turns**. Fifteen original run/thread/events values match their pre-view snapshots. The latest UI and full-thread region keyboard checks also pass. [Restart log](restart.log.txt), [startup log](server-restart.log.txt), [script](restart-check.mjs.txt).

| System / case               | Steps                                         | Expected                    | Actual                                                                                                           | Result | Evidence                        |
| --------------------------- | --------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------- |
| inference                   | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| inference /thread           | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| inference /events           | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| mutate                      | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| mutate /thread              | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| mutate /events              | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| decision                    | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| decision /thread            | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| decision /events            | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| similarA                    | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| similarA /thread            | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| similarA /events            | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| similarB                    | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| similarB /thread            | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| similarB /events            | Stop process; restart same store; GET/inspect | Original value / correct UI | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| UI restart latest marker    | Stop process; restart same store; GET/inspect | Original value / correct UI | {"name":"UI restart latest marker","pass":true,"previewLength":4097}                                             | PASS   | [results](restart-results.json) |
| full thread keyboard region | Stop process; restart same store; GET/inspect | Original value / correct UI | {"name":"full thread keyboard region","pass":true,"focused":true,"tabindex":"0","role":"region","scrollTop":441} | PASS   | [results](restart-results.json) |

## Gates and maintained regression tests

- pnpm build: **exit 0**, 11 successful tasks, web bundle rebuilt; [build log](build.log.txt). The log's final shared-cache IO warning did not change the exit status.
- pnpm typecheck, pnpm lint, pnpm check:layers, pnpm check:deps, pnpm check:tokens: **exit 0**; exact commands/results in [gate summary](gates-summary.log.txt) and their individual logs below.
- pnpm --filter @graphgoblin/web test:coverage: **exit 1; 1,484 passed / 14 failed, 113 passed / 6 failed files, 566.28 seconds**; see [coverage log](coverage.log.txt) and gate summary for the fresh uncached package run. It did not produce a passing coverage qualification; no percentage from the review claim is substituted. Failures are in DecisionAuthoring, EditorPage, NodeEditorDialog, routing-review, TriggerEditor and ClassifierModelsSection. Their code paths were not changed by this candidate, but load causation or baseline equivalence has not been independently established here. No threshold/exclusion changes and no whole-suite retry.
- pnpm format:check: **exit 2**; [format log](format.log.txt) records 58 raw QA JSON style warnings and an EBUSY error from checking its own still-open output log. Raw QA JSON artifacts retain download/API bytes rather than being reformatted. **pnpm exec prettier --check <all files in git diff base..HEAD>: exit 0**; [production-file formatting check](format-production.log.txt) checks every file changed by the candidate separately.
- pnpm check:docs and pnpm check:licenses: **not run / not applicable**; this candidate changes no route/schema or dependency.
- The existing inspector-large-values Edge spec passed **4/4**, with retries=0, against the same 5720/5721 disposable instance; [log](e2e.log.txt). The [config](playwright.config.mjs.txt) disables the normal server bootstrap and reuses the disposable instance, and the QA controls translate its /apps and /harness/script requests to the same fake. The four cases are result/progress and wait-prompt regressions at each width.
- Maintained test sources were unchanged. The additional focused run passed **7/7 files, 65/65 tests, exit 0**; [focused test log](focused-tests.log.txt). Exact command: pnpm --filter @graphgoblin/web exec vitest run src/components/ui/bounded-value.test.tsx src/lib/pretty-json-prefix.test.ts src/runs/RunInspectorPage.test.tsx src/runs/inspector/ProgressDrawer.test.tsx src/runs/inspector/WaitPanel.test.tsx src/runs/projections.test.ts src/events/EventsPage.test.tsx. It is separate from the failed coverage gate. Independent regression probes are retained as scripts; the reset probes fail on the tested head. No baseline implementation/fix test cycle was performed by QA.

## Test-harness corrections and limits

The first primary attempt had two locator mistakes: Result also names its enclosing section, and a decision row's accessible name does not include the node ID. A second attempt used a locator anchored to Show all after its label had changed to Show less; that attempt was interrupted. The corrected primary run retains the same two product failures. A supplemental 1440 px attempt read full JSON before history finished loading; the corrected check selects the known current run.waiting event before inspecting content. Its focus field was captured after downloading, when Shift+Tab returns to Show less; the dedicated native-restart check instead verifies keyboard focus/scroll from Show less into the full-thread region. The first performance attempt encountered QA-259-01 on returning to the expanded value; the corrected performance probe recognizes either current expansion state. The first custom Playwright configuration resolved its test directory from the filtered package's cwd and found no tests; the corrected absolute-root config ran 4/4. An additional progress screenshot attempt waited for the nonexistent run.succeeded event; the corrected capture waits for node.finished work. No product code or assertion was weakened to close those harness errors. Initial logs/results are indexed below.

An actual screen-reader application was not exercised; the requested accessible names, roles, keyboard path and scroll behavior were tested through Edge's accessible tree and keyboard. A 16 KiB stored progress summary is not testable through the 2,000-character event contract; its normal persisted projection was exercised instead. No sustained-load benchmark, baseline branch performance comparison, live-provider behavior, exhaustive cache-eviction profiling, or exotic non-JSON JavaScript object behavior is claimed. Historical #190 shell-ready timings are not reused as current loaded-history evidence. Re-selection automatically restoring expansion remains unresolved. Direct download actions absent on the surfaces listed above were not testable.

# 4. Report path and evidence folder

Report: **docs/qa/2026-10-22-wp-e1-259-qa/README.md**. Evidence folder: this directory. Every retained artifact is linked below; raw JSON download files are byte-preserved. Scripts are stored as .mjs.txt and executable copies were run from system temp. Logs are .log.txt. Local user paths are stripped. The disposable store and temporary executable/output directories are retained for orchestrator cleanup; QA deleted no directories.

## Artifact index

- [COMMON.md.txt](COMMON.md.txt)
- [QA-COMMON.md.txt](QA-COMMON.md.txt)
- [analyze-thread.mjs.txt](analyze-thread.mjs.txt)
- [artifact-validation.json](artifact-validation.json)
- [browser-errors.json](browser-errors.json)
- [browser-final.log.txt](browser-final.log.txt)
- [browser-initial-results.json](browser-initial-results.json)
- [browser-initial.log.txt](browser-initial.log.txt)
- [browser-network.json](browser-network.json)
- [browser-results.json](browser-results.json)
- [browser-selector-results.json](browser-selector-results.json)
- [browser-selector.log.txt](browser-selector.log.txt)
- [browser.log.txt](browser.log.txt)
- [browser.mjs.txt](browser.mjs.txt)
- [build.log.txt](build.log.txt)
- [capture-progress.mjs.txt](capture-progress.mjs.txt)
- [coverage.log.txt](coverage.log.txt)
- [decision-events-before.json](decision-events-before.json)
- [decision-run-before.json](decision-run-before.json)
- [decision-thread-before.json](decision-thread-before.json)
- [deps.log.txt](deps.log.txt)
- [e2e-initial.log.txt](e2e-initial.log.txt)
- [e2e.log.txt](e2e.log.txt)
- [environment.log.txt](environment.log.txt)
- [event-1440.json](event-1440.json)
- [event-390.json](event-390.json)
- [events-1440.png](events-1440.png)
- [events-390.png](events-390.png)
- [events-before.json](events-before.json)
- [events-row-1440.aria.txt](events-row-1440.aria.txt)
- [events-row-390.aria.txt](events-row-390.aria.txt)
- [exact-above-bound-1440.json](exact-above-bound-1440.json)
- [exact-above-bound-390.json](exact-above-bound-390.json)
- [exact-controls-1440.json](exact-controls-1440.json)
- [exact-controls-390.json](exact-controls-390.json)
- [exact-events.json](exact-events.json)
- [exact-holes-and-nulls-1440.json](exact-holes-and-nulls-1440.json)
- [exact-holes-and-nulls-390.json](exact-holes-and-nulls-390.json)
- [exact-lone-high-1023-1440.json](exact-lone-high-1023-1440.json)
- [exact-lone-high-1023-390.json](exact-lone-high-1023-390.json)
- [exact-lone-low-1023-1440.json](exact-lone-low-1023-1440.json)
- [exact-lone-low-1023-390.json](exact-lone-low-1023-390.json)
- [exact-long-key-1440.json](exact-long-key-1440.json)
- [exact-long-key-390.json](exact-long-key-390.json)
- [exact-pair-1023-1440.json](exact-pair-1023-1440.json)
- [exact-pair-1023-390.json](exact-pair-1023-390.json)
- [exact-unicode-1440.json](exact-unicode-1440.json)
- [exact-unicode-390.json](exact-unicode-390.json)
- [extra-browser.mjs.txt](extra-browser.mjs.txt)
- [extra-results.json](extra-results.json)
- [extra.log.txt](extra.log.txt)
- [fixtures.json](fixtures.json)
- [fixtures.log.txt](fixtures.log.txt)
- [fixtures.mjs.txt](fixtures.mjs.txt)
- [focused-tests.log.txt](focused-tests.log.txt)
- [format-production.log.txt](format-production.log.txt)
- [format.log.txt](format.log.txt)
- [full-thread-results.json](full-thread-results.json)
- [full-thread.log.txt](full-thread.log.txt)
- [gates-summary.log.txt](gates-summary.log.txt)
- [inference-events-before.json](inference-events-before.json)
- [inference-run-before.json](inference-run-before.json)
- [inference-thread-before.json](inference-thread-before.json)
- [issue-380.json](issue-380.json)
- [issues-259.md.txt](issues-259.md.txt)
- [issues-287.md.txt](issues-287.md.txt)
- [issues-303.md.txt](issues-303.md.txt)
- [layers.log.txt](layers.log.txt)
- [lint.log.txt](lint.log.txt)
- [live-browser.mjs.txt](live-browser.mjs.txt)
- [live-fixture.json](live-fixture.json)
- [live-results.json](live-results.json)
- [live.log.txt](live.log.txt)
- [make-report.mjs.txt](make-report.mjs.txt)
- [measured-inputs.txt](measured-inputs.txt)
- [mismatch-Full-thread-JSON-1440.json](mismatch-Full-thread-JSON-1440.json)
- [mismatch-Full-thread-JSON-390.json](mismatch-Full-thread-JSON-390.json)
- [mutate-events-before.json](mutate-events-before.json)
- [mutate-run-before.json](mutate-run-before.json)
- [mutate-thread-before.json](mutate-thread-before.json)
- [owner-ledger-and-completion.txt](owner-ledger-and-completion.txt)
- [performance-initial.log.txt](performance-initial.log.txt)
- [performance.json](performance.json)
- [performance.log.txt](performance.log.txt)
- [performance.mjs.txt](performance.mjs.txt)
- [playwright.config.mjs.txt](playwright.config.mjs.txt)
- [pr-382-claims.json](pr-382-claims.json)
- [prefix-checks.mjs.txt](prefix-checks.mjs.txt)
- [prefix-memory.json](prefix-memory.json)
- [prefix-memory.log.txt](prefix-memory.log.txt)
- [prefix-memory.mjs.txt](prefix-memory.mjs.txt)
- [prefix-results.json](prefix-results.json)
- [prefix.log.txt](prefix.log.txt)
- [progress-1440.png](progress-1440.png)
- [progress-390.png](progress-390.png)
- [progress-contract.json](progress-contract.json)
- [progress-contract.log.txt](progress-contract.log.txt)
- [progress-contract.mjs.txt](progress-contract.mjs.txt)
- [progress-drawer-1440.png](progress-drawer-1440.png)
- [progress-drawer-390.png](progress-drawer-390.png)
- [progress-visual-initial.log.txt](progress-visual-initial.log.txt)
- [progress-visual.json](progress-visual.json)
- [progress-visual.log.txt](progress-visual.log.txt)
- [reasoning-1440.png](reasoning-1440.png)
- [reasoning-390.png](reasoning-390.png)
- [restart-check.mjs.txt](restart-check.mjs.txt)
- [restart-results.json](restart-results.json)
- [restart.log.txt](restart.log.txt)
- [restored-expansion-390.png](restored-expansion-390.png)
- [result-1440.json](result-1440.json)
- [result-390.json](result-390.json)
- [review-claims.txt](review-claims.txt)
- [server-restart.log.txt](server-restart.log.txt)
- [server.log.txt](server.log.txt)
- [server.mjs.txt](server.mjs.txt)
- [shutdown.log.txt](shutdown.log.txt)
- [similarA-events-before.json](similarA-events-before.json)
- [similarA-run-before.json](similarA-run-before.json)
- [similarA-thread-before.json](similarA-thread-before.json)
- [similarB-events-before.json](similarB-events-before.json)
- [similarB-run-before.json](similarB-run-before.json)
- [similarB-thread-before.json](similarB-thread-before.json)
- [thread-1440.json](thread-1440.json)
- [thread-1440.png](thread-1440.png)
- [thread-390.json](thread-390.json)
- [thread-390.png](thread-390.png)
- [thread-comparison.json](thread-comparison.json)
- [tokens.log.txt](tokens.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [validate-evidence.mjs.txt](validate-evidence.mjs.txt)
- [variables-1440.json](variables-1440.json)
- [variables-390.json](variables-390.json)

# 5. Observations outside scope

- Full-value expansion is an explicit expensive operation on the 2 MiB fixture (up to 892 ms long tasks). Bounded prefixes and settled controls have the measured behavior above; no claim is made about arbitrarily large explicit expansions.
- The root formatting command also inspects this report's raw evidence. Those artifact-only formatting failures are separated from candidate-source formatting.
- The QA branch name differs from the PR source branch while its HEAD matches exactly. No branch was switched.
- No changes were made to other bolts, owner ports 4747/4748, the owner store or the main checkout.
