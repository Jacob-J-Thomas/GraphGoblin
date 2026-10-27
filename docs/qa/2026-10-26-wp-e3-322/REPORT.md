# WP-E3 phase 2: pressure-driven bounded cleanup (#322)

## 1. Branch and worktree

Branch `codex-wp-e3-187-322`; worktree `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-e3-187-322`; base/unchanged HEAD `60e88760c72ff09bf81c8990723edfe5cd377661`. Uncommitted; ready for orchestrator commit subject to the gate dispositions below. No Git index actions, commits, publication, branch changes or sub-agents. Stop after phase 2 for orchestrator review.

COMMON.md, including the new evidence-file rules, and the phase-2 brief were reread. The project-scoped runtime overrides AGENTS.md:

```text
node --version: v22.23.4
(Get-Command node).Source:
%USERPROFILE%\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe
```

Every gate used this runtime first on PATH. The capture helper invokes the same standalone executable as the Windows `pnpm.cmd` shim, preserving argument boundaries; package scripts still resolve Node from PATH. API tests use `GG_TEST_PORT_START=5600 GG_TEST_PORT_COUNT=100`; other tests use `5650/300`. Edge uses `msedge`, main/control 5948/5949, `--retries=0 --workers=1`. No manually started listener, owner ports 4747/4748, home store or main checkout was used. All new deletion fixtures use disposable system-temp `gg-wp-e3-` data.

## 2. Per bolt

| Bolt / acceptance criterion                           | Implementation and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #322: adequate storage deletes nothing                | Public `ContainerOverrides.storageCapacity` composes `FsStorageCapacity` / `fs.statfs`; controlled adequate readings preserve approvals and files. Public API tests verify cached observation does not measure or grant consent, the one-minute bound, hysteresis, external database capacity, unavailable/invalid readings and stop behavior.                                                                                                                        |
| #322: pressure deletes only the approved eligible set | `SqliteHistoryCleanup.prepareBatch` rechecks owner, valid approval, terminal/finalized state and complete indexed dependency components in the write transaction. Existing eligibility is not inferred from age, success/failure or future preferences. Tests cover complete components, active/dangling protection, finite batches, paging and newly retained dependencies.                                                                                          |
| #322: owned, unreferenced resources only              | `OwnedRunResources` records exclusive creation identity and producing run, rather than trusting a pathname. Real temporary-file tests cover owned workspace/artifact deletion, pre-existing/unproven and replaced paths, user-owned/shared workspaces, shared artifacts, hard links, retained/escaped/tail/input references, damaged JSON and proof/inventory limits. API tests retrieve a retained run's artifact bytes unchanged after another run's real deletion. |
| #322: subtle visible warning                          | `StorageNotice` uses a nonmodal polite live status below gateway status, with a Runs review link. Adequate storage hides it; pressure, no eligible work and unavailable observation have distinct copy. Component tests and the Edge storage scenario cover it; observing grants no consent.                                                                                                                                                                          |
| #322: interruption and honest accounting              | History and pending jobs, including the confirming approval, commit atomically. A real process dies after preparing jobs; reopening the API under injected pressure finishes them without restoring runs. SQLite fault injection after unlink rolls the job transaction back; reopen completes a missing file with zero extra byte credit. File lengths, SQLite reusable pages and volume capacity are distinct. No reset or `VACUUM`.                                |
| #322: nothing eligible never broadens deletion        | API tests retain successful and failed unapproved runs, report `no-eligible`, preserve protected resources, and keep retained artifacts retrievable on subsequent passes. Event input/provenance is retained while deleted run links are pruned.                                                                                                                                                                                                                      |
| #187 regression: guarantees and append bound intact   | Phase-1 browser/API/storage checks remain. Ordinary append UPDATE: **80 VM instructions at both 100 and 10,000 rows**, with an unrelated approval. Isolated Resume amid unrelated approvals: **297 at both sizes**. Migration 0022 adds no event trigger/index or append statement.                                                                                                                                                                                   |

These are implementation and agent-verification results, not independent review, owner product acceptance or integrated #304/#287 sign-off. Final full-suite failures are recorded below without being replaced by focused passes.

## 3. Files changed

- **contracts:** new `src/storage.ts` / `storage.test.ts`, exported from `src/index.ts`.
- **engine:** `src/ports.ts` requires the producing run ID on artifact publication; `src/handlers/inference.ts` supplies it. No RunManager or event-append implementation changes.
- **infrastructure:** migration `0022_run_resource_ownership.sql`, snapshot/journal; new `src/fs/capacity.ts`, `owned-resources.ts`; new SQLite `run-resources.ts`, `history-cleanup.ts`, `history-cleanup.test.ts`; schema/entry-point exports; `delete-runs.ts` removes selected usage rows and allows cleanup to prune only selected snapshots; `admission.ts` rechecks replay-source existence transactionally. Historical fixture rewinds in catalog, delivery-runs, history-summaries, webhook-receipt-upgrade and deletion-eligibility tests include 0022.
- **API:** new `history-cleanup.ts`, `history-cleanup.test.ts`, `history-cleanup-process.test.ts`; container composition/start/stop/disposal wiring; cached `/system/storage` route; route-scope matrix; test-app capacity injection; artifact-integrity test supplies the producing run ID and uses the required disposable prefix.
- **api-client:** regenerated `openapi.json` and `src/generated/schema.ts`.
- **web:** new `app/StorageNotice.tsx` / test, additive `App.tsx` placement and FakeApi observation fixture; explicit permanent-resource consequence in `runs/HistoryEligibility.tsx` and its unit/browser assertions; new `e2e/storage-cleanup.spec.ts`; E2E server injects capacity through the public port and exposes a controlled reading change.
- **documentation/evidence:** CHANGELOG, docs/03, docs/05, docs/07, docs/09, user guide 03, extended ADR-0060, generated API reference, this report, UTF-8 capture helper and `*.log.txt` evidence.

WAVE/shared surfaces: container edits are limited to cleanup composition and lifecycle calls around the existing WP-C7 startup/disposal/shutdown wiring. Engine port and inference edits are limited to artifact publication; SQLite admission adds the replay-source check. API system routing and generated client files are additive. The existing shared `packages/contracts/src/run.ts`, `apps/api/src/routes/runs.ts`, RunsPage and RunInspectorPage are untouched in this phase; the shared confirmation component changes only consequence copy. No unrelated shared regions were reformatted. Regenerate the client after integration with #256. Migration 0021 is unchanged; only reserved 0022 is added, and ADR-0061 / migration 0023 remain untouched.

## 4. Tests

New public/component verification:

- `packages/contracts/src/storage.test.ts`: strict finite observation/accounting contract, no future-history consent field.
- `packages/infrastructure/src/sqlite/history-cleanup.test.ts`: real file-backed SQLite and disposable filesystem; component/protection/paging, root batching, positive ownership, shared/unproven/substituted resources, hard links, inventory/proof budgets, retained JSON/input references, post-unlink transaction rollback/reopen, statfs and replay admission after source removal.
- `apps/api/src/history-cleanup.test.ts`: injected capacity through composition, no-op adequate storage, frequency/hysteresis, no eligible history, actual owned-resource cleanup and retained artifact retrieval, invalid/unavailable readings, stop/timer behavior, external SQLite volume and retained Event provenance.
- `apps/api/src/history-cleanup-process.test.ts`: built production storage components, actual process death after the durable history/job transaction, followed by API startup recovery and consistent run paging.
- `apps/web/src/app/StorageNotice.test.tsx`: adequate/pressure/no-eligible/unavailable/forbidden observation and accessible review link; existing eligibility test now asserts the permanent resource consequence.
- `apps/web/e2e/storage-cleanup.spec.ts` plus phase-1 `deletion-eligibility.spec.ts`: real HTTP/API/SQLite/browser with injected capacity and fake execution harnesses. No live-provider behavior is claimed.

Red-before evidence:

1. `red-storage-route.log.txt`, committed phase-1 baseline: **“expected 404 to be 200”** for `/system/storage`.
2. `red-replay-source-removed.log.txt`, committed admission code with the new test: **“promise resolved ... instead of rejecting”** after cleanup removed its source. The transaction check now refuses `RUN_NOT_FOUND` with no fork row. The earlier `red-replay-admission.log.txt` used an invalid fixture and is not counted as regression proof.
3. Initial focused failures were corrected: harness request-field access, Windows SQLite teardown GC, the old confirmation-copy assertion, and expensive serial directory fixture setup. The inventory test now creates empty files in bounded groups and uses a 60-second native-I/O timeout; its correctness assertion is the 2,000-entry preservation bound, not elapsed time. Failed dispositions are retained and never relabeled passing; only the listed kept captures are preserved in the repository, with omitted captures recorded in NOT-KEPT.md.

Focused final results: **storage 59/59 across 4 files; API 34/34 across 6 files; web 11/11 across 2 files; standalone real-process interruption 1/1. The strengthened paging/consent readback passes 15/15: it checks a surviving row after a deleted cursor and the original confirming approval in the durable job. The new storage-route permission check is an explicit 401/403/200 API verification because the full authorization matrix timed out.**

| Changed package | Lines  | Branches | Coverage test disposition                                             |
| --------------- | ------ | -------- | --------------------------------------------------------------------- |
| contracts       | 99.74% | 95%      | PASS                                                                  |
| engine          | 97.48% | 91.43%   | PASS, 1,730 tests                                                     |
| infrastructure  | 97.61% | 93.6%    | FAIL: 832 passed / 17 failed (7 native, 10 offline-upgrade timeouts). |
| API             | 97.42% | 92.49%   | FAIL: 1,486 passed / 2 timed out / 11 skipped.                        |
| api-client      | 100%   | 98.42%   | PASS, 97 tests                                                        |
| web             | 98.68% | 94.54%   | FAIL: 1,787 passed / 4 failed in unchanged assertions/hooks.          |

Coverage thresholds/exclusions were not changed. Reruns follow actual code/fixture/assertion changes; unchanged native failures are retained as failures, not retried to obtain a passing claim. Each long-run coverage output uses a separate disposable directory.

## 5. Gates

Every command uses Node v22.23.4. Captures name the full pnpm arguments and exit code. Required root commands: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:layers`, `pnpm check:deps`, `pnpm check:migrations`, `pnpm check:docs`, `pnpm check:tokens`. Client generation and `pnpm docs:generate` were run after adding the route/schema.

| Exact command                                                                                                                              | Result / evidence                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                                                                                               | PASS, 11 tasks (`build-complete.log.txt`).                                                                                  |
| `pnpm typecheck`                                                                                                                           | PASS, 20 tasks, including final readback after test-only additions (`typecheck-readback.log.txt`).                          |
| `pnpm lint`                                                                                                                                | PASS, 11 tasks (`lint-verified.log.txt`); earlier async-fixture/unused-assignment lint findings were fixed, not suppressed. |
| `pnpm format:check`                                                                                                                        | FAIL, only unchanged `docs/qa/2026-10-25-wp-d1-integration/README.md` (`format-final.log.txt`); deliberately untouched.     |
| `pnpm check:layers`                                                                                                                        | PASS.                                                                                                                       |
| `pnpm check:deps`                                                                                                                          | PASS, 0 errors / 2 existing orphan warnings.                                                                                |
| `pnpm check:migrations`                                                                                                                    | PASS; Drizzle generation is a no-op.                                                                                        |
| `pnpm check:docs`                                                                                                                          | PASS; generated references current.                                                                                         |
| `pnpm check:tokens`                                                                                                                        | PASS, 177 files.                                                                                                            |
| `pnpm --filter @graphgoblin/web exec playwright test e2e/deletion-eligibility.spec.ts e2e/storage-cleanup.spec.ts --retries=0 --workers=1` | PASS, 4/4, Edge (`edge-corrected.log.txt`).                                                                                 |

A first formatter capture was interrupted after prolonged lack of progress. The diagnostic run's full 4,290,669-byte capture is not kept; its size/hash and extracted warnings are recorded. The final exact command completed and flagged only WP-D1. The capture helper bounds formatter subprocesses, not product cleanup, and stops only its own child tree if needed. Owned-file formatting is checked separately after final report edits.

Exact final coverage commands (profile paths redacted; port pools in section 1):

```text
pnpm --filter @graphgoblin/contracts test:coverage --maxWorkers=2 --coverage.reportOnFailure --coverage.reportsDirectory=%USERPROFILE%/AppData/Local/Temp/gg-wp-e3-322-contracts-coverage
pnpm --filter @graphgoblin/engine test:coverage --maxWorkers=2 --coverage.reportOnFailure --coverage.reportsDirectory=%USERPROFILE%/AppData/Local/Temp/gg-wp-e3-322-engine-coverage
pnpm --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2 --coverage.reportOnFailure --coverage.reportsDirectory=%USERPROFILE%/AppData/Local/Temp/gg-wp-e3-322-infra-verified-coverage
pnpm --filter @graphgoblin/api test:coverage --maxWorkers=4 --coverage.reportOnFailure --coverage.reportsDirectory=%USERPROFILE%/AppData/Local/Temp/gg-wp-e3-322-api-coverage
pnpm --filter @graphgoblin/api-client test:coverage --maxWorkers=2 --coverage.reportOnFailure --coverage.reportsDirectory=%USERPROFILE%/AppData/Local/Temp/gg-wp-e3-322-client-coverage
pnpm --filter @graphgoblin/web test:coverage --maxWorkers=4 --coverage.reportOnFailure --coverage.reportsDirectory=%USERPROFILE%/AppData/Local/Temp/gg-wp-e3-322-web-final-coverage
```

Browser command is `pnpm --filter @graphgoblin/web exec playwright test e2e/deletion-eligibility.spec.ts e2e/storage-cleanup.spec.ts --retries=0 --workers=1` with Edge.

Evidence is UTF-8, identities redacted, logs named `*.log.txt`. The capture helper enforces the 1,000,000-byte limit and records oversize capture size/hash in `NOT-KEPT.md` instead of keeping the capture in the repository. No compressed trace is claimed as retained. The omitted browser trace/error-context and oversize formatter diagnostic are listed with captured byte counts and SHA-256 in NOT-KEPT.md; none is claimed as kept. Kept evidence is checked for UTF-8, the size limit and local identity strings. `git diff --check` passes.

## 6. Docs

Updated docs/03 resource model, docs/05 execution/cleanup lifecycle, docs/07 cached observation and accounting, docs/09 notice/confirmation, and guide/03 low-storage behavior. Extended ADR-0060 covers capacity, thresholds, ownership, shared references, budgets, journal recovery, replay race and storage-accounting limits. The #322 CHANGELOG bullet ends `(#322)` and has **Upgrade:** migration 0022, preserved old ownership/consent rules, artifact port change and client regeneration. The #187 entry remains. Generated client/OpenAPI and API reference are updated.

## 7. Decisions and parameters

| Condition/event                                                                   | Protection / lifecycle                                                                                                       |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| New history, success/failure, age or future preference                            | Never confer approval.                                                                                                       |
| Active/paused, unfinalized, missing/foreign required relative                     | Keep protected.                                                                                                              |
| Confirmed terminal/finalized complete component                                   | May be consumed under measured pressure only.                                                                                |
| Resume, child/replay admission, relationship/evidence change                      | Existing transactionally enforced revocation stays intact. Replay also refuses if cleanup already removed its source.        |
| Withdrawal before cleanup starts                                                  | Retain the selected component; after the atomic deletion starts, the already-consumed history cannot be withdrawn.           |
| Retained/shared artifact, workspace use, link, unknown ownership or bounded proof | Preserve; never expand history consent to obtain more space.                                                                 |
| Interrupted pass                                                                  | Durable pending jobs retain confirming approval; retry safely, do not restore deleted runs or double-credit uncertain bytes. |
| Explicit loop deletion                                                            | ADR-0033 separate consent and behavior unchanged; no filesystem job is created by that command.                              |

Capacity dependency: public `StorageCapacityPort.read(path)` injected in API composition; production `fs.statfs` bigint `blocks/bsize/bavail`. Observe data and external database paths. Measure at startup after recovery and at most once per path per 60 seconds; coalesce polls; no request/write/event hook. Enter pressure below min(1 GiB, 5%); leave at min(2 GiB, 10%) for every volume. These are engineering headroom/hysteresis choices: relative bounds for small volumes, absolute caps for large volumes, enough recovery room to avoid oscillation. Invalid measurements fail closed.

Bound work by 20 approved roots, 500 run rows, 501 inspected component members, 32 resources per pass, 2,000 streamed filesystem entries per workspace and 2,000 retained JSON documents / 2 MiB per artifact proof. Rotate cursors to avoid starving later jobs. These are engineering budgets, not owner-approved storage policy or a latency/WAL-size guarantee: a selected run's dependent SQL rows remain an atomic transaction. Over-budget or unprovable resources stay protected.

Ownership: exclusive directory creation or exclusive publication of a synced inode; durable producing run/path/device/inode/birth-time identity. Existing files are not retroactively claimed. Canonical fixed/template uses are recorded without ownership. Preserve retained overlaps, configured fixed directories, unresolved retained template workspaces, links and substitutions. Retained thread/event/input/admission JSON participates in artifact proof, including escaped references and fail-closed damaged data. Shared Event provenance stays with its retained inbound source while removed run links are pruned.

Removal: selected run rows/events/sessions/timers/webhook receipts/use rows; only selected now-unpinned snapshots; positively owned unreferenced workspace trees/artifact files. Shared inbound deliveries, admitted Event provenance, other loops, published definitions, user-owned/unproven paths and retained resources remain. The ownership journal is made pending with the original confirmation before run deletion; filesystem work is separately retryable under the shared publication gate and a retained-reference transaction. Deterministic quarantine preserves identity across a crash before/after rename or during deletion. Stop awaits its current bounded pass.

Accounting: `removedFileBytes` means successfully unlinked logical file lengths in the pass. It does not promise physically freed blocks. `reusableDatabaseBytes` means SQLite free pages, sampled separately; row deletion need not shrink the OS file, and WAL/sparse/open files/intervening writes can affect capacity. Capacity is sampled on its own schedule. No unconditional `VACUUM`, compaction, reset or unlimited-storage claim.

## 8. Caveats and open items

Stop after phase 2, uncommitted. Orchestrator review/integration, independent review/QA, commit and owner product acceptance remain distinct and outstanding. No new owner judgment is needed for eligibility, ownership or the chosen engineering thresholds.

Concrete owner product question: **keep the subtle global notice below gateway status (implemented), or put it only on Runs?** Global keeps pressure visible while working elsewhere; Runs-only is less prominent. The implemented nonmodal global notice and conservative wording make no deletion promise and require explicit selection/confirmation elsewhere. Owner acceptance of placement/wording remains open.

Legacy/unproven files, shared/linked resources, retained input references and over-budget resources can remain after eligible history is gone. Persistent pressure warns rather than broadening cleanup. This is an explicit protection/accounting limit, not a promise that available bytes will increase after every pass.

Observed outside scope / unresolved gate findings:

- Infrastructure final coverage: the six previously recorded native child/process/readiness failures remain, plus the installed-Claude no-turn readiness probe. Ten tests in unchanged `src/sqlite/upgrade.test.ts` timed out at their existing 20-second bound. A focused **26/26** upgrade run verifies the new migration in isolation; it does not erase the full-run failure. The initial full infrastructure run passed the upgrade cases and had only the six earlier native failures. No native implementation or upgrade logic was changed here.
- API full coverage: unchanged authorization-matrix assertion (`src/adversarial.test.ts:187`, inventory adds the new route) and unchanged template-packaging rebuild test (`src/templates/catalog-package.test.ts:49`) timed out at 20 seconds. The new endpoint's focused permission test covers 401/403/200 explicitly. The full-run timeout remains a failed gate, not a passing authorization matrix.
- Web final coverage: unchanged `EventsPage.races.test.tsx` filter/back and unmount/back cases timed out; `EditorPage.device.test.tsx:26` hit its 20-second setup-hook timeout; `RunInspectorPage.test.tsx:414` reproduced the previously observed detached-element assertion. Their bodies are untouched. The first full web run passed these cases but failed the now-corrected copy assertion. These differing full-run results remain unresolved; no causal claim or retry-to-green is made.
- Full runs overlapped other checks and showed substantial runtime variability. This is context, not proof that load caused each failure, and it does not waive any gate. No broad full-suite rerun was used to replace these failures with green results. Root formatting's WP-D1 QA file remains untouched if flagged, per the orchestrator instruction. Disposable failure evidence is left for orchestrator disposition; no manual directory deletion or process cleanup was attempted.
