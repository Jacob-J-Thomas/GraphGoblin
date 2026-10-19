# WP-A2: two-tab initialization and the functional browser gate

Evidence for #67 and #241, initially measured from `cfae696` and implemented in `309195b`, with review corrections recorded on 2026-10-19. Browser checks used Node 22 and installed Edge on Windows against the built app, disposable storage and scripted provider boundaries. They establish no live-provider or Ubuntu result.

The source measurements are preserved in the local artifact collection `output/playwright/test-results/wp-a2/`, principally `REPORT.md`, `browser-results.md`, JSON reports and trace ZIPs. Paths below are relative to that collection. The measurements needed to assess the conclusions are reproduced here.

## Two-tab evidence (#67)

The exact historical failure in which tab B never renders its heading was **not reproduced, not disproven**: the original drafts conflict test passed alone and in all ten initial load repeats. Its discriminating evidence is instead the **pre-change modal conflict failure plus one A/B activation diagnostic**. These are not repeated independent reproductions of the original tab-B failure.

| Initial check                                             | Result                               |              Total seconds | Retries |
| --------------------------------------------------------- | ------------------------------------ | -------------------------: | ------: |
| Complete drafts spec alone                                | 7 passed                             |                    104.976 |       0 |
| Complete drafts spec, ten load repeats                    | 69 passed, 1 restored-notice timeout |                   2679.016 |       0 |
| Requested main two-tab conflict within those repeats      | 10 passed                            | Individual durations below |       0 |
| Revocation before a held key-list refresh                 | 10 passed                            |                   1124.280 |       0 |
| Current Settings model-removal confirmation/recovery flow | 10 passed                            |                   1083.308 |       0 |

The historical title “Settings confirms model removal” is absent at this baseline. Its current counterpart is “Settings catalog edits LiteLLM models, refuses Add, and reports a second-delete error”. Neither action test was changed. The independent restored-notice timeout is preserved without attributing it to the two-tab flow.

Load included two CPU-bound threads. Initial repeats also overlapped coverage, typechecking, lint and the action checks; final repeats overlapped the full browser suite. This is comparable stress with different scheduling, not a controlled performance benchmark.

### Slow passing run

The slowest initial main conflict result was 75.356 s including hooks. Its repeat-index-3 trace is `before-load/drafts-two-tabs-editing-on-71871-sked-to-reload-or-overwrite-chromium-repeat3/trace.zip`:

| Stage                         | Milliseconds |
| ----------------------------- | -----------: |
| Browser-side tab-B navigation |       1747.7 |
| Tab-B heading visibility wait |        179.2 |
| Tab-B loop GET, HTTP 200      |         13.5 |
| Context teardown              |      30491.5 |
| After Hooks                   |      32949.3 |

Across the ten traces, tab-B navigation ranged 383.1–1747.7 ms and heading visibility 56.5–528.3 ms. This long overall result does not demonstrate a long second-heading wait or an IndexedDB lock. Detailed stage measurements are in `before-load-timings.json`.

### Discriminating failure and activation A/B

Before the helper changed, `editor-modal.spec.ts` / “a draft conflict is answered from inside an open node editor” failed waiting for tab A's initial heading, before any edits. Both tabs had already been created. Its 69.240 s result includes a 11975.4 ms navigation and a 56237.4 ms heading wait; the loop GET returned HTTP 200. Trace: `full/editor-modal-a-draft-confl-42a2b--inside-an-open-node-editor-chromium/trace.zip`.

A single read-only A/B diagnostic used fresh contexts, two pages and public Playwright APIs against that same disposable server. Times are milliseconds since the beginning of each condition, not a shared clock.

| Event                                            | Explicit activation before navigation |                                               No initial activation |
| ------------------------------------------------ | ------------------------------------: | ------------------------------------------------------------------: |
| Both pages initially report visible/focused      |                                3642.5 |                                                              2914.7 |
| Early activation completes                       |                                3698.7 |                                                                   — |
| Document response body finishes                  |                                4085.7 |                                                              3048.4 |
| Navigation completes                             |                                4605.6 |                                                             69173.6 |
| Loop GET response body finishes                  |                                4495.3 |                                                             77313.2 |
| Heading becomes visible                          |                                5654.1 | Two conditional heading waits fail, ending at 127155.3 and 149397.9 |
| Recovery activation completes                    |                                     — |                                                            151672.4 |
| Validation response body finishes after recovery |                                     — |                                                            151748.8 |
| Heading becomes visible after recovery           |                                     — |                                                            152278.2 |

Without initial activation, a bounded DOM evaluation also timed out. The heading appeared 605.8 ms after recovery activation. With early activation, it appeared 1048.5 ms after navigation completed. Evidence: `activation-comparison.json`, `activation-true.zip` and `activation-false.zip`.

This supports explicit activation of the page being driven. It does not establish a particular Chromium scheduling mechanism, product IndexedDB lock, service-worker claim deadlock or hydration defect. The nonactivated trace also contains an unfinished service-worker request and a long font request; their causal role was not isolated. No production code changed.

### Synchronization and finite verification

`openDraftTab` activates the page, navigates, waits for its exact heading and waits for the existing server/device reconciliation notice to clear. Both conflict flows use it. Reload, overwrite, save-state, stale-write and stored-value assertions remain intact. No sleep or timeout increase was added; the comments distinguish state synchronization from render-speed assertions.

| Repeat, 1-based | Main conflict before (s) | Main conflict after (s) | Modal conflict after (s) |
| --------------: | -----------------------: | ----------------------: | -----------------------: |
|               1 |                   25.096 |                  11.805 |                    6.821 |
|               2 |                   21.103 |                  11.794 |                   12.866 |
|               3 |                   42.707 |                  11.385 |                   13.117 |
|               4 |                   75.356 |                  40.772 |                   44.861 |
|               5 |                   52.106 |                  50.528 |                   22.278 |
|               6 |                   19.018 |                  16.114 |                   17.139 |
|               7 |                   16.739 |                  18.488 |                   29.723 |
|               8 |                   12.510 |                  10.460 |                   26.400 |
|               9 |                   12.637 |                  19.315 |                   31.394 |
|              10 |                   11.506 |                  19.071 |                   18.959 |

All entries passed on their first attempt. The complete post-change drafts repetition was **70/70** in 1532.826 s; the separate modal conflict repetition was **10/10** in 960.945 s. Tab-B navigation ranged 318.5–628.7 ms and heading visibility 90.9–521.0 ms. These are measurements, not timing requirements. Evidence: `after-load.json`, `after-load-timings.json`, `modal-after.json` and their trace directories.

The final `--workers 2` check exercised separate spec files with two actual Playwright workers despite `fullyParallel: false`:

| Test                                    | Seconds | Result | Retries |
| --------------------------------------- | ------: | ------ | ------: |
| Settings catalog edits / model removal  |  32.048 | Passed |       0 |
| Revocation before held key-list refresh |  12.718 | Passed |       0 |
| Main stale-tab reload/overwrite         |  31.643 | Passed |       0 |
| Modal conflict / reload                 |  15.798 | Passed |       0 |

The four-test check completed in 256.905 s with no global errors. Evidence: `workers-2-after.json` and `workers-2-after/`.

## Browser gate and seeded regression (#241)

The unconditional Ubuntu `browser` job installs frozen dependencies and Edge, builds, then runs every functional spec with `--retries=0`. Edge follows the existing Ubuntu routing workflow and matches Windows development. Local Windows channel selection is unchanged. The Playwright configuration also defaults to zero retries and creates an HTML report in CI.

The job reads the runtime from `.nvmrc` and depends on WP-A1 pinning that file to Node 22. At this follow-up baseline it still says 24; the browser job must be integrated after WP-A1. Local checks explicitly put Node 22 on PATH. The functional step has a 30-minute timeout inside the 40-minute job budget; `failure() || cancelled()` uploads available evidence. A step timeout allows subsequent failure-upload steps; exhausting the whole job budget can still prevent them. Ubuntu duration is to be recorded from the first run. A green Ubuntu run remains required.

Failure evidence includes available `test-results` files and the HTML report. A trace is not guaranteed: `routing.spec.ts` explicitly sets `trace: 'off'`, and the custom contexts in `responsive.spec.ts` attach no trace. Routing performance assertions at `routing.spec.ts:472`, together with the responsive 90-second and 120-second budgets, are intentional timing assertions and remain in the gate unchanged.

The seeded-regression check temporarily changed the built visible conflict notice from “The draft changed on the server” to “Seeded conflict notice regression”. The original main conflict assertion at `drafts.spec.ts:53` failed its visibility check, exit 1; the snapshot contains the changed notice. Exact original asset bytes were restored, verified with SHA-256 `cd38516c9f88750adf7c63c4da0602006a2400d94c774f134b7c276408f28370`, followed by a fresh successful build. The unseeded full-run conflict test passed in 13.409 s. The seed is absent. Evidence: `seed-metadata.json`, `seed.json`, `seed.log` and `seed/`.

### Skips and conditional modes

- The sole functional skip is `live.spec.ts` / “LIVE: build, publish, and run an inference loop against Codex from the UI”. It needs `LIVE=1`, an installed/authenticated Codex CLI and subscription quota. CI sets `LIVE=0`.
- No other functional test depends on provider login or an installed provider CLI. Scripted provider boundaries do not establish live-provider behavior.
- `GG_FORMS_QA_PHASE` historical captures and `GG_ROUTING_SCREENSHOTS`, `GG_ROUTING_PROFILE`, `GG_ROUTING_STRICT_PERF` optional modes are off in CI; their ordinary tests, including default routing performance checks, still run.
- `screens.capture.ts` is a manual screenshot utility outside the `*.spec.ts` pattern.
- Live checks are manual, separately authorized `LIVE=1` checks. No recurring paid-provider job was added.

### Initial full-run failure inventory

The single original full run selected all 357 tests: **341 passed, 15 failed, one live skip**, zero retries and zero global errors, in 5213.694 s on the busy Windows host. It began before the two-tab helper changed. This is historical evidence, not the first Ubuntu runtime measurement or a claim about a fresh full run after the review corrections.

Independent review confirmed **nine deterministic failures**: six model-control visibility cases and three stale #341 expectations. Classification (a) means behavior expected from #205; (b) means a stale expectation against accepted current behavior; (c) means another cause.

| Failing test                                                        | Observed assertion and expected behavior                                                                                              | Classification / disposition                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `claude-harness.spec.ts:159`, narrow Claude editor, readiness false | Preflight-not-ready status is hidden under Advanced; expects an immediately visible explanation and recovery.                         | (a) #205 visibility; unchanged.                                                                         |
| Same test, readiness true                                           | Selecting `claude-fable-5-1` times out because Model is hidden; expects a directly usable supported-model choice.                     | (a) #205 visibility; unchanged.                                                                         |
| `model-picker.spec.ts:28`, dark                                     | Expected `picker-dark`, received empty Model after keyboard selection; expects model/effort publishing and adapter-request agreement. | (a) #205; downstream request assertions not reached.                                                    |
| Same test, light                                                    | Expected `picker-light`, received empty Model.                                                                                        | (a) #205; unchanged.                                                                                    |
| `model-picker.spec.ts:94`, removed catalog model                    | The Settings recovery link is hidden under Advanced; expects saved selection preservation and an accessible recovery link.            | (a) #205; preceding saved-value/import assertions passed.                                               |
| `model-picker.spec.ts:151`, failed catalog / retry / defaults       | Retry model catalog cannot be clicked under Advanced; expects preservation, recovery and shared default pickers.                      | (a) #205; unchanged.                                                                                    |
| `earlier-node-outputs.spec.ts:8`, 1440 px                           | Expected `Copied`, received `Copied {{ outputs["producer-id"].value }}`.                                                              | (b) Stale after `5f7909d`; corrected to the deliberate named status.                                    |
| Same test, 390 px                                                   | Same exact-status mismatch; paste, publish and route assertions were not reached.                                                     | (b) Same correction; those downstream assertions remain.                                                |
| `form-controls.spec.ts:130`, Tab/Shift+Tab                          | Expected Remove args 1 immediately after CodeMirror; focus correctly reached Earlier node outputs (1).                                | (b) Stale after `d2d3291`; now checks editor → outputs → Remove and reverse traversal.                  |
| `cron.spec.ts:195`, custom summary                                  | Substring locator matches visible summary plus sr-only live status after its 350 ms settle timer.                                     | (c) Timing-dependent ambiguity under load; exact visible-summary text selected.                         |
| `editor-modal.spec.ts:358`, modal conflict                          | Initial tab-A heading never becomes visible.                                                                                          | (c) Pre-change discriminating initialization failure; post-change repeats and concurrency check passed. |
| `responsive.spec.ts:864`, dark coarse-pointer zoom                  | Exceeded 90000 ms after emitting complete geometry/routing measurements, before cleanup finished.                                     | (c) Test/cleanup budget; no failed geometry assertion and no isolated product cause.                    |
| `responsive.spec.ts:301`, light screen sweep                        | Overall 120000 ms budget exhausted polling health probes: expected > 0, received 0.                                                   | (c) Outage-probe/sweep budget; cause not isolated.                                                      |
| `responsive.spec.ts:864`, light coarse-pointer zoom                 | Same 90000 ms budget exhaustion with complete measurements emitted.                                                                   | (c) Test/cleanup budget; unchanged.                                                                     |
| `routing.spec.ts:472`, 100 nodes / 200 edges                        | Expected routing sample count > 60, received 40; preceding median/p95 assertions passed.                                              | (c) Performance sampling failure; 300-node counterpart passed. Thresholds remain.                       |

The two narrow Claude tests also explicitly switch harness and then expect the incompatible Codex model to remain selected. The latest #204 contract requires a compatible default after an explicit harness switch. Their observed visibility failures belong to #205, while these retention assertions need alignment with #204; moving controls alone does not establish final semantic acceptance.

Prior web coverage runs reported startup failures under parallel load, then 1461 passed / 10 failed with two workers and no fresh coverage summary. Independent review attributed all unit failures to load after confirming byte-identical web test inputs on the branch, base and main. No threshold or exclusion was changed; no fresh coverage percentage is asserted here.

## Review follow-up verification, 2026-10-19

The #67 helper and conflict assertions are unchanged. The follow-up corrects the Cron summary selector, the two stale #341 expectations, manual-live wording, trace-availability claims, CI timeout handling, shared runtime-file selection and the generated HTML report lint ignore. No test was suppressed, skipped or given a larger timeout.

The requested five-spec check passed **32/32**, with zero retries, zero skips and zero global errors, in **111.825 s**. No other test in these files failed. The full browser suite was not rerun.

| Spec                           | Passed | Failed |
| ------------------------------ | -----: | -----: |
| `cron.spec.ts`                 |     10 |      0 |
| `drafts.spec.ts`               |      7 |      0 |
| `earlier-node-outputs.spec.ts` |      2 |      0 |
| `editor-modal.spec.ts`         |      7 |      0 |
| `form-controls.spec.ts`        |      6 |      0 |

Both 1440 px and 390 px output-reference cases now reach their downstream clipboard paste, publish, successful execution, producer value 42, consumer value 43, decision port `yes`, and run-result 43 assertions. The keyboard case checks editor ? outputs disclosure ? Remove, then reverses to the editor and previous input, with the code text unchanged.

Node 22 typecheck (20/20 tasks), lint (11/11 tasks), build (11/11 tasks), formatting (`pnpm format` and `pnpm format:check`), design tokens (161 files) and layer checks passed. Lint passed with the existing generated HTML report present; the new ignore was also verified through the public ESLint API, while source specs remained included. An additional dependency check found a cycle between generated report CodeMirror/defaultSettings bundles in `apps/web/playwright-report/`; dependency rules remain unchanged. The current runtime pin is still 24, so Ubuntu gate acceptance depends on the Node 22 pin update and a green Ubuntu run.
