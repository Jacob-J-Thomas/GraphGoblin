#!/usr/bin/env bash
# Check 7: run each named native test file once, sequentially, outside any sandbox.
# Usage: bash native-files.sh <worktree> <out-dir>
set -u
WT="$1"
OUT="$2"
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
export GG_TEST_PORT_START=5850 GG_TEST_PORT_COUNT=100 GG_TEST_STORE_PREFIX=gg-qa-d1-int-
{
  echo "node $(node --version) at $(which node)"
  echo "head $(git -C "$WT" rev-parse HEAD)"
  echo "started $(date -Iseconds)"
} > "$OUT/native-files-env.log.txt"

run() {
  local name="$1" dir="$2"
  shift 2
  local log="$OUT/native-$name.log.txt"
  local start end
  start=$(date +%s)
  (cd "$WT/$dir" && "$@") > "$log" 2>&1
  local code=$?
  end=$(date +%s)
  echo "$name exit=$code seconds=$((end - start))" >> "$OUT/native-files-status.txt"
}

: > "$OUT/native-files-status.txt"
run api-child-creation-restart apps/api pnpm exec vitest run src/child-creation-restart.test.ts
run api-subloop-restart apps/api pnpm exec vitest run src/subloop-restart.test.ts
run api-script-restart apps/api pnpm exec vitest run src/script-restart.test.ts
run api-script-persistence-restart apps/api pnpm exec vitest run src/script-persistence-restart.test.ts
run api-pinned-run-restart apps/api pnpm exec vitest run src/pinned-run-restart.test.ts
run api-shutdown-process apps/api pnpm exec vitest run src/shutdown-process.test.ts
run infra-claude-process packages/infrastructure pnpm exec vitest run src/claude/process.test.ts
run infra-process-scripts packages/infrastructure pnpm exec vitest run src/process/scripts.test.ts
run infra-script-recovery packages/infrastructure pnpm exec vitest run src/process/script-recovery.test.ts
run infra-child-admission-recovery packages/infrastructure pnpm exec vitest run src/sqlite/child-admission-recovery.test.ts
run root-test-recovery-process . pnpm test:recovery-process
run root-test-wait-restart . pnpm test:wait-restart
run root-test-webhook-retry . pnpm test:webhook-retry
echo "finished $(date -Iseconds)" >> "$OUT/native-files-env.log.txt"
