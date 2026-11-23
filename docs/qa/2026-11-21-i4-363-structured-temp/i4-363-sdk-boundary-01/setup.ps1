$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$taskEvidence = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-363-sdk-boundary-01'
Set-Location -LiteralPath 'G:/ggq/gg-i4-363-qa/GraphGoblin'
node --version
pnpm.cmd --version
$taskBeforeLock = (Get-FileHash -Algorithm SHA256 pnpm-lock.yaml).Hash
& pnpm.cmd install --offline --frozen-lockfile *>&1 | Tee-Object -FilePath "$taskEvidence/raw/offline-install.log"
$taskInstallExit = $LASTEXITCODE
$taskAfterLock = (Get-FileHash -Algorithm SHA256 pnpm-lock.yaml).Hash
@{beforeLock=$taskBeforeLock;afterLock=$taskAfterLock;exitCode=$taskInstallExit;lockUnchanged=($taskBeforeLock -eq $taskAfterLock)} | ConvertTo-Json | Set-Content -LiteralPath "$taskEvidence/raw/setup-result.json" -Encoding utf8
if ($taskBeforeLock -ne $taskAfterLock) { throw 'Lock changed' }
exit $taskInstallExit
