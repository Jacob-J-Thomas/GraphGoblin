# PR #487 terminal-wait CI evidence

This packet preserves the original CI attempt and one authorized Gates-only retry for GraphGoblin PR #487. Both attempts use the same PR head, source tree, target, and tested synthetic merge. This packet records CI evidence only; it makes no review, merge, or owner-acceptance claim.

## Tested identity and run results

| Attempt | Workflow run                    | Gates result                              | Workflow result | Companion jobs                                                        |
| ------- | ------------------------------- | ----------------------------------------- | --------------- | --------------------------------------------------------------------- |
| 1       | 43758754651, run 885, attempt 1 | Cancelled at GitHub's 30-minute job limit | Cancelled       | Browser, Windows launcher, and Template image succeeded               |
| 2       | 43758754651, run 885, attempt 2 | Success; all 32 Gates steps passed        | Success         | Same three successful outcomes were carried from attempt 1, not rerun |

| Identity                         | Value                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| PR head                          | 0d1b935988c4ff06f5091b645210b0cd88703a16                                                |
| PR tree and synthetic merge tree | 9439a500040aa4763613549cca6235023916de58                                                |
| Target main                      | 154401c7b47c1e56b62a6daec50e2a3145ea967d                                                |
| Tested synthetic merge           | 89fa84597f5aa124cf02d2fdebe27e4656ef1516                                                |
| Synthetic merge parents          | 154401c7b47c1e56b62a6daec50e2a3145ea967d, then 0d1b935988c4ff06f5091b645210b0cd88703a16 |

The [attempt-1 packet](attempt-1/README.md) contains its complete four-job logs, terminal metadata, and coverage artifact. The [attempt-2 packet](attempt-2/README.md) contains the fresh Gates retry log and the distinct retry coverage artifact. Their per-attempt maps and checksum files are preserved inside each folder.

## What changed between attempts

Attempt 1's Gates job reached the 30-minute limit while processing coverage. Its final package summaries were present and the always-run coverage artifact upload subsequently succeeded, but licence, generated-doc, contrast, and dependency-audit checks were skipped. The first workflow run concluded cancelled.

The root-authorized retry reran only Gates. That job passed all 32 steps, including those four later checks. GitHub reports the overall workflow run as successful in attempt 2 because the three successful companion outcomes remained attached to the run. The new attempt-2 job IDs for Browser, Windows launcher, and Template image retain the original start/completion times and their decoded logs compare exactly equal to attempt 1. They are carried results, not new executions.

Both coverage archives are retained under separate artifact IDs despite sharing the GitHub artifact name. Attempt 1 artifact 14180472080 is 22,023 bytes; attempt 2 artifact 14181289134 is 22,026 bytes. The retry readback found 13 package summaries; 11 member files are byte-identical between archives, while apps/web and tooling summaries differ slightly. The comparison records the exact hashes and percentages without assigning a cause.

## Reliability follow-up

The first-attempt timeout and the retry pass with a faster but otherwise unchanged coverage workload are recorded in issue [#488](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/488). The observed runtime difference does not establish a cause, and this packet does not claim the reliability issue is resolved or that a gate was waived. The issue readback is in [provenance](provenance/retry-result-issue-488-readback.json).

The original first-attempt capture and accepted packet readbacks are in [provenance](provenance/). The complete packet source mapping is in [source-copy-map.json](source-copy-map.json); [SHA256SUMS.txt](SHA256SUMS.txt) covers every packet file except itself.
