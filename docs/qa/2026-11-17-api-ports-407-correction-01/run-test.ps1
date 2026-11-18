param(
  [Parameter(Mandatory)][string]$Run,
  [int]$PortStart = 63650,
  [int]$PortCount = 2,
  [Parameter(Mandatory)][string[]]$Arguments
)
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:GG_TEST_PORT_START = "$PortStart"
$env:GG_TEST_PORT_COUNT = "$PortCount"
$env:GG_TEST_STORE_PREFIX = 'gg-407-windows-'
$env:LIVE = $null
$env:PERF = $null
$packet = $PSScriptRoot
$started = [DateTime]::UtcNow
$node = node --version
$artifact = Join-Path $packet $Run
$initialPorts = node (Join-Path $packet 'probe-ports.mjs') $PortStart $PortCount 2>&1
$initialPorts | Set-Content -Encoding utf8 "$artifact-ports-before.log"
if ($LASTEXITCODE -ne 0) { throw "Allocated ports unavailable. See $artifact-ports-before.log" }
$env:GG_TEST_PORT_RACE_DIR = (New-Item -ItemType Directory -Path "$artifact-coordination").FullName
pnpm.cmd @Arguments 2>&1 | Tee-Object -FilePath "$artifact.log"
$result = $LASTEXITCODE
$postPorts = node (Join-Path $packet 'probe-ports.mjs') $PortStart $PortCount 2>&1
$postResult = $LASTEXITCODE
$postPorts | Set-Content -Encoding utf8 "$artifact-ports-after.log"
[ordered]@{ cwd=(Get-Location).Path; node=$node; head=(git rev-parse HEAD); arguments=$Arguments; portStart=$PortStart; portCount=$PortCount; storePrefix=$env:GG_TEST_STORE_PREFIX; startedUtc=$started; finishedUtc=[DateTime]::UtcNow; exit=$result; portPostflightExit=$postResult } | ConvertTo-Json | Set-Content -Encoding utf8 "$artifact.json"
exit $result
