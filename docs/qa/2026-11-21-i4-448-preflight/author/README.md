# #448 author checkpoint

Author context: `/root/i4_448_preflight`, GPT-6.1 Sol xhigh, assigned bounded implementation.
This packet is author verification, not independent QA, opposite-family review or owner acceptance.

## Admission and source binding

- Issue read live through GitHub connector: #448 open, `aidlc-ready`, `qa:touched-systems`,
  `impl:gpt-6.1-sol`, `review:claude-opus-5.5`, with November 21 admission and owner-only closure.
  No issue comments existed. No GitHub writes performed.
- Worktree: `G:/ggq/gg-i4-448-preflight/GraphGoblin`.
- Branch: `codex/gg-i4-448-preflight`; clean initial signed-main base
  `02351e2fb932b3be44e7cc3fb3943a61d568226c`.
- Read AGENTS, docs/README, docs/12, docs/15, approved five-intent register,
  Q/decision-171.md and Q/i4-readiness-reconciliation/README.md.
- Every package command prepends
  `C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64` to PATH.
  `node --version` returned `v22.23.4`; pnpm version was 12.8.1.
- `pnpm.cmd install --frozen-lockfile` passed, 801 packages, lockfile unchanged.

## Change and touched systems

`projectStartupModelCatalog` in infrastructure/sqlite/settings.ts is a pure stored-first
projection: append a shipped seed only if its exact `(harness, model)` pair is absent.
Both container startup's pre-write admission and offline configPreflightSources use it.
Stored metadata/enabled values are never replaced in the projection. No schema, migration,
dependencies, provider or permission changes. Numbered doc 11 and CHANGELOG describe the change.

1. Catalog projection: empty input, stored order, custom metadata, disabled seed, same model
   name in another harness, idempotence and frozen-input preservation.
2. Offline CLI and startup admission: existing current-format external percent-encoded stores
   missing Codex/Claude seeds; CLI admits them without persistence, normal start then seeds them.
3. Stored precedence and negative controls: disabled Codex WARN/0, disabled Claude FAIL/1;
   unknown and wrong-family models and unsupported efforts retain their current behavior;
   restricted stored efforts override the corresponding shipped metadata.
4. Read-only storage: byte comparison of DB and any WAL across CLI calls, original rows retained,
   data directory absent until startup, frozen copied WAL remains present and unchanged.
   SQLite `-shm` read marks retain their documented exception.
5. Existing preflight suites cover first run, unsupported/old and unreachable databases,
   pending migrations and Ollama resolution; execute with the new regressions as focused files.

## Original failures and corrections

### Interrupted incorrectly scoped command (not a passing result)

Command: `pnpm.cmd --filter @graphgoblin/infrastructure test -- src/sqlite/catalog-projection.test.ts`.
The script emitted `vitest run -- src/sqlite/catalog-projection.test.ts`; the extra `--`
caused the package aggregate to execute. This was not an authorized full-workspace run.
After observing unrelated tests start, the author sent Ctrl-C to session 30882 (exit 1) and
confirmed through Win32_Process that no Node processes bound to this worktree remained.
No thresholds or assertions were altered, and no claim is made about the causes of these failures.
The intended following API invocation in that shell did not run.

Observed partial output, preserved here from the tool transcript (complete raw output was not
redirected and is not available as a separate full-suite log):

```text
src/process/voice.test.ts (135 tests | 46 failed) 5673ms
src/fs/chat-audio.test.ts (39 tests | 4 failed) 752ms
src/sqlite/chat.test.ts (25 tests | 1 failed) 6852ms
```

Voice failures included unsafe audio symlinks, qualification identity and evidence fixtures,
loader inventory, private qualification storage and bounded model installation. Audio failures
included symlink/regular-file boundaries and orphan cleanup. Chat failure was
`returns an acknowledged admission after closing/reopening the store and does not repeat seeds or pair claims`.
These interrupted partial results remain unresolved; ordinary candidate CI belongs to the coordinator.

Corrected invocation form is `pnpm.cmd --filter <package> exec vitest run <file>`.

### Incorrect author expectation about disabled defaults

Command: `pnpm.cmd --filter @graphgoblin/api exec vitest run src/preflight-catalog.test.ts`.
Original outcome: 2 failed / 9 passed, 41.55 s. The disabled Codex and Claude cases expected
`createContainer` to reject with MODEL_DISABLED, but its promise resolved. The resulting Vitest
object diff was enormous and truncated by tool output; there is no separately retained complete
raw log. This was a mistaken test expectation, not evidence for changing product policy.

Fresh source establishes why: packages/domain/src/model-resolution.ts `validateHarnessDefaults`
returns only `status: invalid` issues, whereas MODEL_DISABLED has `status: unavailable`;
apps/api/src/container.ts `validateProcessDefaults` uses that validation. Coordinator independently
confirmed the source and selected preservation of existing behavior. Corrected tests require boot
to retain `enabled: false` and repository `isAllowed` to return false, separately from the existing
Codex CLI warning and Claude CLI failure. Unknown/family/effort configuration refusals remain strict.
The numbered doc was corrected before delivery. No startup policy was expanded.

## Verification status

- Pure projection: 1 file / 2 tests passed via exact focused invocation.
- API typecheck: `pnpm.cmd --filter @graphgoblin/api typecheck` passed (exit 0).
- Infrastructure typecheck: `infrastructure-typecheck.log`, passed (exit 0).
- Further focused checks and exact candidate binding will be appended below.

No owner store/configuration/credentials/services or ports 4747/4748 accessed; all store fixtures
were under disposable Temp directories. No paid provider request, push, PR, merge or issue closure.
Whole-workspace coverage/build/browser checks require coordinator serialization and are not claimed.

## Completed focused checks

All commands run through Node 22.23.4 / pnpm.cmd in the assigned worktree.

| Command after `pnpm.cmd` | Result | Evidence |
| --- | --- | --- |
| `--filter @graphgoblin/api exec vitest run src/preflight-catalog.test.ts src/preflight.test.ts src/preflight-ollama.test.ts` | PASS: 3 files, 61 tests, 77.85 s | focused-api-02.log |
| `--filter @graphgoblin/api exec vitest run src/preflight-catalog.test.ts` | PASS after tuple annotation: 1 file, 11 tests, 38.52 s | focused-api-03.log |
| `--filter @graphgoblin/api typecheck` | PASS after final source restoration | api-typecheck-02.log |
| `--filter @graphgoblin/infrastructure typecheck` | PASS | infrastructure-typecheck.log |
| `--filter @graphgoblin/api lint` | PASS after snapshot tuple typing | api-lint-02.log |
| `--filter @graphgoblin/infrastructure lint` | PASS | infrastructure-lint.log |
| `exec prettier --check <all seven changed files>` | PASS | tool transcript; all matched files use Prettier style |
| `--filter @graphgoblin/infrastructure exec vitest run src/sqlite/catalog-projection.test.ts src/sqlite/catalog.test.ts src/sqlite/storage.test.ts` | FAIL: 55 passed, 1 cleanup failure, 17.59 s | focused-infrastructure-02.log |

API lint's original recorded failure (`api-lint.log`) was test helper line 77's inferred-any
Object.fromEntries return. Annotating each map result as `Promise<[string, Buffer]>` fixed the
type without a cast, exclusion or threshold change. The final 11-case test rerun followed it.

The infrastructure failure was existing `catalog.test.ts` test
`reads current-format base catalog before discovery migrations without joining new tables`:
`EBUSY: resource busy or locked, unlink .../gg-pre-discovery-catalog-PdDOx1/catalog.db-wal`.
Its finally clause at lines 230-233 closes the old client then calls rm. That test calls seed and
readPreMigrationModelCatalog, whose implementations are unchanged; it does not call the new
projection. This source observation does not prove a runtime baseline outcome or the failure's
cause. No unrelated cleanup changes or retry-to-green were performed. Coordinator informed.

## Original-behavior counterfactual

The exact candidate preflight.ts bytes were retained, only its offline catalog expression was
temporarily restored to the original stored-only read, and a PowerShell finally restored the
candidate bytes. Command:
`pnpm.cmd --filter @graphgoblin/api exec vitest run src/preflight-catalog.test.ts -t 'missing shipped|WAL-backed'`.
Expected negative outcome: 3 failed / 8 skipped, 7.17 s, exit 1. All three selected cases reported
`Database reachable and migrated` then rejected the missing model (Codex, Claude and copied WAL).
Full output is `original-stored-only-control.log`. This establishes that the new positive cases
discriminate the reported defect. The subsequent final candidate 11-case suite passed.

## Source anchors for policy clarification

- `packages/domain/src/model-resolution.ts:135` validateHarnessDefaults returns only invalid
  configuration issues; MODEL_DISABLED belongs to unavailable resolution.
- `apps/api/src/container.ts:609` validateProcessDefaults uses that invalid-only validation.
- `apps/api/src/preflight.ts:265` Codex default membership keeps disabled rows at WARN.
- `apps/api/src/preflight.ts:410` Claude defaults keep disabled rows at FAIL.
- `packages/infrastructure/src/sqlite/settings.ts:458` shared projection.
- `apps/api/src/container.ts:222` startup callsite.
- `apps/api/src/preflight.ts:645` offline configuration callsite.

Independent review, independent behavior QA, ordinary full-coverage CI at the current target,
fresh final audit and the explicit owner closure decision remain coordinator-owned gates.

## One immutable-baseline comparison and process cleanup

At the coordinator's explicit request, a separate detached worktree was created at
`G:/ggq/gg-i4-448-baseline/GraphGoblin`, immutable base
`02351e2fb932b3be44e7cc3fb3943a61d568226c`, initially and finally clean. Its frozen install passed
on Node 22.23.4 (`baseline-install-02.log`). A premature install attempt while checkout was still
finishing returned ERR_PNPM_NO_LOCKFILE (`baseline-install.log`); the author waited for checkout
completion before the successful setup. This was setup correction, not a behavior-test retry.

Exactly one baseline behavior invocation was run:
`pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/catalog.test.ts -t 'reads current-format base catalog before discovery migrations without joining new tables'`.
Result: FAIL, 1 failed / 9 skipped, 9.49 s, exit 1, EBUSY unlink of the fixture's catalog.db.
Raw terminal: `baseline-catalog-single-case.log`. This establishes that the same cleanup-failure
class occurs at immutable main before #448; it does not identify an OS/native-handle cause or
erase the candidate's failure. There was no further retry or unrelated test modification.
Exact baseline/candidate catalog.test.ts, settings.ts and db.ts bytes are retained under
`baseline-source/` and `candidate-source/`, with SHA-256 manifests and before/after baseline status.

After the interrupted package invocation settled, Win32_Process found no worktree-bound Node
processes (`author-node-process-snapshot.json`: []). A broader read-only check for the known
infra native-process fixture prefixes (voice, script recovery, process-tree, Claude process,
chat audio/restart) also returned [] (`interrupted-helper-process-check.json`). No unresolved
known helper leak remains. No unrelated process was stopped.

## Frozen author candidate

Commit `b45807f033601a53919f2c9e16e0de751971a518`, branch `codex/gg-i4-448-preflight`.
Seven changed files; working tree/index clean. `candidate.diff` and `candidate-manifest.json`
bind the complete delta and SHA-256 hashes. Commit uses `Part of #448`, without a closing keyword
or assistant attribution. No push or publication performed.

Additional checks: `pnpm.cmd check:layers` PASS. `pnpm.cmd check:deps` PASS (exit 0, 1338 modules,
5793 dependencies, zero errors; four existing no-orphans warnings for drizzle.config.ts,
chat-update-worker.js, e2e/shutdown.config.ts and check-templates.d.mts). `git diff --check` PASS.

Review handoff: source is frozen and ready for actual Claude Opus opposite-family review and
independent behavior QA. The retained local aggregate/cleanup failures, baseline reproduction,
and absent whole-workspace coverage/CI are explicit limits, not passing gates.
