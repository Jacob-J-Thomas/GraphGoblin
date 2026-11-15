#!/usr/bin/env bash
# Mutation control for the selection-identity branch in Canvas.onEdgesChange (#207): with the
# `same ? current : next` retention replaced by `next`, the control test "keeps a drag when xyflow
# selects its connection again under the multi-selection key" must fail. Absolute paths only; the
# new Canvas.tsx is restored from a backup outside the repository and verified by SHA-256.
set -u
REPO="C:/Users/98jak/.codex/worktrees/gg-20261114-canvas-repair/GraphGoblin"
NC="C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-207-review-correction-implementation/artifacts/negative-control"
FILE="$REPO/apps/web/src/editor/Canvas.tsx"
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"

sha256sum "$FILE" > "$NC/mutation-canvas-before.sha256"
cp -p "$FILE" "$NC/mutation-canvas-backup.tsx"
restore() {
  cp -p "$NC/mutation-canvas-backup.tsx" "$FILE"
  sha256sum -c "$NC/mutation-canvas-before.sha256" > "$NC/mutation-restore-verify.txt" 2>&1
  echo "restore-verify exit=$?" >> "$NC/mutation-restore-verify.txt"
}
trap restore EXIT

grep -c 'return same ? current : next;' "$FILE" > "$NC/mutation-site-count.txt"
sed -i 's/return same ? current : next;/return next;/' "$FILE"
grep -c 'return next;' "$FILE" >> "$NC/mutation-site-count.txt"

cd "$REPO/apps/web" || exit 91
timeout 600 pnpm exec vitest run src/editor/Canvas.test.tsx -t "multi-selection key" > "$NC/identity-mutation.log" 2>&1
echo "exit=$?" >> "$NC/identity-mutation.log"
