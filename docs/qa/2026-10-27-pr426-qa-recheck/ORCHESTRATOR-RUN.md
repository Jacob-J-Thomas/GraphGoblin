# Orchestrator's run of check 3 outside the sandbox

The QA session above could not observe the two Claude stream-failure classifications (E-1): inside its sandbox, native process termination is denied (`taskkill /T /F` returns `ERROR: Access denied`), so both the `main` baseline and the PR build recorded `HARNESS_TERMINATION_UNCONFIRMED` instead. That is a limit of the verification environment (register D-015), not a product finding.

The orchestrator ran the session's own driver, unchanged, outside any sandbox on 2026-10-27 at 18:55 UTC: `scripts/c4-regression.mjs` against the retained baseline build of `main` at `b33a6d9f` and the built PR head `ae88d7574ce90667664e82951970e68279355ff1`, with the session's compiled fake CLIs, on ports 6716 and 6718, with `JEV_API_KEY` and every `GG_*` variable stripped. Output: [`orchestrator-c4-regression.log.txt`](orchestrator-c4-regression.log.txt).

Result: `DONE passed=7 failed=0`, no real provider turns.

| Case                                            | `main` at `b33a6d9f`                                                | PR head                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Codex HTTP 429 then exit 1                      | `HARNESS_QUOTA_EXHAUSTED`, stream message                           | same                                                                                     |
| Codex HTTP 500 then exit 1                      | `HARNESS_TRANSPORT_FAILED`, stream message                          | same                                                                                     |
| Claude `rate_limit` in the stream then exit 1   | `HARNESS_QUOTA_EXHAUSTED`, no banner or provider body               | same                                                                                     |
| Claude `server_error` in the stream then exit 1 | `HARNESS_TRANSPORT_FAILED`, no banner or provider body              | same                                                                                     |
| Control: the F2 refusal stream                  | `HARNESS_DELIVERY_UNCERTAIN` with the exit banner (the original D2) | `HARNESS_TURN_FAILED`, adapter code `HARNESS_ARGUMENTS_REJECTED`, the provider's message |

Both gateways drained to exit 0. With this run, every check of this re-check is observed as expected; the session's FAIL line above records only its own environment limit.
