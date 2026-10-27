# Verification qualifications

Current command results are in [the report](REPORT.md) and [complete ledger](checks.json). A measured coverage percentage never changes a nonzero test result into a pass.

## D-015 native process assertions - NOT RUN as positive qualifications

The full infrastructure coverage invocation reported 861 passes and six failed native tests. These are the same native-tree termination class as register D-015. [Fresh probe](native-permission.json): taskkill of only the five-second child spawned by that probe returned exit 1, `ERROR: Access denied`; the child remained alive and then exited naturally. No alternate mechanism was used to make assertions pass. Ordinary fixture teardown ran; locked fixture data remains for external cleanup. Positive native tree termination is unqualified.

| Test location                                             | Observation                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/infrastructure/src/adversarial.test.ts:225`     | Child/grandchild abort; teardown directory EBUSY.                   |
| `packages/infrastructure/src/process/scripts.test.ts:157` | Cancelled process with incomplete UTF-8 still alive at line 203.    |
| `packages/infrastructure/src/claude/process.test.ts:69`   | Deadline/output-limit cleanup left EBUSY.                           |
| `packages/infrastructure/src/claude/process.test.ts:84`   | Cancellation cleanup left EBUSY.                                    |
| `packages/infrastructure/src/claude/process.test.ts:150`  | Descendant marker continued growing at line 199; teardown EBUSY.    |
| `packages/infrastructure/src/claude/readiness.test.ts:62` | Termination-unconfirmed message instead of confirmed deadline exit. |

See [unchanged failing assertions and totals](infra-coverage.log.txt). No threshold, exclusion, assertion or native implementation was changed to hide these results.

## Earlier API worker crash

The first full coverage invocation used two workers, reported 1,670 passes and 12 skips, then failed with a worker exit 3221225477 in `shutdown.test.ts`. [Original log](api-coverage-attempt-1.log.txt). The isolated file passed all four tests; [tool-response transcription](shutdown-diagnostic.log.txt). After the final binding correction, the full suite ran with one worker and passed 1,672 tests with 12 skips. [Current log](api-coverage.log.txt). One worker reduces native-pool pressure; neither that result nor the source correction establishes the crash's cause or claims it fixed.

## Earlier tooling timeout

The first tooling coverage run reported 121 passes and one CLI timeout at 180 seconds. [Original log](tooling-coverage-attempt-1.log.txt). Its three Edge page observations had no errors and execution continued, but the measurement CLI did not finish in time. [Extracted observation](tooling-timeout-observation.json). The final-source run enabled `--coverage.reportOnFailure` to collect the missing tooling coverage and passed all 122 tests. [Current log](tooling-coverage.log.txt). The earlier timeout remains recorded; its cause was not isolated.

## Six preserved SDK matrix failures

The additional matrix passed 320/326 cases; all nine stale request bodies are fixed. The remaining six cases assert generic `HARNESS_TURN_FAILED` while main records typed `HARNESS_TRANSPORT_FAILED`; three also expect retry despite the recorded non-retriable failure. Current policy follows main's recorded resumability. These original semantic assertions are preserved rather than changing the engine to fit them. [Counts and complete six failures](failure-evidence-results.json).

- `sdk-0-sync-HARNESS_TRANSPORT_FAILED`
- `sdk-4-promise-HARNESS_TRANSPORT_FAILED`
- `sdk-8-iterator-HARNESS_TRANSPORT_FAILED`
- `sdk-73-sync-HARNESS_TRANSPORT_FAILED`
- `sdk-77-promise-HARNESS_TRANSPORT_FAILED`
- `sdk-81-iterator-HARNESS_TRANSPORT_FAILED`

## Interrupted partial browser run

The first browser launch was stopped to correct the newly discovered pre-admission child-advance liveness case. Printed case states: `{'ok': 208}`; last numbered pass 208. The wrapper exited 1; Playwright's own final exit/result is unavailable. [Partial log](edge-full-attempt-1.log.txt), [metadata](edge-partial.json). It is not counted as a completed full suite or final-source qualification. Port 6370 was verified free after its teardown. The final completed full suite uses the finished source, Edge, zero retries and one worker.

## Missing-session generated evidence

The integration driver writes eight historical QA output names. This run's outputs are preserved here as `missing-session-restart-*`; the historical files were restored byte-for-byte from the unchanged base. No historical evidence is replaced by this round.
