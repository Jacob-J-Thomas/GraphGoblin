# WP-F2b #204 round 4

## 1. Branch and worktree

Branch `codex-wp-f2b-harness-switch` (PR #378), worktree
`.claude/worktrees/codex-wp-f2b-harness-switch`. Starting HEAD was verified as
`fb89122f1f845c25808b680210f6ba76936d40ec`, with a clean worktree. Changes are uncommitted;
ready for orchestrator commit. A new independent exact-head sign-off is required before merge. This report
covers only round 4, not completion of I06 or its other bolts.

## 2. Per bolt

### #204 N1: cancelled-switch waiting notice

**Confirmed on the original production code.** Hold initial Settings, request Claude on an explicit
Codex / Astra / minimal node, edit the prompt, then release Settings. The component test verifies
that Codex, the original model/effort and the edited prompt remain; it then fails because the
waiting notice still promises that the harness change will apply:

```text
Error: expect(element).not.toBeInTheDocument()
expected document not to contain element, found <p ... role="status">
  Waiting for the first model catalog, Settings and readiness checks to finish... The harness change will apply when they finish.
</p> instead
```

The new served `pending-prompt-edit` case reproduced the same defect in Edge against the built
API/web and native synthetic CLIs before the fix:

```text
FAIL pending-prompt-edit: expect(locator).toHaveCount(expected) failed
Locator: getByText(/The harness change will apply/)
Expected: 0
Received: 1
Timeout: 5000ms
```

Only test/fixture files had changed at those reproductions. The production fix first rejects an
outdated attempt by its existing request counter. For the current attempt, a changed form snapshot
clears its notice and returns. That preserves the concurrent edit and prevents an older attempt
from clearing a newer attempt's notice. Direction/default selection and query/probe behavior are
unchanged. After-fix component and served results pass as recorded below; the old failing
observations are retained separately.

### #204 N4: client upgrade instruction

The existing #204 CHANGELOG bullet now includes:

> **Upgrade:** rebuild the API and web app together with the regenerated client for the required
> `ecosystemDefault` catalog response field. No store migration or reset is needed.

The same bullet names cancellation clearing the waiting notice. No contract or stored value changes
are introduced in this round; this documents the already-delivered response requirement.

### #204 N2: qualification of the no-extra-request check

`B1-all-failed` now observes `requestfinished` separately for catalog, Settings and preflight.
Bootstrap retries each failed query once: the check waits for both responses for every lookup,
network idle, and the terminal catalog and Codex-preflight Retry controls before taking its request
baseline. Both inherited switches still assert unchanged request counts, and now unchanged
finished-response counts too. The check records its settled baseline.

The full 27-case replay passes; the final paired N1/N2 qualification passes too. Both record
`initiallySettled`, `before`, and `after` as `{catalog:2,settings:2,preflight:2}`. No product change was made
for N2; the audit's earlier extra requests remain a qualified observation, not a clean replay pass
or an established runtime defect.

## 3. Files changed

Line ranges are relative to the final round-4 source; every shared-file edit is listed.

| Area / file                                                        | Changed lines                            | Purpose                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Web: `apps/web/src/editor/HarnessField.tsx`                        | 72-76                                    | Clear only the current cancelled attempt's notice.                                               |
| Web: `apps/web/src/editor/harness-switch.test.tsx`                 | 6, 362-416                               | Real editor operations for concurrent prompt editing and newer-attempt notice protection.        |
| Shared docs: `docs/09-frontend-and-pwa.md`                         | 707-709                                  | Describe cancellation notice ownership.                                                          |
| Shared docs: `CHANGELOG.md`                                        | 7                                        | Add N1 behavior and the required client upgrade instruction.                                     |
| QA-owned: `docs/qa/2026-10-22-wp-f2b-qa/round-3/served-checks.mjs` | 10-17, 19, 50, 301, 1116-1145, 1200-1254 | Run settings, settled failed-lookups baseline, and the served N1 regression.                     |
| New evidence: `docs/qa/2026-10-22-wp-f2b-round-4/`                 | New files                                | This report, path-redacted logs, and current before/after observations and process-exit records. |

Production changes are confined to `HarnessField.tsx`; the remaining edits are its component
tests, docs/CHANGELOG, the allowed served-check script and new round-4 evidence. Under `docs/qa/2026-10-22-wp-f2b-qa/`, only `round-3/served-checks.mjs` is edited:

- Add response-settlement synchronization and retain the no-extra-request assertion for `B1-all-failed`.
- Add the `pending-prompt-edit` served regression for N1, including save/reopen preservation.
- Add optional `QA_PORT` and `QA_OUTPUT_DIR` so this round can use port 5672 and write new results
  outside the protected evidence directory; the prior port/output defaults remain available.
- Add `QA_TEMP_PREFIX` for this round's `gg-wp-f2b-served-` directories and record the selected port.
  Its default retains the historical prefix so the protected cleanup script remains compatible.

The six round-3 logs, manifest hashes and all other prior QA evidence are untouched.

## 4. Tests

Old-code component reproduction command:

```powershell
pnpm.cmd --filter @graphgoblin/web exec vitest run src/editor/harness-switch.test.tsx -t 'clears a cancelled switch'
```

New component cases:

- `clears a cancelled switch notice after a concurrent prompt edit`: delayed Settings, preserved
  Codex/model/effort and concurrent prompt, then no false waiting notice. It failed before the fix
  with the quoted assertion above.
- `keeps a newer switch notice when an older pending attempt finishes`: keep Settings pending,
  settle the other initial lookups, fail a catalog refresh, start a newer action, then release the
  older action. Its newer failure notice must remain in the live DOM.

Initial after-fix harness suite: 30 passed. The newer-attempt case was then strengthened to verify
its pending/settled preconditions explicitly. The final full web coverage run passes **1544 tests / 120 files** in 1467.04 seconds, including
both final regressions. Lines **98.95% (7091/7166)**, branches **95.01% (7280/7662)**, statements
98.04% (8135/8297), functions 98.55% (2190/2222). Every threshold is unchanged and exceeded;
no coverage failure or isolated failure triage was needed. [Coverage log](coverage.log.txt),
[summary](coverage-summary.json). The full native served replay passes **27/27 behavioral cases**, plus its environment row
(28 PASS rows), including N1, N2, save/reopen/request agreement and restart. Its API processes
exited as observed. After the fixture-only prefix refinement, the paired final N1/N2 qualification
passes **2/2**, plus environment; the prefix remains `gg-wp-f2b-served-`, now supplied explicitly.
The paired result does not replace or relabel the earlier full replay.

- Full replay: [log](served-after.log.txt), [observations](served-after/served-results.json),
  [lifecycle](served-after/served-lifecycle.json).
- Final prefix qualification: [log](served-final.log.txt), [observations](served-final/served-results.json),
  [lifecycle](served-final/served-lifecycle.json).

The owned Edge run has **13 passed / 4 failed / 17 total**, zero retries, 2.4 minutes
([log](edge.log.txt)). All nine Claude-harness cases pass. The four known #205 failures are:

- `model-picker.spec.ts:36`: catalog model and effort publish and reach the harness (dark), empty model instead of `picker-dark`.
- `model-picker.spec.ts:36`: the same case (light), empty model instead of `picker-light`.
- `model-picker.spec.ts:102`: a saved model removed from the catalog stays selected and explicit unknown import is rejected; Settings catalog link hidden under collapsed Advanced.
- `model-picker.spec.ts:159`: catalog failure preserves the current values until retry and loop defaults share the picker; Retry control hidden under collapsed Advanced.

These remain failed and outside #204; no rerun was used to change their status.

## 5. Gates

Node `v22.14.0`, locked dependencies supplied by the orchestrator, `pnpm.cmd`.
Coverage limits, exclusions, timeouts and retries are not changed.

| Command                                                                                                                                                  | Result / evidence                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                                                     | Pass; 20 tasks ([log](typecheck-final.log.txt)).                                                                                                                                                  |
| `pnpm.cmd lint`                                                                                                                                          | Pass; 11 tasks ([log](lint-final.log.txt)). Initial run found two `require-await` violations in the new test callbacks ([initial log](lint.log.txt)); those callbacks were corrected, not waived. |
| `pnpm.cmd format:check`                                                                                                                                  | Pass ([log](format.log.txt)); final repeat covers the retained evidence.                                                                                                                          |
| `pnpm.cmd check:tokens`                                                                                                                                  | Pass; 163 files ([log](tokens.log.txt)).                                                                                                                                                          |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 --coverage.reportOnFailure=true --coverage.reportsDirectory=<round4-temp>/web-coverage` | Pass; 1544 tests, fresh report directory and no Turbo cache ([log](coverage.log.txt)).                                                                                                            |
| `pnpm.cmd build`                                                                                                                                         | Pass; 11 tasks ([final log](build-final.log.txt)). The separate old-code build also passed ([log](build-before.log.txt)).                                                                         |
| From `apps/web`, `GG_E2E_BROWSER_CHANNEL=msedge`, `pnpm.cmd exec playwright test e2e/claude-harness.spec.ts e2e/model-picker.spec.ts`                    | 13 pass / exactly 4 known #205 failures; exit 1 ([log](edge.log.txt)).                                                                                                                            |
| `node docs/qa/2026-10-22-wp-f2b-qa/round-3/served-checks.mjs`, with the run settings in section 7                                                        | Full 27/27 pass, final paired 2/2 pass.                                                                                                                                                           |
| `pnpm.cmd check:layers`                                                                                                                                  | Pass ([log](layers.log.txt)).                                                                                                                                                                     |
| `pnpm.cmd check:deps`                                                                                                                                    | Pass; 823 modules, 3288 dependencies, zero errors; existing `drizzle.config.ts` orphan warning ([log](deps.log.txt)).                                                                             |

Final full-tree formatting verification is retained in [this log](format-final.log.txt).

The passing initial after-fix component run is [retained](component-after.log.txt), as is the
stronger newer-attempt test's [isolated run](component-newer-notice.log.txt). Old-code component
and native served failures are retained separately: [component](component-before.log.txt),
[served log](served-before.log.txt), [served observations](served-before/served-results.json),
[served lifecycle](served-before/served-lifecycle.json). These are current round-4 observations,
not restored or regenerated round-3 logs.

## 6. Docs

Docs 09 states that completion of the current cancelled attempt clears its loading notice, and
that an older attempt cannot clear a newer notice. The #204 CHANGELOG upgrade wording is quoted
above. No ADR or generated-client/reference changes are needed. This round changes no schema, route,
dependency or lockfile, so `check:docs` and license checks are not required. It fixes a notice
and adds a missing instruction for the existing contract.

## 7. Decisions and parameters

Current-attempt identity is checked before clearing state. This is the smallest change that fixes
the stale notice while retaining the existing concurrent-edit, dismissal and history guards.

The served script retains its old defaults for historical replay. The initial 27-case replay
used the required prefix directly; a final fixture-only refinement exposes `QA_TEMP_PREFIX` with
the historical default, because the protected cleanup script checks that old prefix. The N1 and
N2 cases are requalified with the explicit override after that refinement. This round supplies
`QA_PORT=5672`, `QA_TEMP_PREFIX=gg-wp-f2b-served-`, `QA_OUTPUT_DIR=<fresh-round4-output>`, and Node 22.
The old-code served reproduction used `QA_ONLY=pending-prompt-edit`; the full replay cleared
that filter, and the final pair used `QA_ONLY=B1-all-failed,pending-prompt-edit`. Choose a new
empty output directory when replaying so earlier observations are retained.
The N2 response count of two follows
bootstrap's existing one-retry setting, rather than an arbitrary sleep. Network idle and visible
terminal error controls then establish the settled fixture before switching. The regression uses
existing CodeMirror public editor operations and QueryClient/network interfaces; it adds no
test-only production export or private state access.

## 8. Caveats and open items

This is implementation evidence, not independent sign-off for a changed PR head. The orchestrator
owns the existing evidence-hygiene findings and refreshed hashes. The permitted served-script
change also requires its owning QA manifest entry to be refreshed at the delivered revision;
this round does not edit that manifest. All new observations/logs go in
this round's directory; old observed results are not overwritten or relabelled. Logs are retained
as `.log.txt` and redact only checkout/TEMP machine paths and terminal color escapes, as declared
when the final artifacts are copied.

No live provider or paid turns; no owner app/store or ports 4747/4748. Native served checks use
port 5672 and synthetic CLI binaries. Standard browser specs retain their isolated automatic test
ports. All new test stores are under `%TEMP%/gg-wp-f2b-r4-d63c95e6066e4c44b1d1cdebd86f8230`;
per this round's instruction no directory deletion will be attempted. Exact child process exits
and retained store names are recorded by the served lifecycle artifact. The four known #205
browser failures remain outside this round and are listed separately above. The native directories
retained under that root are `gg-wp-f2b-served-PwnJNA` (before), `gg-wp-f2b-served-AeTgPw` (full
after), and `gg-wp-f2b-served-nqq8IL` (final paired qualification). No cleanup script was executed.
Turbo's existing Windows cache access-denied warnings do not change the successful native exit
codes. The initial lint error, old-code expected failures and known browser failures remain in the
retained record; none is called a clean first-pass gate.
