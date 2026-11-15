# PR #482 corrected publication-head CI evidence

This packet records the fresh CI and routing workflows for PR #482 at publication head `e1237593babd4d03466b91685fc05dbe49223b2a` (tree `57541f0423de585307f5d7db27923ddac41d7181`), against `main` at `177f3a7d57768c88f19c6bb4d8ef2b272c1e91bd`. Both workflows completed successfully on attempt 1. No workflow was rerun.

The source commit has sole parent `b043d3b8baafdff742803ae46750c8664067f3c7`. GitHub’s synthetic tested checkout was merge commit `2a3ae36fdd72ebceacbfbe2d4f21d5e10c75ad13`, tree `57541f0423de585307f5d7db27923ddac41d7181`, with parents in order: exact target `177f3a7d57768c88f19c6bb4d8ef2b272c1e91bd`, then head `e1237593babd4d03466b91685fc05dbe49223b2a`. All five job logs record this checkout; final GitHub ref and commit readbacks agree. See [tested checkout identity](tested-checkout-identity.json).

The original failed publication-head evidence remains in the preserved [original CI packet](../2026-11-15-space-cards-current-ci/README.md) and was not changed. These corrected results apply only to head `e1237593…` and target `177f3a7d…`.

## Workflow results

| Workflow            | Run / attempt                                                                                              | Result  | Started (UTC)       | Completed (UTC)     |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ------- | ------------------- | ------------------- |
| CI                  | [43698926003](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43698926003), run 877 / attempt 1 | success | 2026-11-15 09:22:15 | 2026-11-15 09:51:09 |
| Routing performance | [43698925969](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43698925969), run 274 / attempt 1 | success | 2026-11-15 09:22:15 | 2026-11-15 09:24:41 |

| CI job              | Job ID / attempt   | Result and step qualification                                                                                                                                |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gates               | `132765496147` / 1 | Success; all 32 recorded steps succeeded. Turborepo reported 22/22 tasks successful, including nine cached build tasks.                                      |
| Template image      | `132765496370` / 1 | Success; six recorded steps succeeded.                                                                                                                       |
| Windows launcher    | `132765496437` / 1 | Success; 14/14 native tests, zero skipped. The evidence upload step found no `.tmp/windows-launcher-*/` files, so no Windows evidence artifact was uploaded. |
| Browser             | `132765496455` / 1 | Success; 481 passed, one declared live-provider test skipped. The conditional browser-failure-evidence upload step was skipped after the suite passed.       |
| Routing performance | `132765496037` / 1 | Success; all 14 recorded steps succeeded, including both drag-size groups.                                                                                   |

Node-based jobs logged Node `v22.23.4`; pnpm was `12.8.1`. Browser acceptance built 12 tasks with zero cache hits and ran Playwright on Edge with `--retries=0 --workers=1`.

## Gates coverage

The Gates job ran coverage for 13 workspace packages. Across those groups, **9,567 tests passed, 41 were skipped, and zero failed** (9,608 total); 600 test files passed and eight were fully skipped (608 total). Every package exceeded the repository’s 90% line and branch thresholds.

| Package                       | Tests passed / skipped | Files passed / skipped |         Lines covered |       Branches covered |
| ----------------------------- | ---------------------: | ---------------------: | --------------------: | ---------------------: |
| `@graphgoblin/contracts`      |                304 / 0 |                 27 / 0 |     499 / 502 (99.4%) |     216 / 228 (94.73%) |
| `@graphgoblin/domain`         |                459 / 0 |                 29 / 0 |  1558 / 1578 (98.73%) |   1646 / 1713 (96.08%) |
| `@graphgoblin/engine`         |               1795 / 0 |                 65 / 0 |     3366 / 3470 (97%) |   3131 / 3428 (91.33%) |
| `@graphgoblin/adapter-codex`  |                641 / 5 |                 16 / 1 |    520 / 524 (99.23%) |     479 / 502 (95.41%) |
| `@graphgoblin/infrastructure` |               1149 / 8 |                 74 / 0 |   3836 / 3922 (97.8%) |   3267 / 3506 (93.18%) |
| `@graphgoblin/adapter-jev`    |                 34 / 5 |                  1 / 2 |       83 / 84 (98.8%) |       60 / 62 (96.77%) |
| `@graphgoblin/api-client`     |                103 / 0 |                 11 / 0 |      315 / 315 (100%) |      217 / 223 (97.3%) |
| `@graphgoblin/api`            |              1917 / 20 |                122 / 4 |  3833 / 4002 (95.77%) |   2983 / 3294 (90.55%) |
| `@graphgoblin/mcp`            |                 62 / 0 |                 12 / 0 |    255 / 263 (96.95%) |     229 / 243 (94.23%) |
| `@graphgoblin/web`            |               2911 / 0 |                224 / 0 | 11754 / 11920 (98.6%) | 12486 / 13239 (94.31%) |
| `@graphgoblin/plugin-claude`  |                  8 / 0 |                  1 / 0 |         38 / 40 (95%) |       20 / 21 (95.23%) |
| `@graphgoblin/plugin-codex`   |                  9 / 1 |                  1 / 1 |      65 / 68 (95.58%) |       22 / 24 (91.66%) |
| `@graphgoblin/tooling`        |                175 / 2 |                 17 / 0 |  1872 / 1932 (96.89%) |   1288 / 1405 (91.67%) |
| **Total**                     |          **9567 / 41** |            **600 / 8** |      All 13 above 90% |       All 13 above 90% |

Skipped test cases are counted in the package table and retained in the full Gates log. Files containing skipped test cases were:

- `@graphgoblin/adapter-codex`: `src/live.test.ts` (4) and `src/cli.test.ts` (1).
- `@graphgoblin/adapter-jev`: `src/primitive-live.test.ts` (1) and `src/live.test.ts` (4).
- `@graphgoblin/infrastructure`: `src/process/scripts.test.ts` (3), `src/fs/fs.test.ts` (1), `src/claude/process.test.ts` (1), `src/claude/readiness.test.ts` (2), and `src/process/script-recovery.test.ts` (1).
- `@graphgoblin/api`: `src/reset/reset.test.ts` (7), `src/shutdown-console.test.ts` (3), `src/shutdown-process.test.ts` (2), `src/reset/reset-locked-plan.test.ts` (1), `src/live.test.ts` (3), `src/perf.test.ts` (1), and `src/reset/reset-sockets.test.ts` (3).
- `@graphgoblin/plugin-codex`: `src/live.test.ts` (1).
- `@graphgoblin/tooling`: `plugin-output.test.mjs` (2).

No other package coverage suite skipped tests. The Browser job’s one skip was `live.spec.ts` / `LIVE: build, publish, and run an inference loop against Codex from the UI`; the job summary says no other functional spec was skipped or gated on provider login or an installed CLI.

## Browser, Windows and template results

- **Browser:** 481 passed and one declared live-provider skip in 27.3 minutes, with zero retries and one worker. The built-app test suite, browser coverage/exclusion step, type/build work and functional checks succeeded. No browser-failure artifact was needed.
- **Windows launcher:** 14 passed, zero skipped. The job’s upload warning is limited to the absence of `.tmp/windows-launcher-*/` files; it does not change the test result.
- **Template image:** read-only/offline validation loaded all four shipped templates: `starter` (4 draft nodes), `implementation` (11), `review` (10), and `qa` (11). The image build logged `[WARN] Shared workspace lockfile detected but configuration forces legacy deploy implementation`; the job succeeded.

## Routing performance

The active limits were median routing p95 below 8 ms and every drag below 16 ms. The routing workflow passed both groups:

| Graph                 | Routing p95s     | Median | Frame p95s          |
| --------------------- | ---------------- | ------ | ------------------- |
| 100 nodes / 200 edges | 6.2, 6.6, 4.4 ms | 6.2 ms | 33.4, 50.0, 33.4 ms |
| 300 nodes / 600 edges | 6.8, 5.4, 5.0 ms | 5.4 ms | 50.0, 49.9, 33.4 ms |

`GG_ROUTING_STRICT_PERF` was empty, so the optional strict manual frame target of 17 ms was not enabled. All six recorded frame p95 values exceeded 17 ms. There was no controlled pre-change timing baseline; this packet makes no claim about a regression or 60 Hz rendering.

## Warnings and artifacts

- `pnpm audit --audit-level=high` succeeded and reported 21 advisories: 8 low and 13 moderate. No high-severity advisory caused a gate failure.
- Node emitted deprecation warnings for `url.parse()` (`DEP0169`) and `punycode` (`DEP0040`). GitHub Actions also warned that the affected v4 actions target Node 20 and were forced to run on Node 24.
- The Windows job did not produce a native evidence artifact because its upload path had no matching files. The Browser failure-evidence upload was conditionally skipped because the suite succeeded.
- The CI run uploaded a `coverage` artifact (ID `14156301864`, 21,976 bytes); the Routing run uploaded `routing-performance` (ID `14155473699`, 1,820 bytes). Artifact API metadata is preserved; the ZIP payloads remain on GitHub and were not copied into this packet.

## Retained records

- [Gates decoded log](job-132765496147-gates.log) and [step summary](job-132765496147-gates-steps.json).
- [Browser decoded log](job-132765496455-browser.log) and [step summary](job-132765496455-browser-steps.json).
- [Template image decoded log](job-132765496370-template-image.log) and [step summary](job-132765496370-template-image-steps.json).
- [Windows launcher decoded log](job-132765496437-windows-launcher.log) and [step summary](job-132765496437-windows-launcher-steps.json).
- [Routing decoded log](job-132765496037-routing.log) and [step summary](job-132765496037-routing-steps.json).
- Final raw workflow/job/artifact snapshots: [CI run](run-43698926003-final.json), [CI jobs](jobs-43698926003-final.json), [CI artifacts](artifacts-43698926003-final.json), [Routing run](run-43698925969-complete.json), [Routing jobs](jobs-43698925969-complete.json), and [Routing artifacts](artifacts-43698925969-complete.json). Initial and in-progress snapshots are retained separately; final snapshots establish terminal status.
- GitHub Git database readbacks: [head commit](head-commit-final.json), [target ref](base-main-ref-final.json), [merge ref](merge-ref-final.json), and [tested merge commit](tested-merge-commit-final.json).
- [Log byte/hash manifest](log-manifest.json), [fresh log readback receipt](log-readback.json), and [SHA-256 inventory](SHA256SUMS).

All five decoded logs were fetched again after completion. Their UTF-8 byte lengths and SHA-256 hashes match the saved files exactly. The original `current-ci` directory remains separate and unchanged.
