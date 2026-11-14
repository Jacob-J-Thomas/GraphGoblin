#!/usr/bin/env bash
# usage: run-logged.sh <label> <command...>   Runs in the checkout, keeps log + meta, never retries.
set -u
label="$1"; shift
dir=/c/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-207-phase2/logs
cd /c/Users/98jak/.codex/worktrees/gg-20261114-canvas/GraphGoblin || exit 99
{
  echo "cwd $(pwd)"
  echo "command $*"
  echo "node $(node --version) pnpm.cmd $(pnpm.cmd --version 2>/dev/null)"
  echo "start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$dir/$label.meta"
"$@" > "$dir/$label.log" 2>&1
code=$?
{ echo "end $(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo "exit $code"; } >> "$dir/$label.meta"
tail -n 25 "$dir/$label.log"
echo "exit $code"
exit $code
