# PR #474 historical native negative controls

This packet preserves the historical negative controls on the original compiled runtime: commit `ae8add8a791699e905540465b5ddf929d00c50eb`, tree `ea2dfcfd46f7d5ab79fd98414db214513d830b52`, target main `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`. The checkout held corrected candidate head `164c01a2e3a52bf0ef69a409e1a428b45817b1b8`, but both before/after readbacks matched all 1,227 compiled files across 13 distribution trees; the test remained bound to the original runtime. It used Windows Edge, Node 22.23.4, the built API and file SQLite, with no provider turn.

The original [native report](old-native-report.md.txt) describes the schedules. Quick links to the captured criterion readbacks:

| Criterion                                      | Evidence                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| U1 pointer and Enter row identity/focus        | [Pointer](runs/before-rows-pointer/observed.json) · [Enter](runs/before-rows-enter/observed.json) |
| U2 warning after collection deletion           | [Warning](runs/before-warning/observed.json)                                                      |
| U3 valid held JSON through rename              | [Held JSON](runs/before-held-json/observed.json)                                                  |
| F1 context/subloop and F2 evaluated references | [Backend structural readback](runs/before-backend-structural/observed.json)                       |
| Source/runtime binding                         | [Before](ae8-artifacts-before.json) · [After](ae8-artifacts-after.json)                           |
| Fixture and gateway cleanup                    | [Cleanup proof](old-native-cleanup.json)                                                          |

These observations document pre-correction failures, not corrected behavior. The report records four GUI negatives reaching their intended result on the first attempt and no uncaught page errors. It also preserves the backend fixture repair history: URL resolution was corrected after a bad double-slash health path; the second run exposed JSONata null-prototype comparison noise; the third run completed all three backend groups and 29 HTTP requests. Seven gateways and four Edge sessions closed normally, with owned PIDs/listeners/WAL/SHM/locks absent afterward.

The [corrected native packet](../2026-11-14-node-reference-review-corrected-native/README.md) records later independent behavior on the corrected source. This packet alone makes no corrected-behavior, CI, formal-review, or owner-acceptance claim. The [retained file manifest](retained-files-manifest.json) is an exact copy of the preservation manifest (38 files, 709,372 bytes). See [link checks](link-checks.json) and [SHA256SUMS.txt](SHA256SUMS.txt). All retained files are protected from line-ending conversion.
