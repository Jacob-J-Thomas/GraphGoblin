# Source in every Bash call: project Node 22.23.4 first on PATH; git never takes optional locks (no index refresh).
export GIT_OPTIONAL_LOCKS=0
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
export REPO="C:/Users/98jak/.codex/worktrees/gg-20261114-node-references-native/GraphGoblin"
export OUT="C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-273-promotion-verification"
export HEAD_EXPECTED=ae8add8a791699e905540465b5ddf929d00c50eb
export TREE_EXPECTED=ea2dfcfd46f7d5ab79fd98414db214513d830b52
export BASE_EXPECTED=a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c
export FREEZE=16aa9a2aed50710e68875b991a8eedb668fdecf8
# Brief forbids credentials/providers: strip every inherited provider variable for all gates.
unset AZURE_OPENAI_API_KEY AZURE_OPENAI_ENDPOINT AZURE_OPENAI_NARRATION_MODEL AZURE_OPENAI_RESPONSES_MODEL AZURE_OPENAI_INTENT_MODEL JEV_API_KEY
