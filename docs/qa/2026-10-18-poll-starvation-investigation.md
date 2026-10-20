# Poll-starvation investigation (#140 / B26)

**Result: not reproduced for candidate-specific admission rejection.** Whole-poll
refusal and first storage-error tail deferral **do survive**; the table below
records their repeat/restart effects explicitly. They are not evidence that the
retired configured-review/QA rejection hooks still exist. No policy or corrective
code change is made.

Executed on 2026-10-19 at `9070207ee11b86c31aee54a911ff3d16992fc67f`, Windows,
Node `v22.14.0`, after WP-C2 merged. The issue's two historical comments describe
configured review authority and `qaPollKeys`/`qa-native` refusals. ADR-0034 removed
those services and admission/transition hooks. Searching current API, engine and
infrastructure source found none of `qaPollKeys`, `qa-native`, `TemplateRuntime`,
`afterRunStaged`, or `beforeTransition`. Ordinary starting-point drafts grant no
implicit review/QA authority.

## Current path and policy

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

Thus later valid items can remain blocked indefinitely by a persistently invalid
**batch** or a persistently failing **store**. Restart does not cure either. The
historical candidate-local authority/size rejection inside an otherwise usable
poll was not reproduced after template retirement. There is no evidence-based
reason here to skip arbitrary admission exceptions, relax complete-batch
validation, reopen consumed keys, reorder items or change concurrency.

## Verification and limits

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
  processes. There is no new regression test or fix because the candidate-local
  hypothesis was not confirmed. Policy changes need a separate owner decision.

The [shared verification record](2026-10-18-wp-c3-evidence/verification.txt),
[driver source](2026-10-18-wp-c3-evidence/driver.mjs.txt), and
[closed-store manifest](2026-10-18-wp-c3-evidence/environment.json) retain the
reproduction. A separate [read-only store audit](2026-10-18-wp-c3-evidence/storage-audit.json)
matches admitted run IDs to their persisted dedupe keys and verifies the recorded
input order. Only QA documents/evidence changed. No production, maintained-test,
numbered behavior-doc, ADR, CHANGELOG, dependency or coverage-policy change was
made. The controlled server and containers were closed; disposable stores remain
for orchestrator cleanup. The owner app/store was not used.
