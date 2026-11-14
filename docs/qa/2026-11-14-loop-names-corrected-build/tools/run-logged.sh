#!/bin/bash
# usage: run-logged.sh <name> <command...>   (cwd = worktree root; node 22.23.4 first on PATH)
A="C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-209-correction-verification/artifacts"
name=$1; shift
echo "$(date -u +%FT%T.%3NZ) START $name :: cwd=$(pwd) :: node=$(node --version) :: $*" >> "$A/commands.log"
env -u GITHUB_PAT "$@" >"$A/$name.stdout.log" 2>"$A/$name.stderr.log"
code=$?
echo "$(date -u +%FT%T.%3NZ) END   $name exit=$code" >> "$A/commands.log"
exit $code
