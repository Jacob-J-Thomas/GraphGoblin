#!/usr/bin/env bash
set -euo pipefail

suite="$1"
control=.github/qa407-posix/control.mjs
case "$suite" in
  maintained) selector=src/testing/api-port.test.ts ;;
  witness) selector=src/qa407-posix/ ;;
  *) exit 64 ;;
esac

export TMPDIR="$GG_407_WORK/$suite-tmp"
node "$control" ports "$suite-before"

set +e
pnpm --filter @graphgoblin/api exec vitest run "$selector" --maxWorkers=2 --reporter=verbose --reporter=json \
  --outputFile="$GG_407_EVIDENCE/$suite.json" 2>&1 | tee "$GG_407_EVIDENCE/$suite.log"
pipeline_status=(${PIPESTATUS[@]})
node "$control" ports "$suite-after"
postflight_status=$?
set -e

printf '{"vitestCommandExit":%s,"teeExit":%s,"postflightExit":%s}\n' \
  "${pipeline_status[0]}" "${pipeline_status[1]}" "$postflight_status" > "$GG_407_EVIDENCE/$suite.exit.json"
if [[ "${pipeline_status[0]}" -ne 0 ]]; then exit "${pipeline_status[0]}"; fi
if [[ "${pipeline_status[1]}" -ne 0 ]]; then exit "${pipeline_status[1]}"; fi
if [[ "$postflight_status" -ne 0 ]]; then exit "$postflight_status"; fi
node "$control" report "$suite"
