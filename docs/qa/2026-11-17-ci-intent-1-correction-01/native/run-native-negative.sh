#!/usr/bin/env bash
# Correction 01 (#496): one bounded native NEGATIVE run against the frozen corrected candidate.
# init -> QA-only negative copy of the unchanged acceptance suite -> finalize, mirroring the CI
# step contract. Local only: no GitHub bindings are faked (they are recorded as unavailable), and
# install/build were not run in this session, so their outcomes are passed as unknown.
# Ports: GG_TEST_PORT_START=63700 (the suite uses 63700-63719). The generated suite is written to
# its exact temporary path in the checkout and removed after the run.
set -u
repo=/c/Users/98jak/.codex/worktrees/gg-20261117-ci-gates/GraphGoblin
out=/c/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-ci-correction-01/native
generator=/c/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-ci-implementation-evidence/qa/make-negative-acceptance.py
suite_rel=tooling/scripts/windows-launcher.qa-negative.acceptance.mjs
export PATH="/c/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
mkdir -p "$out/runner-temp"
: > "$out/github-output.txt"
cd "$repo"
[ -e "$suite_rel" ] && { echo "refusing: $suite_rel already exists"; exit 2; }
python -I "$generator" tooling/scripts/windows-launcher.acceptance.mjs "$suite_rel" > "$out/generate.log" 2>&1
cp "$suite_rel" "$out/windows-launcher.qa-negative.acceptance.mjs"
sha256sum tooling/scripts/windows-launcher.acceptance.mjs "$suite_rel" >> "$out/generate.log"
seed=$(node -e "process.stdout.write(require('node:crypto').randomBytes(12).toString('hex'))")
canary="QA496-C01-$seed"
printf '%s\n' "$canary" > "$out/canary-seed.txt"
runner_temp=$(cygpath -w "$out/runner-temp")
github_output=$(cygpath -w "$out/github-output.txt")
step_summary=$(cygpath -w "$out/step-summary.md")
RUNNER_TEMP="$runner_temp" GITHUB_OUTPUT="$github_output" node tooling/scripts/windows-launcher-evidence.mjs init > "$out/init.log" 2>&1
init=$?
dir=$(sed -n 's/^dir=//p' "$out/github-output.txt")
id=$(sed -n 's/^id=//p' "$out/github-output.txt")
start=$(date -u +%FT%TZ)
LIVE=0 GG_TEST_PORT_START=63700 RUNNER_TEMP="$runner_temp" GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_DIR="$dir" \
  QA_496_CANARY="$canary" GG_QA_496_ENV_CANARY="$canary-ENV" QA_496_PLAIN_ENV_CANARY="$canary-PLAINENV" \
  node --test "$suite_rel" > "$out/native.log" 2>&1
native=$?
end=$(date -u +%FT%TZ)
outcome=$([ $native -eq 0 ] && echo success || echo failure)
RUNNER_TEMP="$runner_temp" GITHUB_OUTPUT="$github_output" GITHUB_STEP_SUMMARY="$step_summary" \
  GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_DIR="$dir" GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_ID="$id" \
  GG_TEST_EVIDENCE_INSTALL_OUTCOME= GG_TEST_EVIDENCE_BUILD_OUTCOME= \
  GG_TEST_EVIDENCE_NATIVE_OUTCOME="$outcome" \
  node tooling/scripts/windows-launcher-evidence.mjs finalize > "$out/finalize.log" 2>&1
finalize=$?
# Remove only the generated QA-only suite, by its exact path, after checking it is the copy.
if cmp -s "$suite_rel" "$out/windows-launcher.qa-negative.acceptance.mjs"; then rm -f -- "$suite_rel"; fi
removed=$([ -e "$suite_rel" ] && echo false || echo true)
printf '{"run":"correction-negative","init":%d,"native":%d,"finalize":%d,"start":"%s","end":"%s","suiteRemoved":%s,"dir":"%s"}\n' \
  "$init" "$native" "$finalize" "$start" "$end" "$removed" "$(basename "$dir")" | tee "$out/exits.json"
