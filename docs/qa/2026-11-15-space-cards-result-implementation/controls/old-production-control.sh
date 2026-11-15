#!/usr/bin/env bash
# Old-production negative control for the Space cards result (#208).
#
# Temporarily puts HEAD's Canvas.tsx and SpaceCardsOffer.tsx (read with `git show`, hash-checked
# against the recorded baseline) into the assigned worktree, runs the retained new tests against
# them, and restores the exact new bytes from a hash-checked backup in a trap. Absolute paths only,
# so a changed directory cannot misplace a restore. Never touches the index: no add, no add -N, no
# checkout, no stash. If this process is killed outright the trap cannot run: the worktree would hold
# old production, and `RESTORE.sh` in this directory puts the new bytes back.
#
# usage: old-production-control.sh <label> <test file relative to apps/web>...
set -u
. "C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-208-double-hit-implementation-resume-0250/env.sh"

LABEL="$1"; shift
CTRL="$OUT/controls"
BACKUP="$CTRL/new-source-backup-$LABEL"
LOG="$CTRL/$LABEL.log"
META="$CTRL/$LABEL.meta.txt"
FILES="apps/web/src/editor/Canvas.tsx apps/web/src/editor/SpaceCardsOffer.tsx"
# HEAD's recorded blobs' sha256 (the baseline the first attempt recorded).
HEAD_CANVAS_SHA=b47c77b45c6d31e5fcc2235daa270d2da093677ef4b5f6cd7c3c9f8e48f4190e
HEAD_OFFER_SHA=248c7416f78053c515610990ac4d8fa5fbad19988d46505e134920479a06bd85

sha() { sha256sum "$1" | cut -d' ' -f1; }
mkdir -p "$BACKUP"
: > "$META"
say() { echo "$@" | tee -a "$META"; }

declare -A NEW_SHA
for f in $FILES; do
  NEW_SHA[$f]=$(sha "$WT/$f")
  mkdir -p "$BACKUP/$(dirname "$f")"
  cp -p "$WT/$f" "$BACKUP/$f"
  [ "$(sha "$BACKUP/$f")" = "${NEW_SHA[$f]}" ] || { echo "backup hash mismatch for $f" >&2; exit 90; }
  say "new     ${NEW_SHA[$f]}  $f"
done

restored=0
restore() {
  [ "$restored" = 1 ] && return
  restored=1
  local bad=0
  for f in $FILES; do
    cp -p "$BACKUP/$f" "$WT/$f"
    local now; now=$(sha "$WT/$f")
    if [ "$now" = "${NEW_SHA[$f]}" ]; then say "restored ${now}  $f"; else say "RESTORE MISMATCH $f now=$now want=${NEW_SHA[$f]}"; bad=1; fi
  done
  [ "$bad" = 0 ] || exit 91
}
trap restore EXIT INT TERM HUP

for f in $FILES; do
  git -C "$WT" show "HEAD:$f" > "$WT/$f"
  got=$(sha "$WT/$f")
  case "$f" in
    *Canvas.tsx) want=$HEAD_CANVAS_SHA ;;
    *SpaceCardsOffer.tsx) want=$HEAD_OFFER_SHA ;;
  esac
  say "old     $got  $f (want $want)"
  [ "$got" = "$want" ] || { say "HEAD blob hash mismatch for $f"; exit 92; }
done

say "command: cd apps/web && pnpm.cmd exec vitest run $*   (node $(node --version))"
say "start:   $(date -u +%FT%T.%3NZ)"
( cd "$WT/apps/web" && timeout 500 pnpm.cmd exec vitest run "$@" ) > "$LOG" 2>&1
code=$?
say "vitest exit=$code"
say "end:     $(date -u +%FT%T.%3NZ)"

restore
trap - EXIT INT TERM HUP
say "status after restore:"
git -C "$WT" status --porcelain=v1 | tee -a "$META"
exit 0
