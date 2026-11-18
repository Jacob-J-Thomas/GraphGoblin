$ErrorActionPreference = 'Stop'
$repo = (Get-Location).Path
if ($repo -ne 'C:\Users\98jak\.codex\worktrees\gg-20261117-ports-407\GraphGoblin') { throw 'unexpected worktree' }
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$node = node --version
if ($node -ne 'v22.23.4') { throw 'project runtime not active' }
$pnpm = pnpm.cmd --version
$head = git rev-parse HEAD
if ($head -ne '62d443cd2aa321585b45099acb591bf3c24eafaf') { throw 'unexpected base' }

function Invoke-Recorded([string]$name,[string]$program,[string[]]$arguments) {
  $start = [DateTime]::UtcNow
  & $program @arguments 2>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot "$name.log")
  $exit = $LASTEXITCODE
  [ordered]@{ program=$program; args=$arguments; cwd=$repo; node=$node; pnpm=$pnpm; head=$head; startedUtc=$start; finishedUtc=[DateTime]::UtcNow; exit=$exit } |
    ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $PSScriptRoot "$name.json")
  if ($exit -ne 0) { throw "$name exited $exit" }
}
Invoke-Recorded 'api-typecheck' 'pnpm.cmd' @('--filter','@graphgoblin/api','typecheck')
Invoke-Recorded 'api-lint' 'pnpm.cmd' @('--filter','@graphgoblin/api','lint')
Invoke-Recorded 'readable-format' 'pnpm.cmd' @('exec','prettier','--check','apps/api/src/testing/api-port.ts','docs/10-testing-and-quality.md')

$port = '63650'
$probe = Join-Path $PSScriptRoot 'probe-assigned-port.mjs'
Invoke-Recorded 'ports-before' 'node' @($probe,$port)
$oldTemp = $env:TEMP
$oldTmp = $env:TMP
$testRoot = [IO.Directory]::CreateTempSubdirectory('gg407-darwin-').FullName
$actual = (Resolve-Path -LiteralPath $testRoot).Path
if (!(Split-Path -Leaf $actual).StartsWith('gg407-darwin-')) { throw 'unexpected owned TEMP path' }
try {
  $env:TEMP = $actual
  $env:TMP = $actual
  $env:GG_TEST_PORT_START = $port
  $env:GG_TEST_PORT_COUNT = '1'
  $env:GG_TEST_STORE_PREFIX = 'gg-407-darwin-windows-'
  $env:LIVE = $null
  $env:LIVE_CLAUDE = $null
  $env:PERF = $null
  Invoke-Recorded 'windows-focused' 'pnpm.cmd' @('--filter','@graphgoblin/api','test','--maxWorkers=1','src/testing/api-port.test.ts')
} finally {
  $env:TEMP = $oldTemp
  $env:TMP = $oldTmp
  $leftovers = @(Get-ChildItem -LiteralPath $actual -Force | Select-Object -ExpandProperty Name)
  if ($leftovers.Count -eq 0) { Remove-Item -LiteralPath $actual -ErrorAction Stop }
  [ordered]@{ assignedPort=[int]$port; portCount=1; disposableTemp=$actual; residualEntries=$leftovers; ownedTempExistsAfter=Test-Path -LiteralPath $actual } |
    ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $PSScriptRoot 'windows-focused-cleanup.json')
  Invoke-Recorded 'ports-after' 'node' @($probe,$port)
}
if (Test-Path -LiteralPath $actual) { throw 'disposable QA TEMP has residual entries' }
