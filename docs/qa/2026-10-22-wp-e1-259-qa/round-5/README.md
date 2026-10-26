# 1. Verdict

> Files above 1,000,000 bytes (36 in this round) are not kept in the repository; [NOT-KEPT.md](NOT-KEPT.md) records each with its size and SHA-256. Mentions of those names below, and in the JSON result files, refer to that record.

**FAIL** at **314bbcb18e56a0180653d710979913d6afeeb15e**. **QA-259-R4-01 is fixed**, including the exact older-message region reproduction, a focused control in the last-50 window, Show all, outside focus and the list fallback. Two minor issues remain: **QA-259-R5-01**, stale value-level hand-off steals keyboard focus on a cached return; and **QA-259-R5-02**, a new diff preview still enumerates synchronously before cold selection/placeholder paint.

Worktree **codex-qa-wp-e1-259**, detached at the assigned HEAD; comparison base **8984d7f44b1e3f88e9f7ada8388da2f616bad6f2**. Independent QA only. No production or maintained-test edits, commits, index changes, branch switches, stashes, sub-agents, GitHub writes or live provider turns. Only this round-5 directory was added; evidence is **uncommitted; ready for orchestrator commit**. [Diff tested](change.diff.txt), [final state](final-state.json).

# 2. Defects

## QA-259-R5-01 — minor — returning to a cached value reuses an old focus hand-off while the keyboard is outside

Reproduced once at **1440 x 900** and **390 x 844** through a real mutate/wait run:

1. Set Variables to a 20,000-character A marker and wait at ask; a later mutation sets a 21,000-character B marker and waits at notouch.
2. Expand Variables at the current A wait; Shift+Tab into the Variables region.
3. Supply the wait input through HTTP. On live B arrival, the keyboard correctly moves to **Show all of Variables**.
4. Focus seed node.finished in the timeline and press Enter to select A. The keyboard remains on that timeline button.
5. Focus the remembered run.waiting notouch event (B) in the timeline and press Enter.

Expected: the keyboard stays on the timeline button used to select B. Actual at **both widths**: it is moved to **Show all of Variables**, although the keyboard was outside the value component before this selection. The value remains bounded; this is a keyboard-ownership defect, not a return of full-value expansion.

Evidence: [desktop stages](outside-return-1440.json), [narrow stages](outside-return-390.json), [failing focus cases](focus-results.json), [public-API/keyboard script](focus.mjs.txt), [execution log](focus.log.txt). The source retains handoffFor by value identity; the effect runs again when that cached value returns, while blur only clears ownsFocus (apps/web/src/components/ui/bounded-value.tsx:84, :132 and :149). Source reading explains the observation; no component state was inspected or patched.

## QA-259-R5-02 — minor — a newly mounted diff preview bypasses cold-selection deferral

Reproduction at both widths:

1. Admit 350,000 properties through a mutate node and park at a wait.
2. Load the inspector; select run.queued, then select the previously unseen seed node.finished event. This mounts its Patch diff and changes Variables from the empty object to the wide value.
3. Record DOM commits, Chrome Paint events, a source-mapped sampled CPU profile, long tasks and compositor frames.

Expected from the stated cold-selection behavior and docs 09: selection/placeholder paints before wide preview serialization. Actual: a new diff BoundedValue has its first value settled immediately, so its 1,024-character preview enumerates in the urgent render. In the ordinary-viewport follow-up, the first serializer sample precedes even the Variables placeholder DOM commit by **89.4 ms desktop / 73.0 ms narrow**. The first Paint after that commit follows the enumeration, rather than preceding it. The urgent tasks are **500/414 ms**, followed by the separately deferred Variables tasks of **92/77 ms**. All values remain exact and bounded.

Evidence: [ordinary-height paint runs](paint-results.json), [paint assessment](assessment.json), [desktop cold seed trace](paint-seed-1440.trace.json.txt), [desktop CPU profile](paint-seed-1440.cpuprofile.json.txt), [narrow trace](paint-seed-390.trace.json.txt), [narrow CPU profile](paint-seed-390.cpuprofile.json.txt), [script](paint.mjs.txt), [log](paint.log.txt). Frames before the urgent commit still show the queued selection: [desktop](paint-seed-1440-frame-57.png), [narrow](paint-seed-390-frame-60.png). The additional [390 x 3000 confirmation](visible-paint-results.json) has the same ordering. The mounting behavior is in bounded-value.tsx:100 and ThreadViewer.tsx:38.

The existing Variables component **does** pass the ordering check on the cold wait-event path without a newly mounted diff: Paint occurs before deferred serializer sampling. That path still pays **375–380 ms** of replay/reconstruction before the urgent commit in ordinary-height runs. This finding is limited to the new diff preview; it does not claim every deferred render fails to paint.

# 3. Coverage of criteria

## Environment, isolation and retention

- Node **v22.14.0** first on PATH; dependencies installed; pnpm build passed before the built API/web app was served.
- Installed Microsoft Edge **155.0.4283.62**, headless Playwright. Normal viewports **1440 x 900 / 390 x 844**. Primary wide traces use **3000 px height** at each required width to expose more content. Separate full-resolution paint runs use normal heights; an additional **390 x 3000** run puts the narrow Variables area on screen. Heights are recorded, and these timings are not presented as a controlled before/after comparison with earlier rounds.
- Disposable API **127.0.0.1:5720**, fake control **127.0.0.1:5721**, system-temp data directory **gg-qa-e1-tdo0uE**. Real HTTP, SQLite, engine, mutate and wait paths. Inference evidence is **fake-only** through FakeHarness/FakeStructured; no live provider or CLI turn. An API-created QA key was minted; only non-secret [metadata](api-key-metadata.json) are retained. [Environment](browser-environment.json), [server](server.mjs.txt), [server log](server.log.txt).
- COMMON, QA-COMMON and the relevant docs/source were read. Owner ports/store were not accessed. The disposable process was stopped, its exec session exited 0, and both ports became unreachable. [Shutdown](shutdown.json), [shutdown log](shutdown.log.txt). Temp stores/helper/output directories remain for the orchestrator; no directories were deleted.
- **All 404 prior report references exist.** **70 round-4 artifacts are untracked** on this assigned HEAD, contrary to the handoff's committed description. They were already untracked at admission and are preserved unchanged. [Prior existence/tracking/hash audit](prior-evidence-audit.json); all prior reference hashes remain equal in [final state](final-state.json).

Touched systems tested: Messages focus ownership, window reset and list fallback; BoundedValue deferred preview, focus hand-off and expansion lifetime; incremental thread cache and untouched Variables identity; replay equivalence and failure behavior; large message/variable presentation, exact downloads, timeline selection and narrow layout; relevant Result/progress/wait regressions. No production changes or new dependencies were made by QA.

## Requested criteria

| Criterion                                                        | Result                                                        | Evidence                                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1: exact QA-259-R4-01 action/data sequence                       | PASS at both widths                                           | all region exact R4 cases: 6,000 messages, m0 content 20,000 characters, expanded region, external append, Show all messages focused |
| 1: focused control slides out of last-50 window                  | PASS at both widths                                           | window control cases use m5950; Tab then reaches Download messages                                                                   |
| 1: Show all and outside keyboard                                 | PASS at both widths                                           | all control, outside Full thread JSON and outside timeline cases                                                                     |
| 1: list fallback when controls disappear                         | PASS at both widths                                           | list takes focus at tabindex -1; Tab reaches Full thread JSON and removes tabindex                                                   |
| 2: first/cached wide selections, exact prefix and long tasks     | MEASURED; exact/bounded data pass; cold diff deferral FAIL    | CPU/paint/long-task tables below                                                                                                     |
| 2: untouched vars live append                                    | PASS within profiling resolution                              | retained exact value, no repeated wide enumeration observed; serializer samples total 0.732/0 ms, unit identity check passes         |
| 2: changed vars live append                                      | PASS for fresh exact preview and expected new serializer work | changed key0 includes a surrogate pair and NUL; sampled serializer work 83.5/58.7 ms                                                 |
| 3: 6,000 messages re-selection and live appends, window/Show all | PASS at both widths                                           | 50 mounted; stored count grows 6000 -> 6002 -> 6004                                                                                  |
| 4: original QA-259-01 A/B/A                                      | PASS at both widths                                           | 2,322,721-character full value returns to a 4,097-character preview                                                                  |
| 4: prior value-level live small focus hand-off                   | PASS, four exact prior cases                                  | [Direct and 500 ms cases](focus-small-repro.json), [log](focus-small.log.txt)                                                        |
| 4: outside keyboard after value-level hand-off and cached return | FAIL at both widths                                           | QA-259-R5-01                                                                                                                         |
| 4: nested Variables and messages download bytes                  | PASS at both widths                                           | raw .json.txt files, integrity validation                                                                                            |
| Incremental replay compared with full API result                 | PASS, four live-completion cases without reload               | [Live replay results](incremental-replay-results.json), [script](incremental-replay.mjs.txt), [log](incremental-replay.log.txt)      |

## Every core case

Exact steps are in [performance script](performance.mjs.txt) and [browser measurement support](browser-support.mjs.txt). Fixtures are created through the public API; [fixture generator](fixtures.mjs.txt), [admission values/hashes](fixtures.json), [log](fixtures.log.txt). The API retains 6,000 messages and 350,000 properties. The source-map/CPU tooling observes browser execution through CDP; no cache counters, private state, test-only exports or component monkey-patches were introduced.

| Case                                                                | Expected                                                                                                | Actual                                                                     | Result   | Evidence                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| 1440: wide first seed selection, cached selections, and paint trace | Exact prefix and bounded width; capture actual DOM, paints, filmstrip and sampled serializer work       | exact 4097-character prefix, cold 602.9 ms; cached selections retained     | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 1440: live append leaves vars untouched                             | Retained preview, no repeated serializer enumeration; full stored value unchanged                       | 5424.4 ms; 7 long tasks; 350000 keys/messages                              | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 1440: live append changes vars                                      | One changed-value enumeration expected; exact new prefix and actual placeholder-paint ordering retained | 5694.7 ms; 7 long tasks; 350000 keys/messages                              | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 1440: cold earlier wait without a new diff component                | Independent cold-selection paint trace for an existing Variables component, with no new diff layout     | 387.0 ms; 2 long tasks; 0 keys/messages                                    | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 1440: full incremental thread equals live API                       | Reconstructed values equal API after untouched and touched vars appends                                 | API values equal; 8529788 download bytes                                   | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 1440: 6000-message re-selection and exact download                  | Latest 50; exact notice; bounded ordinary selections; API-byte-identical messages download              | latest 50 on every selection; 1989782 exact messages-download bytes        | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 1440: message append with window on                                 | Stored message count grows; current window returns to 50; ordinary controls retain focus                | 304.4 ms; 0 long tasks; 6002 keys/messages                                 | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 1440: message append with Show all on                               | Stored message count grows; current window returns to 50; ordinary controls retain focus                | 404.5 ms; 1 long tasks; 6004 keys/messages                                 | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 1440: full message-thread replay equals API                         | All 6004 messages and full replayed values are preserved                                                | API values equal; 2075950 download bytes                                   | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 1440: original A/B/A and strict nested download                     | 2322721-character expansion, bounded return, same exact stored data                                     | 2322721-character full value returns to 4097; 2322734 exact download bytes | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 390: wide first seed selection, cached selections, and paint trace  | Exact prefix and bounded width; capture actual DOM, paints, filmstrip and sampled serializer work       | exact 4097-character prefix, cold 441.0 ms; cached selections retained     | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 390: live append leaves vars untouched                              | Retained preview, no repeated serializer enumeration; full stored value unchanged                       | 4475.8 ms; 7 long tasks; 350000 keys/messages                              | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 390: live append changes vars                                       | One changed-value enumeration expected; exact new prefix and actual placeholder-paint ordering retained | 4802.9 ms; 7 long tasks; 350000 keys/messages                              | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 390: cold earlier wait without a new diff component                 | Independent cold-selection paint trace for an existing Variables component, with no new diff layout     | 424.4 ms; 2 long tasks; 0 keys/messages                                    | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 390: full incremental thread equals live API                        | Reconstructed values equal API after untouched and touched vars appends                                 | API values equal; 8529788 download bytes                                   | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 390: 6000-message re-selection and exact download                   | Latest 50; exact notice; bounded ordinary selections; API-byte-identical messages download              | latest 50 on every selection; 1989782 exact messages-download bytes        | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 390: message append with window on                                  | Stored message count grows; current window returns to 50; ordinary controls retain focus                | 304.4 ms; 0 long tasks; 6002 keys/messages                                 | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 390: message append with Show all on                                | Stored message count grows; current window returns to 50; ordinary controls retain focus                | 367.2 ms; 1 long tasks; 6004 keys/messages                                 | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 390: full message-thread replay equals API                          | All 6004 messages and full replayed values are preserved                                                | API values equal; 2075950 download bytes                                   | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |
| 390: original A/B/A and strict nested download                      | 2322721-character expansion, bounded return, same exact stored data                                     | 2322721-character full value returns to 4097; 2322734 exact download bytes | **PASS** | [Assessed case](assessment.json), [original](performance-results.json) |

## Every message and value-focus case

Common message steps: seed 6,000 valid messages with one older 20,000-character content value; focus its Show all control or expanded region; deliver wait input externally; inspect the new 50-message window and document.activeElement; Tab once and inspect tabindex cleanup. The no-controls case intentionally clears messages through a mutate node. Outside targets are focused without changing the followed event. The exact R4 region case uses Show all messages -> Show all of Message m0 content -> Shift+Tab -> external append.

| Case                                                      | Expected                                                                                             | Actual                                                                                                                                                                                 | Result   | Evidence                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------- |
| 1440: window control                                      | Removed focused message hands to Show all or held list; outside focus unchanged; Tab cleanup correct | BUTTON Show all of Message m5950 content -> BUTTON Show all messages; Tab -> BUTTON Download messages as JSON; list tabindex after Tab null                                            | **PASS** | [Focus case](focus-results.json) |
| 1440: all region exact R4                                 | Removed focused message hands to Show all or held list; outside focus unchanged; Tab cleanup correct | PRE Message m0 content (tabindex 0) -> BUTTON Show all messages; Tab -> BUTTON Download messages as JSON; list tabindex after Tab null                                                 | **PASS** | [Focus case](focus-results.json) |
| 1440: all control                                         | Removed focused message hands to Show all or held list; outside focus unchanged; Tab cleanup correct | BUTTON Show all of Message m0 content -> BUTTON Show all messages; Tab -> BUTTON Download messages as JSON; list tabindex after Tab null                                               | **PASS** | [Focus case](focus-results.json) |
| 1440: outside Full thread JSON                            | Removed focused message hands to Show all or held list; outside focus unchanged; Tab cleanup correct | BUTTON Full thread JSON -> BUTTON Full thread JSON; Tab -> BUTTON Node progress (0 nodes); list tabindex after Tab null                                                                | **PASS** | [Focus case](focus-results.json) |
| 1440: outside timeline                                    | Removed focused message hands to Show all or held list; outside focus unchanged; Tab cleanup correct | BUTTON #6node.finishedseed → out, 1 change, 14 ms -> BUTTON #6node.finishedseed → out, 1 change, 14 ms; Tab -> BUTTON #7node.startedask (wait) attempt 1; list tabindex after Tab null | **PASS** | [Focus case](focus-results.json) |
| 1440: all region to no controls                           | Removed focused message hands to Show all or held list; outside focus unchanged; Tab cleanup correct | PRE Message m0 content (tabindex 0) -> OL Messages (tabindex -1); Tab -> BUTTON Full thread JSON; list tabindex after Tab null                                                         | **PASS** | [Focus case](focus-results.json) |
| 1440: value hand-off followed by outside A/B/A navigation | After a live value hand-off, returning to that cached value must leave the keyboard on the timeline  | returning cached value stole keyboard: {"tag":"BUTTON","label":"Show all of Variables","role":null,"tabindex":null,"text":"Show all"}                                                  | **FAIL** | [Focus case](focus-results.json) |
| 390: window control                                       | Removed focused message hands to Show all or held list; outside focus unchanged; Tab cleanup correct | BUTTON Show all of Message m5950 content -> BUTTON Show all messages; Tab -> BUTTON Download messages as JSON; list tabindex after Tab null                                            | **PASS** | [Focus case](focus-results.json) |
| 390: all region exact R4                                  | Removed focused message hands to Show all or held list; outside focus unchanged; Tab cleanup correct | PRE Message m0 content (tabindex 0) -> BUTTON Show all messages; Tab -> BUTTON Download messages as JSON; list tabindex after Tab null                                                 | **PASS** | [Focus case](focus-results.json) |
| 390: all control                                          | Removed focused message hands to Show all or held list; outside focus unchanged; Tab cleanup correct | BUTTON Show all of Message m0 content -> BUTTON Show all messages; Tab -> BUTTON Download messages as JSON; list tabindex after Tab null                                               | **PASS** | [Focus case](focus-results.json) |
| 390: outside Full thread JSON                             | Removed focused message hands to Show all or held list; outside focus unchanged; Tab cleanup correct | BUTTON Full thread JSON -> BUTTON Full thread JSON; Tab -> BUTTON Node progress (0 nodes); list tabindex after Tab null                                                                | **PASS** | [Focus case](focus-results.json) |
| 390: outside timeline                                     | Removed focused message hands to Show all or held list; outside focus unchanged; Tab cleanup correct | BUTTON #6node.finishedseed → out, 1 change, 11 ms -> BUTTON #6node.finishedseed → out, 1 change, 11 ms; Tab -> BUTTON #7node.startedask (wait) attempt 1; list tabindex after Tab null | **PASS** | [Focus case](focus-results.json) |
| 390: all region to no controls                            | Removed focused message hands to Show all or held list; outside focus unchanged; Tab cleanup correct | PRE Message m0 content (tabindex 0) -> OL Messages (tabindex -1); Tab -> BUTTON Full thread JSON; list tabindex after Tab null                                                         | **PASS** | [Focus case](focus-results.json) |
| 390: value hand-off followed by outside A/B/A navigation  | After a live value hand-off, returning to that cached value must leave the keyboard on the timeline  | returning cached value stole keyboard: {"tag":"BUTTON","label":"Show all of Variables","role":null,"tabindex":null,"text":"Show all"}                                                  | **FAIL** | [Focus case](focus-results.json) |

The four prior Variables focus reproductions pass: direct and 500 ms fake-delayed replacements at both widths hold the small pre at tabindex -1, then Tab reaches Full thread JSON and removes that attribute. [Results](focus-small-repro.json), [script](focus-small-repro.mjs.txt), [log](focus-small.log.txt). New message-window focus fixes do not reopen QA-259-R2-01.

## Measurements and every long task in the primary action windows

Wall time is from the action to two animation frames after the value settles; it includes automation/scheduling overhead and is **not INP**. Long tasks use the browser's **50 ms** definition. Entries are allowed 80 ms for delivery after the measured end. Appends include server execution and waiting for the next wait; they are not continuous browser-block times. Main timings ran after build, fixture and unit/lint/typecheck jobs finished. CDP tracing and 1 ms CPU sampling add overhead; no owner-approved performance threshold is inferred.

| Width | Action                      | Wall ms | Every long-task duration and start (document-relative ms)                                                                  |
| ----- | --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1440  | wide-cold-seed-1440         | 602.9   | 484 ms @ 4896.4; 87 ms @ 5382.8                                                                                            |
| 1440  | queued 0                    | 33.0    | none                                                                                                                       |
| 1440  | cached seed 0               | 34.2    | none                                                                                                                       |
| 1440  | queued 1                    | 32.4    | none                                                                                                                       |
| 1440  | cached seed 1               | 33.6    | none                                                                                                                       |
| 1440  | wide-live-no-vars-1440      | 5424.4  | 142 ms @ 6975.9; 162 ms @ 9209.2; 157 ms @ 10101.2; 182 ms @ 10359.6; 139 ms @ 11512.4; 143 ms @ 11755.4; 136 ms @ 11999.5 |
| 1440  | wide-live-changed-vars-1440 | 5694.7  | 163 ms @ 3780.7; 146 ms @ 5421.2; 147 ms @ 6447.4; 159 ms @ 6699.3; 474 ms @ 8507.9; 83 ms @ 8982.9; 154 ms @ 9100.6       |
| 1440  | wide-cold-wait-1440         | 387.0   | 299 ms @ 11992.7; 66 ms @ 12293.1                                                                                          |
| 1440  | messages queued 0           | 22.6    | none                                                                                                                       |
| 1440  | messages ask 0              | 27.5    | none                                                                                                                       |
| 1440  | messages queued 1           | 17.7    | none                                                                                                                       |
| 1440  | messages ask 1              | 34.5    | none                                                                                                                       |
| 1440  | messages live window        | 304.4   | none                                                                                                                       |
| 1440  | messages live all           | 404.5   | 124 ms @ 1583.7                                                                                                            |
| 1440  | A to B                      | 20.8    | none                                                                                                                       |
| 1440  | B to A                      | 35.7    | none                                                                                                                       |
| 390   | wide-cold-seed-390          | 441.0   | 355 ms @ 3532.6; 64 ms @ 3889.1                                                                                            |
| 390   | queued 0                    | 18.9    | none                                                                                                                       |
| 390   | cached seed 0               | 19.2    | none                                                                                                                       |
| 390   | queued 1                    | 20.0    | none                                                                                                                       |
| 390   | cached seed 1               | 19.2    | none                                                                                                                       |
| 390   | wide-live-no-vars-390       | 4475.8  | 157 ms @ 5173.6; 168 ms @ 7071.5; 134 ms @ 7849.7; 122 ms @ 8099.3; 127 ms @ 8780.5; 130 ms @ 9010.4; 176 ms @ 9242.6      |
| 390   | wide-live-changed-vars-390  | 4802.9  | 122 ms @ 3157.7; 125 ms @ 4792.4; 128 ms @ 5442.0; 135 ms @ 5671.8; 423 ms @ 7106.2; 60 ms @ 7530.3; 143 ms @ 7631.6       |
| 390   | wide-cold-wait-390          | 424.4   | 293 ms @ 10620.1; 109 ms @ 10914.3                                                                                         |
| 390   | messages queued 0           | 17.8    | none                                                                                                                       |
| 390   | messages ask 0              | 26.7    | none                                                                                                                       |
| 390   | messages queued 1           | 19.3    | none                                                                                                                       |
| 390   | messages ask 1              | 27.6    | none                                                                                                                       |
| 390   | messages live window        | 304.4   | none                                                                                                                       |
| 390   | messages live all           | 367.2   | 95 ms @ 1254.3                                                                                                             |
| 390   | A to B                      | 20.4    | none                                                                                                                       |
| 390   | B to A                      | 33.5    | none                                                                                                                       |

The complete per-action trace JSON retains DOM state times, Chrome Paint events, all traced screenshot times and long-task starts/durations. The CPU profiles retain every sample and source-mapped frame. Source map retained with host prefixes redacted (`app-source-map.json.txt`, not kept; see [NOT-KEPT.md](NOT-KEPT.md)), [original/retained hashes and mapping provenance](source-map-provenance.json). The initial integrity check found the source map's host prefix; [initial result](validation-initial.json.txt) and [initial log](validation-initial.log.txt) are retained. [Sanitization](sanitization.json), [script](sanitize-source-map.mjs.txt), [log](sanitization.log.txt) confirm that the mapping table, downloads and profiles were unchanged. Primary Trace Screenshot frames are thumbnails and cap during long appends; their absence after that cap is not evidence of no paint. The separate full-resolution screencasts resolve the cold-selection visibility check. [Paint script](paint.mjs.txt), [paint log](paint.log.txt), [visible narrow setup](prepare-visible-paint.mjs.txt), [visible narrow script](visible-paint.mjs.txt), [log](visible-paint.log.txt).

## Paint ordering, including the failure boundary

Times below share the document-relative clock: Chrome trace marks correlate CPU profile timestamps with DOM observers and Paint events. A DOM mutation alone is not called a paint. Source mapping identifies prettyJsonPrefix and its nested serializer functions (utils.ts:41–147); cachedJsonPrefix is mapped separately. A Paint after the pending commit and before serializer sampling is supported by compositor frames showing the placeholder. The ordinary narrow layout puts Variables below the timeline, so the tall full-resolution capture additionally shows the literal placeholder on screen: [390 px visible placeholder](visible-paint-wait-390-frame-2.png). Desktop: [visible placeholder](paint-wait-1440-frame-65.png).

| Width / height       | Cold event | First serializer sample ms | Placeholder DOM ms | First Paint after placeholder commit ms | Ordering | Evidence                             |
| -------------------- | ---------- | -------------------------- | ------------------ | --------------------------------------- | -------- | ------------------------------------ |
| 1440 / normal height | wait       | 5455.6                     | 5452.4             | 5453.7                                  | PASS     | [Probe](paint-wait-1440.json)        |
| 1440 / normal height | seed       | 4754.5                     | 4843.9             | 4849.0                                  | FAIL     | [Probe](paint-seed-1440.json)        |
| 390 / normal height  | wait       | 5301.6                     | 5298.6             | 5299.7                                  | PASS     | [Probe](paint-wait-390.json)         |
| 390 / normal height  | seed       | 4398.7                     | 4471.7             | 4475.7                                  | FAIL     | [Probe](paint-seed-390.json)         |
| 390 / 3000 height    | wait       | 5294.0                     | 5290.8             | 5292.1                                  | PASS     | [Probe](visible-paint-wait-390.json) |
| 390 / 3000 height    | seed       | 4028.3                     | 4104.2             | 4107.0                                  | FAIL     | [Probe](visible-paint-seed-390.json) |

For the changed-vars live traces, pending DOM appears before sampled serializer work, but the traces do not show an intervening Paint before that work. The retained filmstrip is capped before that late phase; no additional visual guarantee is claimed for it. The cold wait and cold diff cases above provide the directly checked paint boundary.

## Untouched identity, replay equivalence and exactness

The new projection test compares incremental and full replay results, checks untouched vars/messages with reference equality, then checks a messages-only patch preserves vars identity. Browser no-vars appends preserve the entire API Variables value and exact preview. The initial desktop assertion required zero serializer samples anywhere in the page and failed on **one 0.732 ms sample**; that test was broader than the requested absence of another wide enumeration. Cold positive controls capture **64–174 ms** of serializer-stack sample weight. The desktop no-vars append has 0.732 ms and narrow has zero, supporting no repeated wide enumeration within sampling resolution. Other short JSON values may still be previewed. The original failure is retained in [raw results](performance-results.json) and [log](performance.log.txt); [offline assessment](assessment.json), [assessment script](assess.mjs.txt), [log](assessment.log.txt) correct its interpretation without rerunning the test or rewriting the original results. It is not recorded as a product defect or as a retry pass.

The initial full-thread comparisons in the main script are fresh-load comparisons. A separate check warms the remembered thread, supplies one more real input to finish the run, and downloads Full thread JSON **without a reload**. All four current reconstructions equal the live API values, including **350,000 keys** and the completed message thread's **6,005 messages**. [Incremental completion comparisons](incremental-replay-results.json), [script](incremental-replay.mjs.txt), [log](incremental-replay.log.txt). Full-thread property-order differences remain the accepted QA-259-02 representation difference; parsed values are compared exactly.

Messages downloads are **1,989,782 UTF-8 bytes**, SHA-256 **aac60dc3440df7074966ddd4e7352460d2238fb4d883e8a72cf35d43fcc70778**. Nested Variables downloads are **2,322,734 bytes**, SHA-256 **7f2577a2a104addc52573d9df76bdcc880ca0db6e5ae294dd7cba67ad935941f**. Both widths match retained API bytes exactly, including the earlier Unicode/escape fixture. Raw JSON and profile/trace evidence use .json.txt; formatters do not modify them. Execution-context data remain complete. No browser page/console errors were observed in the main, focus or incremental replay scripts.

## Tests, gates and coverage limits

**79/79 tests pass in nine affected files**, including the new Messages ownership regression and incremental/full replay and identity regression. The maintained Edge file passes **5/5** (large Result/progress/page width and wait prompts at both widths, plus live value hand-off). Retries are disabled. The prior production head was not checked out or executed here; the historical R4 failure and fresh current reproductions are distinguished from source reasoning about regression tests. Current browser failures are retained as executable QA scripts; no production fixes were attempted.

| Exact command                                                                                                                                                                                                                                                                                                                                                                 | Result                                                   | Evidence                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------- |
| pnpm.cmd build                                                                                                                                                                                                                                                                                                                                                                | PASS                                                     | [Log](build.log.txt)         |
| pnpm.cmd --filter @graphgoblin/web exec vitest run src/components/ui/bounded-value.test.tsx src/lib/pretty-json-prefix.test.ts src/lib/utils.test.ts src/runs/inspector/ThreadViewer.test.tsx src/runs/RunInspectorPage.test.tsx src/runs/inspector/ProgressDrawer.test.tsx src/runs/inspector/WaitPanel.test.tsx src/runs/projections.test.ts src/events/EventsPage.test.tsx | PASS                                                     | [Log](focused-tests.log.txt) |
| pnpm.cmd lint                                                                                                                                                                                                                                                                                                                                                                 | PASS                                                     | [Log](lint.log.txt)          |
| pnpm.cmd typecheck                                                                                                                                                                                                                                                                                                                                                            | PASS                                                     | [Log](typecheck.log.txt)     |
| pnpm.cmd --filter @graphgoblin/web exec playwright test --config %TEMP%\gg-qa-e1-r5-playwright.config.mjs                                                                                                                                                                                                                                                                     | PASS                                                     | [Log](playwright.log.txt)    |
| pnpm.cmd exec prettier --check apps/web/src/components/ui/bounded-value.tsx apps/web/src/runs/inspector/ThreadViewer.tsx apps/web/src/runs/inspector/ThreadViewer.test.tsx apps/web/src/runs/projections.ts apps/web/src/runs/projections.test.ts docs/09-frontend-and-pwa.md                                                                                                 | PASS                                                     | [Log](source-format.log.txt) |
| pnpm.cmd check:layers                                                                                                                                                                                                                                                                                                                                                         | PASS                                                     | [Log](layers.log.txt)        |
| pnpm.cmd check:deps                                                                                                                                                                                                                                                                                                                                                           | PASS                                                     | [Log](deps.log.txt)          |
| pnpm.cmd check:tokens                                                                                                                                                                                                                                                                                                                                                         | PASS                                                     | [Log](tokens.log.txt)        |
| pnpm.cmd format:check                                                                                                                                                                                                                                                                                                                                                         | PASS                                                     | [Log](format.log.txt)        |
| pnpm --filter @graphgoblin/web test:coverage                                                                                                                                                                                                                                                                                                                                  | NOT RUN — full coverage explicitly waived for this round | User's round-5 scope         |
| pnpm check:docs                                                                                                                                                                                                                                                                                                                                                               | NOT RUN — no node schema/route changed                   | [Diff](change.diff.txt)      |
| pnpm check:licenses                                                                                                                                                                                                                                                                                                                                                           | NOT RUN — no dependencies changed                        | [Diff](change.diff.txt)      |

The build reports a nonfatal Turbo cache-write Access denied warning while all build tasks succeed. No numbered docs, ADRs, CHANGELOG, generated references, thresholds or dependencies were changed by QA. Docs 09's changed-value paint claim was included in the cold-selection assessment. Earlier full adversarial surface, session-reset/restart, actual screen-reader and live-provider campaigns were not all rerun in this narrowed round; their evidence remains historical. CPU sampling supports attribution at its resolution; it does not count every helper invocation or inspect private object references in the running UI.

# 4. Report path and evidence folder

Report: **docs/qa/2026-10-22-wp-e1-259-qa/round-5/README.md**. Evidence: **docs/qa/2026-10-22-wp-e1-259-qa/round-5/**. [Artifact/link/path/download validation](validation.json), [validation log](validation.log.txt). A successful integrity check preserves the failing product verdict and the original over-broad sampling assertion result.

- [api-key-metadata.json](api-key-metadata.json)
- `app-source-map.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [assess.mjs.txt](assess.mjs.txt)
- [assessment.json](assessment.json)
- [assessment.log.txt](assessment.log.txt)
- [browser-environment.json](browser-environment.json)
- [browser-support.mjs.txt](browser-support.mjs.txt)
- [build.log.txt](build.log.txt)
- [change.diff.txt](change.diff.txt)
- [deps.log.txt](deps.log.txt)
- [environment.json](environment.json)
- [final-state.json](final-state.json)
- [finish.mjs.txt](finish.mjs.txt)
- [fixtures.json](fixtures.json)
- [fixtures.log.txt](fixtures.log.txt)
- [fixtures.mjs.txt](fixtures.mjs.txt)
- [focus-1440-all-control.png](focus-1440-all-control.png)
- [focus-1440-all-region-exact-R4.png](focus-1440-all-region-exact-R4.png)
- [focus-1440-all-region-to-no-controls.png](focus-1440-all-region-to-no-controls.png)
- [focus-1440-outside-Full-thread-JSON.png](focus-1440-outside-Full-thread-JSON.png)
- [focus-1440-outside-timeline.png](focus-1440-outside-timeline.png)
- [focus-1440-window-control.png](focus-1440-window-control.png)
- [focus-390-all-control.png](focus-390-all-control.png)
- [focus-390-all-region-exact-R4.png](focus-390-all-region-exact-R4.png)
- [focus-390-all-region-to-no-controls.png](focus-390-all-region-to-no-controls.png)
- [focus-390-outside-Full-thread-JSON.png](focus-390-outside-Full-thread-JSON.png)
- [focus-390-outside-timeline.png](focus-390-outside-timeline.png)
- [focus-390-window-control.png](focus-390-window-control.png)
- [focus-errors.json](focus-errors.json)
- [focus-results.json](focus-results.json)
- [focus-small-1440-0.png](focus-small-1440-0.png)
- [focus-small-1440-500.png](focus-small-1440-500.png)
- [focus-small-390-0.png](focus-small-390-0.png)
- [focus-small-390-500.png](focus-small-390-500.png)
- [focus-small-repro.json](focus-small-repro.json)
- [focus-small-repro.mjs.txt](focus-small-repro.mjs.txt)
- [focus-small.log.txt](focus-small.log.txt)
- [focus.log.txt](focus.log.txt)
- [focus.mjs.txt](focus.mjs.txt)
- [focused-tests.log.txt](focused-tests.log.txt)
- [format-qa.log.txt](format-qa.log.txt)
- [format.log.txt](format.log.txt)
- [incremental-replay-errors.json](incremental-replay-errors.json)
- [incremental-replay-results.json](incremental-replay-results.json)
- [incremental-replay.log.txt](incremental-replay.log.txt)
- [incremental-replay.mjs.txt](incremental-replay.mjs.txt)
- [layers.log.txt](layers.log.txt)
- [lint.log.txt](lint.log.txt)
- `live-completion-many-api-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `live-completion-many-api-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `live-completion-many-download-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `live-completion-many-download-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `live-completion-wide-api-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `live-completion-wide-api-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `live-completion-wide-download-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `live-completion-wide-download-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [make-report.mjs.txt](make-report.mjs.txt)
- `messages-api.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `messages-download-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `messages-download-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [messages-live-all-tasks-1440.json](messages-live-all-tasks-1440.json)
- [messages-live-all-tasks-390.json](messages-live-all-tasks-390.json)
- [messages-live-window-tasks-1440.json](messages-live-window-tasks-1440.json)
- [messages-live-window-tasks-390.json](messages-live-window-tasks-390.json)
- `messages-thread-api-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `messages-thread-api-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `messages-thread-download-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `messages-thread-download-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `nested-api.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `nested-download-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `nested-download-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [outside-return-1440.json](outside-return-1440.json)
- [outside-return-390.json](outside-return-390.json)
- [paint-results.json](paint-results.json)
- [paint-seed-1440-frame-0.png](paint-seed-1440-frame-0.png)
- [paint-seed-1440-frame-102.png](paint-seed-1440-frame-102.png)
- [paint-seed-1440-frame-56.png](paint-seed-1440-frame-56.png)
- [paint-seed-1440-frame-57.png](paint-seed-1440-frame-57.png)
- [paint-seed-1440-frame-65.png](paint-seed-1440-frame-65.png)
- [paint-seed-1440-frame-66.png](paint-seed-1440-frame-66.png)
- [paint-seed-1440-frame-67.png](paint-seed-1440-frame-67.png)
- [paint-seed-1440.cpuprofile.json.txt](paint-seed-1440.cpuprofile.json.txt)
- [paint-seed-1440.json](paint-seed-1440.json)
- `paint-seed-1440.screencast.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [paint-seed-1440.trace.json.txt](paint-seed-1440.trace.json.txt)
- [paint-seed-390-frame-0.png](paint-seed-390-frame-0.png)
- [paint-seed-390-frame-100.png](paint-seed-390-frame-100.png)
- [paint-seed-390-frame-59.png](paint-seed-390-frame-59.png)
- [paint-seed-390-frame-60.png](paint-seed-390-frame-60.png)
- [paint-seed-390-frame-67.png](paint-seed-390-frame-67.png)
- [paint-seed-390-frame-68.png](paint-seed-390-frame-68.png)
- [paint-seed-390-frame-69.png](paint-seed-390-frame-69.png)
- [paint-seed-390.cpuprofile.json.txt](paint-seed-390.cpuprofile.json.txt)
- [paint-seed-390.json](paint-seed-390.json)
- `paint-seed-390.screencast.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [paint-seed-390.trace.json.txt](paint-seed-390.trace.json.txt)
- [paint-wait-1440-frame-0.png](paint-wait-1440-frame-0.png)
- [paint-wait-1440-frame-62.png](paint-wait-1440-frame-62.png)
- [paint-wait-1440-frame-63.png](paint-wait-1440-frame-63.png)
- [paint-wait-1440-frame-64.png](paint-wait-1440-frame-64.png)
- [paint-wait-1440-frame-65.png](paint-wait-1440-frame-65.png)
- [paint-wait-1440-frame-97.png](paint-wait-1440-frame-97.png)
- [paint-wait-1440.cpuprofile.json.txt](paint-wait-1440.cpuprofile.json.txt)
- [paint-wait-1440.json](paint-wait-1440.json)
- `paint-wait-1440.screencast.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [paint-wait-1440.trace.json.txt](paint-wait-1440.trace.json.txt)
- [paint-wait-390-frame-0.png](paint-wait-390-frame-0.png)
- [paint-wait-390-frame-45.png](paint-wait-390-frame-45.png)
- [paint-wait-390-frame-46.png](paint-wait-390-frame-46.png)
- [paint-wait-390-frame-47.png](paint-wait-390-frame-47.png)
- [paint-wait-390-frame-48.png](paint-wait-390-frame-48.png)
- [paint-wait-390-frame-79.png](paint-wait-390-frame-79.png)
- [paint-wait-390.cpuprofile.json.txt](paint-wait-390.cpuprofile.json.txt)
- [paint-wait-390.json](paint-wait-390.json)
- `paint-wait-390.screencast.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [paint-wait-390.trace.json.txt](paint-wait-390.trace.json.txt)
- [paint.log.txt](paint.log.txt)
- [paint.mjs.txt](paint.mjs.txt)
- [performance-errors.json](performance-errors.json)
- [performance-results.json](performance-results.json)
- [performance.log.txt](performance.log.txt)
- [performance.mjs.txt](performance.mjs.txt)
- [playwright.config.mjs.txt](playwright.config.mjs.txt)
- [playwright.log.txt](playwright.log.txt)
- [prepare-visible-paint.mjs.txt](prepare-visible-paint.mjs.txt)
- [prior-evidence-audit.json](prior-evidence-audit.json)
- [run-command.mjs.txt](run-command.mjs.txt)
- [sanitization.json](sanitization.json)
- [sanitization.log.txt](sanitization.log.txt)
- [sanitize-source-map.mjs.txt](sanitize-source-map.mjs.txt)
- [server.log.txt](server.log.txt)
- [server.mjs.txt](server.mjs.txt)
- [setup.mjs.txt](setup.mjs.txt)
- [shutdown.json](shutdown.json)
- [shutdown.log.txt](shutdown.log.txt)
- [source-format.log.txt](source-format.log.txt)
- [source-map-provenance.json](source-map-provenance.json)
- [support.mjs.txt](support.mjs.txt)
- [tokens.log.txt](tokens.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [validate.mjs.txt](validate.mjs.txt)
- [validation-initial.json.txt](validation-initial.json.txt)
- [validation-initial.log.txt](validation-initial.log.txt)
- [validation.json](validation.json)
- [validation.log.txt](validation.log.txt)
- [visible-paint-results.json](visible-paint-results.json)
- [visible-paint-seed-390-frame-0.png](visible-paint-seed-390-frame-0.png)
- [visible-paint-seed-390-frame-1.png](visible-paint-seed-390-frame-1.png)
- [visible-paint-seed-390-frame-2.png](visible-paint-seed-390-frame-2.png)
- [visible-paint-seed-390-frame-3.png](visible-paint-seed-390-frame-3.png)
- [visible-paint-seed-390.cpuprofile.json.txt](visible-paint-seed-390.cpuprofile.json.txt)
- [visible-paint-seed-390.json](visible-paint-seed-390.json)
- `visible-paint-seed-390.screencast.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [visible-paint-seed-390.trace.json.txt](visible-paint-seed-390.trace.json.txt)
- [visible-paint-wait-390-frame-0.png](visible-paint-wait-390-frame-0.png)
- [visible-paint-wait-390-frame-1.png](visible-paint-wait-390-frame-1.png)
- [visible-paint-wait-390-frame-2.png](visible-paint-wait-390-frame-2.png)
- [visible-paint-wait-390-frame-3.png](visible-paint-wait-390-frame-3.png)
- [visible-paint-wait-390.cpuprofile.json.txt](visible-paint-wait-390.cpuprofile.json.txt)
- [visible-paint-wait-390.json](visible-paint-wait-390.json)
- `visible-paint-wait-390.screencast.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [visible-paint-wait-390.trace.json.txt](visible-paint-wait-390.trace.json.txt)
- [visible-paint.log.txt](visible-paint.log.txt)
- [visible-paint.mjs.txt](visible-paint.mjs.txt)
- [wide-all-tasks-1440.json](wide-all-tasks-1440.json)
- [wide-all-tasks-390.json](wide-all-tasks-390.json)
- `wide-api-after-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `wide-api-after-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `wide-api-before.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [wide-cold-seed-1440-frame-0.jpg](wide-cold-seed-1440-frame-0.jpg)
- [wide-cold-seed-1440-frame-55.jpg](wide-cold-seed-1440-frame-55.jpg)
- [wide-cold-seed-1440-frame-56.jpg](wide-cold-seed-1440-frame-56.jpg)
- [wide-cold-seed-1440-frame-64.jpg](wide-cold-seed-1440-frame-64.jpg)
- [wide-cold-seed-1440-frame-65.jpg](wide-cold-seed-1440-frame-65.jpg)
- [wide-cold-seed-1440-frame-66.jpg](wide-cold-seed-1440-frame-66.jpg)
- [wide-cold-seed-1440-frame-98.jpg](wide-cold-seed-1440-frame-98.jpg)
- [wide-cold-seed-1440.cpuprofile.json.txt](wide-cold-seed-1440.cpuprofile.json.txt)
- [wide-cold-seed-1440.json](wide-cold-seed-1440.json)
- [wide-cold-seed-1440.trace.json.txt](wide-cold-seed-1440.trace.json.txt)
- [wide-cold-seed-390-frame-0.jpg](wide-cold-seed-390-frame-0.jpg)
- [wide-cold-seed-390-frame-51.jpg](wide-cold-seed-390-frame-51.jpg)
- [wide-cold-seed-390-frame-52.jpg](wide-cold-seed-390-frame-52.jpg)
- [wide-cold-seed-390-frame-57.jpg](wide-cold-seed-390-frame-57.jpg)
- [wide-cold-seed-390-frame-58.jpg](wide-cold-seed-390-frame-58.jpg)
- [wide-cold-seed-390-frame-59.jpg](wide-cold-seed-390-frame-59.jpg)
- [wide-cold-seed-390-frame-87.jpg](wide-cold-seed-390-frame-87.jpg)
- [wide-cold-seed-390.cpuprofile.json.txt](wide-cold-seed-390.cpuprofile.json.txt)
- [wide-cold-seed-390.json](wide-cold-seed-390.json)
- [wide-cold-seed-390.trace.json.txt](wide-cold-seed-390.trace.json.txt)
- [wide-cold-wait-1440-frame-0.jpg](wide-cold-wait-1440-frame-0.jpg)
- [wide-cold-wait-1440-frame-34.jpg](wide-cold-wait-1440-frame-34.jpg)
- [wide-cold-wait-1440-frame-35.jpg](wide-cold-wait-1440-frame-35.jpg)
- [wide-cold-wait-1440-frame-36.jpg](wide-cold-wait-1440-frame-36.jpg)
- [wide-cold-wait-1440-frame-37.jpg](wide-cold-wait-1440-frame-37.jpg)
- [wide-cold-wait-1440-frame-65.jpg](wide-cold-wait-1440-frame-65.jpg)
- [wide-cold-wait-1440.cpuprofile.json.txt](wide-cold-wait-1440.cpuprofile.json.txt)
- [wide-cold-wait-1440.json](wide-cold-wait-1440.json)
- [wide-cold-wait-1440.trace.json.txt](wide-cold-wait-1440.trace.json.txt)
- [wide-cold-wait-390-frame-0.jpg](wide-cold-wait-390-frame-0.jpg)
- [wide-cold-wait-390-frame-39.jpg](wide-cold-wait-390-frame-39.jpg)
- [wide-cold-wait-390-frame-40.jpg](wide-cold-wait-390-frame-40.jpg)
- [wide-cold-wait-390-frame-41.jpg](wide-cold-wait-390-frame-41.jpg)
- [wide-cold-wait-390-frame-42.jpg](wide-cold-wait-390-frame-42.jpg)
- [wide-cold-wait-390-frame-74.jpg](wide-cold-wait-390-frame-74.jpg)
- [wide-cold-wait-390.cpuprofile.json.txt](wide-cold-wait-390.cpuprofile.json.txt)
- [wide-cold-wait-390.json](wide-cold-wait-390.json)
- [wide-cold-wait-390.trace.json.txt](wide-cold-wait-390.trace.json.txt)
- [wide-live-changed-vars-1440-frame-0.jpg](wide-live-changed-vars-1440-frame-0.jpg)
- [wide-live-changed-vars-1440-frame-449.jpg](wide-live-changed-vars-1440-frame-449.jpg)
- [wide-live-changed-vars-1440.cpuprofile.json.txt](wide-live-changed-vars-1440.cpuprofile.json.txt)
- [wide-live-changed-vars-1440.json](wide-live-changed-vars-1440.json)
- `wide-live-changed-vars-1440.trace.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [wide-live-changed-vars-390-frame-0.jpg](wide-live-changed-vars-390-frame-0.jpg)
- [wide-live-changed-vars-390-frame-445.jpg](wide-live-changed-vars-390-frame-445.jpg)
- [wide-live-changed-vars-390-frame-446.jpg](wide-live-changed-vars-390-frame-446.jpg)
- [wide-live-changed-vars-390-frame-447.jpg](wide-live-changed-vars-390-frame-447.jpg)
- [wide-live-changed-vars-390-frame-448.jpg](wide-live-changed-vars-390-frame-448.jpg)
- [wide-live-changed-vars-390-frame-449.jpg](wide-live-changed-vars-390-frame-449.jpg)
- [wide-live-changed-vars-390.cpuprofile.json.txt](wide-live-changed-vars-390.cpuprofile.json.txt)
- [wide-live-changed-vars-390.json](wide-live-changed-vars-390.json)
- `wide-live-changed-vars-390.trace.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [wide-live-no-vars-1440-frame-0.jpg](wide-live-no-vars-1440-frame-0.jpg)
- [wide-live-no-vars-1440-frame-335.jpg](wide-live-no-vars-1440-frame-335.jpg)
- [wide-live-no-vars-1440-frame-336.jpg](wide-live-no-vars-1440-frame-336.jpg)
- [wide-live-no-vars-1440-frame-449.jpg](wide-live-no-vars-1440-frame-449.jpg)
- [wide-live-no-vars-1440.cpuprofile.json.txt](wide-live-no-vars-1440.cpuprofile.json.txt)
- [wide-live-no-vars-1440.json](wide-live-no-vars-1440.json)
- `wide-live-no-vars-1440.trace.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [wide-live-no-vars-390-frame-0.jpg](wide-live-no-vars-390-frame-0.jpg)
- [wide-live-no-vars-390-frame-449.jpg](wide-live-no-vars-390-frame-449.jpg)
- [wide-live-no-vars-390.cpuprofile.json.txt](wide-live-no-vars-390.cpuprofile.json.txt)
- [wide-live-no-vars-390.json](wide-live-no-vars-390.json)
- `wide-live-no-vars-390.trace.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `wide-thread-api-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `wide-thread-api-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `wide-thread-download-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `wide-thread-download-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))

# 5. Observations outside scope

- Untouched-vars live appends still have seven long tasks at each width (**136–182 ms** desktop, **122–176 ms** narrow), with end-to-end wall times **5,424.4/4,475.8 ms**. Those are retained rather than attributed to another wide preview. Cold reconstruction still blocks before the urgent commit even where deferred preview paint works. No unrelated event-storage/engine optimization is attempted.
- The round-4 artifacts are present but untracked on admission. They are left unchanged for the orchestrator's retention/commit handling.
- Neither the passing maintained tests nor this narrowed QA round establishes full-package coverage, live-provider behavior or integrated intent acceptance.
