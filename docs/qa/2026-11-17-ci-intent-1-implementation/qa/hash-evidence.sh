#!/usr/bin/env bash
# Record source blob/SHA-256 bindings for the uncommitted candidate and SHA-256 of every evidence
# file (excluding this run's own outputs). QA-only.
set -eu
repo=/c/Users/98jak/.codex/worktrees/gg-20261117-ci-gates/GraphGoblin
evidence=/c/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-ci-implementation-evidence
cd "$repo"
{
  echo "base $(git rev-parse HEAD)"
  echo "branch $(git rev-parse --abbrev-ref HEAD)"
  for file in $(git status --porcelain --untracked-files=all | awk '{print $2}' | sort); do
    printf '%s sha256=%s blob=%s\n' "$file" "$(sha256sum "$file" | cut -d' ' -f1)" "$(git hash-object "$file")"
  done
  echo "diff-sha256 $(git diff | sha256sum | cut -d' ' -f1) (tracked changes, git diff)"
} > "$evidence/SOURCE-BINDINGS.txt"
cd "$evidence"
find . -type f ! -name SHA256SUMS.txt ! -path './local/*/runner-temp/*' -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS.txt
# The evidence bundles themselves (below runner-temp) are hashed separately for clarity.
find ./local -path '*/runner-temp/*' -type f -print0 | sort -z | xargs -0 sha256sum >> SHA256SUMS.txt
wc -l SHA256SUMS.txt
