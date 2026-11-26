#!/usr/bin/env bash
# B6 correction-01 driver: light stages first, then the heavy stages under the machine lock.
C=G:/ggq/delivery-evidence/2026-11-24-followups/inspector-561-562-563-556/claude-window-verification-03/correction-01
W=G:/ggq/delivery-evidence/2026-11-24-followups/inspector-561-562-563-556/claude-window-verification-03/run-verification-v2.py
PY=C:/Users/98jak/AppData/Local/Programs/Python/Python311/python.exe
PLAN=$C/CORRECTION-PLAN.json
LOCK=G:/ggq/tmp/heavy-suite.lock
LOCK_DEADLINE_EPOCH=$1   # stop trying to take the lock after this UTC epoch second
cd "$C" || exit 1
stage() {
  "$PY" "$W" "$PLAN" "$C/$1" "$1" > "$C/$1.wrapper.stdout.log" 2> "$C/$1.wrapper.stderr.log"
  echo "$1 wrapper exit $? $(date -u +%FT%TZ)" >> "$C/WRAPPER-EXITS.txt"
}
for s in c-mcp-tsc-p c-client-tsc-p c-typecheck c-client c-web c-lint c-format; do stage "$s"; done
echo "light-done $(date -u +%FT%TZ)" >> "$C/WRAPPER-EXITS.txt"
acquired=0
while [ "$(date -u +%s)" -lt "$LOCK_DEADLINE_EPOCH" ]; do
  if mkdir "$LOCK" 2>/dev/null; then acquired=1; break; fi
  sleep 20
done
if [ "$acquired" != 1 ]; then
  echo "lock-not-acquired-by-deadline $(date -u +%FT%TZ) holder: $(head -c 300 "$LOCK/owner.txt" 2>/dev/null)" >> "$C/WRAPPER-EXITS.txt"
  echo done >> "$C/WRAPPER-EXITS.txt"
  exit 0
fi
trap 'rm -f "$LOCK/owner.txt"; rmdir "$LOCK"; echo "lock-released $(date -u +%FT%TZ)" >> "$C/WRAPPER-EXITS.txt"' EXIT
echo "B6-561 claude-window-verification-03 correction-01 (pnpm build --force, api-client test:coverage) $(date -u +%FT%TZ) worktree=G:/ggq/gg-fu-api-client-561-20261124/GraphGoblin" > "$LOCK/owner.txt"
echo "lock-acquired $(date -u +%FT%TZ)" >> "$C/WRAPPER-EXITS.txt"
stage c-build
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue) { 'LISTENING' } else { 'FREE' }" > "$C/ollama-port-check.txt" 2>&1
if grep -q '^FREE' "$C/ollama-port-check.txt"; then
  stage c-client-coverage
else
  echo "c-client-coverage skipped: 127.0.0.1:11434 has a listener $(date -u +%FT%TZ)" >> "$C/WRAPPER-EXITS.txt"
fi
echo done >> "$C/WRAPPER-EXITS.txt"
