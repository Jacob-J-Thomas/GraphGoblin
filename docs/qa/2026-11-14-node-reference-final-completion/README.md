# PR #474 final completion and CI evidence

This packet records the final PR #474 CI, capped disposition, merge readback, and #273 owner-acceptance status. It preserves the five exact CI logs and their JSON transports, plus source metadata. The CI tested candidate head `b1810e03402cbc5d1bdceac899dbcc40b1ac317e`, tree `8b7cd8d131917ce74da0d8b7a684317477be22ce`. Merge commit `8fadcb0d44ac2caf80ff6279fe4648ce9398afd9` has that same tree and parents `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c` and `b1810e03402cbc5d1bdceac899dbcc40b1ac317e`. Thus the CI is first-pass evidence for the candidate tree; this packet does not claim a separate rerun on the merge commit.

## First-pass gates

All five CI jobs passed on their first attempts: Gates, Template image, Windows launcher, Browser, and Routing performance.

- Coverage completed all **22 tasks**: web **2,546 tests / 207 files**; domain **459 / 29**.
- Browser: **479 passed**, one expected live-provider skip, zero retries.
- Windows launcher: **14/14**.
- Template-image and routing checks passed. Dependency audit passed the configured high-severity threshold with **8 low / 13 moderate** advisories.
- Runs: [CI 43651091055](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43651091055) and [Routing 43651091052](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43651091052).

Exact decoded logs and corresponding JSON transports are retained together under [`raw/current-ci-b181`](raw/current-ci-b181/). Start with the [log manifest](raw/current-ci-b181/log-manifest.json), [final metadata](raw/current-ci-b181/final-metadata.json), and [first job snapshot](raw/current-ci-b181/jobs-first-snapshot.json).

## Capped disposition and merge

The [final capped disposition](raw/final-capped-disposition.md.txt) and [published completion comment](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/474#issuecomment-6885894689) record A1/A2 as source- and native-corrected through the D-035/D-042 completion path. The three formal scans are consumed. The historical third Astra scan remains CHANGES REQUIRED on its old head; this disposition is not a fourth scan, a fresh Astra sign-off, or a waived finding.

The [merge readback](raw/final-merge-readback.json) confirms [PR #474](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/474) merged as [8fadcb0d](https://github.com/Jacob-J-Thomas/GraphGoblin/commit/8fadcb0d44ac2caf80ff6279fe4648ce9398afd9) with the tested candidate tree unchanged.

## Issue and remaining scope

The [owner-acceptance issue readback](raw/owner-acceptance-issue-readback.json) records [#273](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/273) still open and on backlog. Both engineering criteria are checked, but owner acceptance and issue closure remain pending. This packet does not complete other work tranches or final I08 acceptance.

PR #475 still needs its own actual-main integration and resulting verification. Its checks and review status are not established here.

## Preserved packet inventory

- [Copy manifest](copy-manifest.json), [link audit](link-check.json), and [SHA-256 inventory](SHA256SUMS.txt)
- Five first-pass logs and five matching transport files under `raw/current-ci-b181/`
- Exact pre-merge disposition and post-merge/owner readbacks under `raw/`
