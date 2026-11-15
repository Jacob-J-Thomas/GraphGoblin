param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string[]]$PnpmArgs)
$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$activeNode = & node --version
if ($LASTEXITCODE -ne 0 -or $activeNode -ne 'v22.23.4') { throw "Incorrect Node: $activeNode" }
$logs = Join-Path $PSScriptRoot 'checks'
[IO.Directory]::CreateDirectory($logs) | Out-Null
$stdout = Join-Path $logs "$Name.stdout.txt"
$stderr = Join-Path $logs "$Name.stderr.txt"
$receipt = Join-Path $logs "$Name.json"
if ((Test-Path -LiteralPath $stdout) -or (Test-Path -LiteralPath $stderr) -or (Test-Path -LiteralPath $receipt)) { throw "Receipt exists: $Name" }
$start = [DateTime]::UtcNow
& pnpm.cmd @PnpmArgs 1>$stdout 2>$stderr
$code = $LASTEXITCODE
$end = [DateTime]::UtcNow
[ordered]@{
  name = $Name
  cwd = (Get-Location).Path
  node = $activeNode
  command = @('pnpm.cmd') + $PnpmArgs
  startUTC = $start.ToString('o')
  endUTC = $end.ToString('o')
  elapsedSeconds = ($end - $start).TotalSeconds
  exitCode = $code
  stdoutSHA256 = (Get-FileHash -LiteralPath $stdout).Hash
  stderrSHA256 = (Get-FileHash -LiteralPath $stderr).Hash
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receipt -Encoding utf8
Write-Output "Recorded $Name with exit $code"
exit $code
