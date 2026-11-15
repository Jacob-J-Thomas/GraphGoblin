#!/bin/sh
# usage: run-logged.sh <name> <logdir> <cmd...>   - precreated log + exit receipt, never reruns on its own
name="$1"; dir="$2"; shift 2
: > "$dir/$name.log"; printf 'PENDING\n' > "$dir/$name.exit"
{ printf '# cwd: %s\n# node: %s\n# cmd: %s\n# start: %s\n' "$(pwd)" "$(node --version)" "$*" "$(date -u +%FT%TZ)"; } >> "$dir/$name.log"
"$@" >> "$dir/$name.log" 2>&1
code=$?
printf '# end: %s\n# exit: %s\n' "$(date -u +%FT%TZ)" "$code" >> "$dir/$name.log"
printf '%s\n' "$code" > "$dir/$name.exit"
exit $code
