# Independent browser QA — inspector outage after an older run read

**Result:** Baseline reproduced the postmerge defect. Candidate passed the same authored browser probe and the unchanged repository regression. This is bounded QA of issue #575 only. The candidate was tested from the working tree and build01 assets; root must bind the final commit blobs to these runtime and asset hashes, and rerun affected proof if they change.

## Test design

The external `read-crosses-listener-loss.mjs` script launches the repository's disposable E2E gateway with `createTestApp` (in-memory SQLite, fake harness, fake clock, temp directory, ephemeral `127.0.0.1` ports) and headless bundled Chromium. It creates a real waiting run over HTTP. The initial live event batch naturally triggers a second browser run GET; the probe lets the API answer it while healthy, then holds only that real response body at the Playwright route. It stops the actual API listener, witnesses the browser stream failure and global API outage banner, and releases the older response. It tests the stale label, preserved input, disabled run actions, implicit form submit with no write, and a successful later browser run read before recovery. It then submits once and verifies the run succeeds. No cache injection, product flag, retry, or timeout increase is used.

The same exact probe file (SHA-256 `ed2cb8bfc7fdd999acc45cc23972eab968ef7ba6cac00be6659a4fbd6be9bde0`) ran against baseline and candidate build copies. Baseline assets came from clean `ff7992d6` (same tree as merged `eadb2029`); the candidate gateway/API source was the `eadb2029` worktree plus only the currently edited web runtime files. The original repository test source is identical in baseline and candidate (SHA-256 `7c3bf7921d5ef1848fee44e7c7ae0f4dd6912f11ce4b4687cd9ca59bbfcd9ff5`).

## Observations

| Check                                                            | Baseline web build                                                                                         | Candidate web build                                                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Real second run GET answered before listener loss and held       | 06:50:41.905 UTC                                                                                           | 06:52:17.860 UTC                                                                                                                      |
| Listener stop control and stream failure                         | 06:50:41.909 and .910                                                                                      | 06:52:17.864 and .864                                                                                                                 |
| Global outage visible; older 200 released                        | 06:50:41.965 and .966                                                                                      | 06:52:17.919 and .919                                                                                                                 |
| Run GET after loss                                               | None in 20 seconds                                                                                         | #3 at 06:52:17.923, connection refused                                                                                                |
| Last-observed label, disabled actions, preserved draft, no write | **Fail:** label absent at 06:51:02.025; screenshot shows Submit/Pause/Cancel/Replay/history action enabled | **Pass:** all assertions at 06:52:18.040; implicit submit sent no write                                                               |
| Listener restored, later run GET, deliberate submit              | Not reached; listener restored in `finally`                                                                | Restored 06:52:18.041; successful run GET 06:52:18.943; exactly one deliberate `POST /runs/{id}/input` at 06:52:19.039; run succeeded |

The baseline screenshot shows the global API banner, gateway disconnected notice, cached waiting run and typed JSON, but no last-observed warning and enabled write buttons. Six event-stream retries, health, shutdown, and storage probes were refused after the listener closed. The baseline failure is the expected product assertion, not a setup failure.

The first attempted baseline invocation under the default sandbox failed before gateway readiness with `listen EPERM 127.0.0.1`; its distinct receipt is retained under `baseline-run/`. The authorized loopback rerun used `baseline-run-escalated/` and reached the assertion. A later command typo (`/opt/homebrew/bin/pnpm` did not exist) also stopped before testing; the corrected unchanged regression used Corepack pnpm 12.8.1 and passed: **1 selected, 1 passed, 0 retries**, 4.1 seconds total.

## Runtime and asset binding

- Native Node `v22.22.2`; Corepack pnpm `12.8.1`; Playwright `1.63.0`; bundled Chromium revision 1243, Google Chrome for Testing `153.0.8010.12`; macOS arm64.
- Baseline 28-file asset manifest SHA-256 `3847453936dc564de0ffd09f758c2428d1011825028e85b758e83a8501cea551`; baseline `index.html` `73410a6f758f9db331febdcb49a421a55d50a99938318230d7a4537c47fec603`, app JS `6fc57a7e01ed0712597e83a6dbe2b4902db0a87a1f1377145646cebd6754c368`.
- Candidate 28-file asset manifest SHA-256 `1234536bfc02f3383e105ab0d3136d7cb23b9f7083a6010f68f1a3912d15404e`; candidate `index.html` `f99a72f89a4421805c1b90852e77fc604848b20c7acbf44731a0407c6bcd3cf5`, app JS `0bc957ccf8100989b09bcf3159e6f38e3bfd12085998df1525c30bb54bf5a126`.
- Tested candidate runtime sources: `inspector-read-provenance.ts` SHA-256 `11e5f198dbb2cee224b43b02e37abc41bc9679b344a8fee1cb05a64c9201f871`; `useRunEvents.ts` SHA-256 `4fa99c0930b20c756d7fc8ee35779c139ae91553d7cdd3f933e6dc21a3fa6848`. These match build01's source binding supplied by root. Final commit equivalence remains root's gate.
- Both asset manifests rechecked after execution: 28 OK, 0 failed each. No listener remained on either probe's recorded API/control ports after teardown. The script restored the stopped listener in `finally`; browser and API request contexts were closed, and the gateway received its stop signal. The E2E server closes the test app and removes its temporary directory.

## Commands and private evidence

The exact external browser commands used the same script and repository path:

```sh
GG_QA_REPO=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/inspector-repair \
GG_QA_WEB_DIST=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/baseline-dist \
GG_QA_OUT=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/baseline-run-escalated \
/opt/homebrew/bin/node /Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/read-crosses-listener-loss.mjs

GG_QA_REPO=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/inspector-repair \
GG_QA_WEB_DIST=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/candidate-dist \
GG_QA_OUT=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/candidate-run \
/opt/homebrew/bin/node /Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/read-crosses-listener-loss.mjs
```

The unchanged repository regression ran from `work/inspector-repair/apps/web`:

```sh
GG_E2E_WEB_DIST=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/candidate-dist \
GG_E2E_MAIN_PORT=0 GG_E2E_CONTROL_PORT=0 \
/opt/homebrew/bin/corepack pnpm exec playwright test -c playwright.config.ts \
e2e/inspector-availability.spec.ts --grep 'a waiting run stays last observed' \
--output=/Users/jake/Documents/Codex/2026-11-23/files-pasted-by-the-user-prompt/work/aidlc/inspector-independent-qa/original-candidate-results --reporter=list
```

`qa-receipt.sanitized.json` gives machine-readable hashes and event chronology without raw browser URLs or response bodies. Private raw `result.json`, `trace.zip`, `failure.png`, and gateway logs stay under the respective run directories. Do not publish those raw traces without separately reviewing headers and control URLs.
