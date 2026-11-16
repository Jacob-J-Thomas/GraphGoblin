# Historical publication-head CI before corrections

These results apply to the original `4dbb0dc` publication. They do not establish CI for the corrected `1a46c30` product or its later evidence publication; that exact-head CI is recorded separately in the PR.

This packet records the first hosted CI attempt for PR #500 at publication head `4dbb0dc185a9419fcebabd85e199dd554c382b4f`, targeting `e21c24be9cef109ef438fd2df4c1583bc570b1cb`. Run [43888944193](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43888944193), attempt 1, completed successfully with no retry. Its synthetic test merge was `dcf097ed963fdbad8c83efd6cc22aa02bb13a3ed`, tree `6fb222d5b1e70ae6aa16c9702a36f12241c82a89`, ordered parents base then head. The full merge metadata and terminal job responses are in [provenance](provenance/) and [step records](steps/).

All four jobs passed: Gates, Browser, Windows launcher and Template image. Their complete decoded connector logs are preserved under [logs](logs/); `*.decoded.log` files are UTF-8 text decoded by the GitHub connector, not raw Actions ZIP log bytes. Per-job steps and terminal metadata are kept alongside them.

## Gates and coverage

All 32 Gates steps succeeded. The coverage run reported 9,721 passed and 49 skipped tests across 13 distinct coverage groups. All 13 line and branch floors met 90%; the lowest line figure was 95.00% and the lowest branch figure was 90.66%. The [coverage artifact](artifacts/coverage-14238007565.zip) is the exact 22,264-byte ZIP returned for artifact 14238007565; its SHA-256 is `afb05b3654d81ec3ce26fe95d9e7c908e90e330de74ef4252f2919ffcb3ca967`, matching GitHub's reported digest. [coverage-members.json](artifacts/coverage-members.json) records all 13 member hashes and coverage summaries without extracting or changing the archive.

The Gates run finished 22 tasks, with 9 cached. Licences passed for 226 packages, generated documentation passed, design contrast had zero failing enforced pairs, and dependency audit reported 8 low and 13 moderate advisories at the configured `--audit-level=high` threshold. These advisories remain part of the result. The Actions-hosted workflow also emitted Node.js 20 deprecation warnings for actions forced onto Node.js 24; project setup reported Node `v22.23.4`.

## Browser, Windows and template qualifications

Browser passed 481 tests with one declared `LIVE` test skipped, one worker and zero retries. `LIVE=0`; the optional stricter `GG_ROUTING_STRICT_PERF` bounds were off. The emitted 300-node frame p95 samples were 49.9, 33.5 and 50.0 ms against the logged 17 ms optional target, so this run does not establish that stricter performance target. Edge was 157.0.4341.60 on a hosted Linux runner; the emitted Windows user-agent is browser metadata, not native Windows evidence.

The Windows launcher job passed 25/25 tests using Node `v22.23.4`. The artifact-upload step itself succeeded, but reported that no `.tmp/windows-launcher-*/` files were found; the terminal run artifact list contains the coverage archive only. No Windows artifact was produced.

The Template image job loaded four catalog entries: `starter` (4 draft nodes), `implementation` (11), `review` (10) and `qa` (11). No separate Routing workflow run was returned for this head.

## Provenance and related evidence

[publication-binding-01.json](provenance/publication-binding-01.json) binds the publication state and frozen launcher source. Earlier candidate CI attempts remain separate: [first attempt](../2026-11-16-bounded-logging-ci-first/README.md) and [Gates-only retry](../2026-11-16-bounded-logging-ci-retry/README.md). This packet does not replace those records or imply that their carried-forward jobs were rerun.

`source-copy-map.json` maps each captured source file to its packet path and records the byte count and SHA-256 checked after copying. `SHA256SUMS.txt` covers every packet file except itself.
