I fixed F1 under D192: the Codex test helper now gives `true` for Ready, `false` for `auth` and leaves out `authenticated` in the other five states. The two affected test suites passed 59 of 59, and typecheck, lint, Prettier and `git diff --check` all exited 0. Nothing is staged or committed; that's left for root.

**What changed:** one line became two, inside the new `codex(state)` helper in `apps/web/src/settings/sections/PreflightSection.test.tsx` only.
```diff
-    authenticated: state === 'ready',
+    // As the adapter reports: false only for a confirmed sign-out, absent when login is unknown.
+    ...(state === 'ready' || state === 'auth' ? { authenticated: state === 'ready' } : {}),
```
This matches the contract at `harness.ts:36` and what the Codex adapter actually returns (`cli.ts:223/229/235`). The repo's type settings don't allow setting the field to `undefined`, so it is left out through a conditional spread, the same way the helper already handles `version`. No assertions, other helpers (including the older `claude()` one), product code or docs changed, and no tests or files were added.

| | sha256 | git blob |
|---|---|---|
| Before | `a60b0729…6e945c61` | `d3a6bd8b` (matches HEAD) |
| After | `4fb8b7a6…ef0d7dae` | `84566b78` |

Each of the other ten #442 files still matches its HEAD blob. Git status shows only this one modified file, nothing is staged, and HEAD and tree are unchanged at `39304c07`/`f5d9abae`.

**Checks:** one run each, with the project's Node v22.23.4 first on PATH and `pnpm.cmd` 12.8.1. Temp files for each command went to `G:/ggq/qa-scratch/i4-442-fixture-correction-01/tmp`.

| Check | Exit | Result |
|---|---|---|
| Vitest on the two affected suites | 0 | 2 files, 59/59 passed |
| Web typecheck | 0 | No errors |
| ESLint (`--max-warnings 0`) on the changed file | 0 | No problems |
| Prettier check on the changed file | 0 | Formatted |
| `git diff --check` | 0 | No whitespace errors |

**Limits:**
- **No rendered change to test:** the component reads `authenticated` only for Claude sign-ins, so Codex rows look the same whether the value is `false` or absent. The tests pass with both the old and new helper. This change makes the fixture accurate; this run doesn't prove it would catch a regression involving the absent field, since no mutation testing was in scope.
- **Line endings:** an early `grep` of mine wrongly reported Windows line endings. Counting the bytes showed none, and Git confirms the file uses Unix endings, so nothing was converted.
- **Git index:** a few plain `git status` calls ran before I switched to the setting that stops Git updating its index cache. They may have refreshed that cache, but nothing was staged.
- **pnpm location:** `pnpm.cmd` comes from the global `C:\nvm4w\nodejs` shim. The commands themselves ran on the project's Node v22.23.4, which the state log records.
- **Not run, per the brief:** full build, coverage, browser, discovery, install, commit, push, GitHub or provider calls, and subagents.

I didn't write to the provider folder, `BRIEF.md`, `spec.json`, earlier authors' work or the shared stash. Formal review 2's APPROVE stands; the final Astra review 3 and normal CI are still to come.

Everything is in `Q/i4-442-ui-fixture-author-01/author/`; open `REPORT.md` first:
- `REPORT.md`
- `fixture.diff`
- `checks.sh`
- `before/` (copy of the original file and its hash receipt)
- `logs/`
- `SHA256SUMS`