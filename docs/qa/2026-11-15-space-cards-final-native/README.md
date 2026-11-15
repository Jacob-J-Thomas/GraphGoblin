# Space cards final integrated native verification

**Result: seven of seven planned fixture groups passed on the integrated Space candidate.** Eight isolated browser executions are retained: the first R512 execution stopped during fixture setup; the approved correction run passed R512, and the other six groups passed on their initial executions. No product failure remained in the admitted matrix. Both global Space fixture-correction batches are spent. This packet records no formal review scan.

## Candidate and evidence contents

The tested candidate was `af583977ef1ace8fa086eb54b0b66c38f263b1ef` (tree `ed0e0b4340e888da1aeb69c363b447ca4263dada`), based on merged history candidate `177f3a7d57768c88f19c6bb4d8ef2b272c1e91bd`. The admitted canvas merge was `1cfca9bce3967c9d41950266c83aab636667e0ab`.

The [sealed native handoff](final-native-handoff.md.txt) describes the full run and limitations. The source [handoff manifest](final-native-handoff-manifest.json) lists 890 byte-hashed artifacts totaling 19,909,850 bytes; all were copied. The [curation manifest](curation-manifest.json) maps every source-relative path to the published path and records its size and SHA-256. Four source Markdown artifacts use `.md.txt` names to preserve their original bytes. The exact [root inspection receipt](root-final-native-inspection.json) records the independent full read and verification. The source manifest explicitly excludes the isolated Turbo cache and disposable gateway stores and SQLite/key/lock material.

A forced Node 22.23.4 build exited 0 after 12 tasks, with 1,691 tracked inputs, 35 embedded web modules and 1,227 outputs across 13 trees. Run bindings recorded the served asset bytes at startup and closure; the independent domain map ties source and emitted JavaScript to the embedded source map. See [build receipt](forced-build-exit.json), [before binding](binding/binding-before.json), [after binding](binding/binding-after-correction2.json) and [domain map](binding/domain-map-after-correction2.json).

## Passing groups

| Group                                |  Checks |    Browser PUTs | Raw result                                                       |
| ------------------------------------ | ------: | --------------: | ---------------------------------------------------------------- |
| R512 repeated Space, corrected setup |      65 |         7 × 200 | [result](runs/double-r512-correction2/raw/0106-full-result.json) |
| Keyboard and held gestures           |      51 |         5 × 200 | [result](runs/gestures-d1-initial/raw/0083-full-result.json)     |
| Outside selection, pan and drags     |      61 |         9 × 200 | [result](runs/outside-d1-initial/raw/0104-full-result.json)      |
| Apply, dismiss, history and reload   |      59 |        11 × 200 | [result](runs/apply-d1-initial/raw/0120-full-result.json)        |
| N768 card and offer sizing           |      41 |        12 × 200 | [result](runs/n768-initial/raw/0090-full-result.json)            |
| Coarse-pointer touch emulation       |      19 |         1 × 200 | [result](runs/touch-d2-initial/raw/0030-full-result.json)        |
| Device conflict and recovery         |      14 |   200, 409, 500 | [result](runs/device-d1-initial/raw/0031-full-result.json)       |
| **Total**                            | **310** | **48 attempts** | [run totals](final-native-run-totals.json)                       |

All 310 checks passed with zero page errors. Of the 48 browser PUT attempts, 46 were accepted and passed aggregate wire/server/device graph and acknowledgement-token comparisons. The remaining two were the deliberate conflict `409` and error `500`. The device-conflict case also made one separate accepted harness API PUT to establish the competing revision; it is not counted as a browser PUT.

## Retained first failure and correction

The first R512 run passed its count-two control, then stopped before the selected-node Shift drag because setup could not locate a visible node-body hit. The original `fixtureCardPoint` helper actually scanned all `.react-flow__node` elements; the handoff's “Router upper body” wording is imprecise. The admitted correction focused the visible Router node and sent trusted Space to select it, while preserving the product assertions and fixed coordinates. The [correction approval](root-correction2-admission.json), [fixture-correction ledger](fixture-corrections-correction2.json), [driver delta](driver-correction2.diff), [first failure](runs/double-r512-initial/raw/0066-failure-r512-shift-repeat-drag.json), [keyboard trace](runs/double-r512-correction2/raw/0066-frames-keyboard-select-fixture-node.json) and [corrected Shift-drag trace](runs/double-r512-correction2/raw/0076-repeated-verdict-r512-shift-drag.json) retain the sequence.

Before the gestures run, a leading `param()` caused the outer PowerShell wrapper to fail parsing; the exact [command](launch-wrapper-parser-first-command.ps1.txt), [stderr](launch-wrapper-parser-first-stderr.txt) and [failure receipt](launch-wrapper-parser-first-error.json) are retained. Removing that line allowed the initial run without changing the admitted fixture or driver bytes.

## Limits and cleanup

All eight browser executions closed their owned Edge sessions and gateways. Independent terminal verification found no owned live processes, remaining listeners, SQLite/WAL/SHM files, locks, keys or unqualified PID matches. The [final cleanup receipt](cleanup-after-correction2.json) and [command exits](final-after-correction2-command-exits.json) record closure.

This is Windows Edge automation. Browser-native events were sent through Playwright/CDP; coarse taps used Chromium touch emulation, not physical hardware. The 150% root-font override is a reflow proxy, not actual Edge text zoom. The 24 px screenshot shows the unchanged global header extending beyond the viewport; that global-header overflow is outside the Space cards scope, and the sizing checks cover the offer, result and cards. Physical Windows click classification, hardware touch, independent Edge font-enlargement preferences, other browser engines and screen-reader speech remain unverified here. Programmatic fit-call counts are covered separately by focused checks.

The gesture fixtures used trusted Enter while the real mouse button was held. D3 bookkeeping was not observable in those runs, and no synthetic unavailable pointer click was issued. The final native evidence does not itself establish CI, formal sign-off or owner acceptance.
