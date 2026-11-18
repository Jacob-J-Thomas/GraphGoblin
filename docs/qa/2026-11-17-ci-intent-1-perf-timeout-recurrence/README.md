# Read-only evidence for the #453 performance timeout recurrence

This packet preserves the first local performance failure observed during the #488/#496 implementation and the author’s separate follow-up runs. The read-only diagnosis inspected the already-created disposable fixture.

| Run                    | Result                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First tooling coverage | 198 passed, 1 failed, and no coverage totals. The browser CLI child ended after 180.025 seconds with `code: null`, `SIGTERM`, and `killed: true`. [Original failure](03-tooling-coverage.log.txt) |
| Isolated runtime file  | 22/22 passed. The reported 163.42 seconds covers the entire file. [Isolated run](04-perf-runtime-isolated.log.txt)                                                                                |
| Whole tooling rerun    | 199/199 passed across 18 files. [Rerun log](05-tooling-coverage-rerun.log.txt), [coverage summary](05-tooling-coverage-summary.json)                                                              |

The first log reached `PERF_BROWSER complete`. The retained worker samples show work continuing afterward through the 800 checkpoint. The case-completion marker and final case artifact were absent. The initial raw summary predates the case and cannot establish its final correctness. The evidence confirms the outer deadline and leaves the reason for exceeding it unresolved. Host load, instrumentation overhead, and the exact pending work were unmeasured. [Initial raw summary](initial-raw-summary.json), [source and fixture receipts](source-and-fixture-receipts.json)

The historical PR #450 log records both completion markers before rejection at 98.871 seconds and omits the child exit and signal details. The two observed failures remain separate. The #453 investigation stays open alongside the CI-workflow change. [Historical job](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/42501986669/job/128803792930), [tracking issue](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/453)

All eight original artifacts and their seal are retained. [Raw diagnosis](source-readme.md.txt), [original seal](SHA256SUMS.txt), [publication manifest](publication-manifest.json), [original implementation](../2026-11-17-ci-intent-1-implementation/README.md), [evidence index](../2026-11-17-ci-intent-1/README.md)
