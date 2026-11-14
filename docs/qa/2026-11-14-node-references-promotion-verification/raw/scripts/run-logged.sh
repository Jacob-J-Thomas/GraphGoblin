#!/usr/bin/env bash
# Usage: run-logged.sh <log-number-and-name> <cwd> -- <command...>
# Runs the command from <cwd> with the shared env, tees stdout+stderr to logs/<name>.log and writes logs/<name>.meta
# (exact command, node/pnpm, UTC start/end, exit code). The exit code of the command is returned.
source "C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-273-promotion-verification/scripts/env.sh"
name="$1"; dir="$2"; shift 2; [ "$1" = "--" ] && shift
cd "$dir" || exit 97
log="$OUT/logs/$name.log"; meta="$OUT/logs/$name.meta"
{
  echo "cwd $PWD"
  echo "command $*"
  echo "node $(node --version) pnpm.cmd $(pnpm.cmd --version 2>&1 | tail -1)"
  echo "start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$meta"
"$@" > "$log" 2>&1
code=$?
{ echo "end $(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo "exit $code"; } >> "$meta"
echo "[$name] exit=$code"; tail -n "${TAIL_LINES:-25}" "$log"
exit $code
