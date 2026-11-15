# Initial CI evidence for PR #478 at the stacked #207 candidate

This external packet preserves the five original CI log files and the completed-job metadata for the initial CI at the frozen stacked candidate. The raw logs are copied byte-for-byte under `logs/`. Browser failed, so this is **not a green CI result or readiness evidence**.

## Candidate and run identity

- Head: `64a955887962f72287e532824be1b8cb32c5f055`; tree: `a6691516210eb25887cb92abdcbd8c7abe1a4bb3`.
- Stack comparison base: `35bb3fbdc724a82064d0d9e65b551608542c6b22`; actual main: `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`.
- Main CI run: `43643000955`; separate routing run: `43643000960`.
- This is the initial run evidence for PR #478 as DRAFT at this same candidate. No retry is recorded. No final-main integration, owner acceptance, or release readiness is claimed.

## Recorded results

The main CI run completed four jobs: Windows launcher, Template image, and Gates passed; Browser failed. The separate Routing run passed its two ordinary performance scenarios.

| Job                 | Result              | Observed scope                                                                                                                                                                                                                                                                            |
| ------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows launcher    | PASS, first attempt | 14 acceptance tests passed; 0 failed or skipped. The test duration was about 79.4 seconds.                                                                                                                                                                                                |
| Template image      | PASS, first attempt | The distributed image loaded starter (4 nodes), implementation (11), review (10), and QA (11) templates without network access or writable storage.                                                                                                                                       |
| Gates               | PASS, first attempt | Build, typecheck, lint, format, layer/dependency checks, generated docs, acceptance suites, license check, and package coverage gates completed.                                                                                                                                          |
| Browser             | **FAIL**            | 480 tests with one worker and `--retries=0`: 478 passed, 1 skipped, 1 failed. The sole failure was `decision-routes.spec.ts:254`; its assertion at line 286 waited for edge `e5` and did not find it after the third ID clear recorded by the run. No failure retry or rerun is included. |
| Routing performance | PASS, separate run  | Two ordinary performance scenarios ran with three five-second drags each; strict manual performance mode was unset. See the qualification below.                                                                                                                                          |

The Browser job ran against the built app on Edge. Its coverage/exclusions step passed. The one skipped test was the live Codex-provider inference flow (`live.spec.ts`); the run reports no other functional spec skipped or gated on provider login or installed CLI. The selected suite included the isolated API restart/recovery scenario.

Observed command provenance from the retained logs:

- Windows: `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm test:windows-launcher` (which ran `node --test tooling/scripts/windows-launcher.acceptance.mjs`).
- Template image: image build followed by a `docker run` check with `--network none --read-only --cap-drop ALL --security-opt no-new-privileges`.
- Routing: `pnpm --filter @graphgoblin/web exec playwright test e2e/routing.spec.ts --grep 'performance:' --retries=0`.
- Gates: `pnpm exec turbo run test:coverage --concurrency=1`, `pnpm typecheck`, `pnpm lint`, and `pnpm audit --audit-level=high`.
- Browser: `pnpm exec playwright test --retries=0 --workers=1`.

## Coverage and dependency audit

The Gates job ran `test:coverage` across 13 packages and passed its coverage thresholds. For `@graphgoblin/web`, the log records 207 test files and 2,589 tests passed; coverage was 97.63% statements, 94.12% branches, 97.14% functions, and 98.55% lines. These are the web package figures, not a single repository-wide aggregate.

The dependency-audit command was `pnpm audit --audit-level=high` and passed that threshold. Its output still reported 21 vulnerabilities: 8 low and 13 moderate. This is not a zero-advisory result or a general security clearance.

## Routing performance qualification

The separate Routing run reported Edge 157 at a 1440 × 900 viewport. For 100 nodes / 200 edges, the three routing p95 samples were 2.4, 4.4, and 4.4 ms (reported median 4.4 ms); frame p95 was 16.8 ms in each run. For 300 nodes / 600 edges, routing p95 samples were 4.4, 3.9, and 3.4 ms (reported median 3.9 ms); frame p95 was 33.2–33.3 ms.

The measurement output lists a 17 ms frame target, but `GG_ROUTING_STRICT_PERF` was empty. Therefore the passing Routing job is an ordinary performance-test pass, not strict frame-budget acceptance. The 300-node frame measurements exceeded the listed target.

## Evidence and integrity

- [Windows raw log](logs/windows.log)
- [Template image raw log](logs/template.log)
- [Routing raw log](logs/routing.log)
- [Gates raw log](logs/gates.log)
- [Browser raw log](logs/browser.log)
- [Completed-job metadata](completed-jobs.json)
- [Original log manifest](log-manifest.json), including the five original log sizes and SHA-256 values
- [Retained decode helper](decode-logs.mjs); it is preserved as evidence and was not rerun during this curation.

`retained-files-manifest.json` records exact source paths, byte counts, and SHA-256 values for the eight copied source records. `SHA256SUMS.txt` covers all packet files except itself. `link-checks.json` records local README links resolved in this packet. `.gitattributes` disables text conversion so the original logs and metadata retain their bytes. Transport JSON duplicates are omitted.
