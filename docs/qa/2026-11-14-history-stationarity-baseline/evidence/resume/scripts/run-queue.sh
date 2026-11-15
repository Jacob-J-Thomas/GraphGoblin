#!/usr/bin/env bash
# usage: run-queue.sh <queue-file>   lines: "<config> <case> <label> [extra=qs ...]"; runs sequentially, one heavy-slot case at a time.
set -u
R=/c/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-208-stationarity-baseline-resume
while read -r cfg case_ label extra; do
  [ -z "${cfg:-}" ] && continue
  case "$cfg" in \#*) continue;; esac
  echo "$(date -u +%FT%TZ) START $label ($cfg $case_ ${extra:-})"
  bash "$R/scripts/run1.sh" "$cfg" "$case_" "$label" ${extra:-}
  echo "$(date -u +%FT%TZ) END   $label"
done < "$1"
echo "$(date -u +%FT%TZ) QUEUE-DONE $1"
