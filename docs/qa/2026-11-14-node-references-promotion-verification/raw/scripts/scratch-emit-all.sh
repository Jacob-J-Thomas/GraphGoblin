#!/usr/bin/env bash
# From-scratch tsc emit of each remaining tsc -b project into a NEW scratch directory outside the repo (never into dist),
# then a byte comparison with the real dist. --outDir and --tsBuildInfoFile are both overridden so no write can reach dist.
source "C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-273-promotion-verification/scripts/env.sh"
cd "$REPO" || exit 97
status=0
for spec in "contracts:packages/contracts:@graphgoblin/contracts" "engine:packages/engine:@graphgoblin/engine" "infrastructure:packages/infrastructure:@graphgoblin/infrastructure" "api-client:packages/api-client:@graphgoblin/api-client" "adapter-codex:packages/adapter-codex:@graphgoblin/adapter-codex" "adapter-jev:packages/adapter-jev:@graphgoblin/adapter-jev" "api:apps/api:@graphgoblin/api" "mcp:apps/mcp:@graphgoblin/mcp" "plugin-codex:apps/plugin-codex:@graphgoblin/plugin-codex" "plugin-claude:apps/plugin-claude:@graphgoblin/plugin-claude"; do
  name="${spec%%:*}"; rest="${spec#*:}"; dir="${rest%%:*}"; pkg="${rest#*:}"
  scr="$OUT/scratch-emit/$name"
  mkdir "$scr" || { echo "scratch dir exists for $name; refusing"; status=1; continue; }
  echo "### $name ($pkg)"
  pnpm.cmd --filter "$pkg" exec tsc -p tsconfig.build.json --outDir "$scr" --tsBuildInfoFile "$scr/.tsbuildinfo"; code=$?
  echo "tsc exit $code; emitted $(find "$scr" -type f | wc -l) files"
  [ $code -ne 0 ] && status=1
  node "$OUT/scripts/compare-scratch-emit.mjs" "$scr" "$REPO/$dir/dist" "$OUT/manifests/scratch-emit-$name-vs-dist.json" | node -e "
const j=JSON.parse(require('fs').readFileSync(0,'utf8'));
console.log(JSON.stringify({scratch:j.scratchFiles,dist:j.distFiles,onlyInDistCount:j.onlyInDist.length,onlyInDistSample:j.onlyInDist.slice(0,4),js:j.byKind.js,dts:j.byKind['d.ts'],authoritative:j.authoritativeJsAndDtsAllByteIdentical}))"
done
exit $status
