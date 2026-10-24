# Orchestrator dispositions for the #240 QA (2026-10-24)

## Round 1 at `fb37c1b0`: FAIL

Four defects (a failed Refresh dropped all loaded rows; no clear controls for URL filters; no position status after Refresh; a pending arrival notice hid the failed-check status). All four were fixed in the implementer's round 3 (`docs/qa/2026-10-23-wp-g2-240/round-3/`).

## Round 2 at `cc1c3fce`: product checks pass; one gate failure re-run in CI

The QA verified all four fixes and passed all 70 browser checks at 1440 and 390 px, including the late-response, double-Refresh and clear-during-Refresh races and the other pages that share `HistoryState`. Its only failure was the full web coverage gate, where Vitest could not start one worker on the saturated host: 130 files and 1,642 tests passed (98.88% lines, 95% branches), the omitted file passed alone. Under register D-032 a load-class failure is re-run, never waived: CI ran the full web suite at this head (`cc1c3fce`, Gates job green), which is the clean re-run. No product defect remains open.

## Record edits by the orchestrator

The user name in two QA finalize scripts' path-detector patterns (`finalize.mjs.txt`, `round-2/finalize.mjs.txt`) is replaced by `%USERNAME%`, and the local profile path in `round-2/web-coverage.log.txt` by `%USERPROFILE%`. The scripts are kept as records; they are not run from these copies.
