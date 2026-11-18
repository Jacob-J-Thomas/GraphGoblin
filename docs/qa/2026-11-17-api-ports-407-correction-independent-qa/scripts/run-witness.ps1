# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File run-witness.ps1 -Run <rN-name>
# Runs the ACTUAL apps/api vitest.config.ts (global setup + setupFiles) on src/qa407c/ with 2 workers,
# TEMP/TMP redirected to a QA-owned empty folder, ports 63800-63819 only (verified bindable first).
param([Parameter(Mandatory = $true)][string]$Run)
$ErrorActionPreference = 'Stop'
$EV = 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i1-ports-407-correction-independent-claude-qa'
$QA = 'C:\Users\98jak\.codex\worktrees\gg-20261117-ports-407-qa\GraphGoblin'
function Save([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding $false)) }
if ($Run -notmatch '^r[0-9][a-z0-9-]*$') { throw "bad run name $Run" }
$work = Join-Path $EV "work\$Run"; $out = Join-Path $EV $Run
if (Test-Path -LiteralPath $work) { throw "work dir exists, refusing to reuse: $work" }
if (Test-Path -LiteralPath $out) { throw "out dir exists, refusing to reuse: $out" }
New-Item -ItemType Directory -Path "$work\tmp", "$work\sync", $out | Out-Null
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$nodeVersion = (& node --version)
$nodePath = (Get-Command node).Source
Save "$out\ports-before.json" ((& node "$EV\scripts\probe-ports.mjs" "$Run-before") -join "`n")
if ($LASTEXITCODE -ne 0) { throw "assigned ports 63800-63819 not free before $Run" }
$origTemp = $env:TEMP; $origTmp = $env:TMP
$env:TEMP = "$work\tmp"; $env:TMP = "$work\tmp"
$env:GG_TEST_PORT_START = '63800'; $env:GG_TEST_PORT_COUNT = '20'
$env:QA407C_SYNC = "$work\sync"; $env:QA407C_OUT = $out; $env:QA407C_SCRIPTS = "$EV\scripts"
$env:NO_COLOR = '1'; $env:FORCE_COLOR = '0'
Set-Location -LiteralPath "$QA\apps\api"
$cwd = (Get-Location).Path
$command = 'pnpm.cmd exec vitest run --reporter=verbose --maxWorkers=2 src/qa407c/'
$start = (Get-Date).ToUniversalTime().ToString('o')
& cmd.exe /d /c "$command > `"$out\vitest.log`" 2>&1"
$code = $LASTEXITCODE
$end = (Get-Date).ToUniversalTime().ToString('o')
$env:TEMP = $origTemp; $env:TMP = $origTmp
foreach ($n in 'GG_TEST_PORT_START', 'GG_TEST_PORT_COUNT', 'QA407C_SYNC', 'QA407C_OUT', 'QA407C_SCRIPTS') { Remove-Item "Env:$n" }
$receipt = [ordered]@{
  run = $Run; command = $command; cwd = $cwd; node = $nodeVersion; nodePath = $nodePath; start = $start; end = $end; exit = $code
  env = [ordered]@{ TEMP = "$work\tmp"; TMP = "$work\tmp"; GG_TEST_PORT_START = '63800'; GG_TEST_PORT_COUNT = '20'; QA407C_SYNC = "$work\sync"; QA407C_OUT = $out; QA407C_SCRIPTS = "$EV\scripts"; NO_COLOR = '1'; FORCE_COLOR = '0' }
}
Save "$out\vitest.json" ($receipt | ConvertTo-Json -Depth 4)
Set-Location -LiteralPath $QA
# Top-level, non-recursive listings only (no junction following).
$tmpList = @(Get-ChildItem -LiteralPath "$work\tmp" -Force | Select-Object Name, Mode, LastWriteTime)
$syncList = @(Get-ChildItem -LiteralPath "$work\sync" -Force | Select-Object Name, Length)
Save "$out\temp-after.json" ((ConvertTo-Json -InputObject @{ at = (Get-Date).ToUniversalTime().ToString('o'); tempDir = "$work\tmp"; count = $tmpList.Count; entries = $tmpList } -Depth 3))
Save "$out\sync-after.json" ((ConvertTo-Json -InputObject @{ syncDir = "$work\sync"; count = $syncList.Count; entries = $syncList } -Depth 3))
Save "$out\ports-after.json" ((& node "$EV\scripts\probe-ports.mjs" "$Run-after") -join "`n")
$pa = $LASTEXITCODE
Save "$out\processes-after.json" ((& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$EV\scripts\node-procs.ps1") -join "`n")
Write-Output "vitest exit=$code ports-after-exit=$pa temp-entries=$($tmpList.Count)"
exit $code
