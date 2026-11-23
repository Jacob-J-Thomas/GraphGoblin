# D240/S2 native API-shape evidence

Root accepted this bounded witness on core
`458f6cb06eded5cfeb2cf243093b60521a46f676`, tree
`09b29aabeef6ab7e4c4d53dc4f8d2b3b5444d5d6`, after checking 78 original
members and 1,768 materialized source files. This compact external packet is
prepared for later root insertion; it grants no UI, general PR or owner approval.
[Root disposition](raw/i5-416-api-shape-root-disposition-01/DISPOSITION.json)
· [Full original report](raw/i5-416-api-shape-independent-qa-01/REPORT.md)

## Three actual successful GET bodies

A disposable IPv4 loopback API, in-memory database, fresh contained store and
synthetic test key exercised native HTTP through the real engine/API. Ollama
was disabled; existing inference/decider/classifier ports were fakes. Seven
successful POSTs produced exactly three corrected-run GETs, with 10-second
request deadlines and no retries. Pass-through response clones preserved the
untouched bodies; original execution validated strict RunSnapshotSchema,
matching IDs, client/raw/cache content and public committed provenance.

| Corrected native body | Bytes | Result | committed / pending / loss |
| --- | ---: | --- | --- |
| [Waiting](raw/i5-416-api-shape-independent-qa-01/attempt-02/01-waiting.raw.json) | 1,609 | Actual wait/recovery | 1 /0 /0 |
| [Completed](raw/i5-416-api-shape-independent-qa-01/attempt-02/02-completed.raw.json) | 1,433 | Same run succeeded | 2 /0 /0 |
| [Large controlled](raw/i5-416-api-shape-independent-qa-01/attempt-02/03-large-controlled.raw.json) | **1,130,986** | Second run succeeded | 3 /0 /0 |

The large response retains the exact controlled fake result: 8,192 JSON rows,
112 ASCII payload characters per row, one FakeHarness turn. It was persisted
and returned through real infrastructure; no real-provider execution is claimed.
[Raw results, hashes and observations](raw/i5-416-api-shape-independent-qa-01/attempt-02/RESULT.json)

The same captured texts received three warmups and ten measured JSON.parse/schema
checks each. Node 22.23.4 large-body medians were 2.432 ms JSON and 16.949 ms schema;
GET-to-captured-body took 135.041 ms. These are observations with no new threshold,
not browser main-thread, rendering, recovery or service-worker performance.
[Full samples](raw/i5-416-api-shape-independent-qa-01/attempt-02/RESULT.json)
· [Timing summary](raw/i5-416-api-shape-independent-qa-01/TIMING-SUMMARY.json)

## Original failures and exact oracle correction

The first lint and formatting failures, initial source and all execution/static
command receipts/stdout/stderr remain. The first behavioral invocation exited 1
after two native GETs. Waiting passed; completed passed schema, ID, raw/client
content and positive committed/pending checks, then failed an extra assertion
requiring returned and cached values to share object identity. Structural
sharing does not promise that identity. No large-body/timing schedule completed
in that failed invocation.
[First failure](raw/i5-416-api-shape-independent-qa-01/FIRST-FAILURE.json)
· [Initial executed fixture](raw/i5-416-api-shape-independent-qa-01/executed-fixture.ts)

Root approved exactly one replacement: compare cached content deeply to the
untouched parsed raw response. Product cache sharing and all schema, ID,
receipt, response/result, GET-count, timing, deadline and cleanup assertions
were retained. The corrected fixture's first invocation in fresh attempt-02
exited 0. Original exit 1 and raw bodies remain failed evidence, not reclassified.
[Named correction/rationale/declined alternatives](raw/i5-416-api-shape-independent-qa-01/ROOT-FIXTURE-CORRECTION.md)
· [Corrected executed fixture](raw/i5-416-api-shape-independent-qa-01/attempt-02/executed-fixture.ts)
· [Exact-source parity](raw/i5-416-api-shape-independent-qa-01/PARITY.json)

## Closure and its ordering qualification

Each program closed its listener/store in finally. Both stores were absent and
listeners no longer listening, with no close errors. Compilation-cache residuals
were recorded separately. Automatic review rejected the initial guarded
recursive TEMP cleanup **before execution**, stating only `blocked by policy`.
A safer readable script then passed literal-root containment, no-reparse and
recorded-Node-absence guards, removed individual files and checked-empty
directories nonrecursively, and exited 0 with both owned scratch roots absent.

That accepted cleanup completed **before** root's later retain-cache instruction
arrived. This chronology is explicit in the original report/root disposition;
it does not claim the cache was retained. No further deletion or behavioral
execution followed. The original rejection, accepted script/tool result,
per-file cleanup inventory and both program closure records are preserved.
[Rejected action](raw/i5-416-api-shape-independent-qa-01/CLEANUP-REJECTION.md)
· [Accepted script](raw/i5-416-api-shape-independent-qa-01/close-owned-temp.ps1)
· [Actual tool result](raw/i5-416-api-shape-independent-qa-01/CLEANUP-TOOL-RESULT.json)
· [Native cleanup proof](raw/i5-416-api-shape-independent-qa-01/NATIVE-CLEANUP.json)

## Limits and selection

This proves successful native body shape and public core-adapter eligibility
with fakes, **not mounted useRun or inspector/browser behavior**. All three
receipts had loss 0; this did not exercise outage/recovery or write authority.
UI/action/listener-failure/browser/geometry criteria, complete coverage/static
gates, independent review/QA, exact-current CI, final audit, signed merge and
owner acceptance remain required against the completed UI candidate.

[Parked #561](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/561) concerns
preexisting source-based response-body transport failures outside the current
middleware catch. No native mid-body interruption or browser reproduction is
claimed. It adds no batch scope or implementation admission and waives no
listener-outage/action-safety case.
[Issue source/rationale](raw/i5-d240-s2-followup-publication-01/issue-561.md)
· [Exact publication readback](raw/i5-d240-s2-followup-publication-01/readback.json)

[Copy map](COPY-MANIFEST.csv) identifies 75 exact physical copies, including 71
of the original 78 members plus its complete manifest, root acceptance and #561
records. Three source inventories and duplicate module captures stay external
with [exact hash descriptors](OMISSIONS-AND-REFERENCES.json). Of 41,003 tracked
descriptors, 39,235 historical QA entries were sparse-omitted; only 1,768 materialized
source files were hashed by the original QA/root. This assembly verifies selected
copy bytes, not omitted source files. No old core archive, giant brief, provider
stream/thinking, credential/auth settings, owner state or catalogue is copied.

[Source bindings](SOURCE-BINDINGS.json) · [One D240 outcome addendum](D240-S2-OUTCOME-ADDENDUM.md).
Originals/seals remain unchanged. No worktree, Q, Git/index, provider, test or
publication action occurred for this archival preparation.
