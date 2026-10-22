# Independent QA, round 3: #321 restart port ranges

**Verdict: PASS for the scoped port-range fix, with host limitations on `a44744f11d5c37000fe8354754fb3d8a82e3a4fa`.** The range split is sound for the two competing files: #321 uses 5930–5939; #320 keeps 5910–5919. No other API source declares a port in 5930–5939, and none of the executed test commands reported `EADDRINUSE`. Failed cleanup checks remain failed below; this is not an all-gates-green claim.

No product file or Git index was changed, nothing was committed, and this thread worked alone. All artifacts in this folder are directly linked below. Node 22.14.0 and pnpm 12.8.1 were used from PowerShell; available parallelism was 12. No owner app/store, ports 4747/4748, paid provider turn or live-provider test was used.

## Static checks

| Check           | Steps                                             | Expected                                      | Actual                                                                                    | Result | Evidence                                                                       |
| --------------- | ------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| Patch scope     | Diff a44744f1 against 23f809ea                    | One test file, port change and rationale only | script-restart.test.ts: 3 inserted / 1 deleted lines; comment plus 5910–5919 to 5930–5939 | PASS   | [port-range.diff](port-range.diff)                                             |
| Range ownership | Search portRange and literal ports under apps/api | No second declaration of 5930–5939            | Only script-restart.test.ts declares that range; child-creation-restart uses 5910–5919    | PASS   | [port-search.txt](port-search.txt), [static-results.json](static-results.json) |
| Shared defaults | Enumerate createApiProcessFixture callers         | Identify remaining collision opportunities    | main, retired-event-startup and subloop restart files share the 5600–5699 default         | NOTE   | [fixture-callers.txt](fixture-callers.txt)                                     |

Baseline qualification: `2c675ce2..HEAD` also contains earlier changes to the engine admission guard and its contract tests. Both already exist at `23f809ea`; they are outside this port-fix diff. Therefore the port commit is test-only, while the broader claim of identical runtime source to 2c675ce2 is not exact. See [runtime-anchor-delta.txt](runtime-anchor-delta.txt) and [earlier-admission-change.diff](earlier-admission-change.diff).

## Commands and results

The paired runs were executed three times consecutively, followed by the same pair plus subloop-restart. The extra QA config changes disposable fixture names only; port ranges, test assertions, file parallelism and original thresholds are retained. The coverage process also used a unique gg-qa-321-r3 coverage container as TEMP/TMP so helper-created stores stayed inside the owned cleanup scope.

For each test invocation the expected result is all selected tests passing with no EADDRINUSE. Build expects exit 0. [results.jsonl](results.jsonl) preserves exact commands and durations; [summary.json](summary.json) preserves counts and failure names.

| Check / steps        | Passed | Failed | Skipped | Exit / result | EADDRINUSE mentions | Evidence                                             |
| -------------------- | ------ | ------ | ------- | ------------- | ------------------- | ---------------------------------------------------- |
| build                | n/a    | n/a    | n/a     | 0 / PASS      | 0                   | [build.log](build.log)                               |
| pair-1               | 5      | 1      | 0       | 1 / FAIL      | 0                   | [pair-1.log](pair-1.log)                             |
| pair-2               | 6      | 0      | 0       | 0 / PASS      | 0                   | [pair-2.log](pair-2.log)                             |
| pair-3               | 6      | 0      | 0       | 0 / PASS      | 0                   | [pair-3.log](pair-3.log)                             |
| with-subloop         | 8      | 1      | 0       | 1 / FAIL      | 0                   | [with-subloop.log](with-subloop.log)                 |
| coverage-requested   | 705    | 1      | 6       | 1 / FAIL      | 0                   | [coverage-requested.log](coverage-requested.log)     |
| triage-child-zero    | 0      | 1      | 2       | 1 / FAIL      | 0                   | [triage-child-zero.log](triage-child-zero.log)       |
| coverage-two-workers | 706    | 0      | 6       | 0 / PASS      | 0                   | [coverage-two-workers.log](coverage-two-workers.log) |

The failed paired/combined/coverage cases name the same #320 zero-delay `afterEach` disposal timeout (60 seconds) seen in prior QA. The isolated check records its actual result separately. Child-cardinality diagnostics show one child for each of 24 parent visits before the cleanup hook fails. This is the previously dispositioned **D-015 native/sandbox cleanup class**, not an observed port-bind error. Prior outside-sandbox acceptance of QA-321-01 was supplied in round 2; no new outside-sandbox validation is claimed here.

The three **C6 subloop-restart** cases passed in the combined run and coverage invocations; its formerly reported parent/child restart race, addressed by #320 on this branch, was not reproduced here. Native fixture shutdown and cleanup evidence remains host-qualified by D-015.

### Coverage argument forwarding

The literal requested form was run once. With this pnpm/Vitest combination, the extra `--` reaches Vitest and the options after it are ignored: the public CLI parser yields maxWorkers=null and config=null. The literal run nevertheless executed the complete API suite. Its original configuration was unchanged, and all helper stores were contained by the unique TEMP/TMP root.

A separate corrected invocation omitted that separator, explicitly applied `--maxWorkers=2` and the fixture-resource config, and enabled reporting on failure. This was an argument-correction run to establish the requested worker bound. Failed invocations are retained alongside the corrected result. See [cli-parsing.json](cli-parsing.json), [parse-cli.mjs](parse-cli.mjs), [coverage-process-sample.json](coverage-process-sample.json) and [coverage-two-worker-process-sample.json](coverage-two-worker-process-sample.json).

Fresh corrected-run coverage: statements **96.41%**, branches **92.9%**, functions **94.05%**, lines **97.83%**. Thresholds and source exclusions were unchanged. The corrected two-worker invocation passed; earlier failed invocations remain recorded as failures.

## Residual allocator risk

The allocator binds a candidate port, closes that socket, then starts the API later. Closing the probe releases the port; it is not reserved for the API child. Another fixture invocation, another CI job sharing the host, or an unrelated listener can claim it in that interval. Separate ranges eliminate this specific pair's shared-pool collision within an invocation, but do not guarantee race-free allocation on a busy shared runner. The generic default range is still shared by multiple API test files and standalone acceptance scripts. This is a note only; no allocator change was made.

An optional read-only listener sampler did not observe both families listening simultaneously during its finite sampling window. It sent no network requests and did not change the requested Vitest runs. This negative observation does not establish serialization or prove absence of overlapping execution; the actual commands retained normal file parallelism. See [parallel-port-overlap.json](parallel-port-overlap.json).

## Cleanup and replay

[cleanup.json](cleanup.json) lists each remaining owned top-level directory removed, its contained directories, process-exit checks and any remaining stores. All owned node processes were checked after the test commands ended; recorded marker PIDs were also checked before removal. No owner data or old temporary directories were removed.

From <repo>, use [run-checks.ps1](run-checks.ps1) with Node 22 first on PATH. Its default sequence runs the build, three paired invocations, the combined invocation and the literal coverage command. The corrected coverage and isolated check use `-Only coverage-two-workers` and `-Only triage-child-zero`. Run [cleanup.ps1](cleanup.ps1) only after all test/observer processes have exited. Then run [sanitize.mjs](sanitize.mjs), [summarize.mjs](summarize.mjs), [write-report.mjs](write-report.mjs), format the evidence and run [verify-bundle.mjs](verify-bundle.mjs). The logs are overwritten by a replay and command history is appended, so preserve a prior bundle first if retaining its observations.

| Removed top-level temporary directory                  | Nested directories removed | Processes exited first |
| ------------------------------------------------------ | -------------------------- | ---------------------- |
| gg-qa-321-r3-coverage-0117298b94f44b43bed856c014483031 | 71                         | yes                    |
| gg-qa-321-r3-coverage-fb8d0f921f2743168b9b0426842b5ae9 | 70                         | yes                    |
| gg-qa-321-r3-wp-d1-api-8S3MdS                          | 0                          | yes                    |
| gg-qa-321-r3-wp-d1-api-BUg8X9                          | 0                          | yes                    |
| gg-qa-321-r3-wp-d1-api-KQZh5r                          | 0                          | yes                    |

Remaining owned stores: **0**. Other test stores were removed by their own fixture disposal. The manifest records the post-test leftovers removed by this QA cleanup.

## Preservation manifest

- [build.log](build.log)
- [bundle-validation.json](bundle-validation.json)
- [cleanup.json](cleanup.json)
- [cleanup.ps1](cleanup.ps1)
- [cli-parsing.json](cli-parsing.json)
- [coverage-process-sample.json](coverage-process-sample.json)
- [coverage-requested.log](coverage-requested.log)
- [coverage-two-worker-process-sample.json](coverage-two-worker-process-sample.json)
- [coverage-two-workers.log](coverage-two-workers.log)
- [earlier-admission-change.diff](earlier-admission-change.diff)
- [final-state.json](final-state.json)
- [fixture-callers.txt](fixture-callers.txt)
- [format.log](format.log)
- [observe-ports.mjs](observe-ports.mjs)
- [pair-1.log](pair-1.log)
- [pair-2.log](pair-2.log)
- [pair-3.log](pair-3.log)
- [parallel-port-overlap.json](parallel-port-overlap.json)
- [parse-cli.mjs](parse-cli.mjs)
- [port-range.diff](port-range.diff)
- [port-search.txt](port-search.txt)
- [process-inventory.ps1](process-inventory.ps1)
- [qa.config.mts](qa.config.mts)
- [results.jsonl](results.jsonl)
- [run-checks.ps1](run-checks.ps1)
- [runtime-anchor-delta.txt](runtime-anchor-delta.txt)
- [sanitize.mjs](sanitize.mjs)
- [static-checks.mjs](static-checks.mjs)
- [static-results.json](static-results.json)
- [summarize.mjs](summarize.mjs)
- [summary.json](summary.json)
- [triage-child-zero.log](triage-child-zero.log)
- [verify-bundle.mjs](verify-bundle.mjs)
- [with-subloop.log](with-subloop.log)
- [write-report.mjs](write-report.mjs)
