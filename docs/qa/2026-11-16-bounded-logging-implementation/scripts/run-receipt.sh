#!/usr/bin/env bash
# Usage: run-receipt.sh <label> <cwd> <command...>
# Records command, cwd, runtime, start/end and actual exit; output retained verbatim.
set -u
D="C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/launcher-438-implementation"
label="$1"; shift; cwd="$1"; shift
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
n=$(ls "$D/logs" | wc -l); seq=$(printf "%03d" $((n+1)))
log="$D/logs/$seq-$label.log"; receipt="$D/receipts/$seq-$label.json"
start=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
{ echo "# command: $*"; echo "# cwd: $cwd"; echo "# node: $(command -v node) $(node --version)"; echo "# start: $start"; } > "$log"
( cd "$cwd" && "$@" ) >> "$log" 2>&1
code=$?
end=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
echo "# end: $end exit: $code" >> "$log"
printf '{"label":"%s","command":%s,"cwd":"%s","node":"%s","start":"%s","end":"%s","exit":%d,"log":"%s","logSha256":"%s"}\n' \
  "$label" "$(printf '%s' "$*" | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))')" "$cwd" "$(node --version)" "$start" "$end" "$code" "$log" "$(sha256sum "$log" | cut -d' ' -f1)" > "$receipt"
echo "receipt=$receipt exit=$code"
tail -n 60 "$log"
exit $code
