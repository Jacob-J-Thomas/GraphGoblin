# #442 D192 fixture correction: author handoff

Actual Claude Code Opus 5.5/xhigh, as implementer. This is not a review or QA. The checkout is `G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin` on branch `codex/gg-i4-442-plugin-diagnostics`. It was clean at HEAD `39304c07b553f8dfe2d444a19c86f327cd8a32c4`, tree `f5d9abaefbe7be1581a39d22c4eff4e01024e687`, before the edit. The change is left uncommitted and unstaged for root.

## Change

The only file changed is `apps/web/src/settings/sections/PreflightSection.test.tsx`. Within it, only the `codex(state)` helper that #442 introduced changed: one line replaced by two. [Exact diff](fixture.diff)

```diff
-    authenticated: state === 'ready',
+    // As the adapter reports: false only for a confirmed sign-out, absent when login is unknown.
+    ...(state === 'ready' || state === 'auth' ? { authenticated: state === 'ready' } : {}),
```

| State                                                   | `authenticated` before | after   |
| ------------------------------------------------------- | ---------------------- | ------- |
| ready                                                   | true                   | true    |
| auth                                                    | false                  | false   |
| unknown, cli-missing, cli-incompatible, quota, transport | false                  | omitted |

This matches the contract comment at `packages/contracts/src/harness.ts:36`. It also matches the adapter's actual responses in `packages/adapter-codex/src/cli.ts`: line 235 returns true for Ready, lines 223 and 229 return false only for `auth`, and every other path omits the field. The base config sets `exactOptionalPropertyTypes: true`, so the field is omitted by a conditional spread, not set to `undefined`. This follows the helper's existing `version` line.

No assertion, other helper, test, fixture, production source or doc changed. The older `claude()` helper is untouched. No test or file was added.

| File                  | sha256                                                             | git blob                                   |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| before (HEAD, copied) | `a60b07293a7df65f129e246b246461e8b9dc1f89b4bde236c0f253b36e945c61` | `d3a6bd8b0dd60aac4c087e8fbcbe4c62fc4c9cdb` |
| final (worktree)      | `4fb8b7a63a16c8f9c90d1728f1661cd0bc37cccce21e450cb3971031ef0d7dae` | `84566b787083d55eeed5511d743d929696246e22` |

Both versions are LF-only. The file went from 15108 to 15260 bytes. [Before copy and receipt](before/)

## Checks

[checks.sh](checks.sh) ran once, label `final`, at 2026-11-21 12:15 UTC. It used Node `v22.23.4` from the project runtime, first on PATH, and `pnpm.cmd` 12.8.1. Each child process had TEMP/TMP/TMPDIR set to `G:/ggq/qa-scratch/i4-442-fixture-correction-01/tmp`. HOME and CODEX_HOME were left as inherited.

| Check                                                                                   | Exit | Result                                     | Log                                                          |
| --------------------------------------------------------------------------------------- | ---- | ------------------------------------------ | ------------------------------------------------------------ |
| `vitest run` of `PreflightSection.test.tsx` and `SettingsPage.test.tsx` (web, verbose) | 0    | 2 files, **59/59 passed**, 0 failed        | [final-tests.log](logs/final-tests.log)                      |
| `pnpm run typecheck` (web, `tsc -p tsconfig.json --noEmit`)                             | 0    | clean                                      | [final-typecheck.log](logs/final-typecheck.log)              |
| `eslint --max-warnings 0` on the owned file                                             | 0    | clean                                      | [final-eslint.log](logs/final-eslint.log)                    |
| `prettier --check` on the owned file                                                    | 0    | "All matched files use Prettier code style!" | [final-prettier.log](logs/final-prettier.log)                |
| `git diff --check`                                                                      | 0    | no whitespace errors                       | [final-diffcheck.log](logs/final-diffcheck.log)              |

In the [state log](logs/final-state.log), the porcelain status has one entry, ` M` for the owned file, and there are no untracked files. `git diff --cached` is empty. For each of the other ten #442 files, the worktree blob equals the HEAD blob.

The verbose log names all seven `readiness state display` badge cases and all nine `Codex plugin scope notice` cases. Those nine are Ready, six non-Ready states and two more. Five of the non-Ready states now receive the omitted field.

## Limits and notes

- **What the tests show.** `PreflightSection.tsx:42` reads `authenticated` only together with `authMethod === 'claude.ai'`, and the Codex helper sets no `authMethod`. The current component therefore renders the same for false and absent Codex values, and the existing assertions pass with both the old and the corrected fixture. This run shows the corrected fixture type-checks and keeps all 59 tests green. It does not show the fixture catching a regression specific to an absent field: no mutation run was in scope. The value is fixture fidelity, as D192 states.
- **Not run, per brief.** Full build, coverage, browser, discovery, install, git index operations, commit, push, GitHub calls, provider calls and subagents.
- **Measurement correction, no failed check.** An early Git Bash `grep -c $'\r'` reported "CRLF" for every line of several files. A raw byte count (`tr -cd '\r' | wc -c`) found 0 CR bytes, and `git ls-files --eol` reports `w/lf`. The grep pattern was matching every line, so no line-ending conversion happened or was needed.
- **Index stat cache.** Several plain `git status` calls ran before `checks.sh`, which uses `GIT_OPTIONAL_LOCKS=0`. Those earlier calls may have performed Git's optional stat-cache refresh of `.git/index`. Nothing was staged.
- **pnpm resolution.** `pnpm.cmd` resolves to the global standalone shim `C:\nvm4w\nodejs\pnpm.cmd`, which runs `pnpm.exe`. Scripts and binaries ran under the first `node` on PATH, the project runtime v22.23.4, as recorded in the state log. The repo's `devEngines` check did not refuse.
- **Scratch.** The scratch directory contains only Node's compile cache under `tmp/node-compile-cache`.
- **Not touched.** The provider folder, `BRIEF.md`, `spec.json`, prior author sources and reports, and the shared stash were not touched.

Formal review 2's original APPROVE stands unchanged. Root freezes this result. The fresh final Astra review 3 and ordinary CI remain.
