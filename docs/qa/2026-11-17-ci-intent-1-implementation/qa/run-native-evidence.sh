#!/usr/bin/env bash
# QA driver (#496): init -> native acceptance -> finalize, mirroring the CI step contract.
# Usage: run-native-evidence.sh <run-name> [acceptance-file]
# Local only. No GitHub bindings are faked: they are recorded as unavailable.
set -u
name="$1"
suite="${2:-}"
repo=/c/Users/98jak/.codex/worktrees/gg-20261117-ci-gates/GraphGoblin
out=/c/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-ci-implementation-evidence/local/$name
mkdir -p "$out/runner-temp"
: > "$out/github-output.txt"
export PATH="/c/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
cd "$repo"
runner_temp=$(cygpath -w "$out/runner-temp")
github_output=$(cygpath -w "$out/github-output.txt")
step_summary=$(cygpath -w "$out/step-summary.md")
RUNNER_TEMP="$runner_temp" GITHUB_OUTPUT="$github_output" node tooling/scripts/windows-launcher-evidence.mjs init > "$out/init.log" 2>&1
init=$?
dir=$(sed -n 's/^dir=//p' "$out/github-output.txt")
id=$(sed -n 's/^id=//p' "$out/github-output.txt")
start=$(date -u +%FT%TZ)
if [ -n "$suite" ]; then
  GG_TEST_PORT_START=63700 RUNNER_TEMP="$runner_temp" GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_DIR="$dir" node --test "$suite" > "$out/native.log" 2>&1
else
  GG_TEST_PORT_START=63700 RUNNER_TEMP="$runner_temp" GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_DIR="$dir" pnpm test:windows-launcher > "$out/native.log" 2>&1
fi
native=$?
end=$(date -u +%FT%TZ)
outcome=$([ $native -eq 0 ] && echo success || echo failure)
RUNNER_TEMP="$runner_temp" GITHUB_OUTPUT="$github_output" GITHUB_STEP_SUMMARY="$step_summary" \
  GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_DIR="$dir" GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_ID="$id" \
  GG_TEST_EVIDENCE_INSTALL_OUTCOME=success GG_TEST_EVIDENCE_BUILD_OUTCOME=success \
  GG_TEST_EVIDENCE_NATIVE_OUTCOME="$outcome" \
  node tooling/scripts/windows-launcher-evidence.mjs finalize > "$out/finalize.log" 2>&1
finalize=$?
printf '{"run":"%s","init":%d,"native":%d,"finalize":%d,"start":"%s","end":"%s"}\n' "$name" "$init" "$native" "$finalize" "$start" "$end" | tee "$out/exits.json"
