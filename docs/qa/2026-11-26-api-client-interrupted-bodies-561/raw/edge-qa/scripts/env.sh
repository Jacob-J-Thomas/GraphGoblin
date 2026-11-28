# Environment for the RQ-inspector QA API (disposable store, provider-disabled, API keys required)
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
export TEMP=G:/ggq/tmp/rq-inspector TMP=G:/ggq/tmp/rq-inspector
export TURBO_TELEMETRY_DISABLED=1
export GG_HOST=127.0.0.1
export GG_PORT=${GG_PORT:-4811}
export GG_DATA_DIR=${GG_DATA_DIR:-G:/ggq/tmp/rq-inspector-qa/store1}
export GG_REQUIRE_API_KEY=true
export GG_OLLAMA_ENABLED=false
export GG_OLLAMA_URL=http://127.0.0.1:1
export GG_CODEX_BINARY=G:/ggq/tmp/rq-inspector-qa/no-provider/codex-disabled.exe
export GG_CLAUDE_BINARY=G:/ggq/tmp/rq-inspector-qa/no-provider/claude-disabled.exe
export GG_WEB_DIST=G:/ggq/gg-qa-inspector-combined/GraphGoblin/apps/web/dist
export GG_LOG_LEVEL=warn
unset NODE_OPTIONS
