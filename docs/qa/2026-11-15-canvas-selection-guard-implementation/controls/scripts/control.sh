#!/usr/bin/env bash
# Controlled substitution of apps/web/src/editor/OrthogonalEdge.tsx for one focused vitest run.
# usage: control.sh <log> old | mutate <name>
#   old    - production under test is the committed HEAD file (read with `git show`, no index change)
#   mutate - production under test is the final candidate with one named mutation (mutate.cjs)
# The candidate is asserted before the swap and restored (and hashed) by an exit trap. No index
# command is run; only the one worktree file is replaced and put back.
set -u
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
ROOT="C:/Users/98jak/.codex/worktrees/gg-20261114-canvas-repair/GraphGoblin"
OUT="C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-207-selection-doubleclick-implementation"
REL="apps/web/src/editor/OrthogonalEdge.tsx"
TARGET="$ROOT/$REL"
CAND="$OUT/backup/OrthogonalEdge.candidate-final.tsx"
LOG="$1"
MODE="$2"
NAME="${3:-}"
sha() { sha256sum "$1" | cut -d' ' -f1; }
EXPECT="$(sha "$CAND")"
{
  echo "control $MODE $NAME started $(date -u +%FT%TZ)"
  echo "node $(node --version)"
  echo "candidate backup sha256 $EXPECT"
  echo "worktree sha256 before swap $(sha "$TARGET")"
} > "$LOG"
if [ "$(sha "$TARGET")" != "$EXPECT" ]; then
  echo "ABORT: worktree OrthogonalEdge.tsx is not the final candidate" >> "$LOG"
  exit 3
fi
restore() {
  cp "$CAND" "$TARGET"
  echo "restored worktree sha256 $(sha "$TARGET") (candidate $EXPECT)" >> "$LOG"
  if [ "$(sha "$TARGET")" != "$EXPECT" ]; then echo "RESTORE MISMATCH" >> "$LOG"; fi
}
trap restore EXIT
if [ "$MODE" = old ]; then
  git -C "$ROOT" --no-optional-locks show "HEAD:$REL" > "$TARGET"
else
  node "$OUT/scripts/mutate.cjs" "$NAME" "$CAND" "$TARGET" >> "$LOG" 2>&1 || { echo "mutation failed" >> "$LOG"; exit 4; }
fi
echo "worktree sha256 under test $(sha "$TARGET")" >> "$LOG"
cd "$ROOT/apps/web" || exit 5
pnpm exec vitest run src/editor/OrthogonalEdge.test.tsx src/editor/Canvas.test.tsx src/editor/viewport-gesture.contract.test.tsx >> "$LOG" 2>&1
echo "vitest exit=$?" >> "$LOG"
