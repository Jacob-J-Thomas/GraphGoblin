# Issue #207 post-pan Remove causal diagnostic

This packet preserves one bounded native diagnosis. It does not contain a product correction or claim that the post-pan blocker is fixed. The probe used head `64a955887962f72287e532824be1b8cb32c5f055`, tree `a6691516210eb25887cb92abdcbd8c7abe1a4bb3`, stack base `35bb3fbdc724a82064d0d9e65b551608542c6b22`, and actual main `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`.

## Causal observation

On the real Windows Edge post-pan Remove gesture, the probe observed a nonpassive window-capture D3 `click.drag` listener on the same trusted click that failed to remove the selected edge. Its callback was `function tw(e){e.preventDefault(),e.stopImmediatePropagation()}` (SHA-256 `303440642e12553f4bcb6c4ffddd653d74ac256c7565171b4570e74c89530cbf`). The listener remained registered after the drag ended and after the Remove control became visible and enabled. The trusted Remove click was initially uncanceled, then prevented during dispatch; window bubble did not run.

No browser PUT was sent for that blocked click. The public draft and synced IndexedDB still matched the original graph and token `38e0876eeb488d32`. After the listener was observed absent, a later genuine click on the same enabled control removed the same `e5` edge (`subject.decline → work.in`) with one conditional PUT. One Undo sent one conditional PUT and restored the previous graph, original token, and synced device state. The settled success followed a 9-second absent-response observation; this is a diagnostic intervention, not a timing recommendation or bound.

The exact event timeline, API/device state, and cleanup are preserved in the [full causal report](raw/pan-cause-report.md.txt), [structured observation](raw/runs/corrected-decisions-pan-cause/observed.json), [run record](raw/runs/corrected-decisions-pan-cause/run.json), [summary](raw/pan-cause-summary.json), [cleanup](raw/pan-cause-cleanup.json), and [captured post-pan image](raw/runs/corrected-decisions-pan-cause/pan-diagnostic-post-pan.png).

## Boundaries and status

This was one admitted attempt with 19 checkpoints, seven conditional browser PUTs including five setup writes and the positive click/Undo pair, and zero page errors. Before/after bindings report 77 source hashes, 17 embedded modules, and all 1,227 files across 13 artifact trees unchanged (binding SHA-256 `1bd7d02cea6d72f733d1bb075fd57413a14be8aa294316506de8a215091e3dcf`). Both browser sessions and the gateway closed; the recorded port/process/lock/WAL/SHM checks were clear. No rebuild or source change was made.

This diagnostic consumed zero formal scans for #207. The Opus correction remains active; this packet does not claim the correction is complete or establish its behavior. It also does not prescribe a delay, generalize the observed timing, or replace the pending current-target CI and final independent review.

The original [14-file retain manifest](source-retain-manifest.json) is preserved exactly (SHA-256 `e070726cb48e4d102be419a9de24d06dbcd8cc95040f46fb3bd95b493147bd5e`). The [copy manifest](copy-manifest.json), [packet manifest](manifest.json), [local link audit](link-checks.json), and [SHA256SUMS](SHA256SUMS.txt) verify copied bytes and links. `.gitattributes` disables text conversion beneath `raw/`.
