#!/usr/bin/env bash
# Emergency restore after an old-production control was killed outright: copies the hash-checked
# backup of the new Canvas.tsx and SpaceCardsOffer.tsx back. usage: RESTORE.sh <label>
set -eu
. "C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-208-double-hit-implementation-resume-0250/env.sh"
B="$OUT/controls/new-source-backup-$1"
for f in apps/web/src/editor/Canvas.tsx apps/web/src/editor/SpaceCardsOffer.tsx; do
  cp -p "$B/$f" "$WT/$f"; sha256sum "$WT/$f"
done
