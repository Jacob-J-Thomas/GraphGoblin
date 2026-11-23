I've made the fixes for B1, B2, C1, C2, C3 and F2 in 7 of the 15 allowed files and added 14 regression cases. I haven't run anything: no tests, typecheck, lint or formatting. None of this is verified until you run the checks. I didn't touch the three provenance-core files, any existing test or assertion, or the #562/#561 items.

## What changed, by finding

**B1 – an observation-only outage now permanently spends a queued fresh-session choice** (`RunInspectorPage.tsx`)
- The Start-fresh-session gate now records the observation boundary current when it was issued. If the observation read records a later loss, `open()` refuses. That loss stays recorded after the read recovers, so a choice queued before it stays spent even after an equal-body reread.
- The run-wide gate, the run/browser outage checks and the run/node/visit/failure mismatch check in `SessionRecoveryControls` are unchanged. Other run controls are unaffected.
- Test: a page-level case using the real gate. The choice is held in `MutationCache.onMutate`, then the observation read alone fails while run, browser and other controls stay healthy. It is reread with an equal body, and the test asserts the cached object is unchanged (structural sharing). Releasing the held choice shows **Not sent** with no POST. A new choice then sends exactly once with `{nodeId:'worker', failureSeq: 3}`, not the later audit's sequence.

**B2 – a command already sent keeps its identity and outcome**
- `HistoryEligibility.tsx`: while a sent confirmation's review still exists (open, or expired by an outage), both launchers are disabled and `begin()` refuses. A sent confirmation now always reports its result. It shows in the dialog only while that same review is still open and current; otherwise it shows beside the controls, instead of the old early return that silently dropped it.
- `ScriptRecovery.tsx`: the Recover script launcher is disabled while a retry is queued or sent, and its handler refuses. It therefore never calls `action.reset()` on an unresolved retry, and `send` refuses duplicates.
- Tests:
  - Deletion (late transport failure, and success): confirm and hold the POST, lose the connection, reconnect. The launchers are disabled and clicking them opens nothing. When the request settles, the uncertainty or success text appears, and there is still one POST and one preview.
  - A pending confirmation the browser dismissed now reports its failure.
  - Script recovery on the page (late transport failure, and success): one held Resume, outage, recovery. Recover script is disabled and clicking it opens nothing. The failure stays visible in the header, or the original success completes, and there is exactly one POST throughout.

**C1 – a run's own outage stays with that run** (`RunInspectorPage.tsx`)
- The remembered boundary is now stored with the run it belongs to. Another run starts from its own receipts. The browser loss is still applied to every run, and a same-run loss still survives credential or source changes. No new reads and no global map.
- Test with three variants (no outage, only A's run read lost, browser lost), returning to B with B's read held and a healthy `/healthz` handler. B is only marked last observed and locked in the browser variant.

**C2 – qualified cancellation facts are kept without the definition** (`RunInspectorPage.tsx`)
- The execution context now stays during an outage. It gets no definition, so nodes show their recorded IDs, and it is never shown as "loading" then.
- A cancelled run with no qualified observation during an outage now says the record could not be read, instead of "Reading…". `ExecutionEvidence` itself is unchanged.
- Test with three variants (qualified, foreign, manually replaced observation) after a run-only loss. Only the qualified one shows the actor and the #3/#4 sequence numbers. In the manual case, later observation reads are held so an automatic reread can't re-qualify the data.

**C3 – the selected exit keeps its own explanation** (`RunInspectorPage.tsx`)
- The selected-event explanation now uses the same already-loaded observation, thread and version as before #416. Only the run section's copy is hidden during an outage.
- Test covers both Returns None and the expression (ambiguous missing-value) case through a run-only loss.

**F2 – documentation** (`docs/09-frontend-and-pwa.md`, `CHANGELOG.md`)
- A schema-invalid successful GET retires the fallback proof but leaves the ordinary query result and body unchanged.
- A later transport failure's offline error can replace an earlier HTTP message, while the fallback stays unavailable.
- Both files also describe the corrected behaviour above.

## Unaddressed concerns
1. **Deletion dismissal still allows a new review.** The hold releases once the browser dismisses the review. Keeping the existing test "keeps a newer review intact when a dismissed pending save returns HTTP %i" passing required this. The dismissed confirmation's outcome is now reported (a polite live region, not an alert) rather than dropped. This is my judgement call where the brief's wording and that test conflict.
2. **Outage wording in the execution context.** The existing text reads "Pinned definition unavailable. Authored node and route labels are not recorded in the available history." Its second sentence was written for a version that genuinely can't be read, which isn't quite this case.
3. **Script failure wording.** A lost script-retry response still shows the generic "The GraphGoblin API cannot be reached.", with no "may have run" wording.
4. **Focus after script success.** The launcher may still be disabled when the dialog closes on success, so focus may not return to it. `RunControls` already behaves this way.
5. **Run-scoped boundary memory.** It keeps only one run. Going A → B → A across a credential change forgets A's remembered loss in the page component, as the bounded design allows.
6. **Timing assumptions are unverified.** These include the order of the dialog close event and the follower/live-refresh rereads.

This is not a claim of whole-feature acceptance, merge readiness or independent QA. Browser geometry/listener acceptance and the frozen full61 overlay are still open.