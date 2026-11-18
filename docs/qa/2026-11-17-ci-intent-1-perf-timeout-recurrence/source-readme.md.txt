# #453 Windows tooling coverage timeout recurrence

This read-only packet records the first retained failure of the #488/#496 working copy, its isolated and full-suite follow-ups, and observations from the exact disposable fixture already created by that failure. No test, measurement, audit, CI or issue action ran for this diagnosis.

## First failure and bounded follow-ups

| Evidence | Result |
| --- | --- |
| First Windows tooling V8 coverage | Failed 1 of 199 tests. The maintained browser CLI case rejected after **180.025 seconds** with `code: null`, `signal: SIGTERM` and `killed: true`. Vitest reports 198 passed and one failure, with no coverage totals. |
| Author's isolated runtime file | 22/22 passed without coverage. Vitest duration 163.42s is for the entire file. The log does not give an individual browser-case duration. |
| Author's one full tooling coverage rerun | 199/199 passed across 18 files. Vitest duration 208.80s. Coverage was 97.41% lines, 93.19% branches, 93.82% functions and 96.50% statements. |

The first failure log prints the project Node executable v22.23.4 and the exact browser command with `--aged=2 --items=1 --profile=inspector --passes=1000 --browser-ms=1000`. It prints `PERF_BROWSER complete` from child stderr. It does not print `PERF_CASE 1000 complete`. Source sets `execFile` to 180,000ms. The killed/SIGTERM result and 180,025ms timing establish termination at that deadline. The failure remains a failure. The subsequent passes establish successful separate executions under their recorded conditions. [First coverage log](03-tooling-coverage.log), [isolated log](04-perf-runtime-isolated.log), [full rerun](05-tooling-coverage-rerun.log), [rerun coverage summary](05-tooling-coverage-summary.json).

First coverage log SHA-256 `8ce57447c7bc2cdbee651bfeccb6ae91881f1e70ebc6e74213b94936ea918190`. The raw copy matches the author packet's first retained bytes. [Source and artifact receipts](source-and-fixture-receipts.json).

## What the original fixture records

The exact `PERF_OUTPUT` path in the failure log was a physical, owned TEMP fixture. The raw summary preserved at that path is the pre-case snapshot. It reports Node v22.23.4, Windows, the same source HEAD `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`, boot PID 57048, zero cases, and no fields for the five failure flags projected as `null` by the test. That evidence cannot establish the completed case's correctness or finalization outcome. [Retained raw summary](initial-raw-summary.json).

The browser file contains completed observations for all three pages. No observed page errors, all pages remained `running` across their observation, and the event sequence advanced from 3163 to 3324 for Events empty, 3348 to 3504 for Inspector, and 3529 to 3639 for populated Events. The marker comes after browser close and writing `browser.json`. The measurement then calls worker `probe` and `finish`; worker `finish` begins by awaiting manager idle. The measurement must fetch the thread, process correctness, and save its case before the case-complete marker. No final case or CPU profile artifact was present.

The raw live memory log retains 650 ordered worker samples and advancing coarse work-visit checkpoints. Using its case-elapsed clock, checkpoints 300, 500, 700 and 800 first appear at 38.512s, 99.628s, 152.716s and 164.868s. The final sample at 175.338s still reports the 800 checkpoint and none report 900 or 1000. These checkpoints advance when a qualifying thread save returns and are spaced by 100 visits in this workload. They establish continued worker sampling and work progress well after the browser phase. They do not identify an exact final pass count, prove a particular pending await, identify a resource bottleneck, or establish why the remaining work exceeded the child budget. Files were read through literal physical fixture paths. The receipt retains hashes, dates and selected fields from the browser and memory records without copying the store, bulk samples or screenshots. [Workload phase source](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1/tooling/perf/measure.mjs#L458-L470), [artifact receipts and checkpoints](source-and-fixture-receipts.json).

## Comparison and limits

The observed working-copy diff has no performance test, measure, API, web, transitive package, test-configuration, lockfile or Turbo source changes relative to `6d7fcc98`. The candidate adds Windows evidence helper tests to the tooling suite. The prior build log records all 12 build tasks successful and ten cache hits, including API and web. A read-only check of present outputs after the attempts matched 275 workspace source files to TypeScript build metadata across API and seven transitive packages and 221 first-party web sources to the built bundle's sourcemap. The inputs agree with the current source and the bundle name printed in the build log. No pre-invocation built-byte hashes prove those files' exact contents at the instant each test ran.

The first and whole-package rerun logs show V8 coverage; the isolated runtime file does not. The checked tooling config enables subprocess V8 attachment. The maintained test strips most `GG_*` variables and forwards other inherited variables, so no `NODE_OPTIONS` absence is established from source. The admitted log and fixture receipts did not record `NODE_OPTIONS`, subprocess V8 environment values, or test-time concurrent host workload. The observations leave host load, instrumentation overhead and downstream work costs unresolved. A full-suite follow-up pass and unchanged runtime source do not establish that the CI change caused zero performance effect.

The historical PR #450 Gates failure remains distinct. Its Linux case rejected after 98.871s with both browser and case-complete markers. That log omitted child exit, signal and raw-summary status. The new Windows case has a confirmed outer exec deadline and lacks the case-complete marker. The diagnostic already added under #453 produced the evidence here. [Historical exact job](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/42501986669/job/128803792930), [historical disposition](../i1-diagnostics-453-489/README.md).

## Delivery disposition

Retain the first local failure alongside the follow-ups. The evidence supports continued #488/#496 validation on the admitted exact head. A complete hosted Coverage job must run the unchanged workload and all package floors, supply its archive and report denominators, and record the first attempt and any admitted follow-up separately. With the other required workflow, platform, audit and independent review gates satisfied, that result can support delivery of the CI workflow change. It cannot explain or close this #453 recurrence. The separate #503 high-severity audit blocker remains in force.

If the hosted measurement recurs, use the first failing run's child result and phase/checkpoint evidence to decide whether a tightly scoped baseline/candidate comparison or new phase diagnostics would distinguish the cause. Current evidence warrants neither a timeout change nor a speculative performance fix.
