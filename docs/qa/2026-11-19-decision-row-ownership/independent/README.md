# Final independent ownership observations

**Bounded ownership matrix: PASS on `6acf37fe02aed35a0f1bb6e3d24cc869d621bbb8`.** Ten store controls and eight actual Chromium journeys meet their recorded ownership, geometry, history and persistence criteria. Fresh browser first-attempt completion was **4/6**; two journeys required the visible device-copy recovery described below. This is independent behavior evidence, not formal review, CI or automatic-reconnect acceptance.

[Authentic terminal report, unchanged](terminal-report.original.md) · [Fresh aggregate](records/summary.json) · [Device aggregate](records/device-summary.json) · [Source identity](records/source-identity.json) · [Integrated chronology](../README.md)

## Actual observation selection

| Journey                                                       | Retained records                                                                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared IDs: rename after collision                            | [First attempt](records/shared-rename-browser.json), [guarded continuation](records/shared-rename-continuation.json)                                                             |
| Shared IDs: remove after collision                            | [First attempt](records/shared-remove-browser.json), [guarded continuation](records/shared-remove-continuation.json), [correct removal review](records/shared-remove-review.png) |
| Shared IDs: direct rename                                     | [Browser record](records/shared-direct-browser.json)                                                                                                                             |
| Unique IDs: rename, removal and direct rename                 | [Rename](records/unique-rename-browser.json), [removal](records/unique-remove-browser.json), [direct](records/unique-direct-browser.json)                                        |
| Exact old device map: second-row repair, then first-row edit  | [Browser phases](records/prior-map-repair-browser.json), [later first-row edit](records/prior-map-repair-later-edit.png)                                                         |
| Exact old device map: second-row removal, then first-row edit | [Browser phases](records/prior-map-remove-browser.json), [safe config-row removal without connection preview](records/prior-map-remove-review.png)                               |
| Controlled store observations                                 | [Six fresh cases](records/store-journey.json), [four preexisting-ambiguity cases](records/ambiguity-store.json)                                                                  |

The exact captured input is retained at [replay input](replay-inputs/prior-live-collision.json), SHA-256 `40fd7ee7b96e0f5f78f50442ece0f1230d489c93d8be1747019c87531dd63974`. The fixture restores it through IndexedDB outside a mounted editor, substituting only disposable loop identity, current save time and actual server-base bookkeeping. All later browser actions use the unmodified built application.

For contested ownership, the first ambiguous repair/removal leaves every physical connection intact. Later `yes → accepted` changes only the real `yes → done` record. The other `no → other` record and all manual geometry remain intact. This follows current authored ports; the ambiguous saved state cannot identify the historical originating row. Full definitions and ordered records establish geometry, while the screenshots establish the actual forms and removal interaction. Ambiguous duplicate IDs can still affect canvas rendering.

The aggregates contain **54 positively present, nonempty, shape-checked device-map samples**: 36 fresh and 18 restored. Initial Undo restores the editor's normalized loaded map, not the old contested durable claims. Definitions and subsequent map round trips are compared separately; absent synced metadata is never counted as positive map evidence.

## Retained first waits

The original shared-rename and shared-removal attempts each timed out at **30,000 ms** waiting for “All changes saved” after offline reload/reconnect. Their original JSON records above retain the error. The [rename snapshot](records/shared-rename-first-save-timeout-snapshot.yml) and [removal snapshot](records/shared-remove-first-save-timeout-snapshot.yml) show the displayed device/server conflict.

The separate continuations compare full server/device definitions for structural equality, click actual **Use this device's copy instead**, then verify save and server reload. They do not repeat route edits. Both restored-device first attempts complete without this timeout. The result does not imply a save-latency guarantee or general automatic-reconnect correctness.

## API and validation

The [actual fixture requests/results](records/public-api-fixtures.json) retain all six proper-body validation responses: HTTP 200 with `DUPLICATE_EDGE_ID` and `publishable: false` for three shared-edge-ID cases; HTTP 200 with no issues and `publishable: true` for three unique controls. [Already-collided public input](records/ambiguity-http.json) returns 400 `VALIDATION_FAILED` for duplicate route IDs. The metadata-free preexisting-collision case remains store-only; no schema or database bypass was used.

The old baseline's null-body validation failure remains separately qualified by its [unchanged erratum](../prior-findings/baseline/validation-erratum.original.md) and [original requests/results](../prior-findings/baseline/public-api-fixtures.json). Final-source positive validation does not retroactively qualify the old source.

## Source, cleanup and integrity

The [original source binding](records/source-binding.json) and [initial identity](records/source-identity.json) bind the tested source/tree, five source/test/documentation hashes, Node `v22.23.4` and pnpm `12.8.1`. The production module hash is `d2ed6a3c8dcdcdd5bef3db871182d2016c03f7523e39e66c7f9142e2630ef886`. The [publication runtime extract](records/final-verification.json) preserves the 12/12 real build, built web-asset hash, final clean source and observed shutdown. [Credential cleanup](records/credential-cleanup.json) records revocation 204, denial 401 and zero retained exact-token hits. The owned API/browser exited and port 62560 refused connections.

The tester's [read-only replay result](records/independent-replay.json) records 45/45 assertions. Its [original assertion script](verify-records.mjs) is retained for inspection; the assembler did not rerun it or the application. All **92** entries of the tester's original source seal were verified before selection. The [selection provenance](selection-provenance.json) binds that seal and 29 byte-exact copied originals.

Two files are explicitly derived: [commands.md](commands.md) is a privacy notice and runtime/build extract, and [records/final-verification.json](records/final-verification.json) omits only the private absolute `isolatedRuntime.dataDir` field while recording the original hash and treatment. The authentic terminal report remains unchanged, so its two corresponding links now lead to these clearly labeled publication versions. Exact local commands and the original runtime receipt remain sealed externally. Logs, databases, credentials and other driver copies are omitted.

[Component seal](publication-manifest.json) · [Umbrella integrity checker](../verify-publication.mjs)

Coverage is foreground headed Chromium and controlled offline document reload on disposable owned state. OS cold startup, other browser engines, screen readers, owner-store repair, real providers, every malformed historical map, universal reconnect and owner acceptance remain outside this evidence. The coordinator separately binds the later documentation-only publication child, formal review and CI.
