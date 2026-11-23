# Exact behavior/build commands and environment

All commands used working directory `G:/ggq/gg-i4-364-qa/GraphGoblin`. PowerShell command environment was set locally for each invocation:

```powershell
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:TEMP = 'G:\ggq\qa-scratch\i4-364-probe-independent-01'
$env:TMP = $env:TEMP
node --version
```

Initial read-only admission used `git status --porcelain=v1`, `git rev-parse HEAD`, `git rev-parse 'HEAD^{tree}'`, source/build Get-FileHash, and read `docs/README.md`, AGENTS, docs/15, docs/12, D193/D198, scan2, actual author report, frozen receipt and brief. Old `packages/infrastructure/dist/claude/harness.js` was copied to this packet before checkout.

```powershell
git fetch --no-tags 'G:/ggq/gg-i4-364-claude-start/GraphGoblin' b90ffd2dfce3d4a73b83c5722393298453cec07b
git checkout --detach b90ffd2dfce3d4a73b83c5722393298453cec07b
pnpm.cmd build
node 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-364-probe-independent-01\driver-01.mjs'
node 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-364-probe-independent-01\api-driver-01.mjs'
node 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-364-probe-independent-01\api-driver-02.mjs'
node 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-364-probe-independent-01\api-driver-03.mjs'
```

Each command's time, exit code and exact driver SHA is in its `*-command.json`; stdout/stderr are retained in logs/01 through logs/07. Native fixture actual executable argv, working directories, stdin and outcomes are recorded by the drivers and native JSONL sinks. Controlled taskkill calls were intercepted along with their controlled spawned streams; no taskkill reached a real PID in that seam. The native runner used its ordinary implementation.

Before execution, driver-01 was amended to model actual `session.cancel()` instead of a synthetic aborted flag with an unaborted signal; only the sealed executed hash is counted. API attempts 01 and 02 are immutable; attempts 02 and 03 were new files with explicit correction receipts and fresh store/sink paths.

Preliminary discovery errors (read-only; no scenario ran): guessed files `packages/infrastructure/src/claude/options.ts`, `stream.ts`, `capabilities.ts`, `apps/api/src/routes/runs.test.ts`, `apps/api/src/testing.ts`, `packages/contracts/src/node-configs.ts`, `packages/engine/src/nodes/inference.ts`, `packages/infrastructure/src/sqlite/client.ts`, `database.ts`, `migrations`, and `handlers/inference-session.ts` did not exist. `rg ... apps/api/src/*.test.ts` produced Windows argument error123 because an explicit wildcard path was not expanded. Discovery continued using `rg --files`/actual paths. These are not product or behavior failures.

Release used Git status/index diff, repeated source/build Get-FileHash, Get-Process for recorded native PIDs, scoped Win32_Process inspection for QA paths, actual TcpClient connection attempts to the seven recorded ephemeral loopback ports, and a check-folder listing. No processes were killed or files removed during release. Snapshot copies/seals are evidence-only writes.

Initial seal member hashes verified 46/46, but its optional aggregate byte count was null because PowerShell Measure-Object did not project the ordered dictionaries. Initial seal/sums/verification are retained. The seal script now explicitly projects dictionary bytes and uses character-based path normalization. A first metadata patch attempt did not match its expected escaping and made no edits. Resealing changes metadata only, with no behavior execution or recorded behavior artifact-content change.
