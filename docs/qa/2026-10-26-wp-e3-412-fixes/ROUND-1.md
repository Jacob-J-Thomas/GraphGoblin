# PR #412 independent-verification fixes (#322)

## 1. Branch and worktree

`codex-wp-e3-187-322`, `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-e3-187-322`; base/unchanged HEAD `a5d90fe584b0cb3b9f35cca868edea5b053b5547`. Uncommitted; ready for orchestrator commit after review and the gate dispositions below. No index actions, commits, publication, manual directory cleanup commands, branch changes or sub-agents.

Runtime confirmed in runtime.log.txt: Node `v22.23.4`, executable `%USERPROFILE%\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe`. Every pnpm command uses that runtime first on PATH and calls `pnpm.cmd`. API tests use ports 5600?5699; infrastructure 5650?5949; copied built-API probes use 6350. Data is disposable system-temp `gg-wp-e3-` data. Test fixtures create junctions only within their own disposable directory. The owner app/store and main checkout are untouched.

## 2. Per bolt

All three #322 findings are **confirmed** on the supplied head and fixed:

| Defect                                                | Cause and fix                                                                                                                                                                                                                                                                                                                                                        | Evidence                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retained artifact alias stops resolving after cleanup | FsArtifactStore accepted case-insensitive references but retained JSON proof searched the canonical key. Reads now accept exactly the lowercase canonical form publication returns, including an entire-string check for JavaScript's end-anchor newline exception. Other case, separator, encoding and path-segment aliases are missing.                            | reference-case-before.log.txt reproduces beforeReadable=true / afterReadable=false. reference-case-after.log.txt shows noncanonicalRefused=true before retention; retained canonical references still resolve in the API regression. Download-route test returns 404 for noncanonical stored history and 200 for canonical history. |
| Junction configuration loses retained workspace bytes | The reference check compared lexical paths. It now resolves the owned directory and retained uses/fixed configuration through native filesystem realpath; missing descendants inherit their deepest existing directory ancestor. Equal, containing and contained paths protect. Non-missing errors, non-directory ancestors and proof exhaustion keep the workspace. | reference-alias-before.log.txt loses the directory; reference-alias-after.log.txt keeps it and asserts file bytes. Three API junction scenarios assert unchanged waiting-run records; storage cases cover recorded aliases, missing descendants, Windows case and unknown/deep references.                                          |
| Late approval produces a false no-eligible pass       | Cursor traversal spent an empty pass resetting to the beginning. It now fills the same bounded batch by wrapping; the API also makes a final approved-candidate probe before publishing no-eligible. Unexamined or unknown approvals retain pressure conservatively.                                                                                                 | regressions-before.log.txt reproduces no-eligible while the older approved run remains; focused-api-final.log.txt verifies the next pass deletes it with pressure state. Storage wrap and remaining-candidate status tests cover the component boundaries.                                                                          |

The two external probes/helpers were read and copied from the read-only independent-audit folder. Adaptations: system-temp prefix, allowed port, temp-contained alias assertion, and canonical-refusal/retained-file assertions for the corrected behavior. Neither external audit folder nor its evidence was modified. The late-mark built-API mode also passes: the next pass reports pressure / deletedRuns=1 and the older run returns 404 (late-mark-after.log.txt).

## 3. Files changed

- Infrastructure: `src/fs/artifacts.ts`; existing `fs.test.ts` asserts the canonical contract and uses the requested temp prefix; new `artifact-references.test.ts`; `src/sqlite/history-cleanup.ts` and its test.
- API: `src/history-cleanup.ts` and its test; `src/artifact-integrity.test.ts` adds the download-route boundary check. No route schema, container, shared runs route or generated client edits.
- Documentation: ADR-0060, docs/07, docs/09, existing #322 CHANGELOG upgrade bullet, and this evidence folder.

WAVE shared surfaces: documentation additions only in cleanup-specific regions. No engine, event writer, phase-1 migration/consent, Resume/Replay UI, loop-deletion, API-client or other worker-owned runtime edits. No new dependency or migration.

## 4. Tests

Public interfaces only: actual FsArtifactStore / SQLite storage components and API composition with injected capacity/clock. Built-API probes use real HTTP, SQLite and filesystem with fake execution harnesses; no live-provider behavior is claimed.

Before production edits, the new API scenarios failed 5/17: noncanonical get returned content instead of undefined, all three configured alias scenarios failed with ENOENT after cleanup, and the late-mark status was no-eligible instead of pressure. Exact output is kept in regressions-before.log.txt. Both original built-API failures were also reproduced locally before the fix.

Afterward: focused storage 49/49 across four files; focused API 29/29 across three files. The first post-fix storage run exposed the former uppercase-read assertion and Windows file-as-parent ENOENT behavior; both were corrected in code/assertions before the final focused check. Failed captures remain failed evidence. No retry-to-green, private access, monkey-patching, test-only production export, timeout increase or coverage exclusion. Full suites were each run once after the fixes; focused failures were rerun only after an actual code/assertion correction.

Full API coverage: **PASS**, 98 files passed / 2 skipped; **1,614 tests passed / 12 skipped**. Coverage **96.12% lines / 90.47% branches**. Infrastructure coverage: **98.26% lines / 94.51% branches**; the full runner exits 1 with **830 passed / 6 native failures**. Required outside-sandbox native termination verification is **NOT RUN** under register D-015; these are not passes. Raw failure output is retained in coverage-infrastructure.log.txt. The separate 2,001-path proof-budget regression also passes (workspace-proof-bound.log.txt).

Append-bound measurement rerun with the current complete migration chain: ordinary append **80 VM instructions at 100 and 10,000 rows**, isolated Resume **297 at both sizes**. The public SQLite progress-handler script and bounds are unchanged (append-bound.log.txt).

## 5. Gates

Completed commands and results: `pnpm.cmd build` PASS (11 tasks), `pnpm.cmd typecheck` PASS (20 tasks), `pnpm.cmd lint` PASS (11 tasks), `pnpm.cmd check:migrations` PASS (generation no-op), `pnpm.cmd check:docs` PASS (current), `pnpm.cmd check:layers` PASS, `pnpm.cmd check:deps` PASS (two existing orphan warnings). Typecheck/lint report Turbo cache-write access warnings but their tasks complete successfully.

Full API coverage PASS; infrastructure runner exits 1 on six native termination/readiness cases (D-015), with coverage thresholds exceeded. Owned-file formatting PASS (format-owned.log.txt); the additional proof-budget test was formatted and its infrastructure typecheck/lint checks also PASS. Browser specs are not run: there is no web code change; the server-state regression is tested through API/component interfaces and built HTTP probes. No schema/route changed, so no client/reference regeneration is required; the generated-docs check was nevertheless run. No dependency changes require a license run.

Exact focused / coverage / reproduction commands (capture headers redact the profile path):

```text
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/history-cleanup.test.ts src/sqlite/deletion-eligibility.test.ts src/fs/fs.test.ts src/fs/artifact-references.test.ts --maxWorkers=1
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/history-cleanup.test.ts -t 2000-path --maxWorkers=1
pnpm.cmd --filter @graphgoblin/api exec vitest run src/history-cleanup.test.ts src/artifact-integrity.test.ts src/deletion-eligibility.test.ts --maxWorkers=1
pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=1 --coverage.reportOnFailure --coverage.reportsDirectory=%USERPROFILE%/AppData/Local/Temp/gg-wp-e3-412-api-coverage
pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2 --coverage.reportOnFailure --coverage.reportsDirectory=%USERPROFILE%/AppData/Local/Temp/gg-wp-e3-412-infrastructure-coverage
pnpm.cmd exec node --experimental-import-meta-resolve docs/qa/2026-10-26-wp-e3-412-fixes/reference-probes.mjs case
pnpm.cmd exec node --experimental-import-meta-resolve docs/qa/2026-10-26-wp-e3-412-fixes/reference-probes.mjs alias
pnpm.cmd exec node --experimental-import-meta-resolve docs/qa/2026-10-26-wp-e3-412-fixes/reference-probes.mjs late-mark
```

The infrastructure-only final `pnpm.cmd --filter @graphgoblin/infrastructure typecheck` and `pnpm.cmd --filter @graphgoblin/infrastructure lint` pass after the budget test addition. `pnpm.cmd exec prettier --check` followed by every changed/new TypeScript and Markdown file passes; format-owned-final-readback.log.txt records the complete argument list. Final identity redaction initially changed the report line endings; the readback flagged it, the report was formatted again, and final validation reads files without rewriting them. `python docs/qa/2026-10-25-wp-e3-187/measure-append.py --assert-bounded --measure-resume` passes. `git diff --check` passes.

Every command capture names its exact arguments and exit code. Evidence is UTF-8 with profile/machine/SID redaction, *.log.txt names and the 1,000,000-byte cap; any omitted oversized/compressed capture is recorded in NOT-KEPT.md. Final evidence validation is recorded in evidence-validation.log.txt; all retained files are UTF-8, redacted and below the capture limit. No compressed/oversize capture was retained or omitted, so no NOT-KEPT manifest is needed.

## 6. Docs

ADR-0060 records canonical-reference resolution, physical workspace overlap/unknown protection, finite proof budgets, same-pass cursor wrap and conservative concluding status. Docs/07 and /09 explain the reference/ownership rules and truthful notice. The #322 CHANGELOG **Upgrade:** note requires callers to use the exact canonical reference returned by put; previously accepted case/newline aliases are missing. No stored converter, reset, new migration or API DTO change.

## 7. Decisions and parameters

Canonical artifact spelling is the clean shape explicitly requested in this review. Opaque JSON input may contain arbitrary strings; a noncanonical artifact string cannot resolve bytes. JSON-escaped canonical strings remain protected after decoding.

Native realpath resolves junctions, short names and path aliases. Missing paths resolve through the deepest existing directory and append their missing suffix; errors other than missing, a non-directory ancestor or an exhausted proof are unknown/protected. Compare physical forms case-insensitively on Windows and case-sensitively elsewhere. Keep checks/removal within the existing exclusive resource gate and SQLite transaction. Resolving references does not authorize following links for removal or broaden ownership.

New engineering proof bounds: at most 2,000 workspace paths, at most 64 ancestor attempts per path. These bound background filesystem calls; exceeding a bound keeps resources. Existing 20-root/500-record and 32-resource cleanup bounds, capacity thresholds and one-minute schedule remain unchanged. A concluding candidate check conservatively keeps pressure for protected/unexamined approvals rather than claiming their absence. No per-event or after-write work is added.

## 8. Caveats and open items

Stop here uncommitted for orchestrator review. Independent verification and merge acceptance remain outstanding. No new owner product decision is required. Existing ownership, consent, accounting, retained-resource and bounded-proof limitations still apply; persistent pressure never broadens deletion or triggers reset/compaction.

No API test failed; the 12 skips remain skips. The infrastructure runner records 6 native failures in 4 unchanged files: adversarial process-tree cancellation (EBUSY), Claude deadline/cancellation teardown (2 EBUSY cases), Claude descendant termination (continued writes plus EBUSY), readiness hang classification (stop unconfirmed rather than deadline), and script cancellation (child still alive). Those native checks are **not verified** here; the required outside-sandbox run is **NOT RUN**, as required by [D-015](../../delivery/2026-10-18-i01-i07-register.md) (line 115: sandbox taskkill /T /F denial; reviewers must run them outside the sandbox). The readiness outcome is consistent with unconfirmed stop, not evidence of successful termination. No native production/test body was changed or retried. All changed storage/artifact cases pass in the full infrastructure run, including the added budget test. Native fixture cleanup errors are left as recorded; no manual process/directory cleanup was attempted. An optional read-only process-inventory diagnostic (`Get-CimInstance Win32_Process`) was denied by the sandbox; no escalation or repeated attempt was made. This was not a native test pass (D-015). Native tests denied by the sandbox are reported as not run.
