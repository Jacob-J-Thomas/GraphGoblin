# Canvas targeted native QA and Reset double-click reproduction

This packet preserves the first native run at head `ca9ac7bdea9adb0a05a5e515fb6d7bb229b1eab8`,
tree `16cfc0dd206cf4a4865281c296eb26f289f0f252`, against actual main
`41bde22c80a796bf8c4bec8ab5dec8e755271f9e`. Five targeted correction cases passed. The sixth
case confirmed that the second click of a Reset double-click can remove the selected connection.
The runner stopped before the preservation matrix.

The six isolated Edge fixtures recorded 55 checkpoints, 21 browser draft PUTs, 20 accepted
writes, one intentional stale-token HTTP 409, and zero page errors. No fixture correction batch
or additional formal review scan was used. See the [complete native report](raw/corrected-review-native/corrected-native-report.md.txt)
and [run index](raw/corrected-review-native/runs/initial-focused/overview.json).

## Fixture outcomes

| Fixture              | Native result                                                                                                                                                                                                                                                                                 | Raw record                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Duplicate ID         | The public draft admitted both holders. The toolbar and both keyboard removal keys refused ambiguity without changing graph, token, device, history, or save state. Unique Remove and one Undo passed.                                                                                        | [Graph, inputs and readbacks](raw/corrected-review-native/runs/initial-focused/duplicate/observed.json)                   |
| Conflict reload      | A real stale-token 409 and Reload replaced the reused ID without transferring selection. Explicit reselect removed one edge and Undo restored the replacement without selection.                                                                                                              | [Conflict and selection](raw/corrected-review-native/runs/initial-focused/reload/observed.json)                           |
| Hidden Decision edge | Clearing the route ID retired the edge selection and retained its stored ownership. From the intentionally focused node, Backspace performed a node deletion. Undo restored the invalid device graph and exact ownership, and explicit Loop issues recovery removed only the stranded edge.   | [Device and server state](raw/corrected-review-native/runs/initial-focused/hidden/observed.json)                          |
| Script and geometry  | Removing a Script port cleared selection and kept its stored edge. Undo restored the graph without reviving selection. A subsequent fresh selection survived route nudge and Undo, and Remove targeted the intended edge.                                                                     | [Port, geometry and history](raw/corrected-review-native/runs/initial-focused/script-geometry/observed.json)              |
| Control node drag    | The generated drag click at +3.4 ms and separate trusted click on Remove at +6.2 ms both met D3 capture with the button visibly unavailable. The first available trusted click at +26.9 ms reached the button and removed the edge once. Separate Undo actions restored removal and movement. | [Trusted input frames, event trace and history](raw/corrected-review-native/runs/initial-focused/node-drag/observed.json) |
| Reset double-click   | **Product failure.** The first trusted click hit Reset. The second trusted click hit the same edge's newly positioned Remove button and deleted it. Separate Undo restored the automatic edge and then the exact manual route. The single Reset and unique Remove controls passed.            | [Hit boxes, events, graph and controls](raw/corrected-review-native/runs/initial-focused/reset-doubleclick/observed.json) |

## Reset double-click evidence

An ordinary single Reset and Undo measured the actual manual and automatic toolbar positions.
The natural intersection point `(793.704, 286.940)` hit the manual Reset button after Undo.
A native double-click at that point produced a click with detail 1 on Reset at +4.9 ms and a
click with detail 2 on Remove at +17.1 ms, both reaching document capture for edge `e1`.
One conditional PUT removed `e1`. Public GET and IndexedDB matched token
`54e62065a1c1f28c`. The Undo controls restored token `747795145df6e606` with automatic route,
then token `82af9e461472bd15` with the original manual route. The first/second event targets,
previous layout, complete graph and native mutation controls are preserved in the fixture record.
The [publication readback](raw/corrected-review-native/publication-readback.json) records the root's disposition on [PR #478](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/478#issuecomment-6887319153).

## Build and source binding

- The exact previous 993 artifact set was verified before the Node 22.23.4 forced build. The build
  passed 12/12 tasks with zero cache hits in 16.323 seconds. [Prior artifacts](raw/corrected-review-native/prebuild-artifact-readback.json),
  [build log](raw/corrected-review-native/forced-build.log), [build receipt](raw/corrected-review-native/forced-build-exit.json)
- The build was bound to 1,680 source and dependency inputs, 19 embedded modules, and all 1,227
  output files across 13 trees. Each compiled gateway verified the served HTML, CSS and JS bytes.
  Before and after bindings match SHA-256
  `d30f0225116d44e8e22c65aeeda5cb3a07dfa3e3589ab7480395ad256eac7874`.
  [Source closure](raw/corrected-review-native/source-closure-before.json),
  [before binding](raw/corrected-review-native/binding-before.json),
  [after binding](raw/corrected-review-native/runs/initial-focused/binding-after.json),
  [web source map](raw/compiled-web/index-smG5osOh.js.map),
  [API source map](raw/compiled-api/main.js.map)
- The [actual-main integration](raw/review-correction-main-integration.json),
  [admitted candidate](raw/corrected-review-qa-preparation/admission-ca9ac7bd.json),
  [execution admission](raw/corrected-review-native/execution-admission.json),
  [plan](raw/corrected-review-qa-preparation/plan.md.txt),
  [12-file prepared manifest](raw/corrected-review-qa-preparation/literal-manifest.json),
  and every prepared script and actual per-run driver are retained. Broader cases in the
  prepared drivers did not execute.
- All six browser sessions and gateways closed. Terminal readback found zero matching fixture
  PIDs, listeners, or lock, reclaim, WAL, or SHM residue. [Terminal cleanup](raw/corrected-review-native/terminal-cleanup.json)

## File integrity and scope

The packet retains 106 exact raw copies totaling 11,873,640 bytes, including the two exact bound
source maps, six console logs and six page snapshots. Input frames and event traces are in the
structured observation records. The run emitted no standalone event/frames file or screenshot.
Original report and plan are stored with `.md.txt` extensions to preserve historical Markdown.
Their paths remain as recorded. Use the local links in this README to navigate the packet.

The 42 excluded files are disposable SQLite/key files and isolated Turbo cache material. The packet
contains no browser profiles or model streams. Every identical copy is kept at its run-relative
path and mapped by hash. All raw bytes are protected from Git text conversion. The
[copy manifest](raw-copy-manifest.json) records source paths, destinations, sizes and hashes.
The [omission and identical-copy map](omissions.json), [packet inventory](packet-manifest.json),
[checksums](SHA256SUMS.txt) and [local link check](link-checks.json) make the package auditable.

This evidence covers the targeted cases at the named candidate. The Reset failure and the unrun
preservation matrix remain open. Owner acceptance and the final review gates are tracked separately.
