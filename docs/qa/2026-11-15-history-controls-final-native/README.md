# History controls final native verification

This packet records independent Windows Edge native-browser QA for the final history-controls candidate. All **11 of 11 groups passed on their initial attempts**; no group was missing, and the fixture-correction budget remained **0 of 2**. This was behavior QA and consumed **zero formal review scans**.

## Candidate and binding

- Candidate: `6b0eae62ea98ae73b22903c9922bba198e219608`, tree `5996caf9f060c899b305553fc3e359bf86990847`.
- Actual main and the merged Canvas predecessor: `1cfca9bce3967c9d41950266c83aab636667e0ab`.
- Reviewed history source anchor: `c2cffebb7ca1bbea41ae72a37b9f232c90681906`.
- Root's forced Node 22.23.4 build completed 12 tasks with zero cache hits. The before/after binding SHA-256 was `241e04ffe55ae4a9ab1af3586d61060039ca9e973fe19cd0d8c820885f275273`. The independent read-only binding was `7cc5e70f4c96371fa0f9734594228d66368814ce4583276986912e5be5033f7b`; it bound 1,683 source paths, 27 embedded source modules, and 1,227 outputs across 13 distribution trees. The domain-chain receipt `36a97407d92ee94f12d042ba45d62c733e8c9291171c2cb17aaa750567407b89` matched before and after. The Edge entry bundle hash was `64d4e26a83e9710f6a92436e772900d9b98034d1cb0cee6a6a4181305ddb928f`.
- Each fresh browser session used its own compiled local gateway and disposable file SQLite. The live gateway checked its PID and served HTML, JavaScript, and CSS before and after each run.

## Native matrix

| Group                     | Evidence and verified result                                                                                                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 fine/light             | [Raw actions](runs/h-d1-initial/raw/actions.json): complete undo/redo lifecycle, focus and fixed upper-row controls, shortcuts, held save/validation, publish and modal; the separate 1 px observer control detected motion and restored the exact baseline.                                          |
| D2 coarse/dark            | [Raw actions](runs/h-d2-initial/raw/actions.json): full lifecycle with 44 px targets and trusted emulated touch Undo/Redo; native mouse and keyboard histories also made the intended edits.                                                                                                          |
| 768 px fine/light         | [Raw actions](runs/h-n768-initial/raw/actions.json): full lifecycle and stable upper controls with a 120-character loop name, held save, and held validation.                                                                                                                                         |
| 512 px reflow proxy       | [Raw actions](runs/h-r512-initial/raw/actions.json): full lifecycle at 512×384 CSS px and DPR 2; public Fit View exposed the clipped work card without graph, token, history, or write-count changes.                                                                                                 |
| 360 px fine/light         | [Raw actions](runs/n360-initial/raw/actions.json): long name, ordered visible focus and targets, held Publish, current-only API readback, no horizontal overflow, and toolbar action centers hittable.                                                                                                |
| Offline during held Undo  | [Raw actions](runs/offline-initial/raw/actions.json): one editor status during the held press; release at the fixed target applied the exact device Undo without a draft PUT, kept the server unchanged, and recovered with one acknowledged restore.                                                 |
| API transport unreachable | [Raw actions](runs/unreachable-initial/raw/actions.json): browser stayed online; one editor status, fixed-target Undo, device/server isolation, and one acknowledged reconnect save.                                                                                                                  |
| PUT-only transport abort  | [Raw actions](runs/put-flash-initial/raw/actions.json): brief API-unreachable status captured in two frames below the toolbar; fixed hits and device Undo held, then a later ordinary edit persisted the earlier Undo.                                                                                |
| Distinct HTTP 500 cases   | [Raw actions](runs/http500-initial/raw/actions.json): validation POST and draft PUT returned HTTP 500 in distinct phases. Validation unavailable and Save failed appeared without a connectivity banner; the device-only edit recovered on a later ordinary save.                                     |
| Status ownership D1       | [Raw actions](runs/ownership-d1-initial/raw/actions.json): shell owned Loops, held loading, and Events; editor owned load/offline re-entry. Two real GET 404s settled the online missing-loop route. During offline, the native error and one shell status appeared together, with no editor toolbar. |
| Status ownership R512     | [Raw actions](runs/ownership-r512-initial/raw/actions.json): the same route, loading, re-entry, and settled native-error ownership passed at the reflow proxy after stored-theme readback.                                                                                                            |

The raw evidence contains 88 sampling phases and 16,447 samples, including 13,430 layout samples in 77 qualified stationarity windows. Recorded history coordinates moved 0 CSS px, with zero fixed-point misses and zero exclusions in those windows. Replay verified 21 trusted same-target press sequences of approximately 252.8–1116.6 ms. The deliberate 1 px observer movement belongs to its separate control and is outside those product windows.

All 66 accepted browser draft PUTs matched their exact prior If-Match token, expected whole graph, synced device, and public API canonical graph. All four native 404 responses belonged to the two ownership cases. There were zero browser page errors. Saved browser console errors were expected network-abort, HTTP 500, and missing-loop HTTP 404 messages from the admitted fault scenarios. See the [verified result summary](result-summary.json).

## Cleanup and limits

All owned browsers, gateways, and sinks closed. The cleanup audit recorded zero resource failures, live fixture processes, listeners, scratch stores, SQLite files, locks, or WAL/SHM sidecars. PID 26904 was the h-d2 browser PID and was reused by the cleanup PowerShell process itself (`thisAudit=true`); no fixture process owned that PID. Ports 4747/4748 and owner runtime resources were outside the run. See [final cleanup](cleanup-final.json) and [cleanup log](final-cleanup-log.txt).

- The 512×384 CSS px / DPR-2 case is a **reflow proxy**, not actual browser text zoom.
- D2 used **trusted emulated touch**; it does not establish physical-touch behavior. Screen-reader speech and other browser engines were also outside this run.
- Voice staging, auth, storage/shutdown notices, StrictMode, and renderer-error claim cleanup retain focused source/component coverage; this packet does not claim native coverage for those areas.
- The 821 and 899 attempts remain historical and were not used to fill the current 11-group matrix.
- Current CI, a fresh Astra review, and owner acceptance remain pending. This packet alone is not release readiness or owner acceptance.

## Preserved evidence and integrity

The [raw reviewer handoff](final-native-handoff.md.txt) contains the full narrative and detailed result. The [worker manifest](final-native-handoff-manifest.json) lists 455 files (36,142,366 bytes); every listed source size and SHA-256 matched before copying. The [curation manifest](curation-manifest.json) maps every copied source path to its packet path and hash. [SHA256SUMS](SHA256SUMS) covers the packet files other than itself; [local-link-checks](link-checks.json) records the README link check.

This packet copies the complete 475-file, 36,363,257-byte preparation tree outside `isolated-turbo-cache`. The 20 additional context files total 220,891 bytes and include the [approved plan](plan.md.txt), admissions, exact driver/configs, build and verification scripts, preflight record, and worker manifest. The excluded cache contains 30 files / 6,731,918 bytes. The only filename changes are `final-native-handoff.md` → `final-native-handoff.md.txt` and `plan.md` → `plan.md.txt`; both files retain their original bytes and SHA-256 values. All other copied filenames and file bytes are preserved.
