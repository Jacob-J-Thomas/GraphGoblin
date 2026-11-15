#!/usr/bin/env bash
# Old-vs-new negative control for the #207 review correction (UI owner, implementation slot).
#
# Controlled temporary restoration in the assigned worktree only: the seven changed production
# files are replaced by their exact HEAD blobs (993d58a), the new and changed tests stay, the
# focused test files run, and the new production files are copied back from a backup outside the
# repository. Restoration is verified by SHA-256 against the hashes recorded before, and the Git
# index is read before and after (no index command is run). A trap restores on any exit.
set -u
REPO="C:/Users/98jak/.codex/worktrees/gg-20261114-canvas-repair/GraphGoblin"
NC="C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-207-review-correction-implementation/artifacts/negative-control"
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
cd "$REPO" || exit 90

PROD=(
  apps/web/src/editor/Canvas.tsx
  apps/web/src/editor/OrthogonalEdge.tsx
  apps/web/src/editor/store.ts
  apps/web/src/editor/model.ts
  apps/web/src/editor/stranded-edges.ts
  apps/web/src/editor/route-editing.ts
  apps/web/src/editor/viewport-gesture.ts
)
TESTS=(
  src/editor/Canvas.test.tsx
  src/editor/OrthogonalEdge.test.tsx
  src/editor/viewport-gesture.contract.test.tsx
  src/editor/store.test.ts
  src/editor/chat-protection.test.ts
)

{
  echo "node $(node --version)"
  echo "head $(git rev-parse HEAD) tree $(git rev-parse 'HEAD^{tree}') branch $(git branch --show-current)"
} > "$NC/identity.txt"

mapfile -t ALL < <(git status --porcelain=v1 | awk '{print $2}')
sha256sum "${ALL[@]}" > "$NC/new-all-before.sha256"
git ls-files -s "${ALL[@]}" > "$NC/index-before.txt"
git diff --cached --name-only > "$NC/cached-before.txt"

rm -rf "$NC/new-backup"
for f in "${PROD[@]}"; do
  mkdir -p "$NC/new-backup/$(dirname "$f")"
  cp -p "$f" "$NC/new-backup/$f"
done

restore() {
  for f in "${PROD[@]}"; do cp -p "$NC/new-backup/$f" "$f"; done
  sha256sum -c "$NC/new-all-before.sha256" > "$NC/restore-verify.txt" 2>&1
  echo "restore-verify exit=$?" >> "$NC/restore-verify.txt"
  git ls-files -s "${ALL[@]}" > "$NC/index-after.txt"
  git diff --cached --name-only > "$NC/cached-after.txt"
  if cmp -s "$NC/index-before.txt" "$NC/index-after.txt" && cmp -s "$NC/cached-before.txt" "$NC/cached-after.txt"; then
    echo "index unchanged" >> "$NC/restore-verify.txt"
  else
    echo "INDEX CHANGED" >> "$NC/restore-verify.txt"
  fi
}
trap restore EXIT

for f in "${PROD[@]}"; do git show "HEAD:$f" > "$f"; done
: > "$NC/old-restored-blob-check.txt"
for f in "${PROD[@]}"; do
  printf '%s head=%s worktree=%s\n' "$f" "$(git rev-parse "HEAD:$f")" "$(git hash-object "$f")" >> "$NC/old-restored-blob-check.txt"
done

cd apps/web || exit 91
timeout 900 pnpm exec vitest run "${TESTS[@]}" > "$NC/old-production-new-tests.log" 2>&1
echo "exit=$?" >> "$NC/old-production-new-tests.log"
