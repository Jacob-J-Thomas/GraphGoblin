#!/usr/bin/env bash
# Runs each mutation of PreflightSection.tsx against the two focused test files, restoring the
# exact original bytes (sha256-checked) after every mutation and on any exit.
set -u
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
E="C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-442-ui-author-02/author"
WEB="G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin/apps/web"
REL="src/settings/sections/PreflightSection.tsx"
SRC="$WEB/$REL"
BACKUP="$E/PreflightSection.tsx.original"
OUT="$E/mutations"
mkdir -p "$OUT"
cp "$SRC" "$BACKUP"
ORIGINAL="$(sha256sum "$SRC" | cut -d' ' -f1)"
restore() {
  cp "$BACKUP" "$SRC"
  local now
  now="$(sha256sum "$SRC" | cut -d' ' -f1)"
  if [ "$now" != "$ORIGINAL" ]; then echo "RESTORE FAILED: $now != $ORIGINAL"; exit 99; fi
}
trap restore EXIT
node --version
echo "original sha256 $ORIGINAL"
cd "$WEB" || exit 98
for id in "$@"; do
  node "$E/mutate.mjs" "$SRC" "$id" || { restore; echo "$id: mutation not applied"; continue; }
  pnpm exec vitest run src/settings/sections/PreflightSection.test.tsx src/settings/SettingsPage.test.tsx \
    --reporter=json --outputFile="$OUT/$id.json" > "$OUT/$id.log" 2>&1
  code=$?
  restore
  node -e '
    const r = require(process.argv[1]);
    const failed = r.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === "failed").map((a) => a.fullName));
    console.log(`${process.argv[2]}: exit=${process.argv[3]} passed=${r.numPassedTests} failed=${r.numFailedTests}`);
    for (const name of failed) console.log(`    x ${name}`);
  ' "$OUT/$id.json" "$id" "$code"
done
echo "final sha256 $(sha256sum "$SRC" | cut -d' ' -f1)"
