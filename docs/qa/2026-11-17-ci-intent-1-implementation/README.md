# Original implementation evidence for #488 and #496

Claude Opus 5.5 produced the original candidate on base `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. The source bindings identify the eight changed files tested here. Local work used Node v22.23.4 and pnpm 12.8.1 on Windows. The status sentence in the raw report refers to hosted GitHub Actions. The local logs retain an isolated run and one whole-tooling rerun. [Source bindings](SOURCE-BINDINGS.txt), [raw author report](author-record.md.txt)

## Workflow and local verification

The implementation separates Repository checks and Coverage, and keeps Gates as the aggregate. The 30-minute lane budgets and 25-minute Coverage step cap came from the GPT-approved implementation contract. The local inventory preserved the prior non-coverage commands, and a shell harness checked all 25 fan-in result pairs. Only success on both lanes passed the aggregate. [Workflow inventory](qa/workflow-inventory.result.json), [inventory negative controls](qa/workflow-inventory-red-controls.result.json), [fan-in outcomes](qa/gates-fanin.result.json)

The initial tooling coverage run failed the maintained browser CLI case at 180.025 seconds. The isolated file later passed 22/22 and a full local rerun passed 199/199. The first failure remains part of the record. Its underlying cause is unresolved. [First tooling coverage result](logs/03-tooling-coverage.log.txt), [isolated run](logs/04-perf-runtime-isolated.log.txt), [full rerun](logs/05-tooling-coverage-rerun.log.txt), [read-only diagnosis](../2026-11-17-ci-intent-1-perf-timeout-recurrence/README.md)

## Windows launcher evidence

The author’s final native case and the same-host baseline each passed 23 of 25 tests. Both failed the directory symlink subtest with `EPERM` and its parent. The native run exited 1 and the candidate bundle verifier accepted the staged failure evidence. The first candidate bundle also records the original missing lock-contention observation. The negative fixture retained typed child outcomes and bounded records for failure cases. [Final native output](local/candidate-final/native.log.txt), [same-host baseline](local/base-same-host/native.log.txt), [final bundle verification](local/candidate-final/verify.json), [first candidate check](local/candidate-positive/verify.json), [negative bundle verification](local/candidate-negative/verify.json)

Independent QA logged three findings requiring correction. Candidate hosted upload and exact-head CI acceptance require separate verification. The two hosted controls concern historical upload behavior. [Independent QA](../2026-11-17-ci-intent-1-independent-qa/README.md), [uploader control](../2026-11-17-ci-intent-1-496-uploader-control/README.md), [baseline probe](../2026-11-17-ci-intent-1-496-baseline-probe/README.md)

The source seal and publication manifest bind all 72 original artifacts to their preserved bytes. [Original seal](SHA256SUMS.txt), [publication manifest](publication-manifest.json), [evidence index](../2026-11-17-ci-intent-1/README.md)
