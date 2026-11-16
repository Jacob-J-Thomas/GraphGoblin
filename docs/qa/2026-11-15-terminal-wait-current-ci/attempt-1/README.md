# PR #487 current CI: first attempt

This packet preserves the original pull-request CI attempt for GraphGoblin PR #487. It records run 43758754651 (run number 885, attempt 1) on head 0d1b935988c4ff06f5091b645210b0cd88703a16. The run concluded cancelled after the Gates job reached GitHub's 30-minute maximum. This packet is a historical first-attempt record; the cancelled result is not a green CI outcome.

## Tested identity

| Item                    | Value                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Pull request head       | 0d1b935988c4ff06f5091b645210b0cd88703a16                                                |
| PR tree                 | 9439a500040aa4763613549cca6235023916de58                                                |
| Target main             | 154401c7b47c1e56b62a6daec50e2a3145ea967d                                                |
| Tested synthetic merge  | 89fa84597f5aa124cf02d2fdebe27e4656ef1516                                                |
| Synthetic merge tree    | 9439a500040aa4763613549cca6235023916de58                                                |
| Synthetic merge parents | 154401c7b47c1e56b62a6daec50e2a3145ea967d, then 0d1b935988c4ff06f5091b645210b0cd88703a16 |
| Workflow                | CI, run 43758754651, run 885, attempt 1                                                 |
| Run interval            | 2026-11-15 20:33:31Z to 21:03:49Z                                                       |
| Final run result        | cancelled                                                                               |

The [synthetic-merge identity](metadata/synthetic-merge-89fa84597f5aa124cf02d2fdebe27e4656ef1516.json), terminal [run metadata](metadata/run-43758754651-terminal.json), and [terminal job snapshot](metadata/jobs-43758754651-terminal.json) retain the tested checkout identity and run result. Complete logs and step records are in [logs](logs/).

## Job results

| Job                                | Result    | Qualification                                                                                                                       |
| ---------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Gates, job 132948548834            | Cancelled | GitHub's annotation states the job exceeded the 30-minute maximum.                                                                  |
| Browser, job 132948548835          | Success   | 481 passed, 1 skipped; 482 total, one worker, zero retries, 21.9 minutes.                                                           |
| Windows launcher, job 132948548802 | Success   | 14 passed, no failures or skips. The upload step warned that no native evidence files existed, so this run has no Windows artifact. |
| Template image, job 132948548608   | Success   | The read-only, network-disabled image check verified the four shipped template IDs: implementation, qa, review, and starter.        |

## Gates coverage and timeout

Before timing out, Gates completed the build, acceptance suites, typecheck, lint, format, layer, migration, design-token, dependency-graph, template-refusal, and Chromium-install steps. The coverage command emitted final summaries for all 13 package groups and reported 9,607 passed and 41 skipped tests (9,648 total). Every package summary met the 90% line and branch floors. Turbo reported 22 successful tasks, including 9 cached tasks.

Skipped test counts were adapter-codex 5, infrastructure 8, adapter-jev 5, API 20, tooling 2, and plugin-codex 1. The exact per-package coverage values and archive-member hashes are in the [coverage member readback](metadata/coverage-43758754651-members-readback.json); the [coverage ZIP](artifacts/coverage-43758754651-14180472080.zip) is 22,023 bytes with SHA-256 f5a9cc2e9ddc72a79a357a1970a873cd4db321083da2af87f0e48e2c82e38404.

The coverage step was canceled at the job deadline; its final summaries were present, and the always-run artifact upload subsequently succeeded. The job log ends with “The operation was canceled.” The later licence allowlist, generated-doc freshness, design-token contrast, and dependency-audit checks were skipped. The successful package coverage output does not turn the cancelled Gates check into a passing result. The [official check annotations](metadata/gates-check-annotations-132948548834.json) preserve the timeout reason and warnings.

## Browser and environment limits

The Browser log reports that the only skip was the live UI inference test, which requires LIVE=1, an installed Codex CLI, provider login, and subscription quota; CI set LIVE=0. Optional routing screenshots, profiling, and strict performance bounds were off. The browser job ran on a hosted Linux runner with Edge; its Windows user-agent metadata is not evidence of a native Windows run. Native Windows evidence is limited to the separate Windows launcher job above.

The Windows job's upload step itself concluded success, but the log says no files matched .tmp/windows-launcher-*/. The run's artifact listing contains the coverage archive only. The Browser failure-evidence upload was skipped because the Browser tests passed.

Logs also retain GitHub's Node.js 20 action-runtime deprecation notice (the listed actions were forced to Node.js 24), Node DEP0169 and DEP0040 deprecation warnings, and the Ubuntu runner-image migration notice. These were warnings, not test failures.

## Evidence and provenance

- [PR metadata captured at run start](metadata/pr-487-initial.json)
- [Initial run and job snapshots](metadata/run-43758754651-initial.json), [initial jobs](metadata/jobs-43758754651-initial.json)
- [Terminal run and job snapshots](metadata/run-43758754651-terminal.json), [terminal jobs](metadata/jobs-43758754651-terminal.json)
- [Final artifact listing](metadata/artifacts-43758754651-terminal.json), [coverage archive member hashes and percentages](metadata/coverage-43758754651-members-readback.json)
- [Full Gates log and steps](logs/gates.decoded.log), [Browser log and steps](logs/browser.decoded.log)
- [Full Windows launcher log and steps](logs/windows.decoded.log), [Template image log and steps](logs/template.decoded.log)

The full source-to-copy mapping is in [source-copy-map.json](source-copy-map.json); [SHA256SUMS.txt](SHA256SUMS.txt) covers all packet files except itself. The source-copy map notes one excluded incomplete sidecar from local coverage indexing. The unchanged downloaded ZIP and corrected 13-member readback are included.
