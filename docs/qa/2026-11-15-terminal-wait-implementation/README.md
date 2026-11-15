# Terminal-wait implementation evidence (#410)

This packet preserves the implementation handoff, its six raw local-check logs, and the root source-acceptance receipt. The source artifacts were copied byte-for-byte; [source-copy-map.json](source-copy-map.json) records each source path, byte count, and SHA-256. [SHA256SUMS](SHA256SUMS) covers every packet file except itself.

## Source identity and change

Root accepted and committed source commit `4e4501bd92953794bb733a746f7c24d1bcc2452a`, tree `8f19c61271418529ff96e8e204c18010ce088c5e`, based on `154401c7b47c1e56b62a6daec50e2a3145ea967d`. The exact [root source-acceptance receipt](provenance/runtime-410-source-root-acceptance.json) has SHA-256 `b70d9e00ad70205f26e27337e9109cc3a9cd94ac63b6daf46c25221b3a70c286`; the [implementation handoff](implementation/handoff.json) has SHA-256 `88038b71d35f7be230575c86638aee58b0848ab0d07bb820885cea76067afc37`.

The engine clears `waiting` in the live `failRun` path and while recovery applies a logged `run.failed` event. Tests exercise the real `RunManager` through its public port contract with an in-memory fixture; recovery starts a new manager over the same fixture after the terminal event append while the parent failure-status write is gated. This is separate from native-process or SQLite candidate QA. Explicit `waiting: undefined` is stored as SQL `NULL`; there is no schema migration or store rewrite. Runs already marked failed by the prior behavior can retain a stale waiting value.

## Local verification

| Check                  | Result                                                            | Raw log                                                 |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| Old-source regressions | 2 expected failures reproducing the stale wait; 26 tests filtered | [log](implementation/01-old-production-regressions.log) |
| Focused engine tests   | 197 passed across six files                                       | [log](implementation/02-focused-engine.log)             |
| Engine typecheck       | Passed                                                            | [log](implementation/03-engine-typecheck.log)           |
| Engine lint            | Passed                                                            | [log](implementation/04-engine-lint.log)                |
| Formatting             | Prettier passed on all four changed files                         | [log](implementation/05-format.log)                     |
| Engine coverage        | 1,814 tests; 96.94% line coverage and 91.22% branch coverage      | [log](implementation/06-engine-coverage.log)            |

The separate independent native candidate QA is not included here. This packet makes no current-head CI, independent review, security-audit, merge, owner-acceptance, or issue-completion claim.
