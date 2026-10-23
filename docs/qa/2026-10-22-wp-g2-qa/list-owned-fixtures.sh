#!/usr/bin/env bash
ps -W | awk '$NF ~ /node[.]exe$/ {print $1}' | while read -r qa_pid; do
  qa_cwd=$(readlink "/proc/$qa_pid/cwd" 2>/dev/null) || continue
  case "$qa_cwd" in
    *gg-qa-231-9896cf-independent*) printf '%s %s\n' "$qa_pid" "$qa_cwd" ;;
  esac
done
