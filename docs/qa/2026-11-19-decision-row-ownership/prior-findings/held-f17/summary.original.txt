# Independent f17 behavior summary

**HOLD.** Frozen source f17cddc1fca104679a2a8813ce10d2e01962be79, tree16e5778813e2d220f108a1ed2b3d9ef26c298dab, fixes the six ordinary ownership journeys, but actual restored-device metadata still permits changing or deleting another route's stored record.

| Evidence | Result |
| --- | --- |
| Fresh valid-state store controls | 6/6 preserve intended ownership; all history round trips exact. |
| Matched normal browser controls | 6/6 preserve intended ownership, manual geometry, native Undo/Redo and final public saved/reloaded definitions. Shared removal now reviews no → other (e1). |
| Exact captured device metadata: repair | Normal reopening restores both rows claiming yes/e1. Editing the second ID to affirm rewrites first yes → Done [500,200,650], leaving intended no → Other [670] unchanged. |
| Exact captured device metadata: removal | Actual review lists yes → done (e1), then removes that first record. The intended second record survives. Native history and normal server save/reload retain the observed wrong result. |
| Preexisting collided server definition | Actual POST returns400 VALIDATION_FAILED. No server/browser case or schema bypass was fabricated. Controlled load without metadata leaves edges unchanged; that is a separate store-only observation. |
| Unmodified observed current main | Exact main10cdc55a emits both rows id=yes with edgeIds=[e1,e1], rather than the earlier PR's deduplicated[e1]. The ambiguous ownership relationship is empirically present; no main browser/device persistence claim is made. |

The restoration fixture wrote the exact actual earlier device map and collided definition through IndexedDB while outside a mounted editor, rebinding only fresh loop name/id/base bookkeeping. Subsequent reopening, form editing, review, Undo/Redo, autosave and reload used the unmodified built candidate. Both unsafe native cases have positively observed maps and exact history/server round trips. Source/input hashes and complete phases are retained in candidate-f17cddc and replay-inputs.

The eight frozen source files matched before/after testing; supported build12/12. A fresh authenticated API/store/browser used owned port54082. No owner data, production/source changes, provider activity, staging, commits or PR writes occurred. Credentials were revoked204, then refused401; exact scanning found no retained credential. Browser/API closed; checkout stayed clean.

First waits remain qualified: the fresh shared-rename's30-second saved-state wait encountered a same-definition device conflict. The actual visible device-copy recovery, guarded by exact observed server/device equality, completed it without repeating route edits. This is foreground in-app reload evidence, not OS cold start, universal reconnect behavior or owner acceptance.

The earlier baseline API-validation claim is retracted by erratum-2026-11-19-validation.md: its six null-body validation requests returned400 schema errors. A separate correct-body f17 comparison returned200/DUPLICATE_EDGE_ID for shared IDs and200/publishable for unique IDs. No result is retroactively assigned to95c759b7.

This is independent empirical behavior QA, not formal review. Candidate f17 remains held. Awaiting the coordinator's next immutable source; no additional exploratory variants will be run.
