# #208 history stationarity baseline evidence

This packet preserves the completed measurement-only stationarity baseline for the history controls. It records geometry and interaction observations on a stacked #207 phase-2 build. It is not final-main acceptance, does not fix or clear the known post-pan Remove issue, and does not establish readiness or owner acceptance.

## Identity and outcome

The final worker handoff is [preserved byte-for-byte](evidence/resume/handoff.md.txt), SHA-256 **f880198b8f6399bb93c6edc5929d356e1396f845d484b4b8d5aae4e2e66200d9**. The completed worker was verified as Claude Sonnet 5.5, exit 0. The measured subject was head **64a955887962f72287e532824be1b8cb32c5f055**, tree **a6691516210eb25887cb92abdcbd8c7abe1a4bb3**, stacked on base **35bb3fbdc724a82064d0d9e65b551608542c6b22**, with actual main **a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c**. This baseline predates corrected #474 integration.

Across 46 isolated runs and 433 recorded add/history actions, the handoff reports:

- H1 reproduced: content and save/publish label width moved right-aligned history controls in all four configurations.
- H2 reproduced at constructed wrap boundaries and with a long name in the narrow viewport; ordinary short names did not wrap at 768 or 512 CSS pixels.
- H3 reproduced a 1 px pressed translation and a real lost Undo action for a 250 ms hold on the top pixel row. Touch-hold behavior remains unresolved.
- H4 reproduced toolbar displacement for browser-offline and failed transport conditions. HTTP 500 did not produce the connection banner or geometry shift and is retained as a negative control.

The [complete handoff](evidence/resume/handoff.md.txt), [46-run matrix](evidence/resume/analysis/matrix.md.txt), [all result tables](evidence/resume/analysis/report-tables.md.txt), and [H2 boundary summary](evidence/resume/analysis/h2tune-summary.md.txt) summarize all cases. All 46 run-summary JSON files are retained; the [copy manifest](copy-manifest.json) enumerates every copied file. Raw actions, frames, observed data, browser logs, and run screenshots are selected representatives from ten runs, not all 46 runs.

## Representative raw traces

The selected raw-run sets preserve causal witnesses across all four hypotheses and controls:

- H1: [m2-h12 D1 frames](evidence/resume/runs/m2-h12-d1/raw/m2-h12-d1.frames.json), [actions](evidence/resume/runs/m2-h12-d1/raw/m2-h12-d1.actions.json), and [observed summary](evidence/resume/runs/m2-h12-d1/observed.json).
- H2 narrow-wrap witness: [m2-h12held R512 frames](evidence/resume/runs/m2-h12held-r512/raw/m2-h12held-r512.frames.json) and [actions](evidence/resume/runs/m2-h12held-r512/raw/m2-h12held-r512.actions.json). Boundary runs: [h2tune2 D1 frames](evidence/resume/runs/h2tune2-d1/raw/h2tune2-d1.frames.json) and [D2 frames](evidence/resume/runs/h2tune2-d2/raw/h2tune2-d2.frames.json). The retained [first D1 candidate-conflict run](evidence/resume/runs/h2tune-d1/raw/h2tune-d1.frames.json) documents the fixture correction.
- H3: [m2-h3 D1 frames](evidence/resume/runs/m2-h3-d1/raw/m2-h3-d1.frames.json) and [actions](evidence/resume/runs/m2-h3-d1/raw/m2-h3-d1.actions.json).
- H4: browser-offline [frames](evidence/resume/runs/m2-h4offline-d1/raw/m2-h4offline-d1.frames.json), failed-transport PUT-only [frames](evidence/resume/runs/m2-h4transportput-d1/raw/m2-h4transportput-d1.frames.json), and failed-transport-all-requests [frames](evidence/resume/runs/m2-h4transportall-d1/raw/m2-h4transportall-d1.frames.json).
- Negative HTTP 500 control: [frames](evidence/resume/runs/m2-h4http500-d1/raw/m2-h4http500-d1.frames.json) and [actions](evidence/resume/runs/m2-h4http500-d1/raw/m2-h4http500-d1.actions.json).

The packet retains all 24 central screenshots. Examples include the [D1 rest image](evidence/resume/screens/m2-h12-d1-rest.png), [narrow wrap](evidence/resume/screens/m2-h12held-r512-published.png), [failed-transport banner](evidence/resume/screens/m2-h4transportall-d1-fault-on.png), and [HTTP 500 control](evidence/resume/screens/m2-h4http500-d1-fault-on.png).

## Fixture corrections and historical records

The measurement budget was two corrections, and both are exhausted:

1. m1's nominal light configuration changed the operating-system preference but left the GraphGoblin app theme dark because the app follows its own theme setting. m1 also matched an in-page save notice as a shell banner, used fractional hit probes that missed engine snapping, and used mouse clicks for coarse-pointer palette adds. m2 set and checked the app theme, separated shell and in-page notices, added integer-aligned and edge-click checks, and used touch taps for coarse adds. The m1 runs remain unchanged as historical measurements.
2. The first H2 boundary run failed because candidate k70 reused a loop name already created by calibration. The retained h2tune2 runs reuse the recorded loop ID for matching candidate lengths.

The [fixture-budget readback](evidence/root/ui-208-stationarity-fixture-budget-readback.md.txt) is a historical readback of an earlier draft; its bound handoff hash **bf2e6a4ccb6004ac1c62e1fb1c03c3992dbee3fb4b2a52206e6a7d343eb4207e** and its “Used so far: 0” note are stale for the final handoff. Its own SHA-256 is **36d4872d4f046aab29d4fc07eb4b2e8d7987a3d2b4010fbede1048f75a0f71c7**. The final handoff correctly records 2/2 corrections.

The auxiliary m2 notices text field contains the disclosed regex typo /s+/g instead of /\s+/g; it can corrupt that auxiliary text and must not be used to infer notice content. Raw banner, save, validation, and geometry observations are recorded separately. The initial session ended at its quota limit before producing stationarity metrics; its [exact report](evidence/initial-quota/report.md.txt) and [exit metadata](evidence/initial-quota/exit.json) are retained.

## Limits and disposition

This is one headless Edge environment on the stacked source, not a physical-device test. The root font stayed 16 px. R512 used viewport/DPR reflow emulation and is not actual browser text zoom; text-size scaling was not varied. Touch-hold remains unresolved. Other limits and untested states are listed in the [final handoff](evidence/resume/handoff.md.txt).

The [root disposition](evidence/root/ui-208-stationarity-root-disposition.md.txt), SHA-256 **9ddc2a88896881c6ce60af2ffb8cea3b767778aab8b8b24b84c50e1a7e96ee81**, accepts H1–H4 as cause evidence for the approved implementation direction. It also preserves the limits above and records no owner acceptance. This packet itself is evidence curation, not a formal review: zero formal scans were consumed for the stationarity PR. At preparation, source implementation was active; corrected native geometry/action checks, independent review, fresh Astra review, and current-target CI remained pending.

The complete before/after binding snapshots are retained: [rebind before](evidence/resume/binding/rebind-before.json) and [rebind after](evidence/resume/binding/rebind-after.json), both SHA-256 **1bd7d02cea6d72f733d1bb075fd57413a14be8aa294316506de8a215091e3dcf**. The final [quiescence record](evidence/resume/cleanup/quiescence-final.json), SHA-256 **67d1b7f7b0c99eb807b6e10b658fc94c4f2437372223bbb23186787f37a807c5**, reports 46 runs, zero invalid resources, and zero test-owned processes, listeners, stores, or SQLite lock files. The earlier [flagged audit](evidence/resume/cleanup/quiescence-first-audit-flagged-reuse-and-runner.json) is retained with its PID-reuse qualifications.

## Copy scope and integrity

The external source tree was inventoried at 1,117 candidate files / 95,681,867 bytes, largest 3,454,362 bytes; it remains external and is not all published here. This packet contains 234 byte-verified source copies totaling 25,546,014 bytes, largest 3,379,322 bytes. It excludes raw model events/results/thinking, credentials, private profiles, caches, stores, and SQLite data. Markdown evidence copies use .md.txt names to preserve their original bytes without rendering them as packet pages.

See the [copy manifest](copy-manifest.json), [packet manifest](manifest.json), [local link checks](link-checks.json), and [SHA-256 checksums](SHA256SUMS.txt). .gitattributes disables text conversion under evidence/.
