# Space cards and history source integration

This packet records the accepted source integration that stacked Space cards changes onto the history candidate. It is source-preparation and focused-test evidence. It does not establish final actual-main integration, build readiness, native/browser behavior, current CI, formal review, or owner acceptance.

## Integrated commit

- Root commit: `20875894b0f2a9206141f3c469c649d7155d3e45`, tree `b23ac01c96358443047067cd9fd26d2e3afe4b86`.
- Parents, in order: `608864748e84fd0a7d4ae9d04495da92d509f721` and history candidate `6b0eae62ea98ae73b22903c9922bba198e219608`.
- The read-only commit identity receipt confirms the commit, tree, parents, and subject. The worker handoff records the pre-merge `HEAD`, `MERGE_HEAD`, and merge base.
- The worker resolved conflicts in four allowlisted files and left its index unchanged. Root then resolved only the `.gitattributes` conflict, preserving both rules, and committed the integration. The exact root acceptance record and root script are preserved; the script is included as provenance and was not executed during this curation.

## Focused verification and first failure

The first focused Vitest invocation covered 12 files. Seven files and 205 tests passed; five suites failed to load because `Canvas.tsx` declared `generation` twice. No test assertion failed in that run. The worker removed the identical duplicate declaration and reran only those five affected files: all five files and 122 tests passed. Combined evidence is **327 passing tests across two runs**, not one all-green first run; the seven initially passing files were not rerun.

The focused web typecheck, scoped ESLint, and Prettier check each exited 0. The packet preserves both test logs, the initial load failure, the one-line correction patch, and the pre-fix file. The handoff documents the exact commands and file scope.

## Source-resolution record

The worker handoff explains how both parents' contracts were retained across `Canvas.tsx`, `store.ts`, `docs/09-frontend-and-pwa.md`, and `docs/guide/02-build-a-loop.md`. It records the retained Space and history behavior, the one duplicate-declaration correction, and the source hashes. Root acceptance records the accepted four-file hashes and the product delta.

The worker's `docs/qa/.gitattributes` conflict was still unresolved at handoff time. Root's later acceptance removed only that conflict, keeping both attribute rules. The worker's before/after index hashes match; this refers to the worker's integration phase before root staged and committed the accepted merge.

## Limits and remaining gates

- Verification was focused jsdom testing, scoped typecheck, lint, and formatting. Full suites, coverage, repository-wide gates, build, browser/native QA, providers, and ports 4747/4748 were not run here.
- The history candidate was a parent of this stacked source commit. Final actual-main integration and its current CI remain pending, as do native QA, a fresh formal review, and owner acceptance.
- These tests do not prove native first-input delivery, browser hit testing/click counting, physical touch, real viewport measurement, or the result hold's box at documented viewports.
- The handoff notes that no test asserts the offer buttons under a card-drag gate state. The pile disappears after a threshold-crossing card drag and is hidden while dragging; this observation does not substitute for native coverage.
- No formal review scan was consumed by this source integration.

## Preserved files and integrity

The [full accepted worker handoff](handoff.md.txt), [worker SHA index](SHA256SUMS.txt), [root acceptance](root-acceptance.json), [exact root acceptance script](root-accept-merge.mjs), safe [worker exit record](exit.json), and [read-only merge identity receipt](root-merge-commit-identity.txt) are included. The worker index's 40 entries total 1,076,427 bytes and all verified against source before copying. The [curation manifest](curation-manifest.json) maps every copied source path to its packet path and SHA-256. [SHA256SUMS](SHA256SUMS) covers packet files except itself; [local-link checks](link-checks.json) records this README's link validation.

All 40 indexed worker artifacts are byte-exact. The only filename change is `handoff.md` → `handoff.md.txt`; its bytes and hash are unchanged. The worker index itself, root acceptance, exact root script, safe exit record, and read-only commit receipt are additional preserved provenance. Private `events.jsonl`, `result.json`, `latest.md`, and `launch.json` were excluded; the optional redundant `report.md` and empty `stderr.log` were also omitted. The full handoff is the source of truth for the integration.
