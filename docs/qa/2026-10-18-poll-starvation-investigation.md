# Poll-starvation investigation (#140 / B26)

**Result: reproduced naturally through structural depth; corrected in round two.**
The independent review found a small, valid JSON candidate that SQLite cannot
store. The worker's new API regression reproduced zero later admissions on the
unmodified `d33514f` baseline. The fix refuses that candidate individually and
admits later eligible work under delivery decision D-020. The earlier byte-size
and key-shape findings below remain valid, but did not cover structural depth.

Executed on 2026-10-19 at `9070207ee11b86c31aee54a911ff3d16992fc67f`, Windows,
Node `v22.14.0`, after WP-C2 merged. The issue's two historical comments describe
configured review authority and `qaPollKeys`/`qa-native` refusals. ADR-0034 removed
those services and admission/transition hooks. Searching current API, engine and
infrastructure source found none of `qaPollKeys`, `qa-native`, `TemplateRuntime`,
`afterRunStaged`, or `beforeTransition`. Ordinary starting-point drafts grant no
implicit review/QA authority.

## Round-one path and policy (before the fix)

Publication calls `TriggerService.armVersion` and `PollTriggers.arm`;
`PollTriggers.poll()` runs the real HTTP probe, then `admitPollItems`.
`preparePollItems` validates **the complete selected array and every key before
lookup/admission**. Valid unseen items enter `RunManager.startPollItem` and real
SQLite atomic admission sequentially. That manager has no per-candidate poll
input schema or retired template-authority admission hook. JSON payload strings
have no separate per-item size bound in this path.

At `poll-items.ts:37`, any admission exception stops this poll's tail. This
surviving behavior is explicitly documented in docs/08, “Bounded items mode.”
`undefined` from an atomic key reservation instead skips that item without using
the run cap. Invalid/duplicate keys, malformed JSON and probe overflow refuse the
whole batch. ADR-0037's permanent webhook-key/intent rules remain distinct; this
investigation changes neither them nor poll deduplication.

## Public-path experiments

The built API composition root used file-backed SQLite and ordinary loop
creation/publication. The real HTTP probe fetched a controlled loopback server
on port **5663**. A fake clock advanced each supported minimum poll interval of
5 s; scheduler tick setting was 50 ms and public `polls.poll()` drove sweeps.
Each response was polled twice unchanged, then the container/store closed and a
**fresh Node process** rearmed the trigger, advanced another 5 s and polled it
again. The parent kept the same HTTP response available across restart. Refusal
cases were then corrected and polled once more. No component method was patched.

The selected list was `[first, good-1, good-2]`, with unique keys and short `text`
fields unless noted. Each admitted run went to an input wait rendering that
item's `text`. Full run IDs, counts, codes and process IDs are in
[results.json](2026-10-18-wp-c3-evidence/results.json), records `poll-*`.

| First candidate / response                                                      | First poll                                                                                                                                | Same response, second poll / fresh-process poll                                                 | Correction control and disposition                                                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Valid JSON item with 12,000-character text; whole body 12,085 bytes             | All **3 admitted in input order**. First run fails at oversized rendered wait prompt with `EVENT_INVALID`; both later runs park normally. | 0 new runs / 0 new runs; all 3 dedupe keys remain consumed, including the failed run.           | No starvation. Oversized downstream execution output is not rejected admission.                                                                  |
| First key is 513 characters                                                     | 0 admitted, `POLL_ITEMS_INVALID`, `KEY_INVALID`, index 0.                                                                                 | 0 / 0; later items remain blocked while malformed batch persists.                               | Valid keys admit all 3. Intentional whole-batch validation; no keys consumed on refusal.                                                         |
| First key duplicates `good-1`                                                   | 0 admitted, `POLL_ITEMS_INVALID`, `KEY_DUPLICATE`, index 1.                                                                               | 0 / 0; whole-batch refusal persists.                                                            | Unique keys admit all 3. Preserve fail-closed malformed/duplicate-output policy from the issue comment.                                          |
| First text is 65,536 characters; whole response **65,621 bytes**                | 0 admitted, `HTTP_PROBE_BODY_OVERFLOW`.                                                                                                   | 0 / 0; whole response remains refused.                                                          | Bounded response admits all 3. Probe byte bound is crossed before candidate admission, not a rejected first item in an otherwise accepted batch. |
| Malformed JSON response `[invalid JSON`                                         | 0 admitted, `POLL_JSON_INVALID`.                                                                                                          | 0 / 0.                                                                                          | Valid response admits all 3. No valid candidate list was available to admit.                                                                     |
| HTTP 503 with otherwise valid candidate JSON                                    | 0 admitted, `POLL_PROBE_FAILED`.                                                                                                          | 0 / 0.                                                                                          | HTTP 200 admits all 3. This is a controlled HTTP/probe failure, not an item rejection or a simulated loss of network connectivity.               |
| Valid response plus real SQLite `BEFORE INSERT ON runs` trigger raising `ABORT` | 0 admitted, `POLL_ADMISSION_FAILED`, index 0; no partial run rows.                                                                        | 0 / 0 while injected storage failure remains; tail deferred indefinitely if fault never clears. | Remove only the injected trigger: all 3 admit. This reproduces storage-failure tail blocking, not candidate-specific rejection.                  |
| All valid, `maxRunsPerPoll: 2`                                                  | First two items admitted.                                                                                                                 | Last item admitted / 0 new; total stays 3.                                                      | Preserves order, cap, skip-seen behavior and durable dedupe.                                                                                     |

These byte-size and key-shape experiments showed persistent refusal of invalid
batches and failing storage. They did not establish the absence of a
candidate-local storage refusal. The review's depth reproduction below corrects
that gap. No fix skips arbitrary exceptions, relaxes complete-batch key
validation, reopens consumed keys, reorders items or changes concurrency.

## Round-two reproduction, cause and fix

The independent Claude Opus 5.5 review (finding B1, supplied in the round-two
brief) used a built API poll returning `[deep, s-a, s-b]`: about 2,250 bytes of
valid JSON, with 1,100 nested arrays in `deep.v`. Three polls admitted nothing;
after a hard kill and fresh process, two more still admitted nothing. Moving
`deep` between `mid-a` and `mid-b` admitted only `mid-a`. Removing the deep item
released the tail. This persisted at depths 1,200–2,000. At roughly 3,000,
recursive JSON validation instead overflowed, producing `POLL_TRIGGER_FAILED`.
Those native before-fix observations belong to the reviewer, not this worker.

SQLite JSON1 permits 1,000 container levels. The `runs` dedupe expression index
parses `initial_thread`; its root, `invocation`, `trigger` and candidate root
occupy four levels. An object property containing 996 nested arrays fits; 997
does not. The review confirmed `SQLITE_ERROR: malformed JSON` through public
`RunManager.startPollItem`. The old generic catch treated this certain structural
refusal like transient storage failure and stopped the tail forever.

The worker added `poll-depth.test.ts` before changing production code. On
`d33514f`, the real-HTTP/SQLite test failed:

```text
Expected: ["s-a", "s-b"]
Received: []
```

`POLL_ITEM_MAX_NESTING_DEPTH = 1000 - 4` now classifies this before storage.
JSON validation and candidate-depth traversal use explicit stacks, including
probe validation, so the check does not rely on a recursive schema overflowing.
Complete JSON/key validation still precedes lookup/admission. The admission
loop excludes structurally refused candidates, emits fixed
`POLL_ITEM_REJECTED` / `NESTING_DEPTH_EXCEEDED` diagnostics with the original
`itemIndex`, and admits later candidates in order without consuming the refused
key or the cap. Diagnostics contain no payload and are bounded by 200 candidates
per poll. Untyped/storage admission errors retain `POLL_ADMISSION_FAILED` and
stop the tail. Whole-batch JSON/key/probe refusal remains unchanged.

The exact boundary, first and middle positions, repeated polls, store reopen,
no duplicate successful keys and subsequent repair of the deep key are covered
by maintained domain/API tests. The 3,000-level HTTP fixture initially overflowed
in its own `JSON.stringify`; it now constructs the wire JSON iteratively. That
test-fixture failure is retained separately from the product regression.

Current commands, coverage and built-API observations are recorded in
[round2-verification.md](2026-10-18-wp-c3-evidence/round2-verification.md).

## Round-one verification and limits (historical)

- Existing `poll-items.test.ts` tests retain sequential admission, safe
  first-failure deferral, complete validation before I/O, cap/dedupe behavior,
  atomic-reservation skips and recovery after the transient refusal clears.
- The combined `poll-items.test.ts` / `wait-identity.test.ts` run passed 39
  tests but exited 1 at C2 fixture teardown with Windows `EBUSY`. The command
  also named nonexistent `src/triggers/poll.test.ts`; Vitest ran only the two
  existing files. This is not represented as coverage of a third file.
- A separate focused run of `poll-probe.test.ts` and `poll-http-bounds.test.ts`
  passed **7 tests**, exit 0, covering probe failure/JSON/byte-bound controls.
- No live GitHub/QA/review provider was invoked; their configured machinery is
  retired. SQL failure injection is a labelled infrastructure control, not a
  naturally failing production database. Restart is orderly and uses fresh
  processes. That round did not confirm a candidate-local refusal or write a fix;
  round two supersedes that disposition using the review reproduction and D-020.

The [shared verification record](2026-10-18-wp-c3-evidence/verification.txt),
[driver source](2026-10-18-wp-c3-evidence/driver.mjs.txt), and
[closed-store manifest](2026-10-18-wp-c3-evidence/environment.json) retain the
reproduction. A separate [read-only store audit](2026-10-18-wp-c3-evidence/storage-audit.json)
matches admitted run IDs to their persisted dedupe keys and verifies the recorded
input order. Only QA documents/evidence changed in round one; round two also
changes domain/API validation and admission, maintained tests, docs/08 and the
CHANGELOG. Dependencies and coverage policy are unchanged. The controlled server
and containers were closed; disposable stores remain
for orchestrator cleanup. The owner app/store was not used.

**Observed by the review, outside this fix:** lone-surrogate dedupe keys do not
match their stored form (libsql binds U+FFFD while `json_extract` decodes the
stored escape differently), allowing repeated admissions. The orchestrator owns
a separate issue; this change neither filters nor repairs those keys.
