# Card deletion ownership: held baseline

**CHANGES REQUIRED.** This is the source-bound baseline from the third and final independent audit of #514. In two ordinary editor journeys, deleting Done changes an unrelated surviving connection from `pick/no → other [670]` to `pick/yes → other [670]`. The server and synced device save that wrong port. Undo restores the full definition; Redo and reload retain the wrong connection. This capsule records the failure and controls. It contains no correction or correction-pass claim.

[Published final review](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/514#issuecomment-7029317929) · [Published triage](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/514#issuecomment-7029326319) · [Untouched original report](report.original.txt) · [Selection and byte manifest](publication-manifest.json)

## Immutable source and verdict

| Identity                 | Recorded value                                                     |
| ------------------------ | ------------------------------------------------------------------ |
| Reviewed head            | `afc96e2350daa6ff8d3b6d733150218e3675a2aa`                         |
| Target main / merge base | `491f089a0922557f8884629e953546c0187be63a`                         |
| Head and tested tree     | `8d97749cea46adbede42bceef99589c9a4f87e0c`                         |
| Hosted test merge        | `0c1ab94605948d3b5490c8140e7e7fb7bc5b3cef`                         |
| Served web asset SHA-256 | `c70c88d602c5fa1cc2ef009bcd5b0cd986c255f9dce766d61593579c540229ee` |
| Original report SHA-256  | `108fdc3b3000eb0899b7a07bb4032ab73a7a326ba262d2c3b3430c7c0e5dfe35` |

The genuine terminal verdict is **CHANGES REQUIRED**, with one newly admitted P1 on #481. The original audit observed the PR open and draft and judged #519's bounded Chat correction satisfied. Its green hosted CI and earlier passing controls did not resolve this newly observed deletion failure. Those are observations at the recorded source, not a claim about later PR state.

## Two failure journeys and controls

| Journey                          | Actual observation                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Captured device draft            | Restore the exact retained definition and ownership map while outside a mounted editor. Readback confirms both objects. Reopen normally, change the second route ID from `yes` to `affirm`, then delete Done through the editor. The repair preserves all four edges; deletion removes Done's two incident records but also changes the survivor's port from `no` to `yes`. |
| Fresh map-free shared-ID fixture | Public `POST /loops` admits the fixture with HTTP 201. The second route is already `affirm`; the imported `no → other` record is unclaimed. Normal Delete node causes the same wrong survivor-port change.                                                                                                                                                                  |
| Unique-ID browser control        | The same operation with `e2` on the Other connection preserves every surviving field. The fixture still has a stranded port and is not publishable.                                                                                                                                                                                                                         |
| Production-store controls        | Both failing scenarios reproduce in the original store witness. Unique IDs, shared holders with independently identifiable owners, and an unrelated Description edit preserve their expected records. All exercised Undo/Redo definitions match their observed before/after states.                                                                                         |

The [actual Microsoft Edge comparison](browser-verification.json) records both failure journeys after deletion, Undo, Redo and document reload. Every saved phase reports HTTP 200, **All changes saved**, and equality between the synced device and server. The failing delete/Redo/reload phases differ from the required deletion at exactly `/edges/1/from/port`: `no → yes`. Undo has no difference from the complete expected pre-delete definition. The [saved canvas screenshot](shared-after-redo.png) shows the resulting Yes connection to Other.

The initial restored draft reports **Saved on this device only**; after the ID repair it reports **All changes saved**. See [fixture readback](browser-restored-fixture-readback.json), [before edit](browser-restored-before-edit.json), [after ID repair](browser-restored-after-id-repair.json), and the raw [restored deletion](browser-restored-after-delete.json), [Undo](browser-restored-after-undo.json), [Redo](browser-restored-after-redo.json), and [reload](browser-restored-after-reload.json). The fresh shared journey retains its [deletion](browser-shared-after-delete.json), [Undo](browser-shared-after-undo.json), [Redo](browser-shared-after-redo.json), and [reload](browser-shared-after-reload.json); the [unique deletion](browser-unique-after-delete.json) is the matched control.

## Fixtures, API statuses and original store witnesses

[Shared API fixture](node-delete-shared-fixture.json) · [Unique API fixture](node-delete-unique-fixture.json) · [Original store driver](ownership-challenge.mts) · [Original store result](ownership-challenge.json) · [Earlier-finding control driver](prior-findings-control.mts) · [Eight earlier-finding control results](prior-findings-control.json)

Both API fixtures were admitted with HTTP **201**. Correct-body validation returned **200** with `publishable: false`: shared IDs reported `DUPLICATE_EDGE_ID`, `EDGE_PORT_MISSING`, and `PORT_UNCONNECTED`; the unique control reported the latter two. Each retained admission summary also records an initial `{}` validation request returning **400 VALIDATION_FAILED** because the required definition was missing. These safe status excerpts and the exact source-summary hashes are in the manifest. The token-bearing admission-summary files are omitted.

The drivers read the [existing captured input at the reviewed head](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/afc96e2350daa6ff8d3b6d733150218e3675a2aa/docs/qa/2026-11-19-decision-row-ownership/independent/replay-inputs/prior-live-collision.json), SHA-256 `40fd7ee7b96e0f5f78f50442ece0f1230d489c93d8be1747019c87531dd63974`. That source-bound fixture remains in the supplied checkout; this capsule does not duplicate it. The original drivers take the checkout root as their argument and import the production store from that checkout. They deliberately assert the recorded baseline failures and controls, so they are not correction acceptance tests.

For an intentional witness rerun at the recorded head, use the repository-supported Node 22 and pinned pnpm, then run from the supplied checkout root after the capsule is placed at its documented repository location:

```powershell
$checkout = (Get-Location).Path
$baseline = Join-Path $checkout 'docs/qa/2026-11-20-card-deletion-ownership/baseline'
pnpm.cmd --dir (Join-Path $checkout 'apps/web') exec tsx --conditions=development (Join-Path $baseline 'ownership-challenge.mts') $checkout
pnpm.cmd --dir (Join-Path $checkout 'apps/web') exec tsx --conditions=development (Join-Path $baseline 'prior-findings-control.mts') $checkout
```

## Integrity and limits

All 21 selected original artifacts retain their bytes; only the original report's archive filename changes from `report.md` to `report.original.txt`. Its named companions remain beside it with their original names. The manifest records every copied source name, byte count and hash. The five original CRLF JSON files retain exact bytes through narrow nested attributes; normal Markdown and whitespace checks remain in force. The screenshot was visually checked and contains the disposable app view without an address bar, service address or credential.

Run `node docs/qa/2026-11-20-card-deletion-ownership/baseline/verify-baseline.mjs` from the repository root, or run that script by its full path while the capsule is staged. It verifies the manifest, selected baseline facts and local links without executing the application or drivers. Assembly performed byte selection, privacy review, local formatting and retained-record checks only. No new browser/store behavior, formal review, correction, owner-data exercise, Git index/ref/worktree mutation or publication occurred. Private briefs, Playwright snapshots/logs and token-bearing admission summaries are excluded.
