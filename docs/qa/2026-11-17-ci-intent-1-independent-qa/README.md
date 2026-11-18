# Independent QA of the original #488 and #496 candidate

This QA ran on an isolated copy of the original eight-file candidate based on `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. It matched the raw source and Git blob bindings, the tracked diff, and all 72 author artifact hashes. The QA report concerns the candidate covered by those bindings. [Copied source receipt](copied-source.json), [original source bindings](../2026-11-17-ci-intent-1-implementation/SOURCE-BINDINGS.txt)

## Accepted findings requiring correction

1. A failed evidence Prepare step could skip Install and Build. The native acceptance step then saw a skipped Build and never ran. The Windows status model observed this sequence, and the helper returned a real nonzero exit for invalid Prepare paths. [Workflow controls](workflow-controls.json), [CLI controls](cli-controls.json)
2. Finalization could select a manifest with unknown or duplicate fields for upload. The controlled payload carried a path canary. The observations decoder also accepted a UTF-8 BOM, which violated its byte-canonical contract. [CLI controls](cli-controls.json)
3. Finalization could report `complete` with contradictory event-head binding or duplicate contention and alias evidence. A repeated recorder-open record was also admitted. [CLI controls](cli-controls.json)

These findings apply to the original candidate. The corrected implementation and its independent QA have separate evidence.

## Controls and native results

The exact fan-in shell passed 25/25 result cases. The dry run selected 13 serial coverage commands. The helper passed 21/21 focused Vitest tests. The Windows workflow status model passed 5/6 cases, and the direct CLI controls passed 8/13 groups. [Workflow controls](workflow-controls.json), [coverage task graph](coverage-task-graph.json), [focused helper tests](helper-tests.log.txt), [CLI controls](cli-controls.json)

Native acceptance returned 1 after 23 of 25 tests passed. The directory symlink subtest and its parent failed with the same `EPERM` outcome as the same-host base. Finalization returned 0 and retained a 53,343-byte three-file failure bundle. The cleanup receipt records zero listeners in the assigned range and zero surviving processes tied to the QA checkout. [Native TAP](native-tap.log.txt), [same-host comparison](native-baseline-comparison.json), [bundle receipts](native-bundle-receipts.json), [cleanup](cleanup.json)

The complete original QA report and commands are retained with all 30 source-sealed artifacts. [Raw QA report](source-readme.md.txt), [original seal](SHA256SUMS.txt), [publication manifest](publication-manifest.json), [read-only performance diagnosis](../2026-11-17-ci-intent-1-perf-timeout-recurrence/README.md), [evidence index](../2026-11-17-ci-intent-1/README.md)
