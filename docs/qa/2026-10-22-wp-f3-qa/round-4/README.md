# WP-F3 / #243: round 4 record repair

## 1. Verdict and revision

**PASS for the authorized record repair at
`9f654e7f7cfe4180dd8d1258174cc4a2d2a30110`.** HEAD matched before work. This is a
record repair and one targeted API replay, not renewed qualification of the full
behavior matrix or the merged F4/F1 changes.

The committed round-3 tree has **45 artifacts**, including its README and manifest.
All **12 renamed logs** are tracked, linked and readable. Round-2 citations now
state that their original raw evidence was lost. The fixed QA helper records actual
exit events/codes/signals and derives cleanup confirmation from those observations.
The single fresh API replay passed **12/12** checks. Historical JSON was preserved.

At the round-4 closing boundary, the parent report was unchanged, as instructed,
and the supplied checker reported **10 missing names there**. No unresolved evidence
target belonged to the repaired round-2/3/4 record, apart from that explicit
outside-scope inventory. Section 5 distinguishes that historical result from the
later parent-report citation repair.

Independent QA, same thread, alone; detached HEAD; uncommitted, ready for orchestrator
review. Node **22.14.0** first on PATH, PowerShell, `pnpm.cmd`, built API, fake
harness only. One fresh store under `<temp>`, prefix `gg-qa-f3-`, port **5905**.
No product edits, index changes, commits, paid turns, owner app/store access or
listeners on 4747/4748.

## 2. Defects

1. **Minor, QA record, closed:** forced signal exits were marked unconfirmed because
   the helper checked only a numeric exit code. The original JSON has two
   `confirmedExited:false` lifecycle entries and `processConfirmedExited:true` in
   cleanup, supplied through a literal argument. The retained
   [original extract](historical-exit-contradiction.json) preserves this contradiction.
   [Fresh results](api-results.json) record two observed SIGTERM exits with null exit
   codes and one observed exit code 0; all three are confirmed and reproduced in
   cleanup. No historical result was rewritten.
2. **Minor, QA record, closed within scope:** the round-2 report cited lost original
   artifacts, sometimes appearing valid only because round 3 reused their basenames.
   The report now describes the historical observations without those file claims.
   [Citation disposition](round-2-citation-disposition.json) preserves all **33**
   original evidence names and the original report hash. Only the README was tracked
   in that directory; no owned old TEMP directory remained for recovery. The initial
   checker actually found **20 unique missing round-2 names**, plus ten parent-report
   names, rather than the dispatch's approximate count of 23.

No new product defect is asserted. The remaining parent-report references and the
pre-existing inspector observations are outside this repair, as detailed below.

## 3. Coverage, changes and verification

| Check                     | Steps / expected                                                                                                                                 | Actual                                                                                                                                                                                                     | Evidence                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact head                | Read Git HEAD before mutations; stop on mismatch.                                                                                                | **PASS**, exact requested SHA; detached checkout.                                                                                                                                                          | [Audit before](record-audit-before.json), [audit after](record-audit-results.json)                                                                                                           |
| Twelve logs and count     | Compare Git's tracked round-3 paths with actual files and README links. Expect 12 retained logs and an accurate inventory.                       | **PASS**, 12/12 resolve; 45/45 tracked files linked directly. Count clarified in the README; no missing log was fabricated.                                                                                | [Audit results](record-audit-results.json), [round-3 inventory](../round-3/ARTIFACTS.md), [round-3 README](../round-3/README.md)                                                             |
| Retention on next replay  | Inspect the wrapper/finalizer paths. Expect future output to survive the ignore rule without counting old duplicates.                            | **PASS static check**: wrapper writes the retained text suffix; finalizer skips old logs with retained counterparts and refuses unpaired ignored logs. Whole wrapper/finalizer not executed in this round. | [Wrapper](../round-3/gates.ps1), [finalizer](../round-3/finalize-evidence.mjs)                                                                                                               |
| Historical round-2 repair | Check retained tree and owned TEMP inventory, then reword missing citations without regenerating original outcomes.                              | **PASS**, all original measurements, coverage counts and host qualifications remain historical narrative; later replays explicitly identified as later. Fixed existing punctuation encoding while editing. | [Repaired report](../round-2/README.md), [repair procedure](repair-round2.mjs), [disposition](round-2-citation-disposition.json)                                                             |
| Exit-state helper         | Observe the exit event with code/signal and store it at launch; make stop/cleanup use it. Expect no boolean substitution from callers.           | **PASS**, signal exits confirmed from observed events; cleanup includes every launched process for that store. All seven consumers remove the literal cleanup argument. Only API replay rerun.             | [Helper](../round-3/qa-lib.mjs), [original contradiction](historical-exit-contradiction.json), [fresh API result](api-results.json)                                                          |
| Build prerequisite        | Node 22, `pnpm.cmd build` before serving current dist.                                                                                           | **PASS**, 11/11 tasks, no cached tasks; about 124 s.                                                                                                                                                       | [Build log](build.log.txt), [commands](command-results.json)                                                                                                                                 |
| One API replay            | Run the replay once against current built API, with separate output/store prefix. Expect all assertions and real restart/cancellation to finish. | **PASS**, 12/12; command exit 0, about 42 s. Details below.                                                                                                                                                | [Entrypoint](api-replay.mjs), [API source](../round-3/api-checks.mjs), [log](api-replay.log.txt), [results](api-results.json), [replay wrapper](replay.ps1)                                  |
| Cleanup                   | Confirm each owned process exited, then remove only its disposable store; check absence.                                                         | **PASS**, two SIGTERM exits and one code-0 exit recorded; store removed, no round-4 stores remain and none could not be removed.                                                                           | [Cleanup manifest](cleanup-results.json), [verification](verification-results.json)                                                                                                          |
| QA boundaries and syntax  | Check changed paths/index, user-path privacy, relative links and script syntax.                                                                  | **PASS**, QA-only diff, empty index; historical API JSON and parent report unchanged. JS and PowerShell syntax checked; changed Markdown/JS/JSON formatted.                                                | [Audit](record-audit-results.json), [validation](verification-results.json), [PowerShell syntax](powershell-syntax.json), [format log](format.log.txt), [validation log](validation.log.txt) |
| Final supplied checker    | Run the supplied reference checker last over the whole folder. Expect no undisclosed missing artifact.                                           | **PASS for this repair's scope**, ten explicitly excluded parent-report names remain. Exact output retained; list below.                                                                                   | [Before](references-before.log.txt), [final output](references-final.log.txt), [final result](references-results.json), [checker copy](check-qa-refs.mjs)                                    |

The API replay's fresh observations, all fake-only:

| Case                                      | Expected                                                       | Actual                                                                             |
| ----------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Published omitted defaults                | Pinned 10 visits / null deadline.                              | **PASS**, 10/null.                                                                 |
| Five-second input deadline / late input   | Non-resumable deadline failure; late input and resume refused. | **PASS**, 5,759 ms, late input 409, terminal failure retained.                     |
| Paused authored deadline / kill / restart | Original start and absolute deadline retained.                 | **PASS**, failed after restart at original start + 5 s.                            |
| Default input wait / kill / restart       | No deadline; remains waiting through shortened observation.    | **PASS**, still waiting after another 7 s. No hour-long native soak in this round. |
| Unlimited marked repeat gate              | More than 20 work visits, cancellable.                         | **PASS**, 22 visits, cancellation 105 ms.                                          |
| Safe retriable transport refusal          | Exactly one retry.                                             | **PASS**, two invocations.                                                         |
| Uncertain transport                       | No retry.                                                      | **PASS**, one invocation.                                                          |
| Non-retriable transport                   | No retry.                                                      | **PASS**, one invocation.                                                          |
| Quota                                     | No retry.                                                      | **PASS**, one invocation.                                                          |
| Authentication                            | No retry.                                                      | **PASS**, one invocation.                                                          |
| Harness timeout                           | No retry.                                                      | **PASS**, one invocation.                                                          |
| Output limit                              | No retry.                                                      | **PASS**, one invocation.                                                          |

Changed QA files beyond the two reports are linked here in full: shared
[helper](../round-3/qa-lib.mjs), [server](../round-3/server.mjs), the seven cleanup
consumers [API](../round-3/api-checks.mjs),
[Claude](../round-3/claude-checks.mjs),
[child/inspector](../round-3/child-and-inspector.mjs),
[Edge extra](../round-3/edge-extra.mjs),
[Edge specs](../round-3/edge-specs.mjs),
[interactive detail](../round-3/interactive-detail.mjs),
[migration](../round-3/migration-check.mjs), and the
[gate wrapper](../round-3/gates.ps1) / [finalizer](../round-3/finalize-evidence.mjs).
Only the API consumer was exercised; the others received the same argument removal
and syntax checks. The server accepts the new owned prefix while preserving the
5900–5909 guard. No application route, schema or production code changed.

Fresh cleanup scope: `<temp>/gg-qa-f3-r4-api-AeDTO4` only. Its owned API PIDs were
22752, 52692 and 46536. Cleanup follows their observed exit events; no other store,
fixture directory or process was removed or stopped.

Full coverage, Edge, migration, native Claude and engine behavior suites were **not
rerun**, as requested. Package gates are not newly claimed; the current change owns
QA documents/scripts only. No numbered doc, ADR, CHANGELOG or generated reference
required an update.

## 4. Report path and evidence folder

Report: `<repo>/docs/qa/2026-10-22-wp-f3-qa/round-4/README.md`.
Evidence folder: `<repo>/docs/qa/2026-10-22-wp-f3-qa/round-4/`.
Replay the single API collection with [replay.ps1](replay.ps1) from Node 22
PowerShell; it builds first and writes fresh results to this round. Do not confuse
a later invocation with the preserved observation above.

Every round-4 artifact intended for preservation is directly linked here:

- [README.md](README.md)
- [api-replay.mjs](api-replay.mjs)
- [api-replay.log.txt](api-replay.log.txt)
- [api-results.json](api-results.json)
- [audit-record.mjs](audit-record.mjs)
- [build.log.txt](build.log.txt)
- [check-qa-refs.mjs](check-qa-refs.mjs)
- [cleanup-results.json](cleanup-results.json)
- [command-results.json](command-results.json)
- [format.log.txt](format.log.txt)
- [historical-exit-contradiction.json](historical-exit-contradiction.json)
- [powershell-syntax.json](powershell-syntax.json)
- [record-audit-before.json](record-audit-before.json)
- [record-audit-results.json](record-audit-results.json)
- [references-before.log.txt](references-before.log.txt)
- [references-final.log.txt](references-final.log.txt)
- [references-results.json](references-results.json)
- [repair-round2.mjs](repair-round2.mjs)
- [replay.ps1](replay.ps1)
- [round-2-citation-disposition.json](round-2-citation-disposition.json)
- [validate-repair.mjs](validate-repair.mjs)
- [validation.log.txt](validation.log.txt)
- [verification-results.json](verification-results.json)

## 5. Observations outside scope and final checker disposition

At the round-4 closing boundary, the eight names supplied in that dispatch and
two original installation-log names remained unresolved in the parent report. The
exact historical ten-name result remains in the [original checker output](references-final.log.txt)
and [result record](references-results.json). This was a declared residual, not a
zero-missing claim for the whole parent record. Actual relative Markdown targets in
the repaired round-2/3/4 reports resolved at that boundary.

A later citation repair on `e20355c1fd3aeb293e4a852c9a9483138a964293` reworded
the [parent report](../report.md) to state that the eight original captures were
not kept. It also recovered the two original installation transcripts from ignored
files in the implementer's worktree and retained them as
[first installation transcript](../base-install.log.txt) and
[second installation transcript](../base-install-2.log.txt). The
[disposition record](../citation-repair.json) preserves all original names. No
replacement observation was invented or presented as the original. The earlier
round-4 audit's unchanged-parent hash and remaining-name count describe that earlier
boundary, before this later repair.

The prior inspector gaps remain outside #243 per the delivery disposition
(follow-ups #379/#380). Historical D-015 native descendant termination limitations
and coverage results stand; this API replay confirms its own server exits only.
No live-provider behavior, broad Windows process-tree qualification, new coverage
qualification, UI repair or renewed release sign-off is claimed.
