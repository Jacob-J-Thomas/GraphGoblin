#!/usr/bin/env bash
# usage: control.sh <log-name> old | <mutation-id>
# Swaps OrthogonalEdge.tsx in the assigned worktree for the committed HEAD bytes (old) or a
# mutation of the final candidate, runs the three focused test files, and always restores the
# candidate, proving it by SHA-256. No index command is run.
set -u
NAME="$1"; MODE="$2"
WT="C:/Users/98jak/.codex/worktrees/gg-20261114-canvas-repair/GraphGoblin"
OUT="C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-207-reset-doubleclick-implementation-resume-0250"
F="apps/web/src/editor/OrthogonalEdge.tsx"
CANDIDATE=78abfe483474d79694be521f0b7dacd6909352d3669fa62b031b327b7b557ddf
BK="$OUT/backup/OrthogonalEdge.candidate-final.tsx"
sha() { sha256sum "$1" | cut -d' ' -f1; }
[ -f "$BK" ] || cp "$WT/$F" "$BK"
[ "$(sha "$BK")" = "$CANDIDATE" ] || { echo "backup is not the candidate" >&2; exit 90; }
[ "$(sha "$WT/$F")" = "$CANDIDATE" ] || { echo "worktree production is not the candidate" >&2; exit 91; }
restore() { cp "$BK" "$WT/$F"; echo "restored sha=$(sha "$WT/$F") expected=$CANDIDATE" >> "$OUT/logs/$NAME.log"; }
trap restore EXIT
if [ "$MODE" = old ]; then
  git -C "$WT" --no-optional-locks show "HEAD:$F" > "$WT/$F"
else
  node "$OUT/scripts/mutate.cjs" "$BK" "$WT/$F" "$MODE" || exit 92
fi
{ echo "mode=$MODE"; echo "production under test sha=$(sha "$WT/$F")"; } > "$OUT/logs/$NAME.log"
cd "$WT/apps/web" || exit 93
NO_COLOR=1 FORCE_COLOR=0 pnpm.cmd exec vitest run src/editor/OrthogonalEdge.test.tsx src/editor/Canvas.test.tsx src/editor/viewport-gesture.contract.test.tsx >> "$OUT/logs/$NAME.log" 2>&1
echo "vitest exit=$?" >> "$OUT/logs/$NAME.log"
