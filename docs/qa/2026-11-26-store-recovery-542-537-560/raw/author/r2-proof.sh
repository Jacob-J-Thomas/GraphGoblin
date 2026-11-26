#!/usr/bin/env bash
# R2 proof: the two new shell-output tests fail with the fix reverted and pass with it.
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
export TEMP=G:/ggq/tmp/a4-542-537-560 TMP=G:/ggq/tmp/a4-542-537-560
cd G:/ggq/gg-r542/GraphGoblin || exit 1
src=apps/api/src/data-dir-lock.ts
keep=G:/ggq/tmp/a4-542-537-560/data-dir-lock.r2-head.ts
cp "$src" "$keep"
echo "HEAD $(git rev-parse HEAD) $(date -u +%Y-%m-%dT%H:%M:%SZ) node $(node --version)"
echo "== 1. fix reverted (printableEvidence(probes) -> probes), expect 2 failures"
sed -i 's/{ probeFailures: printableEvidence(probes) }/{ probeFailures: probes }/' "$src"
git diff --stat -- "$src"
pnpm --filter @graphgoblin/api exec vitest run src/data-dir-lock-failures.test.ts \
  -t "post-denial lookup|main lock rollback also fails" --reporter=verbose 2>&1
echo "exit $?"
cp "$keep" "$src"
cmp "$src" "$keep" && echo "source restored byte-for-byte"
git diff --quiet -- "$src" && echo "worktree clean for $src"
echo "== 2. with the fix, expect 2 passes"
pnpm --filter @graphgoblin/api exec vitest run src/data-dir-lock-failures.test.ts \
  -t "post-denial lookup|main lock rollback also fails" --reporter=verbose 2>&1
echo "exit $?"
