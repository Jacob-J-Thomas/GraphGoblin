# D241 small follow-up static and focused checks

Node v22.23.4 and pnpm 12.8.1 ran read-only web typecheck, scoped ESLint over the 13 TypeScript author paths and Prettier check over all 15 author paths. All three exited 0 on the first attempt. No formatting write ran. [Static result](STATIC-RESULT.json) · [ESLint output](02-eslint.stdout)

All 227 tests passed across 14 focused files in one invocation with one worker, no retries and unchanged deadlines. This includes the script-recovery case that previously failed on an ambiguous text lookup. The first correction's 226-pass, one-fail result remains intact. [Follow-up raw JSON](vitest-results.json) · [First correction report](../i5-d241-corrected-checks-01/REPORT.md)

The three expected documentation and test paths were bound before execution. Source, selected tests, three protected core paths, linked index, lockfile and modules metadata stayed byte-identical during the checks. The common index remained absent. Root subsequently froze the checked files separately. [Binding](BINDING.json) · [Before](BEFORE.json) · [After](AFTER.json)
