I've made the B1 fix and added a regression for it, but nothing has been run: no tests, typecheck, lint or formatting. Everything below comes from reading the source.

**Changed files** (only the four allowed; the provenance files `queries.ts`, `inspector-read-provenance.ts` and its test were read but not edited):
1. `apps/web/src/runs/RunInspectorPage.tsx`
2. `apps/web/src/runs/RunInspectorPage.offline.test.tsx`
3. `docs/09-frontend-and-pwa.md`
4. `CHANGELOG.md`

**Cause.** The Start fresh session gate was only checked against its receipt. After an observation-only loss, removing the observation query or switching credentials gives the receipt a fresh start with no loss recorded. The rebuilt gate then has the same settings as the original one, so the old queued choice passed every check and sent its POST. The parent gate wasn't replaced at all in this sequence, because the run read and the browser stayed healthy.

**Fix in `RunInspectorPage.tsx`.** This follows your recommendation and copies how the parent gate already works:
- A new ref, `latestSessionGate`, holds the current session gate. A separate layout effect sets it whenever `sessionGate` changes and clears it on cleanup and unmount. It only ever holds one gate, so no history builds up.
- Each session gate's `open()` now also fails if it is no longer `latestSessionGate.current`. The existing checks (evidence blocked, `gate.open()`, `read.loss > since`, `committed > since`) are all kept.
- Once a loss has been shown, the gate in use is replaced and the old one can never open again. Before that render commits, the old gate still exists but the receipt check (`read.loss > since`) refuses it.
- One stricter outcome: any visible change to the gate (boundary or freshness) now permanently retires choices queued before it. The parent gate already behaves this way. I found no existing test that queues a session choice across such a change and expects it to send.

**Regression.** It's a two-case `it.each` named "keeps a fresh-session choice queued before a shown observation-only loss spent once its receipt is %s". It sits before the first test that takes the browser offline, because a browser disconnect stays recorded for the rest of the file; a comment says so. No private state is reset. Each case runs the same schedule on a failed missing-session run:
1. Wait until Start fresh session is enabled, then queue a choice that the mutation cache's `onMutate` holds before any HTTP request.
2. Make only the observation GET throw `TypeError`. The test requires the visible "Run evidence could not be read: …" alert and "Reading the run evidence again.". It also requires no "Last observed" notice, Replay and Review delete-ready history still enabled, the run query still successful, and the browser still online.
3. Replace the receipt:
   - **Removed and read again:** `removeQueries` on the observation only. The mounted view rebuilds it; the test requires a different query object, success, and idle.
   - **Another accepted API key:** a key is saved before mount, then a synthetic `storage` event carries a second key. The real API key panel that App mounts does the re-reading; there is no manual invalidation or direct save of the second key. The test requires the last run GET and the last observation GET to carry the second key, with the same query object.
4. Both cases then require more observation GETs than before, an equal body, and the error and "Reading…" text gone.
5. Release the queued choice: the test requires the **Not sent** message and zero recover-session POSTs.
6. Positive control: a new deliberate click sends exactly one POST with `{ nodeId: 'worker', failureSeq: 3 }`, and exactly one POST in total.

Reasoning through the old code, both cases would send a POST at step 5 and the test would fail on the missing **Not sent** message. The existing observation-only test should still pass with the fix.

**Docs and CHANGELOG.** The docs clarification is narrow: the session gate is replaced when its boundary or freshness changes, and once a loss has been shown an earlier queued choice stays **Not sent**, including after query removal or a key change. The CHANGELOG #416 entry gets a matching clause.

**Limits:**
- These are component tests in jsdom against the fake API: not a real browser, second tab or real principal.
- The ordering protection assumes Vitest runs tests in file order. I couldn't read the Vitest config to confirm there's no shuffle.
- Re-render after the query removal relies on the view's own subscription; nothing forces it in the test.
- Prettier wouldn't wrap the new test title, which is over 100 characters. Existing titles in the file already are.

**Unresolved, not addressed:**
- **#562-adjacent gap:** right after a credential change, before the re-reads arrive, a new choice could be made against the old body. That sits with #562 and I haven't claimed or fixed it.
- #561 is untouched.
- Timeline, layout and other paths are untouched.
- Still needed: your checks, the opposing audit, independent QA, CI and coverage, and the signed merge.