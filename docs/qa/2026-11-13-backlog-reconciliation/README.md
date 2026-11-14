# Backlog reconciliation — 2026-11-13

Baseline: `b3b5e1874a8252cc01c065d18fef42cbfbe075b4`. This is issue-state reconciliation, not a new product acceptance run. Fresh GitHub issue/PR data, comments, native hierarchy, current source, existing CI and carried QA evidence informed each disposition. The [dispatch record](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/279#issuecomment-6872558885) preserves scope and gates.

## Results

| Check                                    | Result                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Initial open inventory                   | 158 issues                                                                |
| Obsolete retirement closures             | 15, each with accepted-cutover and removal evidence                       |
| Already-fixed closures                   | #134 installed package faults; #400 browser assertions                    |
| Native duplicate consolidation           | #414 into #381, after canonical acceptance text was written and read back |
| Remaining open inventory                 | 140 issues                                                                |
| Delivered owner-open records             | All 17 retained OPEN and parked from repeat implementation                |
| Non-epics without gate or parking marker | 0 after reconciliation                                                    |
| I08 native membership                    | Exactly 12 bolts under its three existing UoWs; relationships preserved   |
| Protected records and separate #460      | No requested mutation                                                     |
| Agent-applied plan-approved labels       | None                                                                      |

The [raw mutation readbacks](readbacks.json) record 74 issue state/label results. They preserve observed returned values, including 18 closures and 56 issues left open. The independent #279 scoped authorization is a comment and is not counted as an issue-state mutation. Final #276/#325 comments also record the owner cold launches observed in the separate #460 workflow. A failed connector argument validation and a null-label decoding error were corrected before their affected updates; neither was treated as a successful write.

SHA-256 of the raw readback file: `f670136acc238a169885d87d3e8545e92fd9f59ce69087f75fd1f7ccd15e18ce`. Keep its bytes unchanged.

## Evidence and limits

- Retirement authority: [accepted #280 cutover](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/280#issuecomment-6252218213), merged #338 and the removed configured-template authority/support services. Current catalog, ordinary loop and run paths were checked for surviving equivalents. Each closed issue carries its individual mapping; closure does not claim a new implementation.
- #134's surviving behavior is covered in `apps/api/src/plugins/errors.ts` and `apps/api/src/routes/templates.test.ts`: trusted installed-package failures yield sanitized 503 errors for listing, item read and draft creation, while unknown IDs retain 404. Historical PR #130 reports were checked against those current cases; the report was closed as completed, not merely obsolete.
- #400's assertions were corrected in merged #351: current `apps/web/e2e/qa.spec.ts` and `issue-7-qa.spec.ts` use `HARNESS_DELIVERY_UNCERTAIN`, and the event count derives from the completed run. The existing green Browser evidence covers the assertions; this reconciliation did not rerun that suite.
- #381 explicitly retains #414's persisted failure, public REST/MCP stack/path and internal-log criteria. Native duplicate closure records consolidation only; the defect remains queued for implementation under #381.
- The [I01–I07 reconciliation](../../delivery/2026-10-27-i01-i07-reconciliation.md) remains the historical engineering record. Its owner obligations and partially unrerun integrated evidence are not rewritten into completion.
- PR #454 addresses one #421 shutdown path, while a stopped-response wording/assertion discrepancy remains. #453's added diagnostics do not establish the original intermittent measurement cause. Both remain open.
- PR #460 records owner desktop/taskbar cold launches on its installed candidate. It is still separate and explicitly owner-held for merge at reconciliation. Those observations do not close all launcher acceptance obligations.

No product source, owner application, store, credentials or protected issue relationship was changed by this reconciliation. The new delivery register records the subsequent authorized implementation work separately.
