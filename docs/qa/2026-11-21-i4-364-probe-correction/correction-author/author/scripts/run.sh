#!/usr/bin/env bash
# Run one command for the #364 probe correction with a per-process environment and record it.
# Usage: run.sh <label> <workdir-relative-to-repo> <command> [args...]
# Sets only PATH (project Node 22.23.4 first), TEMP and TMP for the child; no HOME/CODEX_HOME or
# global variable is changed. Output: logs/<label>.log, logs/<label>.exit, one commands.jsonl line.
set -u
E="C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-364-probe-author-01/author"
REPO="G:/ggq/gg-i4-364-claude-start/GraphGoblin"
label="$1"
workdir="$2"
shift 2
if [ -e "$E/logs/$label.log" ]; then
  echo "refusing to overwrite existing log for label $label" >&2
  exit 97
fi
NODE_DIR="/c/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64"
SCRATCH_WIN='G:\ggq\qa-scratch\i4-364-probe-correction-01'
start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
(
  cd "$REPO/$workdir" &&
    PATH="$NODE_DIR:$PATH" TEMP="$SCRATCH_WIN" TMP="$SCRATCH_WIN" "$@"
) >"$E/logs/$label.log" 2>&1
code=$?
end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\n' "$code" >"$E/logs/$label.exit"
"$NODE_DIR/node.exe" -e '
const [label, workdir, start, end, code, ...command] = process.argv.slice(1);
process.stdout.write(JSON.stringify({ label, workdir, start, end, exit: Number(code), command, env: { PATH: "project node-v22.23.4-win-x64 first", TEMP: "G:\\ggq\\qa-scratch\\i4-364-probe-correction-01", TMP: "G:\\ggq\\qa-scratch\\i4-364-probe-correction-01" } }) + "\n");
' "$label" "$workdir" "$start" "$end" "$code" "$@" >>"$E/commands.jsonl"
echo "[$label] exit $code"
exit "$code"
