# PR 482 publication-head CI evidence

This packet records the original CI result for PR #482 at head `daa43634c8a093f2cde8239a3501ae4b6b14c112`, against base `177f3a7d57768c88f19c6bb4d8ef2b272c1e91bd`. The main workflow and the routing workflow both ran once, on 2026-11-15. No workflow was rerun. This is publication-head evidence; it does not establish CI for later corrections or a later head.

## Tested checkout

The checkout log and GitHub readback identify synthetic merge commit `26c9f58bd903c1ea0b5c0a361c6b8ee1f1cce633`, tree `a3f55255f1309606e024171b9b3e4e943c004966`, with parents the exact PR base and head above. The immutable commit API response and the captured merge-ref readback are retained as [commit identity](tested-merge-git-commit-readback.json), [merge ref](tested-merge-ref-readback.json), and [checkout identity record](tested-checkout-identity.json). The merge-ref readback followed routing completion; checkout log lines and the run metadata bind the actual run to the full commit and parent pair.

## Job results

| Job                 | Run / job                                                                                              | Attempt | Result                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| Browser             | [43689861052](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43689861052) / `132738025652` | 1       | Passed: 481 passed, 1 expected live-provider skip; 482 total, zero retries. Edge functional suite.                       |
| Windows launcher    | [43689861052](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43689861052) / `132738025800` | 1       | Passed: 14 passed, 0 skipped, including launcher route checks, reused-PID refusal, and three API lock-contention trials. |
| Gates               | [43689861052](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43689861052) / `132738025821` | 1       | Failed in web Vitest coverage: 2,883 passed, 3 failed of 2,886 across 223 files. Details below.                          |
| Template image      | [43689861052](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43689861052) / `132738025825` | 1       | Passed: isolated read-only image validation loaded all four shipped templates.                                           |
| Routing performance | [43689861048](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43689861048) / `132738025490` | 1       | Passed: both 100-node/200-edge and 300-node/600-edge drag tests.                                                         |

The combined CI run is **failed**, because the Gates coverage step failed. It started at 07:25:10Z and completed at 07:51:12Z. The separate routing workflow started at 07:25:10Z and completed at 07:27:54Z. The raw run records and job/step snapshots are retained below.

## Gates failure

Only `apps/web` coverage tests failed. In `src/editor/Canvas.space-cards.gate.test.tsx`, two “holds a press dragged on the result” cases (Shift false and true) expected viewport `{ x: 416, y: 280, zoom: 2 }` but received `{ x: 144, y: 280, zoom: 2 }`. A third case, “control: a Zoom Out press that is the first press elsewhere ends the result and zooms out once,” expected zoom `1.6666666666666667` but received `2`. The web Vitest run ended with 1 file failed and 222 passed, 3 tests failed and 2,883 passed (2,886 total; 483.17 seconds). The raw failure records are in [the complete Gates log](job-132738025821-gates.log).

The Gates job successfully completed build, focused acceptance, typecheck, lint, format, layer, migration-generation, design-token, dependency-graph and shipped-template steps before the coverage failure. Licence allowlist, generated-doc, design-token contrast-table and dependency-audit steps were skipped after the failure; this run provides no result for those gates. The coverage artifact was still uploaded (10 files, 13,536 bytes, SHA-256 `acd1e29d18d94399422118694fb51b571069517c8e2c686190abc227a629cb35`). The log contains React warnings for a duplicate `start-work` key and `NaN` SVG attributes; it does not identify them as the cause of the three assertions.

## Other checks and limits

The Browser workflow ran `playwright test --retries=0 --workers=1`: 481 passed and one `live.spec.ts` provider-backed test was intentionally skipped. Browser-failure evidence upload was skipped because the suite passed. The Windows job reported 14 passed and 0 skipped; its artifact upload found no `.tmp/windows-launcher-*/` files, so there is no Windows-evidence artifact. The template image job built the distributed image and loaded `starter` (4 draft nodes), `implementation` (11), `review` (10), and `qa` (11) under its offline/read-only validation.

Routing used the normal PR limits (median routing p95 below 8 ms; each drag below 16 ms). Strict manual mode was off (`GG_ROUTING_STRICT_PERF` empty); its stricter 4 ms routing and 17 ms frame targets were not enabled. Routing p95s were 5.7/5.3/4.7 ms at 100 nodes and 6.7/5.2/5.3 ms at 300 nodes (median 5.3 ms for both). Frame p95s were 33.4/33.4/33.4 ms and 50/33.4/33.4 ms, respectively. The 300-node run therefore exceeded the optional strict frame target on its first drag, while passing the active routing gate. This packet contains no controlled pre-change timing baseline and supports no claim about a performance regression or 60 Hz rendering.

The logs also retain runtime/action deprecation warnings (`url.parse`, `punycode`, and actions forced from Node 20 to Node 24). These are warnings, not failed gates.

## Retained records

All captured raw logs and API snapshots are preserved as received in this directory. The SHA-256 inventory is in [log manifest](log-manifest.json) and [SHA256SUMS](SHA256SUMS). `* -text` in [.gitattributes](.gitattributes) disables line-ending conversion for retained evidence files.

- [Browser log](job-132738025652-browser.log) and [step metadata](job-132738025652-steps.json)
- [Windows launcher log](job-132738025800-windows-launcher.log) and [step metadata](job-132738025800-steps.json)
- [Gates log](job-132738025821-gates.log) and [step metadata](job-132738025821-steps.json)
- [Template image log](job-132738025825-template.log) and [step metadata](job-132738025825-template-steps.json)
- [Routing log](job-132738025490-routing.log) and [step metadata](job-132738025490-steps.json)
- Main run: [final metadata](run-43689861052-final.json), [initial metadata](run-43689861052.json), [initial job snapshot](jobs-43689861052-initial-snapshot.json), [progress job snapshot](jobs-43689861052-progress-snapshot.json), [completed jobs](jobs-43689861052-complete.json), [artifact snapshots](artifacts-43689861052-snapshot.json) and [final artifact metadata](artifacts-43689861052-complete.json)
- Routing run: [run metadata](run-43689861048.json), [completed job](jobs-43689861048-complete.json), and [artifact metadata](artifacts-43689861048.json)

The immutable CI check suites are preserved as historical evidence only. Later head changes require their own evidence; this failed original run was not rerun. The later PR-body disclosure has a separate [exact readback](root-pr-failure-body-readback.json).
