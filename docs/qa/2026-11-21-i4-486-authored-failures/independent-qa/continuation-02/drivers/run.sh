#!/usr/bin/env bash
# 02-owned runner: one attempt of one QA driver, project Node, task TEMP/TMP, cwd in scratch.
# Usage: bash run.sh <driver.mjs> <attempt-number> [extra args]
set -u
Q=/c/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-486-independent-02
S=/g/ggq/qa-scratch/i4-486-independent-02
CHECKOUT=/g/ggq/gg-i4-486-qa/GraphGoblin
DRIVER="$1"; ATTEMPT="$2"; shift 2
NAME="${DRIVER%.mjs}"
OUT="$Q/results/$NAME/attempt-$ATTEMPT"
WORK="$S/$NAME-$ATTEMPT"
if [ -e "$OUT" ] || [ -e "$WORK" ]; then echo "refusing to overwrite $OUT or $WORK"; exit 3; fi
mkdir -p "$OUT" "$WORK/tmp" "$WORK/cwd"
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
export TEMP=$(cygpath -w "$WORK/tmp") TMP=$(cygpath -w "$WORK/tmp")
export QA_WORK=$(cygpath -w "$WORK") QA_OUT=$(cygpath -w "$OUT")
{
  echo "driver=$DRIVER attempt=$ATTEMPT"
  echo "driver_sha256=$(sha256sum "$Q/drivers/$DRIVER" | cut -d' ' -f1)"
  for f in "$Q"/drivers/lib/*.mjs "$Q"/fixtures/*.mjs; do echo "file_sha256 $(basename "$f")=$(sha256sum "$f" | cut -d' ' -f1)"; done
  echo "node=$(node --version) head=$(git -C "$CHECKOUT" rev-parse HEAD) porcelain_lines=$(git -C "$CHECKOUT" status --porcelain --untracked-files=all | wc -l)"
  echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ) TEMP=$TEMP work=$QA_WORK"
} > "$OUT/attempt.txt"
cp "$Q/drivers/$DRIVER" "$OUT/driver-copy.mjs"
mkdir -p "$OUT/lib-copy"; cp "$Q"/drivers/lib/*.mjs "$OUT/lib-copy/"
cd "$WORK/cwd"
node "$(cygpath -w "$Q/drivers/$DRIVER")" "$@" > "$OUT/stdout.txt" 2> "$OUT/stderr.txt"
CODE=$?
echo "exit=$CODE finished=$(date -u +%Y-%m-%dT%H:%M:%SZ) porcelain_after=$(git -C "$CHECKOUT" status --porcelain --untracked-files=all | wc -l)" >> "$OUT/attempt.txt"
tail -60 "$OUT/stdout.txt"; echo "--- stderr (tail)"; tail -25 "$OUT/stderr.txt"; echo "exit=$CODE"
