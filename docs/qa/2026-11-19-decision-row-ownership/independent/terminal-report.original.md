# Independent #481 ownership QA — 6acf37

The bounded ownership matrix passes on the tested production bytes: **10/10 store cases and 8/8 actual Chromium cases meet their ownership, geometry, history and persistence criteria**. Two fresh-browser first attempts timed out during reconnect save; the original failures remain intact, and both completed through the visible device-copy recovery choice without repeating route edits. This is behavior QA, not a formal review, ordinary CI gate or acceptance of automatic reconnect.

## Source and execution boundary

Tested commit `6acf37fe02aed35a0f1bb6e3d24cc869d621bbb8`, tree `f7da19cd267622e6ded1bf3356a2ffbd31784e96`, parent `603e715853d6817f3e4de108cfb1440075de9f1a`. Production file SHA-256: `d2ed6a3c8dcdcdd5bef3db871182d2016c03f7523e39e66c7f9142e2630ef886`. All five bound source/test/documentation file hashes matched before and after execution; the named QA checkout remained clean. See [source binding](records/source-binding.json), [initial identity](records/source-identity.json) and [final verification](records/final-verification.json).

Node `v22.23.4`, pnpm `12.8.1`; `pnpm.cmd build` passed 12/12 tasks. Real web asset `index-2iZK7vxR.js`, SHA-256 `c70c88d602c5fa1cc2ef009bcd5b0cd986c255f9dce766d61593579c540229ee`. Playwright CLI 0.1.25 drove real headed Chromium build 1234 at 1440×1000. A new owned authenticated API/store listened only at `127.0.0.1:62560`; no owner store, owner credentials, personal browser profile, existing services or live providers were used. [Exact commands](commands.md) and preserved drivers describe the boundaries.

## Matched observations

The four stored physical records are `s1 start/out→pick/in [220]`, first `e1 pick/yes→done/in [500,200,650]`, second `e1 pick/no→other/in [670]`, and neighbor `m1 pick/maybe→done/in [550,440,700]`. Brackets are exact manual-route coordinates. Unique controls give the second record ID `e2`.

| Case family                                                                       | Store | Actual browser | Result                                                                                                               |
| --------------------------------------------------------------------------------- | ----: | -------------: | -------------------------------------------------------------------------------------------------------------------- |
| Fresh shared IDs: second `no→yes→affirm`, collide then remove, direct `no→affirm` |   3/3 |            3/3 | Only intended second record changes/removes; first and neighbors retain full geometry                                |
| Same journeys with unique IDs                                                     |   3/3 |            3/3 | Same intended behavior                                                                                               |
| Preexisting collision without metadata: repair/remove, then first-row rename      |   2/2 |    Not claimed | Controlled store only                                                                                                |
| Exact captured older device map: repair/remove, then first-row rename             |   2/2 |            2/2 | Ambiguous second-row operation leaves every edge intact; later first `yes→accepted` changes only actual first record |

[Fresh raw summaries](records/summary.json), [store raw records](records/store-journey.json), [ambiguity store records](records/ambiguity-store.json), and [captured-device comparison](records/device-summary.json) retain full definitions, ordered edge records, targets, source ports, geometry and maps.

Fresh removal reviews correctly named `Connection no → other (e1/e2)`; Cancel preserved the full definition and positively present map, and Confirm removed exactly that record. With the restored contested map, the second row had no eligible connection removal, so normal removal applied without a connection-removal preview and retained all four records. This observes safe refusal of ambiguous **connection ownership**, not refusal to edit the route config or a warning toast.

Both captured-device cases used the exact prior-live input bytes, SHA-256 `40fd7ee7b96e0f5f78f50442ece0f1230d489c93d8be1747019c87531dd63974`. The explicit fixture boundary wrote the captured definition/map into the maintained current-format IndexedDB draft while outside the mounted editor, with only the new disposable loop name/ID, current save time and real current server base substituted. Subsequent document load, restored notice, form typing/removal, toolbar Undo/Redo, offline device reload, save and server reload were actual unmodified app behavior. The persisted old map was positively present and exact before editing.

**54 positively present, nonempty, shape-checked device-map samples** were retained: 36 fresh and 18 restored. The first persisted old-map receipt contains contested claims. The editor sanitizes its loaded map; initial Undo restores that sanitized map with both contested claims cleared, not the old persisted claims. The raw definition comparison and sanitized-map comparison are explicit. Later Undo/Redo and offline recovery compare actual full definitions and present maps exactly. A synced copy omitting metadata is never counted as map evidence.

## First failures, validation and chronology

Fresh `shared-rename` and `shared-remove` retained their original **30000 ms** “All changes saved” wait timeouts after offline reload/reconnect: first-attempt completion is **4/6**, not 6/6. Both displayed the device/server conflict. The guarded continuations observed structurally identical full server/device definitions, then clicked actual **Use this device's copy instead** and verified save plus server reload. No route edit was repeated. See the original `*-browser.json`, timeout snapshots and separate `*-continuation.json` records. Both captured-device first attempts completed without this timeout.

Six proper-body `POST /loops/{id}/validate` requests returned HTTP 200: three shared-ID controls were unpublishable with `DUPLICATE_EDGE_ID`; three unique controls were publishable without issues. A server-authored already-collided route definition was refused HTTP 400 `VALIDATION_FAILED`; no bypass was used. Thus the no-metadata already-collided server scenario remains store-only. Earlier baseline null-body validation receipts remain schema errors and do not establish duplicate-ID validation; the separate earlier erratum stands.

Broken source `95c759b` had two fresh ownership failures. Held `f17cddc` corrected the six fresh controls but retained both captured-device failures. Final `6acf37` passes those same fresh and captured-device checks plus the later explicit-edit discriminator. Intermediate `603e715` had a successful build only; it was paused before API/store/browser behavior execution and receives no behavior credit. An external helper patch-format attempt was rejected before mutation or behavior execution, then corrected before testing; there was no product failure at that step.

## Replay, cleanup and limits

[Read-only independent replay](verify-records.mjs) passed **45/45** record assertions; [raw replay result](records/independent-replay.json). Previous baseline and f17 seals rechecked **69/69** and **83/83** entries with zero drift. Their original evidence and reports were not rewritten.

Owned credential revocation returned 204, subsequent use returned 401, and an exact-value token scan found zero retained hits. Browser closed; API exited; both owned process IDs were absent; TCP port 62560 returned `ECONNREFUSED`. [Cleanup](records/credential-cleanup.json) and [final source/runtime verification](records/final-verification.json) retain these observations. No product edits, staging, commits, pushes, owner-data changes or publication were performed.

This covers foreground Chromium interactions and controlled offline document reload, not OS cold startup, all browser engines, screen readers, owner-store repair, live providers or guaranteed automatic reconnect. Invalid shared IDs can still cause ambiguous canvas rendering; stored-record/API/device comparisons establish exact geometry, and screenshots establish form/review interactions. Publication rebinding to the coordinator's later documentation-only child is separate from this tested source identity.

Useful interaction images: [fresh correct removal review](records/shared-remove-review.png), [ambiguous removal safely leaves only config rows](records/prior-map-remove-review.png), [later first-row edit](records/prior-map-repair-later-edit.png). These were visually inspected and contain no authentication fields or personal browser UI.
