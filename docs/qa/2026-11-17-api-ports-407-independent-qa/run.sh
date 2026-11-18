#!/usr/bin/env bash
# Usage: run.sh <name> <cmd...>  Writes <name>.log (stdout+stderr) and <name>.json receipt (command, cwd, times, exit) into the evidence folder.
EV="C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-ports-407-independent-claude-qa"
name="$1"; shift
start=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
"$@" > "$EV/$name.log" 2>&1
code=$?
end=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
node -e 'const [out,n,s,e,c,cwd,...cmd]=process.argv.slice(1); require("fs").writeFileSync(out,JSON.stringify({name:n,command:cmd,cwd,start:s,end:e,exit:Number(c),node:process.version},null,2)+"\n")' "$EV/$name.json" "$name" "$start" "$end" "$code" "$(pwd)" "$@"
echo "exit=$code ($name)"
exit $code
