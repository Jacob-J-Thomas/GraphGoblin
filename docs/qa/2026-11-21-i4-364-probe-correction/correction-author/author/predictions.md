# Predictions and counterfactual controls (written before tests and source changes)

Seams: **R** = controlled runner seam (`ClaudeCliRunner` result scripted per check; no process),
**C** = controlled child seam (real `runClaudeProcess` + real `ClaudeHarness`, mocked `spawn`,
`stat` and `killTree`; scripted child streams; no native pipe fault), **N** = native process (real
Node child running the repository fake CLI, real Windows spawn refusal and real `stat`). No owner
CLI, account, provider or model turn in any case. Every case asserts through `ClaudeHarness`
public `preflight()` and/or `start()`.

Common F1 expectation (corrected): `state: 'unknown'`, `ok: false`, no `authenticated` property,
`authMethod: null`, problems exactly `["Claude CLI check output could not be read. Check that the
Claude CLI starts and responds, then retry preflight."]`; turn rejects `HARNESS_TURN_FAILED` /
same detail / not retriable, one error event `definitely-not-submitted`, no `--print` process.

Common F2 expectation (corrected): `state: 'unknown'`, `version` from the version check,
`authenticated: true`, `authMethod: 'claude.ai'`, problems exactly `["<fixed cause> Check that the
Claude CLI starts and responds, then retry preflight."]`; turn rejects `HARNESS_TURN_FAILED` with
the fixed cause, not retriable, `definitely-not-submitted`, no `--print` process. Canaries
(stdout/help body, binary, prompt, check-folder path) absent from every public value.

## Cases (B = original source with new tests, A = corrected source)

| ID | Seam | Case | B | A |
| --- | --- | --- | --- | --- |
| H1.1 | R | auth: auth-like truncated stdout, output lost, exit 1 | FAIL (`auth`, `authenticated:false`, sign-in problem; turn `HARNESS_NOT_AUTHENTICATED`) | PASS |
| H1.2 | R | same, exit null | FAIL (same) | PASS |
| H1.3 | R | auth: runner-classified `auth` stderr, neutral truncated stdout, output lost, exit 1 | FAIL (same) | PASS |
| H1.4 | R | same, exit null | FAIL (same) | PASS |
| H1.5 | R | auth: classified `quota` stderr, output lost, exit 1 | FAIL (`quota`) | PASS |
| H1.6 | R | auth: classified `transport` stderr, output lost, exit null | FAIL (`transport`, retriable) | PASS |
| H1.7 | R | auth: explicit sign-out (`notLoggedIn`, `{"loggedIn":false`) with output lost, exit 1 | PASS (sign-out branch already checks with exit 0) | PASS |
| H2.1 | R | control: completed structured sign-out, exit 1 → `auth`/false "Claude is not signed in." | PASS | PASS |
| H2.2 | R | control: completed classified `auth` stderr, exit 1 → `auth`/false "Claude sign-in is missing or invalid." | PASS | PASS |
| H2.3 | R | control: H1.1's exact stdout, exit 1, output complete → `auth`/false | PASS | PASS |
| H3.1-6 | R | help or auth check with output lost + inferred state, and termination-unconfirmed / timeout / overflow → that outcome's own code and detail | PASS | PASS |
| H4.1-2 | R | help or auth check with output lost, cancelled through `session.cancel()` → `AbortError`, no events, no turn | PASS | PASS |
| H5.1 | R | help only: refusal, check folder missing | FAIL (versioned "Claude CLI 2.1.285 failed the --max-turns/--help check.") | PASS |
| H5.2 | R | help only: refusal, check folder not a folder | FAIL (versioned) | PASS |
| H5.3 | R | help only: unexplained `ENOENT` refusal → "Claude CLI could not be started (ENOENT)." | FAIL (versioned) | PASS |
| H5.4 | R | help only: unexplained `EACCES` refusal → "(EACCES)" (same start-refusal site; pre-#364 also wrapped — disclosed) | FAIL (versioned) | PASS |
| H5.5 | R | help only: output lost, exit 0 | FAIL (versioned) | PASS |
| H5.6 | R | help only: output lost, exit 1, classified `cli-incompatible` stderr | FAIL (`cli-incompatible`, versioned) | PASS |
| H5.7 | R | help only: output lost, exit null | FAIL (versioned) | PASS |
| H6.1 | R | control: help exits 1 → versioned, `unknown` | PASS | PASS |
| H6.2 | R | control: help stops without exit code → versioned | PASS | PASS |
| H6.3 | R | control: help stdin failure → versioned | PASS | PASS |
| H6.4 | R | control: help classified `cli-incompatible` at exit 1 → versioned, `cli-incompatible`, `HARNESS_CLI_INCOMPATIBLE` | PASS | PASS |
| H6.5 | R | control: help lacks `--restricted` → "Claude CLI 2.1.285 does not list required options: --restricted." `cli-incompatible` | PASS | PASS |
| P1.1-4 | C | auth: stderr `API Error: 401 …` then stdout or stderr pipe `EPIPE`, close 1 or null → runner `outputFailed`+`failureState:auth` | FAIL (`auth`/false) | PASS |
| P2 | C | control: same stderr, complete output, close 1 → `auth`/false | PASS | PASS |
| N1 | N | help only: harness's own empty check folder removed for that one start (real `ENOENT`, real `stat`) | FAIL (versioned) | PASS |
| N2 | N | help only: check folder replaced by a file for that one start (Windows only) | FAIL (versioned) | PASS |

Pre-existing tests in the three files: predicted all PASS at B (before new tests are added, proving
they miss the mixed cases) and all PASS at A.

Totals predicted at B: **19 failing new cases** (H1.1-6, H5.1-7, P1.1-4, N1, N2 = 6+7+4+2),
every other case passing. (A first draft of this line said 22; corrected before any run.)

## Counterfactual source mutations (after correction; each restored byte-exactly, SHA-256 checked)

| ID | Temporary change to corrected `harness.ts` | Predicted failing cases |
| --- | --- | --- |
| M1 | move the lost-output guard back below readiness inference | H1.1-6, H5.6, P1.1-4 (11) |
| M2 | help wrapper ignores the private type | H5.1-7, N1, N2 (9) |
| M3 | over-broad: the private type also at the ordinary probe exit/stdin site | H6.1-3 and existing "reports the detected version when the hidden max-turns capability probe fails…" (4) |
| M4 | over-correction: drop probe readiness inference entirely | H2.2, H2.3, H6.4, P2 (4) |

Then the affected suites run once on the corrected source (scoped `src/claude` with coverage),
plus infrastructure typecheck, lint, Prettier check of changed files and `git diff --check`.
