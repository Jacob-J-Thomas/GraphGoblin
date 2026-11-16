#!/usr/bin/env bash
# Usage: run-logged.sh <label> <command...>
# Runs one command from the admitted checkout with project Node 22.23.4 first on PATH, writes the
# exact command, combined output and exit status to logs/<label>.txt and appends a TSV row.
set -u
EV=/c/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/launcher-438-correction-implementation-02
REPO=/c/Users/98jak/.codex/worktrees/gg-20261116-bounded-logs-corrections/GraphGoblin
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
label="$1"; shift
log="$EV/logs/$label.txt"
test ! -e "$log" || { echo "refusing to overwrite $log" >&2; exit 2; }
cd "$REPO"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{
  echo "# label: $label"
  echo "# cwd: $REPO"
  echo "# started: $started"
  echo "# node: $(node --version)"
  printf '# command:'; printf ' %q' "$@"; echo
  echo "# ---- output ----"
} > "$log"
"$@" >> "$log" 2>&1
status=$?
ended=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{ echo "# ---- end ----"; echo "# ended: $ended"; echo "# exit: $status"; } >> "$log"
printf '%s\t%s\t%s\t%s\t' "$label" "$started" "$ended" "$status" >> "$EV/commands.tsv"
printf ' %q' "$@" >> "$EV/commands.tsv"; echo >> "$EV/commands.tsv"
echo "exit $status -> $log"
exit $status
