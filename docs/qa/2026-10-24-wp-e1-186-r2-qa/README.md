# Independent QA round 1 — WP-E1 #186 round 2

## 1. Verdict

**FAIL** at **bf9935754dcfbdef80b8d978fb2e605a5111b7f5**. A supported zero-boundary history request returns a cursor that silently skips event 1. The required infrastructure coverage gate also remains red; its failures are recorded separately from the feature defect.

Branch: codex-qa-wp-e1-186-r2. Worktree: %USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-e1-186-r2. Comparison target: main at 498da565d445113116495301691e5e284d0e3d42. HEAD was checked before work and again after testing. Dependencies were already populated; no install, linking, production edit, staging, commit, branch change, GitHub write or sub-agent was used. All changes are uncommitted QA evidence.

The binding COMMON.md and QA-COMMON.md briefs, root instructions, issue workflow, architecture, implementation plan, #278 decision ledger, #186/#303/#259 issue bodies, ADR-0050 Round 2, sustained-run input row 3 and the actual base-to-head diff were read. The implementer's report was treated as a claim, never as independent acceptance evidence.

### Environment and evidence boundaries

Node 22.14.0 was first on PATH for every build/gate/script. The built gateway ran in real Node processes with file-backed SQLite and FakeHarness/FakeStructured/fake classifier/decider ports. Inference evidence is **fake-only**; HTTP, storage, browser parsing, process restart and webhook delivery used real components/processes. Edge was driven headlessly through Playwright against built assets. Service workers were blocked in the independent browser contexts to keep the executable revision explicit.

Head gateway/control: 6150/6151. Baseline gateway/control: 6152/6153. Local webhook receiver: 6154. Manually managed stores all use %USERPROFILE%\AppData\Local\Temp\gg-qa-e1-186r2-*. The head store is gg-qa-e1-186r2-XBteKB. Initial/restarted gateway PIDs were 54564/55440. No owner app/store/checkout was operated on.

**Environment deviation:** the standard API coverage suite spawned its own hardcoded subprocess instance on 5649 and its fixtures use their existing gg-api-* prefixes. This was discovered in its retained log after launch. The suite was not repeated. Other gate fixtures choose their own existing test ports/temp names. The independent scenarios obeyed the requested 6150–6159/prefix constraints. No owner ports were used.

**D-015 registered:** native process-tree termination is denied in this sandbox. Forced descendant termination/cleanup is not established here. Real graceful gateway exit/restart was established, with a changed PID and identical durable history/threads.

## 2. Defects

### QA-186R2-001 — major — empty before-first history page skips the first durable event

Reproduction against the built gateway with a runs:read key and the retained run 01M5RVRSG8PWB6B0PAWH9TYCZ2:

1. GET /runs/{id}/events?around=0&limit=1 returns HTTP 200, items [], nextAfter 1, and a non-null newerCursor whose sequence is 1.
2. GET /runs/{id}/events?cursor={that newerCursor}&limit=1 returns event **2**, run.started.
3. GET /runs/{id}/events?after=0&limit=1 returns event **1**, run.queued, including the pinned definition/initial thread.

Expected: a valid before-first read must supply a continuation that includes event 1; alternatively an unsupported zero seek must fail explicitly. Actual: following the supplied cursor silently omits event 1. The normal UI's positive sequence selection works; this is a supported REST boundary defect.

Evidence: [complete response bodies](zero-boundary.json), [reproduction script](zero-boundary.mjs.txt), [log](zero-boundary.log.txt). Source locations: apps/api/src/routes/runs.ts:260 converts around=0 to exclusive older sequence 1; packages/infrastructure/src/sqlite/events.ts:183–184 uses that exclusive bound as the empty page's last member and emits a newer cursor after 1. No fix was made.

### Required gate failure, separately classified

Infrastructure coverage: **7 failed / 790 passed**, 5 failed / 50 passed files. These are unresolved gate results, not proof that #186 introduced seven defects:

- ProcessScripts real child/grandchild abort: EBUSY during cleanup.
- Claude transport deadline/output overflow: EBUSY during cleanup.
- Already-aborted/running Claude process cancellation: EBUSY during cleanup.
- Claude descendant termination: marker continued to grow; cleanup also reported EBUSY.
- Claude readiness hang: expected problem classification differed.
- ProcessScripts incomplete-UTF-8 cancellation: expected rejection did not occur.
- SQLite upgrade owner-default conflict case: 20,000 ms timeout in an untouched file.

The full failures are retained in [the infrastructure gate log](infrastructure-coverage.log.txt). D-015 applies to native termination evidence; the SQLite timing failure must not be erased or represented as fixed by an isolated pass. Its one isolated diagnostic and exact outcome are recorded in the gates section.

## 3. Coverage of criteria

Touched systems enumerated and exercised: SQLite ordered windows/latest evidence/validation; REST history/thread/observation reads and scope/owner authorization; API client resources and SSE parser/reconnect; domain paged replay; browser event-store retention/persistence/migration; browsing and live acknowledgement; inspector status/failure/result/delivery/exit/gate/thread/patch/variables/counters/activity; Timeline DOM/focus/keyboard/layout; changed generated API docs and performance observers.

| Requested case                                                                                                                 | Status                                                       | Independent evidence                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #186 paged replay, bounded buffers, explicit slow-consumer recovery with ordering/visibility                                   | **Failed at the zero boundary**, otherwise tested and passed | 52 API checks; exact backward/forward traversal of 1,778 events; native paused-reader recovery of all 82 events; controlled Edge typed-error recovery at 600                                                      |
| #186 bound temporary browser history while preserving durable history/context                                                  | Tested and passed for exercised workloads                    | 3,033-event live run; 512-event and 1,048,576-byte bounds; byte-heavy frozen window 121 events / 984,806 estimated UTF-16 bytes; full-read equality                                                               |
| 1. Retention, payload-heavy events, memory/cache, reload, quota, old cache                                                     | Tested and passed, with the first harness attempts retained  | Public store component tests; real Edge cache measurements; a transient exact 600,000-character event; actual sessionStorage QuotaExceededError after 52 filler entries; old cache version discarded              |
| 2. Older/newer cursors, out-of-window around selection, same timestamps, window edge, live join, active run/reload/typed error | **Failed at around=0**, positive paths passed                | Opaque traversal and both-direction equality; 750 same-timestamp events; frozen membership while live ack 750→775; reload after 775; controlled stream error then after=600; exact returned suffix                |
| 3. Projections beyond retained window                                                                                          | Tested and passed with explicit activity scope               | Ancient exit/gate/finish evidence after 750 later rows; evicted failure and real webhook delivery/result; full-replay historical threads, patch before, 150 mutation passes and counters                          |
| 4. Timeline 1440/390 in both themes, ≤80 rows, keyboard, focus, selection, live end, Reading note                              | Tested and passed                                            | Four viewport/theme cases, ARIA captures and inspected screenshots; Home/End/Arrow/PageUp/PageDown/boundary Shift+Tab/Enter; unavailable-event error; delayed thread response retains event 100 while reading 129 |
| 5. New REST reads: cursor/around/limit validation, authorization, at=0/beyond-tail/checkpoints                                 | **Failed at empty-page continuation**, other checks passed   | 52 retained API checks plus zero-boundary reproduction; runs:read 200, wrong scope 403, other owner 404, no key 401; exact full-replay comparisons at 0, 127/128/129, 511/512/513 and checkpoint ±1/beyond tail   |
| 6. Same-workload before/after inspector heap/cache/Timeline DOM                                                                | Measured; see measurements below                             | Independent target-main snapshot and exact-head processes, same 500-pass/6,008-event workload, CDP heap, cache UTF-16 bytes, mounted rows/descendants                                                             |

Progress is intentionally scoped by ADR-0050 to the **retained window**. The activity groups were compared to the matching slice of a fresh full read, and the UI's scope label was verified. This report does not claim that all historical progress groups are simultaneously rendered.

### Important observed numbers

- Static 1,778-event history: retained events 1267–1778, 512 rows, 148,480 estimated UTF-16 row bytes, 149,806 framed cache bytes; 80 mounted Timeline rows.
- Active payload-heavy browsing: retained events 601–721 stayed unchanged while acknowledgement advanced 750→775; 121 rows, 984,806 estimated UTF-16 bytes.
- Completed cyclic run: 3,033 durable events; retained exact suffix 2522–3033, 512 rows, 837,438 estimated row bytes, 838,764 framed cache bytes; live-end scroll 1856+540=2396.
- Oversized event: exact 600,000-character payload displayed transiently; only its identity marker was persisted; 212,978 estimated retained bytes at that observation.
- Real paused reader: 64 events with 500,000-character payloads; 6,100 ms pause; typed 503 SSE_SLOW_CONSUMER; 18 complete events before the failure, resumed after 18, 64 events recovered, 82 total, zero gaps/duplicates.
- Mutation history: 760 events; 150 exact variable entries and work/gate visits; selecting evicted event 203 yielded before-count 39 and after-count 40, equal to full replay.

### Not established / limitations

- Forced native process-tree termination and cleanup remain D-015-limited; unrestricted CI/QA is required for those gates.
- No live provider turn was authorized or run. All inference content is fake-only.
- Browser in-memory count/byte bounds are checked through the public store's component tests; live Edge independently measures persisted state, heap and rendered membership. No private store introspection or test-only production export was added.
- PWA offline/service-worker update installation was not tested. These browser contexts loaded the built revision directly with service workers blocked.
- The performance pair is on a heavily shared host, with other coverage work overlapping part of the observation. It establishes the observed heap/cache/DOM curves for this workload, not a quiet-host latency SLA or isolated causal execution-time claim.
- No full browser regression suite or live provider acceptance is claimed. Independent built-app scripts covered the requested inspector flows; the implementer's nine-spec result was not reused.
- #259's separate general large-value-rendering acceptance and owner product acceptance are not completed by this bounded #186 QA.

### Initial harness failures and finite follow-ups

All initial failed checks are retained. They are not silently replaced with green reruns:

- The first static browser script demanded exactly 512 rows after Follow live. The contract allows a smaller exact suffix (128 rows was returned). Recovery and synchronized live checks compare the actual retained suffix and pass.
- The first live script’s eight preliminary samples reached only acknowledgement 88; its name alone is not thousands-of-events evidence. It then used a 45-second event-count wait and compared a pre-navigation cursor snapshot with a still-advancing live cursor. The fake harness also bounds ordinary progress summaries, so a later attempt's “fewer than 512” assertion did not establish byte pressure. The final harness uses explicit appended 50,000-character payloads, frozen membership, monotonic navigation cursors and synchronized state; four checks passed.
- An old-cache write attempted while the old page was still streaming could be overwritten before unload. The final migration check stops the old page at /healthz before seeding the old cache, then observes after=0.
- Projection setup initially expected a raw QA_FAILURE code, but the public engine truthfully wraps uncertain harness submission as HARNESS_DELIVERY_UNCERTAIN; the final check compares the displayed persisted code/message. It also initially assumed a singular “delivery” field for file returns, whereas the inspector's delivery panel represents durable webhook deliveries. The final native HTTP webhook case passes.
- The first webhook script sent an empty JSON body to publish; the corrected delivery-only request sends {}. All its initial setup failure evidence remains.
- Baseline snapshot setup encountered dependency-resolution errors (tooling location, CSS package resolution, subpath alias ordering, openapi-fetch). The final snapshot build completed. No target-main production source was edited to resolve those harness paths.

### Per-check ledger

The generated ledger below records each check's steps/script, expectation, actual numbers or excerpt, result and retained evidence. A failed harness prerequisite does not become a product defect merely because dependent checks failed.

#### api-results.json

Steps: Real HTTP, ordered pages, scope/owner boundaries and full-read reference. Execute [api.mjs.txt](api.mjs.txt); detailed values: [api-results.json](api-results.json).

| Case                                                                                                                 | Expected                                                     | Actual / excerpt                                                                                                                                                                                                                       | Result |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| fresh full history: status, complete durable evidence, same timestamp batch                                          | HTTP status or deep equality asserted by the retained script | {"runId":"01M5RVRSG8PWB6B0PAWH9TYCZ2","total":1778,"distinctTimestamps":942,"sha256":"bf6172108da7b98fcbe712cc2a132d084d646655a52e661baf0f67a4981d8fa8","record":{"id":"01M5RVRSG8PWB6B0PAWH9TYCZ2","ownerId":"local","loopId":"01M5RV | PASS   |
| opaque older pages exactly equal fresh full read, no gaps or duplicates                                              | HTTP status or deep equality asserted by the retained script | {"pages":14,"newerPages":13,"total":1778,"first":1,"last":1778,"sha256":"bf6172108da7b98fcbe712cc2a132d084d646655a52e661baf0f67a4981d8fa8","boundaries":[{"first":1651,"last":1778,"cursor":"eyJydW5JZCI6IjAxTTVSVlJTRzhQV0I2QjBQQVdIO | PASS   |
| around and window-edge limits 1                                                                                      | HTTP status or deep equality asserted by the retained script | {"status":200,"count":1,"first":512,"last":512}                                                                                                                                                                                        | PASS   |
| around and window-edge limits 128                                                                                    | HTTP status or deep equality asserted by the retained script | {"status":200,"count":128,"first":385,"last":512}                                                                                                                                                                                      | PASS   |
| around and window-edge limits 512                                                                                    | HTTP status or deep equality asserted by the retained script | {"status":200,"count":512,"first":1,"last":512}                                                                                                                                                                                        | PASS   |
| around and window-edge limits 1000                                                                                   | HTTP status or deep equality asserted by the retained script | {"status":200,"count":512,"first":1,"last":512}                                                                                                                                                                                        | PASS   |
| reject invalid query cursor=                                                                                         | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/invalid-cursor","title":"invalid cursor","status":400,"code":"INVALID_CURSOR","detail":"Choose a cursor returned by this run history."}}                                | PASS   |
| reject invalid query cursor=!!!                                                                                      | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/invalid-cursor","title":"invalid cursor","status":400,"code":"INVALID_CURSOR","detail":"Choose a cursor returned by this run history."}}                                | PASS   |
| reject invalid query cursor=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/invalid-cursor","title":"invalid cursor","status":400,"code":"INVALID_CURSOR","detail":"Choose a cursor returned by this run history."}}                                | PASS   |
| reject invalid query cursor=e30                                                                                      | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/invalid-cursor","title":"invalid cursor","status":400,"code":"INVALID_CURSOR","detail":"Choose a cursor returned by this run history."}}                                | PASS   |
| reject invalid query cursor=eyJydW5JZCI6Im90aGVyIiwic2VxIjo1MTIsImRpcmVjdGlvbiI6Im9sZGVyIn0                          | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/invalid-cursor","title":"invalid cursor","status":400,"code":"INVALID_CURSOR","detail":"Choose a cursor returned by this run history."}}                                | PASS   |
| reject invalid query cursor=eyJydW5JZCI6IjAxTTVSVlJTRzhQV0I2QjBQQVdIOVRZQ1oyIiwic2VxIjozODUsImRpcmVjdGlvbiI6Im9sZGVy | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/","message": | PASS   |
| reject invalid query cursor=eyJydW5JZCI6IjAxTTVSVlJTRzhQV0I2QjBQQVdIOVRZQ1oyIiwic2VxIjozODUsImRpcmVjdGlvbiI6Im9sZGVy | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/","message": | PASS   |
| reject invalid query around=5&after=0                                                                                | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/","message": | PASS   |
| reject invalid query limit=0                                                                                         | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/limit","mess | PASS   |
| reject invalid query limit=1001                                                                                      | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/limit","mess | PASS   |
| reject invalid query limit=-1                                                                                        | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/limit","mess | PASS   |
| reject invalid query limit=1.5                                                                                       | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/limit","mess | PASS   |
| reject invalid query around=-1                                                                                       | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/around","mes | PASS   |
| reject invalid query around=1.5                                                                                      | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/around","mes | PASS   |
| reject invalid query around=9007199254740991                                                                         | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/around","mes | PASS   |
| cursor returned by another actual run is rejected                                                                    | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/invalid-cursor","title":"invalid cursor","status":400,"code":"INVALID_CURSOR","detail":"Choose a cursor returned by this run history."}}                                | PASS   |
| authorization /events?around=512 reader                                                                              | HTTP status or deep equality asserted by the retained script | {"status":200,"sha256":"8e88f21a8d2b83bd981973bb34b1f841c6ace3aa6c3d8a1e2edd01d69fbeff84"}                                                                                                                                             | PASS   |
| authorization /events?around=512 denied                                                                              | HTTP status or deep equality asserted by the retained script | {"status":403,"body":{"type":"https://graphgoblin.dev/problems/forbidden","title":"forbidden","status":403,"code":"FORBIDDEN","detail":"this key lacks the \"runs:read\" scope"}}                                                      | PASS   |
| authorization /events?around=512 other                                                                               | HTTP status or deep equality asserted by the retained script | {"status":404,"body":{"type":"https://graphgoblin.dev/problems/run-not-found","title":"run not found","status":404,"code":"RUN_NOT_FOUND","detail":"run 01M5RVRSG8PWB6B0PAWH9TYCZ2 not found"}}                                        | PASS   |
| authorization /events?around=512 null                                                                                | HTTP status or deep equality asserted by the retained script | {"status":401,"body":{"type":"https://graphgoblin.dev/problems/unauthorized","title":"unauthorized","status":401,"code":"UNAUTHORIZED","detail":"an API key is required"}}                                                             | PASS   |
| authorization /observation reader                                                                                    | HTTP status or deep equality asserted by the retained script | {"status":200,"sha256":"b1f15744ed6aa6edca277059b34c3c87b585aabd4b4261184e6979cc8ef53f3f"}                                                                                                                                             | PASS   |
| authorization /observation denied                                                                                    | HTTP status or deep equality asserted by the retained script | {"status":403,"body":{"type":"https://graphgoblin.dev/problems/forbidden","title":"forbidden","status":403,"code":"FORBIDDEN","detail":"this key lacks the \"runs:read\" scope"}}                                                      | PASS   |
| authorization /observation other                                                                                     | HTTP status or deep equality asserted by the retained script | {"status":404,"body":{"type":"https://graphgoblin.dev/problems/run-not-found","title":"run not found","status":404,"code":"RUN_NOT_FOUND","detail":"run 01M5RVRSG8PWB6B0PAWH9TYCZ2 not found"}}                                        | PASS   |
| authorization /observation null                                                                                      | HTTP status or deep equality asserted by the retained script | {"status":401,"body":{"type":"https://graphgoblin.dev/problems/unauthorized","title":"unauthorized","status":401,"code":"UNAUTHORIZED","detail":"an API key is required"}}                                                             | PASS   |
| authorization /thread?at=128 reader                                                                                  | HTTP status or deep equality asserted by the retained script | {"status":200,"sha256":"ec6092336d69ac01bf15671aae8ececeafd9581d60a4a3a5c27f41d4554b2ac2"}                                                                                                                                             | PASS   |
| authorization /thread?at=128 denied                                                                                  | HTTP status or deep equality asserted by the retained script | {"status":403,"body":{"type":"https://graphgoblin.dev/problems/forbidden","title":"forbidden","status":403,"code":"FORBIDDEN","detail":"this key lacks the \"runs:read\" scope"}}                                                      | PASS   |
| authorization /thread?at=128 other                                                                                   | HTTP status or deep equality asserted by the retained script | {"status":404,"body":{"type":"https://graphgoblin.dev/problems/run-not-found","title":"run not found","status":404,"code":"RUN_NOT_FOUND","detail":"run 01M5RVRSG8PWB6B0PAWH9TYCZ2 not found"}}                                        | PASS   |
| authorization /thread?at=128 null                                                                                    | HTTP status or deep equality asserted by the retained script | {"status":401,"body":{"type":"https://graphgoblin.dev/problems/unauthorized","title":"unauthorized","status":401,"code":"UNAUTHORIZED","detail":"an API key is required"}}                                                             | PASS   |
| thread at 0 equals fresh complete replay                                                                             | HTTP status or deep equality asserted by the retained script | {"at":0,"sha256":"3423f7ef4332b3176fd20d6718c20069ccfac3144b12e45156021e9cc22523d5","counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}},"vars":{}}                 | PASS   |
| thread at 1 equals fresh complete replay                                                                             | HTTP status or deep equality asserted by the retained script | {"at":1,"sha256":"3423f7ef4332b3176fd20d6718c20069ccfac3144b12e45156021e9cc22523d5","counters":{"nodeVisits":{},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}},"vars":{}}                 | PASS   |
| thread at 127 equals fresh complete replay                                                                           | HTTP status or deep equality asserted by the retained script | {"at":127,"sha256":"ec6092336d69ac01bf15671aae8ececeafd9581d60a4a3a5c27f41d4554b2ac2","counters":{"nodeVisits":{"start":1,"work":11,"gate":10},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens" | PASS   |
| thread at 128 equals fresh complete replay                                                                           | HTTP status or deep equality asserted by the retained script | {"at":128,"sha256":"ec6092336d69ac01bf15671aae8ececeafd9581d60a4a3a5c27f41d4554b2ac2","counters":{"nodeVisits":{"start":1,"work":11,"gate":10},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens" | PASS   |
| thread at 129 equals fresh complete replay                                                                           | HTTP status or deep equality asserted by the retained script | {"at":129,"sha256":"ec6092336d69ac01bf15671aae8ececeafd9581d60a4a3a5c27f41d4554b2ac2","counters":{"nodeVisits":{"start":1,"work":11,"gate":10},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens" | PASS   |
| thread at 511 equals fresh complete replay                                                                           | HTTP status or deep equality asserted by the retained script | {"at":511,"sha256":"a704d2427a1c5ae2e9d1dbb27ce212b9955c79693ec5374605904e7fb32f4854","counters":{"nodeVisits":{"start":1,"work":43,"gate":42},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens" | PASS   |
| thread at 512 equals fresh complete replay                                                                           | HTTP status or deep equality asserted by the retained script | {"at":512,"sha256":"a704d2427a1c5ae2e9d1dbb27ce212b9955c79693ec5374605904e7fb32f4854","counters":{"nodeVisits":{"start":1,"work":43,"gate":42},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens" | PASS   |
| thread at 513 equals fresh complete replay                                                                           | HTTP status or deep equality asserted by the retained script | {"at":513,"sha256":"a704d2427a1c5ae2e9d1dbb27ce212b9955c79693ec5374605904e7fb32f4854","counters":{"nodeVisits":{"start":1,"work":43,"gate":42},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens" | PASS   |
| thread at 1027 equals fresh complete replay                                                                          | HTTP status or deep equality asserted by the retained script | {"at":1027,"sha256":"371ccbbcdfdf90679c9f55ca69bb479a4385998ce8ccc8db71ab76137d6c3cb7","counters":{"nodeVisits":{"start":1,"work":85,"gate":85,"done":1},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOut | PASS   |
| thread at 1028 equals fresh complete replay                                                                          | HTTP status or deep equality asserted by the retained script | {"at":1028,"sha256":"371ccbbcdfdf90679c9f55ca69bb479a4385998ce8ccc8db71ab76137d6c3cb7","counters":{"nodeVisits":{"start":1,"work":85,"gate":85,"done":1},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOut | PASS   |
| thread at 1029 equals fresh complete replay                                                                          | HTTP status or deep equality asserted by the retained script | {"at":1029,"sha256":"371ccbbcdfdf90679c9f55ca69bb479a4385998ce8ccc8db71ab76137d6c3cb7","counters":{"nodeVisits":{"start":1,"work":85,"gate":85,"done":1},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOut | PASS   |
| thread at 1778 equals fresh complete replay                                                                          | HTTP status or deep equality asserted by the retained script | {"at":1778,"sha256":"371ccbbcdfdf90679c9f55ca69bb479a4385998ce8ccc8db71ab76137d6c3cb7","counters":{"nodeVisits":{"start":1,"work":85,"gate":85,"done":1},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOut | PASS   |
| thread at 1878 equals fresh complete replay                                                                          | HTTP status or deep equality asserted by the retained script | {"at":1878,"sha256":"371ccbbcdfdf90679c9f55ca69bb479a4385998ce8ccc8db71ab76137d6c3cb7","counters":{"nodeVisits":{"start":1,"work":85,"gate":85,"done":1},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOut | PASS   |
| observation equals full-history latest exit/gate/finish/lifecycle after 750 later rows                               | HTTP status or deep equality asserted by the retained script | {"lifecycle":{"runId":"01M5RVRSG8PWB6B0PAWH9TYCZ2","seq":1028,"ts":"2026-10-25T06:25:40.868Z","type":"run.finished","status":"succeeded","outcome":"success"},"exit":{"runId":"01M5RVRSG8PWB6B0PAWH9TYCZ2","seq":1026,"ts":"2026-10-25 | PASS   |
| invalid historical thread -1                                                                                         | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/at","message | PASS   |
| invalid historical thread 1.1                                                                                        | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/at","message | PASS   |
| invalid historical thread NaN                                                                                        | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/at","message | PASS   |
| invalid historical thread 9007199254740992                                                                           | HTTP status or deep equality asserted by the retained script | {"status":400,"body":{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/at","message | PASS   |

#### browser-results.json

Steps: Completed long history, paging, selected threads, reload and four layout cases. Execute [browser.mjs.txt](browser.mjs.txt); detailed values: [browser-results.json](browser-results.json).

| Case                                                                           | Expected                                                                   | Actual / excerpt                                                                                                                                                                                                                       | Result                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| long real gateway history bounded persisted window                             | Exact stored values, stable focus, ≤80 mounted rows and valid continuation | {"rows":512,"bytes":148480,"persistedUTF16Bytes":149806,"first":1267,"last":1778}                                                                                                                                                      | PASS                               |
| projection evidence survives evicted latest exit/gate/finish                   | Exact stored values, stable focus, ≤80 mounted rows and valid continuation | {"recordStatus":"succeeded","observation":{"lifecycle":{"runId":"01M5RVRSG8PWB6B0PAWH9TYCZ2","seq":1028,"ts":"2026-10-25T06:25:40.868Z","type":"run.finished","status":"succeeded","outcome":"success"},"exit":{"runId":"01M5RVRSG8PWB | PASS                               |
| older/newer via cursor at retained boundary, exact ordered membership          | Exact stored values, stable focus, ≤80 mounted rows and valid continuation | {"boundaries":[{"first":1139,"last":1650},{"first":1011,"last":1522},{"first":883,"last":1394}],"cursorRequests":2}                                                                                                                    | PASS                               |
| seek evicted event, exact thread vars and counters                             | Exact stored values, stable focus, ≤80 mounted rows and valid continuation | {"seq":100,"vars":{},"counters":{"nodeVisits":{"start":1,"work":8,"gate":8},"usage":{"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"reasoningOutputTokens":0}}}                                                               | PASS                               |
| old thread remains visible with Reading note until new selected thread arrives | Exact stored values, stable focus, ≤80 mounted rows and valid continuation | {"heldSeq":100,"requestedSeq":129,"retainedThreadExact":true}                                                                                                                                                                          | PASS                               |
| reload restores frozen window and resumes at independent acknowledged cursor   | Exact stored values, stable focus, ≤80 mounted rows and valid continuation | {"mode":"history","first":2,"last":129,"ack":1778,"reopen":{"url":"http://127.0.0.1:6150/runs/01M5RVRSG8PWB6B0PAWH9TYCZ2/events?after=1778","sse":true}}                                                                               | PASS                               |
| Timeline keyboard, selection, layout 1440 dark                                 | Exact stored values, stable focus, ≤80 mounted rows and valid continuation | {"width":1440,"theme":"dark","rows":80,"selected":1732,"end":1778,"geometry":{"documentWidth":1440,"innerWidth":1440,"theme":"dark"}}                                                                                                  | PASS                               |
| Timeline keyboard, selection, layout 1440 light                                | Exact stored values, stable focus, ≤80 mounted rows and valid continuation | {"width":1440,"theme":"light","rows":80,"selected":1732,"end":1778,"geometry":{"documentWidth":1440,"innerWidth":1440,"theme":"light"}}                                                                                                | PASS                               |
| Timeline keyboard, selection, layout 390 dark                                  | Exact stored values, stable focus, ≤80 mounted rows and valid continuation | {"width":390,"theme":"dark","rows":80,"selected":1732,"end":1778,"geometry":{"documentWidth":390,"innerWidth":390,"theme":"dark"}}                                                                                                     | PASS                               |
| Timeline keyboard, selection, layout 390 light                                 | Exact stored values, stable focus, ≤80 mounted rows and valid continuation | {"width":390,"theme":"light","rows":80,"selected":1732,"end":1778,"geometry":{"documentWidth":390,"innerWidth":390,"theme":"light"}}                                                                                                   | PASS                               |
| Follow live reaches complete tail with no gap or duplicate                     | Exact stored values, stable focus, ≤80 mounted rows and valid continuation | "AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:\n+ actual - expected\n\n [\n {\n nodeId: 'qa',\n payload: '',\n reason: 'manual',\n runId: '01M5RVRSG8PWB6B0PAWH9TYCZ2',\n- seq: 1267,\n- ts: '2026-10-25T | FAIL; classify using caveats above |

#### live-results.json

Steps: Initial live harness; preserved preliminary samples and failures. Execute [live.mjs.txt](live.mjs.txt); detailed values: [live-results.json](live-results.json).

| Case                                                                 | Expected                                                                            | Actual / excerpt                                                                                                                                                                                                                       | Result                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| thousands of payload-heavy live events stay bounded in Edge          | See harness caveats: this attempt does not establish thousands-of-events acceptance | {"samples":8,"last":{"elapsedMs":10519,"heapUsed":12433540,"heapTotal":28295168,"rows":80,"dom":400,"count":88,"retainedUTF16Bytes":141344,"persistedUTF16Bytes":141818,"ack":88}}                                                     | PASS                               |
| browsing while executing freezes window but advances acknowledgement | See harness caveats: this attempt does not establish thousands-of-events acceptance | "Error: too few events"                                                                                                                                                                                                                | FAIL; classify using caveats above |
| reload during active historical browsing uses acknowledged cursor    | See harness caveats: this attempt does not establish thousands-of-events acceptance | "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n'198' !== '197'\n"                                                                                                                                           | FAIL; classify using caveats above |
| Follow live rejoins executing stream with exact retained suffix      | See harness caveats: this attempt does not establish thousands-of-events acceptance | "TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n\u001b[2m - waiting for getByRole('button', { name: 'Follow live', exact: true })\u001b[22m\n\u001b[2m - locator resolved to <button disabled type=\"button\" clas | FAIL; classify using caveats above |
| oversized event retains identity and exact transient payload         | See harness caveats: this attempt does not establish thousands-of-events acceptance | {"seq":1093,"exactCharacters":600000,"marker":{"seq":1093,"type":"run.woken","uncached":true,"description":"qa woken by manual"},"cachedBytes":212978}                                                                                 | PASS                               |
| actual session quota exhaustion remains nonfatal                     | See harness caveats: this attempt does not establish thousands-of-events acceptance | {"quota":{"entries":52,"name":"QuotaExceededError"},"rows":80,"pageErrors":[]}                                                                                                                                                         | PASS                               |
| old cache version discarded and fresh SSE begins at zero             | See harness caveats: this attempt does not establish thousands-of-events acceptance | "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n'384' !== '0'\n"                                                                                                                                             | FAIL; classify using caveats above |

#### live-synchronized-results.json

Steps: Second harness attempt; ordinary progress summary was bounded by the engine. Execute [live-synchronized.mjs.txt](live-synchronized.mjs.txt); detailed values: [live-synchronized-results.json](live-synchronized-results.json).

| Case                                                                           | Expected                                                                     | Actual / excerpt                                                                                                                                                                                                                       | Result                             |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| bounded heavy history while actual run executes                                | See preserved invalid byte-pressure assumption; dependent cases inconclusive | "AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:\n\n assert.ok(x.log.events.length<512)\n"                                                                                                                  | FAIL; classify using caveats above |
| reload during execution freezes membership and monotonic complete-event cursor | See preserved invalid byte-pressure assumption; dependent cases inconclusive | "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n'live' !== 'history'\n"                                                                                                                                      | FAIL; classify using caveats above |
| same workload reaches thousands, follows exact suffix and remains byte bounded | See preserved invalid byte-pressure assumption; dependent cases inconclusive | "TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n\u001b[2m - waiting for getByRole('button', { name: 'Follow live', exact: true })\u001b[22m\n\u001b[2m - locator resolved to <button disabled type=\"button\" clas | FAIL; classify using caveats above |
| legacy cache migration with stopped old page starts SSE at zero                | See preserved invalid byte-pressure assumption; dependent cases inconclusive | {"oldSentinel":999999,"reopen":"http://127.0.0.1:6150/runs/01M5RWCPE2C3ZB5XZ42MX9V9FJ/events?after=0","observedAck":2304}                                                                                                              | PASS                               |

#### live-final-results.json

Steps: Final synchronized active run with explicit 50,000-character payload events. Execute [live-final.mjs.txt](live-final.mjs.txt); detailed values: [live-final-results.json](live-final-results.json).

| Case                                                                           | Expected                                                                             | Actual / excerpt                                                                                                                            | Result |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| bounded heavy history while actual run executes                                | Frozen history, monotonic ack/reload cursor, exact live suffix and count/byte bounds | {"runStatus":"running","frozenFirst":601,"frozenLast":721,"ackBefore":750,"ackAfter":775,"rows":121,"bytes":984806}                         | PASS   |
| reload during execution freezes membership and monotonic complete-event cursor | Frozen history, monotonic ack/reload cursor, exact live suffix and count/byte bounds | {"snapshotAck":775,"reopenedAfter":775,"observedAck":775,"windowFirst":601,"windowLast":721}                                                | PASS   |
| same workload reaches thousands, follows exact suffix and remains byte bounded | Frozen history, monotonic ack/reload cursor, exact live suffix and count/byte bounds | {"total":3033,"retained":512,"bytes":837438,"sessionBytes":838764,"first":2522,"last":3033,"scroll":{"top":1856,"height":540,"total":2396}} | PASS   |
| legacy cache migration with stopped old page starts SSE at zero                | Frozen history, monotonic ack/reload cursor, exact live suffix and count/byte bounds | {"oldSentinel":999999,"reopen":"http://127.0.0.1:6150/runs/01M5RWK75XZVH91XABHSK8HT1H/events?after=0","observedAck":2422}                   | PASS   |

#### recovery-results.json

Steps: Controlled typed HTTP fault followed by real gateway reads; patch and two-tab checks. Execute [recovery.mjs.txt](recovery.mjs.txt); detailed values: [recovery-results.json](recovery-results.json).

| Case                                                                      | Expected                                                                    | Actual / excerpt                                                                                                                                                                                                                       | Result |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| typed slow-consumer reason is visible and resumes from complete event 600 | after=600, exact suffix, exact before/after patch and independent tab state | {"fault":"controlled public HTTP stream, real browser parser, real gateway reconnect","receivedPrefix":600,"reopen":"http://127.0.0.1:6150/runs/01M5RVRSG8PWB6B0PAWH9TYCZ2/events?after=600","count":512,"first":1267,"last":1778}     | PASS   |
| after typed failure older/newer, reload and live suffix remain exact      | after=600, exact suffix, exact before/after patch and independent tab state | {"reloadedFirst":1139,"last":1778,"count":128,"exactSuffix":true}                                                                                                                                                                      | PASS   |
| selected node patch before and after equal full replay boundary           | after=600, exact suffix, exact before/after patch and independent tab state | {"seq":49,"boundaryBefore":48,"results":[{"path":"/outputs/work","before":{"nodeId":"work","value":"QA output 2","at":"2026-10-25T06:25:35.019Z"},"after":{"nodeId":"work","value":"QA output 3","at":"2026-10-25T06:25:35.118Z"}},{"p | PASS   |
| two independent tabs restore separate history windows                     | after=600, exact suffix, exact before/after patch and independent tab state | {"tab1":{"mode":"history","first":1},"tab2":{"mode":"live","first":1267,"ack":1778}}                                                                                                                                                   | PASS   |

#### projection-results.json

Steps: Real restart and initial projection harness. Execute [projections.mjs.txt](projections.mjs.txt); detailed values: [projection-results.json](projection-results.json).

| Case                                                                                    | Expected                                                                              | Actual / excerpt                                                                                                                                        | Result                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| real gateway process restart preserves complete original history and historical threads | Identical restart oracle; initial code/field assumptions retained as harness failures | {"beforePid":54564,"afterPid":55440,"runId":"01M5RVRSG8PWB6B0PAWH9TYCZ2","total":1778,"checkpoint":{"seq":1028,"hasReplayState":true},"identical":true} | PASS                               |
| evicted failure projection equals fresh full history and record                         | Identical restart oracle; initial code/field assumptions retained as harness failures | "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n+ actual - expected\n\n+ 'HARNESS_DELIVERY_UNCERTAIN'\n- 'QA_FAILURE'\n"        | FAIL; classify using caveats above |
| evicted delivery projection equals fresh full history and record                        | Identical restart oracle; initial code/field assumptions retained as harness failures | "AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:\n\n assert.ok(full.record.delivery)\n"                                      | FAIL; classify using caveats above |

#### projection-complete-results.json

Steps: Persisted failure projection and initial native webhook setup. Execute [projection-complete.mjs.txt](projection-complete.mjs.txt); detailed values: [projection-complete-results.json](projection-complete-results.json).

| Case                                                                       | Expected                                                           | Actual / excerpt                                                                                                                                                                                                                       | Result                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| evicted durable failure retains exact code, message, status and thread     | Exact displayed failure; first publish body setup failure retained | {"runId":"01M5RX73ZRK4XJN8ASJJ8YJ36J","total":711,"retainedFirst":200,"failure":{"code":"HARNESS_DELIVERY_UNCERTAIN","message":"harness turn failed: Independent QA failure","nodeId":"work","resumable":true,"details":{"adapterCode" | PASS                               |
| evicted webhook delivery, result and finish agree with full server history | Exact displayed failure; first publish body setup failure retained | "Error: {\"type\":\"https://graphgoblin.dev/problems/malformed-body\",\"title\":\"malformed body\",\"status\":400,\"code\":\"MALFORMED_BODY\",\"detail\":\"Body cannot be empty when content-type is set to 'application/json'\"}"     | FAIL; classify using caveats above |

#### delivery-final-results.json

Steps: Real local HTTP webhook delivery followed by 700 later events. Execute [delivery-final.mjs.txt](delivery-final.mjs.txt); detailed values: [delivery-final-results.json](delivery-final-results.json).

| Case                                                                       | Expected                                                                         | Actual / excerpt                                                                                                                                                                                                                       | Result |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| evicted webhook delivery, result and finish agree with full server history | Delivered identity/status, exact result/finish, retained evidence after eviction | {"runId":"01M5RX8FXSDBNCM0ANT1T7XCYB","total":741,"retainedFirst":230,"result":"OK","delivery":{"id":"01M5RX8G4FXP25GD1RS57XPX3E","channel":{"kind":"webhook","url":"http://127.0.0.1:6154/return"},"status":"delivered","attempts":1, | PASS   |

#### additional-ui-results.json

Steps: Additional keyboard boundary, visible Reading note and unavailable event. Execute [additional-ui.mjs.txt](additional-ui.mjs.txt); detailed values: [additional-ui-results.json](additional-ui-results.json).

| Case                                                                  | Expected                                                            | Actual / excerpt | Result |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------- | ------ |
| PageUp and backwards boundary Tab preserve keyboard focus             | Stable focus/selection, visible note, explicit missing-event reason |                  | PASS   |
| visible Reading note and labelled previous thread                     | Stable focus/selection, visible note, explicit missing-event reason |                  | PASS   |
| unavailable event shows explicit error and retains previous selection | Stable focus/selection, visible note, explicit missing-event reason |                  | PASS   |

#### vars-progress-results.json

Steps and assertions: [vars-progress.mjs.txt](vars-progress.mjs.txt). Actual responses/numbers: [vars-progress-results.json](vars-progress-results.json).

| Case                                                                                 | Expected                                           | Actual                                                                                                                                                                                                                                 | Result |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| current variables, gates and counters equal fresh full replay beyond retained window | Exact full-read reference or labelled window slice | {"name":"current variables, gates and counters equal fresh full replay beyond retained window","pass":true,"historyLength":150,"counters":{"nodeVisits":{"start":1,"init":1,"work":150,"gate":150,"done":1},"usage":{"inputTokens":0," | PASS   |
| evicted variable patch selection and exact before thread                             | Exact full-read reference or labelled window slice | {"name":"evicted variable patch selection and exact before thread","pass":true,"beforeCount":39,"afterCount":40}                                                                                                                       | PASS   |
| progress groups equal server full-read slice for labelled retained window            | Exact full-read reference or labelled window slice | {"name":"progress groups equal server full-read slice for labelled retained window","pass":true,"groups":["gate"],"activityEvents":25,"window":[76,203]}                                                                               | PASS   |

#### native-slow-reader.json

Steps and assertions: [native-slow-reader.mjs.txt](native-slow-reader.mjs.txt). Actual responses/numbers: [native-slow-reader.json](native-slow-reader.json).

Result: **PASS**. {"runId":"01M5RWP0JW8RB0D3QYKMBQC2TQ","holdMs":6100,"payloadEvents":64,"payloadCharacters":500000,"httpStatus":200,"bytes":383622,"sha256":"b9414456c0c898f9903e504c798b67576357b674d4d5c26e48379b53e2f95579","controls":[{"type":"urn

#### zero-boundary.json

Steps and assertions: [zero-boundary.mjs.txt](zero-boundary.mjs.txt). Actual responses/numbers: [zero-boundary.json](zero-boundary.json).

Result: **FAIL — QA-186R2-001**. {"runId":"01M5RVRSG8PWB6B0PAWH9TYCZ2","steps":[{"query":"around=0&limit=1","response":{"status":200,"body":{"items":[],"nextAfter":1,"hasMore":true,"olderCursor":null,"newerCursor":"eyJydW5JZCI6IjAxTTVSVlJTRzhQV0I2QjBQQVdIOVRZQ1oy

#### shutdown-results.json

Steps and assertions: [shutdown.mjs.txt](shutdown.mjs.txt). Actual responses/numbers: [shutdown-results.json](shutdown-results.json).

Result: **PASS — all five manual ports closed**. [{"port":6151,"status":200,"response":"{\"stopping\":true}"},{"port":6153,"status":200,"response":"{\"stopping\":true}"},{"port":6154,"status":200,"response":"stopping"},{"port":6150,"closed":true},{"port":6151,"closed":true},{"po

### Gates

All gates used Node 22.14.0. No pnpm store-lock fallback was required. No coverage threshold or exclusion changed.

| Command                                                                                                                                                 | Result                                                                            | Evidence                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| pnpm.cmd build                                                                                                                                          | PASS; 11 tasks (9 cached, 2 built); gateway/UI launched only after completion     | [build.log.txt](build.log.txt)                                                                 |
| pnpm.cmd typecheck                                                                                                                                      | PASS (0)                                                                          | [typecheck.log.txt](typecheck.log.txt)                                                         |
| pnpm.cmd lint                                                                                                                                           | PASS (0)                                                                          | [lint.log.txt](lint.log.txt)                                                                   |
| pnpm.cmd check:layers                                                                                                                                   | PASS (0)                                                                          | [check-layers.log.txt](check-layers.log.txt)                                                   |
| pnpm.cmd check:deps                                                                                                                                     | PASS (0)                                                                          | [check-deps.log.txt](check-deps.log.txt)                                                       |
| pnpm.cmd check:docs                                                                                                                                     | PASS (0)                                                                          | [check-docs.log.txt](check-docs.log.txt)                                                       |
| pnpm.cmd check:tokens                                                                                                                                   | PASS (0)                                                                          | [check-tokens.log.txt](check-tokens.log.txt)                                                   |
| pnpm.cmd --filter @graphgoblin/tooling test:coverage                                                                                                    | PASS (0)                                                                          | [tooling-tests.log.txt](tooling-tests.log.txt)                                                 |
| pnpm.cmd --filter @graphgoblin/domain test:coverage --maxWorkers=2 --coverage.reportOnFailure                                                           | PASS (0)                                                                          | [domain-coverage.log.txt](domain-coverage.log.txt)                                             |
| pnpm.cmd --filter @graphgoblin/api-client test:coverage --maxWorkers=2 --coverage.reportOnFailure                                                       | PASS (0)                                                                          | [api-client-coverage.log.txt](api-client-coverage.log.txt)                                     |
| pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2 --coverage.reportOnFailure                                                   | FAIL (1)                                                                          | [infrastructure-coverage.log.txt](infrastructure-coverage.log.txt)                             |
| pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2 --coverage.reportOnFailure                                                              | PASS (0)                                                                          | [api-coverage.log.txt](api-coverage.log.txt)                                                   |
| pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 --coverage.reportOnFailure                                                              | PASS (0)                                                                          | [web-coverage.log.txt](web-coverage.log.txt)                                                   |
| pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/upgrade.test.ts -t "refuses invalid/conflicting owner defaults" --maxWorkers=1 | PASS: 3 selected cases, 23 skipped; one isolated diagnostic                       | [isolated log](upgrade-timing-isolated.log.txt), [command/state](upgrade-timing-isolated.json) |
| pnpm.cmd check:licenses                                                                                                                                 | Not run: dependency manifests and lockfile unchanged against target main          | [provenance](provenance.json)                                                                  |
| pnpm.cmd format:check --ignore-path .gitignore --ignore-path .prettierignore                                                                            | PASS (0); extra ignore file excludes existing gitignored temporary/generated data | [format-check.log.txt](format-check.log.txt)                                                   |

The isolated run occurred after the browser, benchmark and all coverage sweeps completed, with gateways idle. The original untouched upgrade case timed out at 20,000 ms in the full infrastructure sweep; the isolated filter selected all three parameterized owner-default cases and passed in 30.12 s total. This is a diagnostic observation, not a fix or retry-to-green gate.

| Package        | Tests                     |              Lines |           Branches | Gate |
| -------------- | ------------------------- | -----------------: | -----------------: | ---- |
| domain         | 612 passed                | 98.48% (2017/2048) | 95.81% (2287/2387) | PASS |
| apiClient      | 93 passed                 |     100% (270/270) |   98.39% (184/187) | PASS |
| infrastructure | 790 passed / 7 failed     | 98.61% (2275/2307) | 95.28% (1860/1952) | FAIL |
| api            | 1,402 passed / 11 skipped |  97.4% (2181/2239) | 91.89% (1543/1679) | PASS |
| web            | 1,705 passed              | 98.71% (7704/7804) | 94.48% (8065/8536) | PASS |

Percentages are retained with truthful numerators/denominators in [coverage-summary.json](coverage-summary.json). The full failed infrastructure sweep is not replaced by the isolated diagnostic. Tooling tests exercise the changed performance observers; the tooling command does not produce coverage percentages. No new production or test source was written; retained acceptance scripts assert through supported component/HTTP/browser interfaces.

### Same-workload measurements

Both real built gateways used a 500-pass fake inference loop with three progress items per turn, 32 padding characters, 1 ms fake delay, no growing context and 6,008 durable events. New Edge contexts used 1440×900, no service worker, the same installed dependencies and Node 22.14.0. All API/inference execution remained fake-only; process/network/storage/browser paths were real.

The target-main source was exported under the ignored .tmp/qa186/baseline directory; 316 TypeScript runtime files were transpiled and its web assets were built from that snapshot. A retained Node loader/alias bridge resolves its workspace packages to the snapshot and its unchanged external dependencies to this worktree. Two CSS dependency directories were physically copied with dereference=true; no symlink/junction or another checkout was used. The head used pnpm build. The baseline reused the unchanged head Vite configuration; the CSS scanner emitted extra unused classes in the nested snapshot. This is a source-equivalent runtime/browser comparison, not a separately installed pnpm checkout.

| Metric                             | Target main |       Head |
| ---------------------------------- | ----------: | ---------: |
| Durable events                     |       6,008 |      6,008 |
| Peak sampled JS heap, bytes        | 180,285,308 | 41,243,952 |
| Heap after forced GC, bytes        |  42,937,360 | 11,589,436 |
| Peak persisted UTF-16 bytes        |   3,946,356 |    348,246 |
| Peak mounted Timeline rows         |       6,008 |         80 |
| Peak Timeline descendant DOM nodes |      30,040 |        400 |
| Observation duration, ms           |     248,295 |    153,477 |

Both succeeded without browser page errors. Host busy fractions were 97.7% and 98.0%. Target main stops persisting the run once it exceeds its existing 2,000,000-character large-history threshold; its final framed cache was 66 bytes (no run entry), while all 6,008 rows remained mounted. The head final cache was 347,716 bytes and retained 512 rows. Baseline sample count 240 versus head 184 reflects the baseline missing-ack sampling limitation described below. Do not compare observation durations as latency. The pair supports reduced heap/cache peaks and DOM size for this workload; quiet repeated timing and universal memory claims are not established.

Raw samples and outcomes: [before-after-results.json](before-after-results.json), [benchmark script](benchmark.mjs.txt), [baseline builder](baseline-build.mjs.txt), [baseline loader](baseline-loader.mjs.txt), [completed baseline build](baseline-build-complete.log.txt), [before/after log](before-after.log.txt). Exact >1 MB full-history captures are inventoried in [NOT-KEPT.md](NOT-KEPT.md).

## 4. Report path and evidence folder

Report: docs/qa/2026-10-24-wp-e1-186-r2-qa/README.md. Evidence folder: docs/qa/2026-10-24-wp-e1-186-r2-qa/. Scripts are retained as .mjs.txt; logs as .log.txt. Reproduction uses the normal .mjs extension in the ignored .tmp/qa186 directory. Source and runtime imports resolve from the worktree, with Node 22 first on PATH.

Every retained artefact is linked below. Captures above 1,000,000 bytes are recorded with byte sizes and SHA-256 in [NOT-KEPT.md](NOT-KEPT.md); they are not presented as inspectable retained captures. Local user path prefixes in text evidence are redacted to %USERPROFILE%; payload values and assertions are otherwise preserved. Digests of omitted raw captures identify their original bytes.

PowerShell log encoding required repair after an early conversion mistake. ASCII commands, counts and errors were restored; some decorative non-ASCII reporter glyphs may be lost. See [EVIDENCE-ENCODING.md](EVIDENCE-ENCODING.md). Node-produced JSON, scripts and screenshots did not undergo that conversion, and the requested source diff was regenerated directly from Git. Normalized process logs are not claimed as byte-exact originals.

| Artefact                                                             | Description                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| [EVIDENCE-ENCODING.md](EVIDENCE-ENCODING.md)                         | Evidence or retention note                           |
| [NOT-KEPT.md](NOT-KEPT.md)                                           | Evidence or retention note                           |
| [additional-ui-results.json](additional-ui-results.json)             | Structured result, capture or command record         |
| [additional-ui.aria.txt](additional-ui.aria.txt)                     | Rendered accessibility snapshot                      |
| [additional-ui.log.txt](additional-ui.log.txt)                       | Command/runtime output                               |
| [additional-ui.mjs.txt](additional-ui.mjs.txt)                       | Executable QA script retained as text                |
| [api-client-coverage.log.txt](api-client-coverage.log.txt)           | Command/runtime output                               |
| [api-coverage.log.txt](api-coverage.log.txt)                         | Command/runtime output                               |
| [api-full.json](api-full.json)                                       | Structured result, capture or command record         |
| [api-results.json](api-results.json)                                 | Structured result, capture or command record         |
| [api.log.txt](api.log.txt)                                           | Command/runtime output                               |
| [api.mjs.txt](api.mjs.txt)                                           | Executable QA script retained as text                |
| [artifact-manifest.json](artifact-manifest.json)                     | Structured result, capture or command record         |
| [baseline-build-complete.log.txt](baseline-build-complete.log.txt)   | Command/runtime output                               |
| [baseline-build-corrected.log.txt](baseline-build-corrected.log.txt) | Command/runtime output                               |
| [baseline-build-final.log.txt](baseline-build-final.log.txt)         | Command/runtime output                               |
| [baseline-build-success.log.txt](baseline-build-success.log.txt)     | Command/runtime output                               |
| [baseline-build.log.txt](baseline-build.log.txt)                     | Command/runtime output                               |
| [baseline-build.mjs.txt](baseline-build.mjs.txt)                     | Executable QA script retained as text                |
| [baseline-loader.mjs.txt](baseline-loader.mjs.txt)                   | Executable QA script retained as text                |
| [baseline-server-final.log.txt](baseline-server-final.log.txt)       | Command/runtime output                               |
| [baseline-server.log.txt](baseline-server.log.txt)                   | Command/runtime output                               |
| [before-after-results.json](before-after-results.json)               | Structured result, capture or command record         |
| [before-after.log.txt](before-after.log.txt)                         | Command/runtime output                               |
| [benchmark.mjs.txt](benchmark.mjs.txt)                               | Executable QA script retained as text                |
| [browser-results.json](browser-results.json)                         | Structured result, capture or command record         |
| [browser.log.txt](browser.log.txt)                                   | Command/runtime output                               |
| [browser.mjs.txt](browser.mjs.txt)                                   | Executable QA script retained as text                |
| [build.log.txt](build.log.txt)                                       | Command/runtime output                               |
| [capture-inventory.mjs.txt](capture-inventory.mjs.txt)               | Executable QA script retained as text                |
| [check-deps.log.txt](check-deps.log.txt)                             | Command/runtime output                               |
| [check-docs.log.txt](check-docs.log.txt)                             | Command/runtime output                               |
| [check-layers.log.txt](check-layers.log.txt)                         | Command/runtime output                               |
| [check-tokens.log.txt](check-tokens.log.txt)                         | Command/runtime output                               |
| [coverage-gates.jsonl](coverage-gates.jsonl)                         | Structured result, capture or command record         |
| [coverage-summary.json](coverage-summary.json)                       | Structured result, capture or command record         |
| [coverage-summary.mjs.txt](coverage-summary.mjs.txt)                 | Executable QA script retained as text                |
| [delivery-final-results.json](delivery-final-results.json)           | Structured result, capture or command record         |
| [delivery-final.log.txt](delivery-final.log.txt)                     | Command/runtime output                               |
| [delivery-final.mjs.txt](delivery-final.mjs.txt)                     | Executable QA script retained as text                |
| [delivery-full.json](delivery-full.json)                             | Structured result, capture or command record         |
| [delivery-verified.aria.txt](delivery-verified.aria.txt)             | Rendered accessibility snapshot                      |
| [delivery-verified.png](delivery-verified.png)                       | Edge screenshot                                      |
| [domain-coverage.log.txt](domain-coverage.log.txt)                   | Command/runtime output                               |
| [encoding-normalization.json](encoding-normalization.json)           | Structured result, capture or command record         |
| [environment.json](environment.json)                                 | Structured result, capture or command record         |
| [failure-full.json](failure-full.json)                               | Structured result, capture or command record         |
| [failure-verified.aria.txt](failure-verified.aria.txt)               | Rendered accessibility snapshot                      |
| [failure-verified.png](failure-verified.png)                         | Edge screenshot                                      |
| [final-markdown-check.log.txt](final-markdown-check.log.txt)         | Command/runtime output                               |
| [final-state.log.txt](final-state.log.txt)                           | Command/runtime output                               |
| [format-check.log.txt](format-check.log.txt)                         | Command/runtime output                               |
| [format-result.json](format-result.json)                             | Structured result, capture or command record         |
| [gates.jsonl](gates.jsonl)                                           | Structured result, capture or command record         |
| [infrastructure-coverage.log.txt](infrastructure-coverage.log.txt)   | Command/runtime output                               |
| [initial-aria.txt](initial-aria.txt)                                 | Evidence or retention note                           |
| [lint.log.txt](lint.log.txt)                                         | Command/runtime output                               |
| [live-final-results.json](live-final-results.json)                   | Structured result, capture or command record         |
| [live-final.log.txt](live-final.log.txt)                             | Command/runtime output                               |
| [live-final.mjs.txt](live-final.mjs.txt)                             | Executable QA script retained as text                |
| [live-results.json](live-results.json)                               | Structured result, capture or command record         |
| [live-synchronized-results.json](live-synchronized-results.json)     | Structured result, capture or command record         |
| [live-synchronized.log.txt](live-synchronized.log.txt)               | Command/runtime output                               |
| [live-synchronized.mjs.txt](live-synchronized.mjs.txt)               | Executable QA script retained as text                |
| [live.log.txt](live.log.txt)                                         | Command/runtime output                               |
| [live.mjs.txt](live.mjs.txt)                                         | Executable QA script retained as text                |
| [measurement-after.png](measurement-after.png)                       | Edge screenshot                                      |
| [measurement-before.png](measurement-before.png)                     | Edge screenshot                                      |
| [native-slow-reader.json](native-slow-reader.json)                   | Structured result, capture or command record         |
| [native-slow-reader.log.txt](native-slow-reader.log.txt)             | Command/runtime output                               |
| [native-slow-reader.mjs.txt](native-slow-reader.mjs.txt)             | Executable QA script retained as text                |
| [normalize-evidence.mjs.txt](normalize-evidence.mjs.txt)             | Executable QA script retained as text                |
| [oversized-captures.json](oversized-captures.json)                   | Structured result, capture or command record         |
| [paused-stream.log.txt](paused-stream.log.txt)                       | Command/runtime output                               |
| [prepare-evidence.mjs.txt](prepare-evidence.mjs.txt)                 | Executable QA script retained as text                |
| [projection-complete-results.json](projection-complete-results.json) | Structured result, capture or command record         |
| [projection-complete.log.txt](projection-complete.log.txt)           | Command/runtime output                               |
| [projection-complete.mjs.txt](projection-complete.mjs.txt)           | Executable QA script retained as text                |
| [projection-results.json](projection-results.json)                   | Structured result, capture or command record         |
| [projections.log.txt](projections.log.txt)                           | Command/runtime output                               |
| [projections.mjs.txt](projections.mjs.txt)                           | Executable QA script retained as text                |
| [provenance.json](provenance.json)                                   | Structured result, capture or command record         |
| [provenance.mjs.txt](provenance.mjs.txt)                             | Executable QA script retained as text                |
| [qa-markdown-format.log.txt](qa-markdown-format.log.txt)             | Command/runtime output                               |
| [reading-note-visible.png](reading-note-visible.png)                 | Edge screenshot                                      |
| [reading-note.png](reading-note.png)                                 | Edge screenshot                                      |
| [receiver.log.txt](receiver.log.txt)                                 | Command/runtime output                               |
| [receiver.mjs.txt](receiver.mjs.txt)                                 | Executable QA script retained as text                |
| [recovery-results.json](recovery-results.json)                       | Structured result, capture or command record         |
| [recovery.log.txt](recovery.log.txt)                                 | Command/runtime output                               |
| [recovery.mjs.txt](recovery.mjs.txt)                                 | Executable QA script retained as text                |
| [report-build.mjs.txt](report-build.mjs.txt)                         | Executable QA script retained as text                |
| [report-verification.json](report-verification.json)                 | Structured result, capture or command record         |
| [restart-before.json](restart-before.json)                           | Structured result, capture or command record         |
| [restart-before.mjs.txt](restart-before.mjs.txt)                     | Executable QA script retained as text                |
| [restart-stop.log.txt](restart-stop.log.txt)                         | Command/runtime output                               |
| [server-baseline.mjs.txt](server-baseline.mjs.txt)                   | Executable QA script retained as text                |
| [server-first.mjs.txt](server-first.mjs.txt)                         | Executable QA script retained as text                |
| [server-initial.log.txt](server-initial.log.txt)                     | Command/runtime output                               |
| [server-restarted.log.txt](server-restarted.log.txt)                 | Command/runtime output                               |
| [server.mjs.txt](server.mjs.txt)                                     | Executable QA script retained as text                |
| [shutdown-results.json](shutdown-results.json)                       | Structured result, capture or command record         |
| [shutdown.log.txt](shutdown.log.txt)                                 | Command/runtime output                               |
| [shutdown.mjs.txt](shutdown.mjs.txt)                                 | Executable QA script retained as text                |
| [slow-consumer-note.png](slow-consumer-note.png)                     | Edge screenshot                                      |
| [source.diff.txt](source.diff.txt)                                   | Exact requested base-to-head diff, excluding docs/qa |
| [timeline-1440-dark.aria.txt](timeline-1440-dark.aria.txt)           | Rendered accessibility snapshot                      |
| [timeline-1440-dark.png](timeline-1440-dark.png)                     | Edge screenshot                                      |
| [timeline-1440-light.aria.txt](timeline-1440-light.aria.txt)         | Rendered accessibility snapshot                      |
| [timeline-1440-light.png](timeline-1440-light.png)                   | Edge screenshot                                      |
| [timeline-390-dark.aria.txt](timeline-390-dark.aria.txt)             | Rendered accessibility snapshot                      |
| [timeline-390-dark.png](timeline-390-dark.png)                       | Edge screenshot                                      |
| [timeline-390-light.aria.txt](timeline-390-light.aria.txt)           | Rendered accessibility snapshot                      |
| [timeline-390-light.png](timeline-390-light.png)                     | Edge screenshot                                      |
| [timeline-controls-390-dark.png](timeline-controls-390-dark.png)     | Edge screenshot                                      |
| [timeline-controls-390-light.png](timeline-controls-390-light.png)   | Edge screenshot                                      |
| [tooling-tests.log.txt](tooling-tests.log.txt)                       | Command/runtime output                               |
| [typecheck.log.txt](typecheck.log.txt)                               | Command/runtime output                               |
| [upgrade-timing-isolated.json](upgrade-timing-isolated.json)         | Structured result, capture or command record         |
| [upgrade-timing-isolated.log.txt](upgrade-timing-isolated.log.txt)   | Command/runtime output                               |
| [vars-full.json](vars-full.json)                                     | Structured result, capture or command record         |
| [vars-progress-results.json](vars-progress-results.json)             | Structured result, capture or command record         |
| [vars-progress.aria.txt](vars-progress.aria.txt)                     | Rendered accessibility snapshot                      |
| [vars-progress.log.txt](vars-progress.log.txt)                       | Command/runtime output                               |
| [vars-progress.mjs.txt](vars-progress.mjs.txt)                       | Executable QA script retained as text                |
| [verify-report.mjs.txt](verify-report.mjs.txt)                       | Executable QA script retained as text                |
| [web-coverage.log.txt](web-coverage.log.txt)                         | Command/runtime output                               |
| [webhook-receiver.json](webhook-receiver.json)                       | Structured result, capture or command record         |
| [zero-boundary.json](zero-boundary.json)                             | Structured result, capture or command record         |
| [zero-boundary.log.txt](zero-boundary.log.txt)                       | Command/runtime output                               |
| [zero-boundary.mjs.txt](zero-boundary.mjs.txt)                       | Executable QA script retained as text                |

## 5. Observations outside scope

- D-015 native process termination/cleanup failures and the untouched upgrade timing failure require unrestricted or isolated follow-up; no change to their implementations was made.
- The packaged API suite's hardcoded 5649 port and existing test-directory prefixes exceeded the manual environment restriction. This is a QA execution deviation, not attributed to #186.
- The before/after benchmark's elapsed execution and observation durations are recorded without a causality claim on this busy host. Its sampling initially relied on a persisted acknowledgement; target main excludes a history from persistence after 2,000,000 JSON characters, so its later cache contains no per-run acknowledgement. That produced the full 240-sample observation budget for the baseline. Heap/cache/DOM measurements remain actual samples; duration is not a matched latency comparison.
- Generated/ignored .tmp/qa186, root dist, coverage folders and native test temporary directories are left for the orchestrator. No directories were deleted. No owner app/store, provider quota, Git index or GitHub state was changed.
