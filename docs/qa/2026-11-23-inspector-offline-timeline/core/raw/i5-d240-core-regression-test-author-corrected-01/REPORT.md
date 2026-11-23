# D240 corrected-core author verification

The corrected helper preserved the qualified revision across the three public schedules that failed on the old helper. The focused file passed all 25 tests, including the original 21, all three B1 regressions and the positive default-retry case. The corrected test ran on Node `v22.23.4` with one worker and zero retries. [Old-helper baseline](../i5-d240-core-regression-test-author-01/REPORT.md) · [Corrected output](02-corrected-cases.stdout) · [Exact command](02-corrected-cases.receipt.json)

| Check | Result |
| --- | --- |
| Format the test file only | Exit 0, wrapping changes to the new test block |
| Focused provenance suite | Exit 0, 25/25 passed |
| Full web typecheck | Exit 0 |
| Scoped ESLint on helper and tests | Exit 0 |
| Prettier check on both changed files | Exit 0 |

The actual `useRun` remount case uses the app's real provider, hook and installed TanStack query lifecycle with a controlled transport. It observes the last subscriber's cancellation before remount and requires the original receipt at the same loss boundary. The direct pause and retry cases additionally check body identity and update count. The successful retry advances the receipt from a qualifying GET after the loss. Live-listener behavior and final inspector rendering remain separate QA.

The test author edited only `apps/web/src/runs/inspector-read-provenance.test.ts`. Root's helper and the existing queries source remained byte-stable throughout these commands. The old failing invocation and its pre-format source remain sealed. The corrected invocation has its own exact source and formatter diff. [Final pins and outcomes](COMMAND-RESULTS.json) · [Formatter diff](test-formatter.diff) · [Executed corrected test source](executed-test-source.ts.txt)

The author heavy slot is released. Independent QA, actual Claude named-delta confirmation, UI work and full delivery gates remain pending.

