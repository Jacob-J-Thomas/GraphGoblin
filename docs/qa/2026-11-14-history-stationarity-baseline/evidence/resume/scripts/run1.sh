#!/usr/bin/env bash
# usage: run1.sh <config> <case> <label> [extra=qs ...]   (runs one case through the prepared orchestrator)
set -u
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
R=C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-208-stationarity-baseline-resume
W=C:/Users/98jak/.codex/worktrees/gg-20261114-canvas/GraphGoblin
CLI=C:/Users/98jak/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/@playwright/cli/playwright-cli.js
cfg=$1; case_=$2; label=$3; shift 3
cd "$R" && node scripts/run-case.mjs "$W" "$CLI" "$cfg" "${DRIVER:-measure.playwright.js}" "$case_" "$label" "$@" > "runs/$label.orchestrator.stdout.json" 2> "runs/$label.orchestrator.stderr.log"
echo "$label exit=$?"
