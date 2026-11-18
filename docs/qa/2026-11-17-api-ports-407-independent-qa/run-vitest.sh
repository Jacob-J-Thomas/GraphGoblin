#!/usr/bin/env bash
# Usage: run-vitest.sh <runName> <portStart> <portCount> <maxWorkers> <vitest filters...>
# Runs the ACTUAL apps/api vitest.config.ts (global setup + setupFiles) with TEMP/TMP redirected to a QA-owned dir.
set -u
EV="C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-ports-407-independent-claude-qa"
QA="C:/Users/98jak/.codex/worktrees/gg-20261117-ports-407-qa/GraphGoblin"
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
run="$1"; start="$2"; count="$3"; workers="$4"; shift 4
work="$QA/.tmp/qa407/$run"
case "$work" in "$QA/.tmp/qa407/"?*) ;; *) echo "bad work path"; exit 90;; esac
if [ -e "$work" ]; then echo "work dir exists, refusing to reuse: $work"; exit 91; fi
mkdir -p "$work/tmp" "$work/sync" "$EV/$run"
node "$EV/scripts/probe-assigned-ports-v2.mjs" "$run-before" > "$EV/$run/ports-before.json"; pb=$?
if [ $pb -ne 0 ]; then echo "assigned ports not free before $run (exit $pb) - aborting"; exit 92; fi
cd "$QA/apps/api"
WTMP=$(cygpath -w "$work/tmp"); WSYNC=$(cygpath -w "$work/sync"); WOUT=$(cygpath -w "$EV/$run")
TEMP="$WTMP" TMP="$WTMP" GG_TEST_PORT_START="$start" GG_TEST_PORT_COUNT="$count" QA407_SYNC="$WSYNC" QA407_OUT="$WOUT" \
  QA407_SCRIPTS="$(cygpath -w "$EV/scripts")" \
  bash "$EV/run.sh" "$run/vitest" pnpm exec vitest run --reporter=verbose --maxWorkers="$workers" "$@"
code=$?
cd "$QA"
{ echo "TEMP entries after run (QA-owned $WTMP):"; ls -la "$work/tmp"; } > "$EV/$run/temp-after.txt" 2>&1
node "$EV/scripts/probe-assigned-ports-v2.mjs" "$run-after" > "$EV/$run/ports-after.json"; echo "ports-after exit=$?" >> "$EV/$run/temp-after.txt"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$EV/scripts/children-v2.ps1")" > "$EV/$run/processes-after.json" 2>&1
echo "vitest exit=$code"
exit $code
