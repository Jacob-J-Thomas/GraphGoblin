#!/usr/bin/env bash
# D192 fixture-correction checks on the exact uncommitted bytes. Usage: checks.sh <label>
# Writes logs/<label>-*.log. Never formats, stages, commits or installs anything.
set -u
export PATH="/c/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
export GIT_OPTIONAL_LOCKS=0
E="C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-442-ui-fixture-author-01/author"
ROOT="G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin"
S="G:/ggq/qa-scratch/i4-442-fixture-correction-01/tmp"
L="${1:?label}"
OWNED="src/settings/sections/PreflightSection.test.tsx"
# Per-child temp only; HOME/CODEX_HOME are left as inherited.
child() { TEMP="$S" TMP="$S" TMPDIR="$S" "$@"; }
cd "$ROOT" || exit 98
{
  echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node=$(command -v node) $(node --version)"
  echo "pnpm=$(command -v pnpm.cmd) $(child pnpm.cmd --version)"
  echo "head=$(git rev-parse HEAD) tree=$(git rev-parse 'HEAD^{tree}')"
  echo "-- status (porcelain, untracked all)"
  git status --porcelain=v1 --untracked-files=all
  echo "-- staged (expect none)"
  git diff --cached --name-only
  echo "-- #442 files: worktree sha256, worktree blob, HEAD blob"
  for f in $(git diff --name-only 02351e2fb932b3be44e7cc3fb3943a61d568226c HEAD); do
    printf '%s  %s  %s  %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$(git hash-object "$f")" \
      "$(git rev-parse "HEAD:$f")" "$f"
  done
} > "$E/logs/$L-state.log" 2>&1
git diff --check > "$E/logs/$L-diffcheck.log" 2>&1; echo "exit=$?" >> "$E/logs/$L-diffcheck.log"
cd "$ROOT/apps/web" || exit 97
child pnpm.cmd exec vitest run --reporter=verbose \
  src/settings/sections/PreflightSection.test.tsx src/settings/SettingsPage.test.tsx \
  > "$E/logs/$L-tests.log" 2>&1; echo "exit=$?" >> "$E/logs/$L-tests.log"
child pnpm.cmd run typecheck > "$E/logs/$L-typecheck.log" 2>&1; echo "exit=$?" >> "$E/logs/$L-typecheck.log"
child pnpm.cmd exec eslint --max-warnings 0 $OWNED > "$E/logs/$L-eslint.log" 2>&1; echo "exit=$?" >> "$E/logs/$L-eslint.log"
child pnpm.cmd exec prettier --check $OWNED > "$E/logs/$L-prettier.log" 2>&1; echo "exit=$?" >> "$E/logs/$L-prettier.log"
for f in state diffcheck tests typecheck eslint prettier; do echo "== $L-$f"; tail -8 "$E/logs/$L-$f.log"; done
