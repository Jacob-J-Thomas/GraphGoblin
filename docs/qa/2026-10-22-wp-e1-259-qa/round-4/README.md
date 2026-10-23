# 1. Verdict

> Files above 1,000,000 bytes (8 in this round) are not kept in the repository; [NOT-KEPT.md](NOT-KEPT.md) records each with its size and SHA-256. Mentions of those names below, and in the JSON result files, refer to that record.

**FAIL** at **8984d7f44b1e3f88e9f7ada8388da2f616bad6f2** because the new message window can remove a focused older message and leave the keyboard on BODY (**QA-259-R4-01, minor**). The message-count bound and wide-object preview cache pass their core checks. This report distinguishes that functional success from the remaining cold-render costs and the focus failure.

Worktree **codex-qa-wp-e1-259**, detached at the exact assigned HEAD; round-3 comparison head **011a01296a00bf1b5427bb9a397c3c5bc2fbdaf6**. No production code, maintained tests, index, branches or previous QA artifacts were changed; no commits, stashes, sub-agents, GitHub writes or live provider turns. This round's evidence is **uncommitted; ready for orchestrator commit**. [Final state](final-state.json), [targeted UI diff](targeted-change.diff.txt).

# 2. Defects

## QA-259-R4-01 — minor — live message-window reset removes the focused region and leaves focus on BODY

Reproduced once at each width, **1440 x 900** and **390 x 844**, through a fresh public-API mutate/wait run:

1. Seed 6,000 messages, using the same message schema as the main workload. For this additional regression case, message m0 has a 20,000-character content string; the other messages remain short.
2. At the current wait, activate **Show all messages**. Activate **Show all of Message m0 content**, then Shift+Tab into its named region.
3. Submit the observed wait ID through HTTP from elsewhere, appending the input message and a mutate-node message; the thread now contains 6,002 messages.
4. The inspector follows the latest event and correctly resets to its last 50 messages. Message m0, which held the keyboard, is removed from the DOM.

Expected: retain a meaningful keyboard location by handing focus to a surviving message-window control (or an equivalent explicit fallback), following the focus-preservation behavior accepted in rounds 2/3. Actual at **both widths**: **document.activeElement is BODY**, the old named region is absent, and no focus-in event names a replacement. The next Tab reaches Full thread JSON; Show all messages and Download messages are skipped from that prior position. All **6,002** messages and m0's **20,000** characters remain stored, so this is a keyboard-position defect, not data loss.

Evidence: [two complete reproductions](message-focus-results.json), [public-interface reproduction script](message-focus.mjs.txt), [execution log](message-focus.log.txt), [desktop screenshot after the following Tab](message-focus-after-tab-1440.png), [narrow screenshot after the following Tab](message-focus-after-tab-390.png). The screenshots are supplemental; the JSON captures BODY before Tab. No retry-to-green was used.

The relevant removal is the render-time reset and slicing/mapping in apps/web/src/runs/inspector/ThreadViewer.tsx:105, :122 and :162. The existing BoundedValue hand-off cannot run after that entire older message component unmounts. This is a new interaction with the message window; **QA-259-R2-01 remains fixed** for a value changing inside its surviving component.

# 3. Coverage of criteria

## Environment and evidence provenance

- Node **v22.14.0** first on PATH; pnpm build completed successfully before the built app was served. Dependencies were already installed.
- Installed Microsoft Edge **155.0.4283.62**, headless Playwright, **1440 x 900** and **390 x 844**. [Environment](browser-environment.json).
- Disposable API **127.0.0.1:5720**; fake-only control server **127.0.0.1:5721**; system-temp store **gg-qa-e1-08LYeI**. [Server](server.mjs.txt), [server log](server.log.txt), [API-created key metadata](api-key-metadata.json). No token is retained; owner ports/store were not accessed.
- Real HTTP, SQLite, engine, mutate and wait execution. **Fake-only provider evidence** for the inference cases: FakeHarness/FakeStructured through supported injection. No real provider/CLI turn. [Fixture admission](fixtures.json), [fixture generator](fixtures.mjs.txt), [fixture log](fixtures.log.txt).
- All **334** references in rounds 1–3 exist and are tracked at this HEAD, including the round-2 evidence that was previously untracked. [Retention audit with hashes](prior-evidence-audit.json). Every referenced file remained unchanged during this run, per [final verification](final-state.json).
- The native disposable process was stopped; its exec session exited with code 0 and both ports became unreachable. [Shutdown](shutdown.json), [shutdown log](shutdown.log.txt). Temp data/output directories are left for the orchestrator; no directory was deleted.

Touched systems: ThreadViewer message-count expansion/reset and historical selection; keyboard navigation and removal of focused child regions; BoundedValue preview/cache and existing focus hand-off; prettyJsonPrefix boxed BigInt behavior; exact downloads and stored context preservation; run-event reconstruction/live appends; narrow document layout; relevant Result/progress/wait regressions. The main merge's delivery/replay additions are not separately accepted by this bounded QA round.

## Requirement disposition

| Requested criterion                                                    | Disposition                                                                               | Evidence                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1: 6,000 short API-admitted messages, latest 50 and notice             | PASS at both widths                                                                       | [14-case matrix](browser-results.json), [admission](fixtures.json)                  |
| 1: Show all, scroll, Show fewer, exact full-array download             | PASS at both widths                                                                       | Matrix, raw message downloads, keyboard transitions and timings below               |
| 1: queued -> waiting re-selection measurements                         | MEASURED; bounded, zero long tasks in all six return selections                           | All measured moves below; full task logs                                            |
| 1: live append while Show all is on resets to last 50                  | PASS at both widths                                                                       | 6,002 stored, 50 current, 6,000 on a separately selected historical thread          |
| 2: 350,000 API-admitted properties, first/cached/new-thread selections | PASS for exactness and cache behavior; cold costs remain MEASURED                         | Wide-object timing rows, prefixes compared with retained API JSON                   |
| 2: every observed long task retained                                   | DONE for measured pages/windows                                                           | Per-page task snapshots and complete listing below                                  |
| 3: keyboard names, Show fewer removal, Tab order, narrow width         | PASS for ordinary window controls; FAIL when a live reset removes a focused older message | Matrix and QA-259-R4-01                                                             |
| 4: original QA-259-01 A/B/A                                            | PASS at both widths                                                                       | Original 2,322,721-character fixture; preview returns to 4,097 characters           |
| 4: prior small-value focus hand-off                                    | PASS in all four direct/500 ms cases                                                      | [Exact prior reproduction](focus-small-repro.json), [log](focus-small.log.txt)      |
| 4: one exactness download                                              | PASS at both widths                                                                       | Nested Variables strict API-byte comparisons, including original adversarial values |

The 14 core independent cases pass, the four exact prior focus reproductions pass, and the two additional message-window/focus regression cases fail. No browser console/page errors were recorded. The only new defect is QA-259-R4-01. No thresholds or retry settings were relaxed.

## Every core check

The [script](browser.mjs.txt) contains the exact public-API, DOM and keyboard steps. Common selection steps: load and synchronize the run, scroll a target timeline event into view, dispatch CDP mouse press/release, then let two animation frames complete. The message-control case uses the keyboard from the latest timeline event: Tab -> Show all; Enter -> Show fewer; Tab -> Download; Shift+Tab -> Show fewer; Enter -> Show all after shrinking; Tab -> Download; Enter downloads; Tab -> Full thread JSON. Focus stays on the surviving renamed toggle when Show fewer removes 5,950 items.

| System                      | Case / steps                                                                       | Expected                                                                                                                                    | Actual                                                                                                                      | Result   | Evidence                     |
| --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- |
| message window              | 1440: messages latest 50, exact notice and quiet re-selections                     | 6000 stored; only m5950..m5999 mounted; run.queued -> run.waiting ask stays bounded                                                         | 50 mounted, 525 elements, m5950 to m5999; six timed moves                                                                   | **PASS** | [Case](browser-results.json) |
| message window              | 1440: messages keyboard, expansion, scrolling, controls, shrink and exact download | Named controls in Tab order; 6000 on demand; unchanged thread stays expanded; Show fewer keeps focus and returns to 50; exact messages JSON | 6000 on request; 50 after Show fewer; focus retained; 1989782 download bytes, exact API; stored thread/events/run unchanged | **PASS** | [Case](browser-results.json) |
| message window              | 1440: live append resets current window and preserves historical expansion         | Latest new thread returns to 50; earlier selected thread keeps all 6000; stored context grows intact                                        | 50 current; 6000 historical; 6002 stored; current focus Show all messages                                                   | **PASS** | [Case](browser-results.json) |
| message window              | 1440: messages boundary 50                                                         | At 50 show all without controls; at 51 show latest 50 with controls and exact endpoints                                                     | 50 visible; 0 Show all controls; width 1440/1440                                                                            | **PASS** | [Case](browser-results.json) |
| message window              | 1440: messages boundary 51                                                         | At 50 show all without controls; at 51 show latest 50 with controls and exact endpoints                                                     | 50 visible; 1 Show all controls; width 1440/1440                                                                            | **PASS** | [Case](browser-results.json) |
| wide object / preview cache | 1440: wide object first, cached and post-append selections                         | 350000 admitted keys; exact bounded prefix on each selection; cached re-selections avoid repeated enumeration; new value misses once        | 350000 keys; all prefixes exact and at most 4097 characters; all selections width <= viewport                               | **PASS** | [Case](browser-results.json) |
| BoundedValue regression     | 1440: QA-259-01 A/B/A and exact nested Variables download                          | 2322721-character value only expands explicitly; A/B/A bounded; strict API byte download                                                    | 2322721 characters; bounded A/B/A; 2322734 download bytes, equal API SHA-256                                                | **PASS** | [Case](browser-results.json) |
| message window              | 390: messages latest 50, exact notice and quiet re-selections                      | 6000 stored; only m5950..m5999 mounted; run.queued -> run.waiting ask stays bounded                                                         | 50 mounted, 525 elements, m5950 to m5999; six timed moves                                                                   | **PASS** | [Case](browser-results.json) |
| message window              | 390: messages keyboard, expansion, scrolling, controls, shrink and exact download  | Named controls in Tab order; 6000 on demand; unchanged thread stays expanded; Show fewer keeps focus and returns to 50; exact messages JSON | 6000 on request; 50 after Show fewer; focus retained; 1989782 download bytes, exact API; stored thread/events/run unchanged | **PASS** | [Case](browser-results.json) |
| message window              | 390: live append resets current window and preserves historical expansion          | Latest new thread returns to 50; earlier selected thread keeps all 6000; stored context grows intact                                        | 50 current; 6000 historical; 6002 stored; current focus Show all messages                                                   | **PASS** | [Case](browser-results.json) |
| message window              | 390: messages boundary 50                                                          | At 50 show all without controls; at 51 show latest 50 with controls and exact endpoints                                                     | 50 visible; 0 Show all controls; width 390/390                                                                              | **PASS** | [Case](browser-results.json) |
| message window              | 390: messages boundary 51                                                          | At 50 show all without controls; at 51 show latest 50 with controls and exact endpoints                                                     | 50 visible; 1 Show all controls; width 390/390                                                                              | **PASS** | [Case](browser-results.json) |
| wide object / preview cache | 390: wide object first, cached and post-append selections                          | 350000 admitted keys; exact bounded prefix on each selection; cached re-selections avoid repeated enumeration; new value misses once        | 350000 keys; all prefixes exact and at most 4097 characters; all selections width <= viewport                               | **PASS** | [Case](browser-results.json) |
| BoundedValue regression     | 390: QA-259-01 A/B/A and exact nested Variables download                           | 2322721-character value only expands explicitly; A/B/A bounded; strict API byte download                                                    | 2322721 characters; bounded A/B/A; 2322734 download bytes, equal API SHA-256                                                | **PASS** | [Case](browser-results.json) |

The short-message window mounts **525 document elements** instead of all 6,000 messages. Explicit Show all mounts **42,175 elements**, with all 6,000 messages in API order and a page scroll height of **948,891 px** at desktop and **1,327,306 px** at narrow width. Page scrolling was observed. Document scroll width equals the window in the captured main cases. Show all persists across opening/closing Full thread JSON on the same thread, while another event or current-thread append starts bounded again. A separately selected earlier thread keeps its 6,000-message expansion during the append.

Fresh full-message downloads are **1,989,782 UTF-8 bytes**, SHA-256 **aac60dc3440df7074966ddd4e7352460d2238fb4d883e8a72cf35d43fcc70778**, identical at both widths and byte-for-byte equal to the API messages array under two-space JSON formatting. Nested Variables downloads are **2,322,734 UTF-8 bytes**, SHA-256 **7f2577a2a104addc52573d9df76bdcc880ca0db6e5ae294dd7cba67ad935941f**, also equal at both widths and to API bytes. Raw JSON evidence uses .json.txt so formatting cannot alter it. Thread, events and complete run records remain unchanged by viewing, expansion, download and collapse before the intentional append.

The wide fixture has **350,000** named properties. After a live append, two mutate operations change key0 (including a surrogate pair and NUL) and key349999. The first 4,096 characters plus ellipsis exactly match the retained API JSON both before and after that change; the historical seed still shows its old exact prefix. At node.finished seed, both the 1,024-character diff preview and 4,096-character Variables preview are exercised. A new value/budget can still pay enumeration once; cached repetitions show zero long tasks in these probes.

## Measurements: all actions and selections

The browser's Long Tasks API uses its **50 ms** threshold. Wall time is operator-process elapsed time from the dispatched action to two completed animation frames; it includes automation/scheduling overhead and is **not INP**. The observer is allowed 70 ms to deliver entries after that measured end. Scrolling the timeline target into view occurs before selection timing. API-to-browser append measurements include backend execution and waiting for the next wait; they are not a continuous browser-block duration. Unit/gate/fixture jobs had finished before these main timings. These are observations, not owner-approved performance limits or a controlled before/after benchmark against the Astra audit.

| Width   | Workload    | Action                                                                        | Wall ms | Long-task durations                                    | DOM elements | Mounted messages |
| ------- | ----------- | ----------------------------------------------------------------------------- | ------- | ------------------------------------------------------ | ------------ | ---------------- |
| 1440 px | messages    | queued 0                                                                      | 105.1   | none                                                   | 169          | 0                |
| 1440 px | messages    | ask reselection 0                                                             | 92.1    | none                                                   | 525          | 50               |
| 1440 px | messages    | queued 1                                                                      | 58.3    | none                                                   | 169          | 0                |
| 1440 px | messages    | ask reselection 1                                                             | 82.1    | none                                                   | 525          | 50               |
| 1440 px | messages    | queued 2                                                                      | 21.8    | none                                                   | 169          | 0                |
| 1440 px | messages    | ask reselection 2                                                             | 74.6    | none                                                   | 525          | 50               |
| 1440 px | messages    | keyboard Show all messages                                                    | 1624.9  | 423 ms                                                 | 42175        | 6000             |
| 1440 px | messages    | input fill while all messages mounted                                         | 202.7   | none                                                   | 42175        | 6000             |
| 1440 px | messages    | run control focus while all messages mounted                                  | 175.1   | none                                                   | 42175        | 6000             |
| 1440 px | messages    | keyboard Show fewer messages                                                  | 157.4   | 100 ms                                                 | 525          | 50               |
| 1440 px | messages    | live append while all messages mounted                                        | 1268.0  | 173 ms, 51 ms, 51 ms                                   | 565          | 50               |
| 1440 px | wide object | queued before unseen seed                                                     | 35.1    | none                                                   | 169          | 0                |
| 1440 px | wide object | first seed selection                                                          | 710.8   | 659 ms                                                 | 198          | 0                |
| 1440 px | wide object | queued before cached seed 0                                                   | 41.6    | none                                                   | 169          | 0                |
| 1440 px | wide object | cached seed 0                                                                 | 81.5    | none                                                   | 198          | 0                |
| 1440 px | wide object | queued before cached seed 1                                                   | 96.0    | none                                                   | 169          | 0                |
| 1440 px | wide object | cached seed 1                                                                 | 129.7   | none                                                   | 198          | 0                |
| 1440 px | wide object | queued before cached seed 2                                                   | 58.2    | none                                                   | 169          | 0                |
| 1440 px | wide object | cached seed 2                                                                 | 56.4    | none                                                   | 198          | 0                |
| 1440 px | wide object | queued during live append                                                     | 51.5    | none                                                   | 169          | 0                |
| 1440 px | wide object | first new thread selection after append                                       | 1683.3  | 1559 ms                                                | 222          | 1                |
| 1440 px | wide object | queued before cached new thread 0                                             | 71.2    | none                                                   | 209          | 0                |
| 1440 px | wide object | cached new thread 0                                                           | 62.3    | none                                                   | 222          | 1                |
| 1440 px | wide object | queued before cached new thread 1                                             | 103.8   | none                                                   | 209          | 0                |
| 1440 px | wide object | cached new thread 1                                                           | 98.3    | none                                                   | 222          | 1                |
| 1440 px | wide object | historical seed after append                                                  | 55.5    | none                                                   | 238          | 0                |
| 1440 px | wide object | append while queued event remains selected (API-to-browser, includes backend) | 19729.2 | 196 ms, 214 ms, 204 ms, 215 ms, 216 ms, 210 ms, 206 ms | 209          | 0                |
| 1440 px | A/B/A       | A to B after full expansion                                                   | 22.2    | none                                                   | 208          | 0                |
| 1440 px | A/B/A       | B to A previously expanded                                                    | 24.1    | none                                                   | 212          | 0                |
| 390 px  | messages    | queued 0                                                                      | 83.9    | none                                                   | 169          | 0                |
| 390 px  | messages    | ask reselection 0                                                             | 127.6   | none                                                   | 525          | 50               |
| 390 px  | messages    | queued 1                                                                      | 106.8   | none                                                   | 169          | 0                |
| 390 px  | messages    | ask reselection 1                                                             | 116.4   | none                                                   | 525          | 50               |
| 390 px  | messages    | queued 2                                                                      | 121.7   | none                                                   | 169          | 0                |
| 390 px  | messages    | ask reselection 2                                                             | 121.7   | none                                                   | 525          | 50               |
| 390 px  | messages    | keyboard Show all messages                                                    | 1752.4  | 376 ms                                                 | 42175        | 6000             |
| 390 px  | messages    | input fill while all messages mounted                                         | 502.1   | none                                                   | 42175        | 6000             |
| 390 px  | messages    | run control focus while all messages mounted                                  | 286.2   | none                                                   | 42175        | 6000             |
| 390 px  | messages    | keyboard Show fewer messages                                                  | 227.1   | 96 ms                                                  | 525          | 50               |
| 390 px  | messages    | live append while all messages mounted                                        | 1820.9  | 191 ms, 85 ms, 90 ms, 96 ms, 84 ms                     | 565          | 50               |
| 390 px  | wide object | queued before unseen seed                                                     | 47.4    | none                                                   | 169          | 0                |
| 390 px  | wide object | first seed selection                                                          | 716.0   | 698 ms                                                 | 198          | 0                |
| 390 px  | wide object | queued before cached seed 0                                                   | 22.2    | none                                                   | 169          | 0                |
| 390 px  | wide object | cached seed 0                                                                 | 24.1    | none                                                   | 198          | 0                |
| 390 px  | wide object | queued before cached seed 1                                                   | 16.9    | none                                                   | 169          | 0                |
| 390 px  | wide object | cached seed 1                                                                 | 24.6    | none                                                   | 198          | 0                |
| 390 px  | wide object | queued before cached seed 2                                                   | 139.9   | none                                                   | 169          | 0                |
| 390 px  | wide object | cached seed 2                                                                 | 89.8    | none                                                   | 198          | 0                |
| 390 px  | wide object | queued during live append                                                     | 54.3    | none                                                   | 169          | 0                |
| 390 px  | wide object | first new thread selection after append                                       | 1568.7  | 1465 ms                                                | 222          | 1                |
| 390 px  | wide object | queued before cached new thread 0                                             | 84.8    | none                                                   | 209          | 0                |
| 390 px  | wide object | cached new thread 0                                                           | 80.7    | none                                                   | 222          | 1                |
| 390 px  | wide object | queued before cached new thread 1                                             | 63.4    | none                                                   | 209          | 0                |
| 390 px  | wide object | cached new thread 1                                                           | 110.2   | none                                                   | 222          | 1                |
| 390 px  | wide object | historical seed after append                                                  | 113.8   | none                                                   | 238          | 0                |
| 390 px  | wide object | append while queued event remains selected (API-to-browser, includes backend) | 16640.9 | 271 ms, 237 ms, 248 ms, 235 ms, 233 ms, 242 ms, 235 ms | 209          | 0                |
| 390 px  | A/B/A       | A to B after full expansion                                                   | 24.1    | none                                                   | 208          | 0                |
| 390 px  | A/B/A       | B to A previously expanded                                                    | 23.2    | none                                                   | 212          | 0                |

Message-return re-selections are **74.6–127.6 ms** with zero long tasks. Cold wide seed selections are **710.8/716.0 ms** with **659/698 ms** long tasks. Cached seed returns are **24.1–129.7 ms**, zero long tasks. The first selection of the new thread after append is **1,683.3/1,568.7 ms** with **1,559/1,465 ms** long tasks; later returns to it have zero long tasks. That new-thread probe intentionally leaves run.queued selected during the append, so the new value has not already been previewed before selection. First selection includes replay/reconstruction work; this does not isolate enumeration CPU time alone.

Explicitly asking for all messages costs **1,624.9/1,752.4 ms** wall time, with **423/376 ms** long tasks. Shrinking costs **157.4/227.1 ms**, with **100/96 ms** long tasks. With all messages mounted, the tested input-fill action takes **202.7/502.1 ms** and Pause-control focus takes **175.1/286.2 ms**, both with zero long tasks in those windows. Pause was focused, not activated; actual pause/resume execution is not newly claimed. The full counts/values, focus positions and task durations remain in the JSON rather than being reduced to a subjective responsiveness claim.

## Every observed long-task entry in the measured page snapshots

Start times below are browser performance.now milliseconds relative to that document navigation. Snapshots can include entries before the action windows, including initial parsing/reconstruction, explicit expansion and live event processing. A snapshot is a page timeline, not a distinct-event count across all files; snapshots of the same page can overlap. The historical helper tab was a state/focus check, not a separate performance profile.

| Page snapshot                                                            | Task start ms | Duration ms |
| ------------------------------------------------------------------------ | ------------- | ----------- |
| [messages-controls-tasks-1440.json](messages-controls-tasks-1440.json)   | 278.8         | 155         |
| [messages-controls-tasks-1440.json](messages-controls-tasks-1440.json)   | 824.8         | 56          |
| [messages-controls-tasks-1440.json](messages-controls-tasks-1440.json)   | 5140.3        | 423         |
| [messages-controls-tasks-1440.json](messages-controls-tasks-1440.json)   | 8503.0        | 106         |
| [messages-controls-tasks-1440.json](messages-controls-tasks-1440.json)   | 8801.1        | 120         |
| [messages-controls-tasks-1440.json](messages-controls-tasks-1440.json)   | 9342.8        | 100         |
| [messages-controls-tasks-390.json](messages-controls-tasks-390.json)     | 427.4         | 73          |
| [messages-controls-tasks-390.json](messages-controls-tasks-390.json)     | 6749.6        | 376         |
| [messages-controls-tasks-390.json](messages-controls-tasks-390.json)     | 11621.7       | 155         |
| [messages-controls-tasks-390.json](messages-controls-tasks-390.json)     | 12053.5       | 92          |
| [messages-controls-tasks-390.json](messages-controls-tasks-390.json)     | 12963.7       | 96          |
| [messages-live-tasks-1440.json](messages-live-tasks-1440.json)           | 535.1         | 293         |
| [messages-live-tasks-1440.json](messages-live-tasks-1440.json)           | 5438.1        | 173         |
| [messages-live-tasks-1440.json](messages-live-tasks-1440.json)           | 5843.5        | 51          |
| [messages-live-tasks-1440.json](messages-live-tasks-1440.json)           | 6217.4        | 51          |
| [messages-live-tasks-390.json](messages-live-tasks-390.json)             | 52.0          | 60          |
| [messages-live-tasks-390.json](messages-live-tasks-390.json)             | 990.7         | 334         |
| [messages-live-tasks-390.json](messages-live-tasks-390.json)             | 6216.3        | 191         |
| [messages-live-tasks-390.json](messages-live-tasks-390.json)             | 6643.4        | 85          |
| [messages-live-tasks-390.json](messages-live-tasks-390.json)             | 6831.4        | 90          |
| [messages-live-tasks-390.json](messages-live-tasks-390.json)             | 7112.1        | 96          |
| [messages-live-tasks-390.json](messages-live-tasks-390.json)             | 7315.7        | 84          |
| [messages-selection-tasks-1440.json](messages-selection-tasks-1440.json) | 278.8         | 155         |
| [messages-selection-tasks-1440.json](messages-selection-tasks-1440.json) | 824.8         | 56          |
| [messages-selection-tasks-390.json](messages-selection-tasks-390.json)   | 427.4         | 73          |
| [wide-all-tasks-1440.json](wide-all-tasks-1440.json)                     | 3680.4        | 212         |
| [wide-all-tasks-1440.json](wide-all-tasks-1440.json)                     | 5660.1        | 650         |
| [wide-all-tasks-1440.json](wide-all-tasks-1440.json)                     | 6311.9        | 940         |
| [wide-all-tasks-1440.json](wide-all-tasks-1440.json)                     | 7839.5        | 659         |
| [wide-all-tasks-1440.json](wide-all-tasks-1440.json)                     | 12252.4       | 196         |
| [wide-all-tasks-1440.json](wide-all-tasks-1440.json)                     | 16977.5       | 214         |
| [wide-all-tasks-1440.json](wide-all-tasks-1440.json)                     | 19344.4       | 204         |
| [wide-all-tasks-1440.json](wide-all-tasks-1440.json)                     | 19887.1       | 215         |
| [wide-all-tasks-1440.json](wide-all-tasks-1440.json)                     | 29311.7       | 216         |
| [wide-all-tasks-1440.json](wide-all-tasks-1440.json)                     | 30044.5       | 210         |
| [wide-all-tasks-1440.json](wide-all-tasks-1440.json)                     | 31003.5       | 206         |
| [wide-all-tasks-1440.json](wide-all-tasks-1440.json)                     | 38721.3       | 1559        |
| [wide-all-tasks-390.json](wide-all-tasks-390.json)                       | 6962.4        | 224         |
| [wide-all-tasks-390.json](wide-all-tasks-390.json)                       | 8150.0        | 679         |
| [wide-all-tasks-390.json](wide-all-tasks-390.json)                       | 8830.5        | 825         |
| [wide-all-tasks-390.json](wide-all-tasks-390.json)                       | 9989.6        | 698         |
| [wide-all-tasks-390.json](wide-all-tasks-390.json)                       | 13550.9       | 271         |
| [wide-all-tasks-390.json](wide-all-tasks-390.json)                       | 18669.0       | 237         |
| [wide-all-tasks-390.json](wide-all-tasks-390.json)                       | 21179.5       | 248         |
| [wide-all-tasks-390.json](wide-all-tasks-390.json)                       | 22169.9       | 235         |
| [wide-all-tasks-390.json](wide-all-tasks-390.json)                       | 28420.8       | 233         |
| [wide-all-tasks-390.json](wide-all-tasks-390.json)                       | 28847.9       | 242         |
| [wide-all-tasks-390.json](wide-all-tasks-390.json)                       | 29395.4       | 235         |
| [wide-all-tasks-390.json](wide-all-tasks-390.json)                       | 33897.2       | 1465        |

## Tests and gates

**77/77 tests in nine affected files pass**: bounded-value, pretty-json-prefix, utils, ThreadViewer, RunInspectorPage, ProgressDrawer, WaitPanel, projections and EventsPage. The new ThreadViewer tests cover the last-50 range, Show all/fewer, exact endpoint text, re-bounding on another thread and the 50-message boundary. Prefix tests cover boxed BigInt TypeError and one cached result per object identity/budget, including an observable public getter and primitive fallbacks. The maintained Edge spec passes **5/5**, including the prior live focus regression, both widths for Result/progress/page width and long wait prompts. Retries are disabled.

The new unit tests and [diff](targeted-change.diff.txt) were read; the old implementation was not re-executed or swapped into production. Their before-fix failure is source reasoning, not a new baseline execution. The current independent failing focus script supplies fresh negative regression evidence for the additional case the maintained tests do not cover. No test-only production hooks or cache monkey-patches were used.

| Exact command                                                                                                                                                                                                                                                                                                                                                                 | Result                                                        | Evidence                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| pnpm.cmd build                                                                                                                                                                                                                                                                                                                                                                | PASS                                                          | [Log](build.log.txt)                      |
| pnpm.cmd --filter @graphgoblin/web exec vitest run src/components/ui/bounded-value.test.tsx src/lib/pretty-json-prefix.test.ts src/lib/utils.test.ts src/runs/inspector/ThreadViewer.test.tsx src/runs/RunInspectorPage.test.tsx src/runs/inspector/ProgressDrawer.test.tsx src/runs/inspector/WaitPanel.test.tsx src/runs/projections.test.ts src/events/EventsPage.test.tsx | PASS                                                          | [Log](focused-tests.log.txt)              |
| pnpm.cmd lint                                                                                                                                                                                                                                                                                                                                                                 | PASS                                                          | [Log](lint.log.txt)                       |
| pnpm.cmd typecheck                                                                                                                                                                                                                                                                                                                                                            | PASS                                                          | [Log](typecheck.log.txt)                  |
| pnpm.cmd --filter @graphgoblin/web exec playwright test --config %TEMP%\gg-qa-e1-r4-playwright.config.mjs                                                                                                                                                                                                                                                                     | PASS                                                          | [Log](playwright.log.txt)                 |
| pnpm.cmd exec prettier --check apps/web/src/components/ui/bounded-value.tsx apps/web/src/lib/utils.ts apps/web/src/lib/pretty-json-prefix.test.ts apps/web/src/runs/inspector/ThreadViewer.tsx apps/web/src/runs/inspector/ThreadViewer.test.tsx                                                                                                                              | PASS                                                          | [Log](source-format.log.txt)              |
| pnpm.cmd check:layers                                                                                                                                                                                                                                                                                                                                                         | PASS                                                          | [Log](layers.log.txt)                     |
| pnpm.cmd check:deps                                                                                                                                                                                                                                                                                                                                                           | PASS                                                          | [Log](deps.log.txt)                       |
| pnpm.cmd check:tokens                                                                                                                                                                                                                                                                                                                                                         | PASS                                                          | [Log](tokens.log.txt)                     |
| pnpm.cmd format:check                                                                                                                                                                                                                                                                                                                                                         | PASS                                                          | [Log](format.log.txt)                     |
| pnpm --filter @graphgoblin/web test:coverage                                                                                                                                                                                                                                                                                                                                  | NOT RUN — full coverage explicitly waived for this round      | User's round-4 scope                      |
| pnpm check:docs                                                                                                                                                                                                                                                                                                                                                               | NOT RUN — no node schema/route changed by the tested UI fixes | [Targeted diff](targeted-change.diff.txt) |
| pnpm check:licenses                                                                                                                                                                                                                                                                                                                                                           | NOT RUN — no dependency change by the tested fixes            | Targeted UI-only scope                    |

No numbered docs, ADRs, CHANGELOG or generated references were edited by QA. Docs 09's once-per-value cold enumeration caveat and the window behavior were read as the intended current behavior. This round makes no main-merge delivery-system acceptance claim. No production thresholds, dependencies or engineering parameters were changed.

# 4. Report path and evidence folder

Report: **docs/qa/2026-10-22-wp-e1-259-qa/round-4/README.md**. Evidence: **docs/qa/2026-10-22-wp-e1-259-qa/round-4/**. Only this directory was added. [Link/path/raw-download validation](validation.json), [validation log](validation.log.txt). Validation checks retention of the two known failures; a successful integrity check does not change the FAIL product verdict.

- [api-key-metadata.json](api-key-metadata.json)
- [browser-environment.json](browser-environment.json)
- [browser-errors.json](browser-errors.json)
- [browser-results.json](browser-results.json)
- [browser.log.txt](browser.log.txt)
- [browser.mjs.txt](browser.mjs.txt)
- [build.log.txt](build.log.txt)
- [deps.log.txt](deps.log.txt)
- [environment.json](environment.json)
- [final-state.json](final-state.json)
- [finish.mjs.txt](finish.mjs.txt)
- [fixtures.json](fixtures.json)
- [fixtures.log.txt](fixtures.log.txt)
- [fixtures.mjs.txt](fixtures.mjs.txt)
- [focus-small-1440-0.png](focus-small-1440-0.png)
- [focus-small-1440-500.png](focus-small-1440-500.png)
- [focus-small-390-0.png](focus-small-390-0.png)
- [focus-small-390-500.png](focus-small-390-500.png)
- [focus-small-repro.json](focus-small-repro.json)
- [focus-small-repro.mjs.txt](focus-small-repro.mjs.txt)
- [focus-small.log.txt](focus-small.log.txt)
- [focused-tests.log.txt](focused-tests.log.txt)
- [format-qa.log.txt](format-qa.log.txt)
- [format.log.txt](format.log.txt)
- [layers.log.txt](layers.log.txt)
- [lint.log.txt](lint.log.txt)
- [make-report.mjs.txt](make-report.mjs.txt)
- [message-focus-after-tab-1440.png](message-focus-after-tab-1440.png)
- [message-focus-after-tab-390.png](message-focus-after-tab-390.png)
- [message-focus-results.json](message-focus-results.json)
- [message-focus.log.txt](message-focus.log.txt)
- [message-focus.mjs.txt](message-focus.mjs.txt)
- `messages-api.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [messages-bounded-1440.png](messages-bounded-1440.png)
- [messages-bounded-390.png](messages-bounded-390.png)
- [messages-controls-1440.png](messages-controls-1440.png)
- [messages-controls-390.png](messages-controls-390.png)
- [messages-controls-tasks-1440.json](messages-controls-tasks-1440.json)
- [messages-controls-tasks-390.json](messages-controls-tasks-390.json)
- `messages-download-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `messages-download-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [messages-live-tasks-1440.json](messages-live-tasks-1440.json)
- [messages-live-tasks-390.json](messages-live-tasks-390.json)
- [messages-selection-tasks-1440.json](messages-selection-tasks-1440.json)
- [messages-selection-tasks-390.json](messages-selection-tasks-390.json)
- `nested-api.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `nested-download-1440.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- `nested-download-390.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [playwright.config.mjs.txt](playwright.config.mjs.txt)
- [playwright.log.txt](playwright.log.txt)
- [prior-evidence-audit.json](prior-evidence-audit.json)
- [run-command.mjs.txt](run-command.mjs.txt)
- [server.log.txt](server.log.txt)
- [server.mjs.txt](server.mjs.txt)
- [setup.mjs.txt](setup.mjs.txt)
- [shutdown.json](shutdown.json)
- [shutdown.log.txt](shutdown.log.txt)
- [source-format.log.txt](source-format.log.txt)
- [targeted-change.diff.txt](targeted-change.diff.txt)
- [tokens.log.txt](tokens.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [validate.mjs.txt](validate.mjs.txt)
- [validation.json](validation.json)
- [validation.log.txt](validation.log.txt)
- `wide-after-api.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [wide-all-tasks-1440.json](wide-all-tasks-1440.json)
- [wide-all-tasks-390.json](wide-all-tasks-390.json)
- `wide-before-api.json.txt` (not kept; see [NOT-KEPT.md](NOT-KEPT.md))
- [wide-preview-1440.png](wide-preview-1440.png)
- [wide-preview-390.png](wide-preview-390.png)

# 5. Observations outside scope

- While the empty run.queued event remains selected, the wide-object append takes **19,729.2/16,640.9 ms** end-to-end and produces seven browser long tasks per width (**196–216 ms** desktop; **233–271 ms** narrow). The empty selected Variables preview remains two characters, so these measurements must not be described as cached-prefix selection work or as a continuously blocked 20-second browser. Live event ingestion/persistence and backend execution were not CPU-profiled here; the existing persistence path is apps/web/src/runs/event-store.ts:73. No causal attribution or out-of-scope fix is claimed.
- Cold/new-thread selection and explicit all-message rendering remain expensive, as recorded above. The tested cache reduces repeated preview work; it does not establish that every first display is free of a long task.
- Broader rounds 1–3 criteria (full adversarial surface matrix, native restart/session-reset campaign, actual screen-reader software and live providers) were not all rerun under this narrowed brief. The current spot-checks and retained historical evidence are distinguished explicitly.
