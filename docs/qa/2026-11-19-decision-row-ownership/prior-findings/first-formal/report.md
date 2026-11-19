# PR #514 first formal adversarial review

**CHANGES REQUIRED.** One reproducible ownership defect can retarget or delete a different Decision route's connection. The maintained tests and retained evidence pass their bounded cases, but do not cover this transition.

## Review identity and scope

- Review: fresh independent first formal scan, scan 1 of the three-scan budget, of the Claude-authored editor change for [#481](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/481). The linked [#519](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/519) test adjustment and evidence were examined as collateral; its required independent Claude review remains separate.
- Exact head: `95c759b7b7d466b1e4c0b9e7a36389d55b96eb6b`.
- Intended target: `10cdc55a8573e484ceb07a32fba9fe9f513a005f`.
- Head tree: `56620c63865e53d338e461a1aef52b95f7591dfb`.
- Tested merge identified by the supplied current CI receipt: `8adf8370b4d47672677b98a390d01a1aff8a04fd`, with the same tree.
- Personally checked the isolated checkout's head, tree and clean status before and after the review. Read live PR metadata and both issue acceptance contracts through the GitHub connector; the PR still matched this head and target and was open, draft and unmerged.
- Read `docs/README.md`, `AGENTS.md`, the implementation-plan context, `docs/15-issue-workflow.md`, the five-intent register and both requested review-policy references. Inspected the complete non-QA source/test/documentation diff and the three evidence READMEs, then selected raw records, verification scripts, source bindings, manifests and screenshots.

The accepted invariant at issue is that a Decision row must never rewrite or prune a different stored record merely because its edge ID matches. Incomplete or ambiguous authoring must preserve records; unique-ID editing, history, device/save ownership, current-format draft admission and duplicate-ID publication refusal must remain intact.

## Blocking finding

### P1 — A temporary duplicate route ID transfers ownership to another row's edge

Root-cause signature: `decision-route-ownership/colliding-previous-row-id-selects-other-record`.

Primary location: [`apps/web/src/editor/decision-route-edges.ts:46–47`](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/95c759b7b7d466b1e4c0b9e7a36389d55b96eb6b/apps/web/src/editor/decision-route-edges.ts#L46-L47). The new `ownedRecord` fallback treats a sole holder on the supplied port as the row's record, without establishing that the previous row ID uniquely identified this row. Callers supply the row's current/previous authored ID at lines 66, 250 and 269–273. During an invalid duplicate-ID edit, that ID can identify the other row's connection instead.

Concrete trigger, independently reproduced against this exact head through the production store methods:

1. Load a Decision with routes `yes`, `no`, `maybe`. Give `pick/yes → done` and `pick/no → other` the same edge ID `e1`, with different manual routes. This is the within-one-Decision case covered by #481.
2. Edit the **second** route ID from `no` to `yes`. Both edges remain unchanged, while the two row entries now both contain `id: yes` and `edgeIds: [e1]`.
3. Edit that same second route from `yes` to `affirm`. The unchanged first row's `pick/yes → done` edge becomes `pick/affirm → done`. The intended second row's original `pick/no → other` stays on `no`.
4. Alternatively, after step 2, remove the second row. `rowConnections(..., 1)` returns the **first** row's `yes → done` edge, and the normal store removal deletes that record and its manual route. The original second row's `no → other` record survives orphaned.

The removal review therefore lists the wrong record for this row. It is consistent with the wrong mutation, which does not make that mutation safe. Both symptoms come from the same ownership resolver and constitute one finding.

Evidence: [controlled reproduction](ownership-probe-run2.json), [six-case control results](ownership-controls.json), and [reviewer-owned driver](ownership-controls.mts). The driver exercises `load`, `updateNode`, `rowConnections` and `undo`; it changes only synthetic in-memory state. Direct rename without the collision preserves the other record. Repeating the same three journeys with unique edge IDs preserves the other record and correctly changes/removes the intended record. Undo restores the original definitions. These controls isolate the shared-edge-ID plus colliding-row-ID transition.

Impact and admission: this is a reachable wrong-record rewrite and deletion inside #481's explicit ownership-preservation contract. The previous implementation already had the broader shared-ID defect; the new selective-record resolver still misidentifies a different record during ambiguity. This is an incomplete resolution of the defect being delivered, not a request to fix adjacent invalid-input behavior. Existing passing coverage of an ID left blank does not establish safety after an ID collides with another valid row. The current regression suite lacks this combination.

Minimum required outcome: a row's temporary duplicate/invalid ID must never establish ownership of another row's stored record. Preserve all ambiguous holders when identity is no longer provable, or retain sufficient unambiguous ownership to act on the intended record. Apply the same rule to port rewrites, removals and their preview. Add failing regression cases for both transitions above, retain unique-ID and direct-rename controls, and verify exact endpoints/manual geometry and history. No broader redesign, format converter or silent migration is requested.

This finding is supported by direct store behavior and source inspection. I did **not** run its exact trigger through a new native browser journey or observe it autosaving to a server in this review.

## Personal checks and results

All executable checks used the project-scoped **Node v22.23.4** and **pnpm 12.8.1**, through `pnpm.cmd`, with the repository's normal configured deadlines and worker settings.

- `pnpm.cmd --filter @graphgoblin/web test src/editor/store.shared-edge-ids.test.ts src/editor/store.test.ts src/editor/EditorPage.shared-edge-ids.test.tsx src/editor/Canvas.test.tsx src/editor/OrthogonalEdge.test.tsx src/editor/chat-protection.test.ts src/chat/ChatSurface.test.tsx`: **7 files, 259 tests passed**, including the full 57-case ChatSurface file. [Receipt](focused-tests.txt)
- `pnpm.cmd --filter @graphgoblin/web test src/editor/store.decision-routes.test.ts`: **20 tests passed**. This includes existing incomplete/duplicate route-ID controls with ordinary edge IDs. [Receipt](decision-tests.txt)
- Independent synthetic ownership driver through `pnpm.cmd --filter @graphgoblin/web exec tsx`: **six controls completed**, confirming the two wrong-record outcomes above and the four preservation controls. This is direct product-store evidence, not a maintained-suite failure. The first exploratory runner invocation failed before product execution because a Windows import needed a `file:` URL; its original output remains in `ownership-probe.json`. The corrected invocation and controls are separate files.
- Independent byte/record verifier through `pnpm.cmd exec node`: **19 checks passed**. Rehashed all **97** listed publication files across the three packets, verified all **16** corrected source-file hashes against this checkout, positively required nine own nonempty unsynced ownership tables, and directly compared history, Cancel, offline reload, refused actions and protected-voice history definitions. [Driver](evidence-check.mjs) · [Result](evidence-check.json)
- Focus-diagnosis read-only replay: **22/22 recorded checks passed**. [Result](focus-replay.json)
- Browser publication read-only verification: **18 retained files**, nine upstream files, ten selected originals, 18 repository links and **12 recorded behavior facts** verified. This starts no browser and provides no new browser behavior run. [Result](browser-publication-replay.json)

No tracked files, Git refs, owner application state, credentials or provider configuration were changed. No additional agents were started, and nothing was published or merged.

## Evidence assessment

The shared-edge packet binds the corrected source and tests byte-for-byte to the reviewed checkout. It supports the tested unrelated edits, identifiable row rename/removal, unique controls, manual geometry, history, safe redraw, conditional full-draft API repair and server publication. The cold-pointer screenshot visibly presents the explanation before an action. Raw interaction records and maintained component/browser assertions support focusable `aria-disabled` controls, associated descriptions, inert activations and Escape behavior. Protected staged Chat voice removal remains refused; unique protected-edge Reset and Undo/Redo retain the rest of the draft.

The publication preserves meaningful limits: the original baseline corruption, author worker-start failures and failed intermediate browser checks remain recorded; pre-guidance full local coverage is identified as historical. All nine earlier synced per-form records lacked `decisionRoutes`, so their equality is not row-map preservation evidence. The corrected nine unsynced samples contain real maps, which I checked independently. The first reconnect wait really missed 15,000 ms and initially read an old server/unsynced device; a later same-journey readback matched the recovered definition and was synced. This establishes eventual recovery in that case, not a latency guarantee. The new collision trigger above is absent from those bounded cases.

I personally read the original hosted [Coverage failure](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44454474852/job/135326032191): the expected focused element was **Try again**, the received focused element was `textarea#chat-message`, and the failure pointed at the former immediate assertion at line 651. A selected excerpt is retained in [hosted-focus-failure.txt](hosted-focus-failure.txt). That run supplies no effect trace. The controlled chronology, same-element positive wait and focus-suppression negative control support the test-only change; the five-second async and 20-second test deadlines are unchanged. The concurrent broad Windows trials were stopped incomplete after unrelated rename timeouts and are not coverage acceptance.

The additional browser packet exercises a different, honestly identified real-recorder path: suppressing one worklet stop request reaches the unchanged three-second finalization deadline, focuses **Record again**, and allows Enter/Escape recovery without upload or provider starts. Its `Try again` count is zero. I inspected its raw observations, boundary identity and failure screenshot and replayed its recorded facts. It does not prove native-browser **Try again**, the hosted callback chronology, OS/window focus behavior, genuine background-tab behavior, transcription or real-provider execution. The mocked rejected-freeze fixture and real recorder timeout have not been substituted for each other.

## CI and remaining gates

The supplied current receipts identify normal CI run `44462676059` and routing run `44462676095` at the exact reviewed head/target. They record all six normal jobs successful, **9,859 unit passes**, 49 skips, **487 browser passes**, **25 native Windows cases**, all 13 coverage summaries above the required line/branch thresholds, and canonical replay of **234** Windows records. Current routing median p95 is approximately **4.3 ms at 100 nodes** and **4.2 ms at 300 nodes** under ordinary PR thresholds. I inspected these verified receipts; I did not independently download and replay those current hosted archives or rerun full coverage/build/browser/launcher/routing suites. Source-only CI run `44450102187`, the red first-publication run and the current run remain distinct.

There are no additional admitted P2/P3 follow-ups from this scan. The one ownership blocker needs an in-scope correction and appropriate regression/affected checks before the remaining review/audit gates. This first formal review does not authorize merge, and neither agent QA nor CI completes any separate owner acceptance obligation.

CHANGES REQUIRED
