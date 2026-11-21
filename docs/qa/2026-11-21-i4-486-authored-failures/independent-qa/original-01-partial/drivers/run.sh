#!/usr/bin/env bash
# Run one QA driver attempt with the project runtime and task-scoped TEMP/TMP; keep every attempt.
# Usage: bash run.sh <driver-file-name> <attempt-number> [extra args]
set -u
Q=/c/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-486-independent-01
DRIVER="$1"; ATTEMPT="$2"; shift 2
NAME="${DRIVER%.mjs}"
OUT="$Q/results/$NAME/attempt-$ATTEMPT"
if [ -e "$OUT" ]; then echo "refusing to overwrite $OUT"; exit 3; fi
mkdir -p "$OUT"
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
S=/g/ggq/qa-scratch/i4-486-independent-01
mkdir -p "$S/tmp/$NAME-$ATTEMPT"
export TEMP=$(cygpath -w "$S/tmp/$NAME-$ATTEMPT") TMP=$(cygpath -w "$S/tmp/$NAME-$ATTEMPT")
cd /g/ggq/gg-i4-486-qa/GraphGoblin
{
  echo "driver=$DRIVER attempt=$ATTEMPT"
  echo "driver_sha256=$(sha256sum "$Q/drivers/$DRIVER" | cut -d' ' -f1)"
  echo "lib_sha256=$(cat "$Q"/drivers/lib/*.mjs | sha256sum | cut -d' ' -f1)"
  echo "node=$(node --version) head=$(git rev-parse HEAD)"
  echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ) TEMP=$TEMP"
} > "$OUT/attempt.txt"
cp "$Q/drivers/$DRIVER" "$OUT/driver-copy.mjs"
mkdir -p "$OUT/lib-copy"; cp "$Q"/drivers/lib/*.mjs "$OUT/lib-copy/"
node "$(cygpath -w "$Q/drivers/$DRIVER")" "$(cygpath -w "$OUT")" "$@" > "$OUT/stdout.txt" 2> "$OUT/stderr.txt"
CODE=$?
echo "exit=$CODE finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT/attempt.txt"
tail -40 "$OUT/stdout.txt"; echo "--- stderr (tail)"; tail -20 "$OUT/stderr.txt"; echo "exit=$CODE"
