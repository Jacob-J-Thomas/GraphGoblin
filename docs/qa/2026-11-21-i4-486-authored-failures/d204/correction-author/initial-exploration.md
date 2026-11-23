# Predriver exploratory command ledger

These commands were executed before the evidence driver existed. Their original outputs remain in this worker's Codex tool transcript. This is a command/result ledger, not a claim that tool-transcript output was independently copied verbatim. Subsequent numbered runs have verbatim stdout/stderr files.

Working directory for the first two commands was C:/Users/98jak/source/repos/GraphGoblin:

1. `Get-Content -LiteralPath 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-486-review-fixes-sol-BRIEF-01.md'`: exit 0, full brief read. TEMP/TMP instruction learned from this read.
2. `rg -n -- '#486|D204|633d9ac|five-intents|GraphGoblin' 'C:\Users\98jak\.codex\memories\MEMORY.md'`: exit 0, broad memory registry hits; live brief/source controlled implementation.

The following batches used the author checkout and prefixed each command with canonical TEMP/TMP and Node22 PATH:

3. `Get-Content -LiteralPath 'AGENTS.md'; Get-Content -LiteralPath 'docs/README.md'; Get-Content -LiteralPath 'docs/15-issue-workflow.md'`: exit 0, full instructions read.
4. Full `Get-Content` reads of D204, the original Fable provider-final-message.md, and preparation receipt: exit 0. Exact input files are now preserved under inputs/ with source paths and SHA256 in binding.json.
5. `git status --porcelain=v1; git branch --show-current; git rev-parse HEAD HEAD^{tree}; git rev-parse --git-path index; & '<runtime>/node.exe' --version; rg -n -- 'diagnostic|InternalRunFailure|B17|A2|authored' docs/12-implementation-plan.md docs/*error* docs/decisions/0088* packages/engine/src/failure-publication.ts packages/engine/src/handlers/inference-context.ts packages/engine/src/handlers/inference-context.test.ts packages/engine/src/run-manager.ts`: overall exit 1. Status was empty; branch was correct; runtime v22.23.4; class/source hits found. Unquoted HEAD^{tree} was misparsed by Windows PowerShell into `-encodedCommand` and `dAByAGUAZQA=` arguments; rg wildcard path arguments were rejected. Rerun 02 used quoted `'HEAD^{tree}'` and directory/glob filtering, confirmed exact expected tree and clean checkout before editing.

A first apply_patch combined the intended engine edits with an incomplete numbered-doc line match. apply_patch rejected the entire patch atomically; numbered run 09 verified no source diff. The patch was then applied with the exact paragraph context. No rejected partial edit was left behind.
