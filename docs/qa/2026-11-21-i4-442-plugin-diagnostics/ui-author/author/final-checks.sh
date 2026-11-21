#!/usr/bin/env bash
# Final author checks on the exact uncommitted bytes. Usage: final-checks.sh <label>
# Writes <label>-*.log beside this script. Never formats, stages or commits anything.
set -u
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
E="C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-442-ui-author-02/author"
ROOT="G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin"
L="${1:?label}"
FILES="src/settings/sections/PreflightSection.tsx src/settings/sections/PreflightSection.test.tsx src/settings/SettingsPage.test.tsx"
cd "$ROOT" || exit 98
{
  node --version
  git rev-parse HEAD 'HEAD^{tree}'
  git status --short
  for f in packages/domain/src/readiness.ts apps/api/src/preflight.ts apps/api/src/preflight.test.ts \
    docs/06-harness-integration.md docs/11-security-and-distribution.md \
    docs/guide/07-troubleshooting.md CHANGELOG.md; do
    printf '%s  %s\n' "$(sha256sum "$f" | cut -d' ' -f1 | tr a-f A-F)" "$f"
  done
  echo "-- owned files"
  for f in $FILES; do printf '%s  apps/web/%s\n' "$(sha256sum "apps/web/$f" | cut -d' ' -f1)" "$f"; done
} > "$E/$L-state.log" 2>&1
cd "$ROOT/apps/web" || exit 97
pnpm exec vitest run src/settings/sections/PreflightSection.test.tsx src/settings/SettingsPage.test.tsx \
  > "$E/$L-tests.log" 2>&1; echo "exit=$?" >> "$E/$L-tests.log"
pnpm run typecheck > "$E/$L-typecheck.log" 2>&1; echo "exit=$?" >> "$E/$L-typecheck.log"
pnpm exec eslint --max-warnings 0 $FILES > "$E/$L-eslint.log" 2>&1; echo "exit=$?" >> "$E/$L-eslint.log"
pnpm exec prettier --check $FILES > "$E/$L-prettier.log" 2>&1; echo "exit=$?" >> "$E/$L-prettier.log"
for f in state tests typecheck eslint prettier; do echo "== $L-$f"; tail -6 "$E/$L-$f.log"; done
