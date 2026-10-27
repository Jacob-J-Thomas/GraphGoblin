param([string]$Name, [string[]]$CheckArgs, [switch]$ManualPorts)
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:GG_TEST_PORT_START = $(if ($ManualPorts) {'6650'} else {'6930'})
$env:GG_TEST_PORT_COUNT = $(if ($ManualPorts) {'10'} else {'40'})
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
$env:GG_E2E_MAIN_PORT = '6650'
$env:GG_E2E_CONTROL_PORT = '6651'
$env:GG_TEST_DATA_PREFIX = 'gg-audit-422r3-api-'
$env:GG_TEST_STORE_PREFIX = 'gg-audit-422r3-wait-'
$auditTempRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'gg-audit-422r3-test-temp'
[void][System.IO.Directory]::CreateDirectory($auditTempRoot)
$env:TEMP = $auditTempRoot
$env:TMP = $auditTempRoot
$env:LIVE = ''
$env:LIVE_CLAUDE = ''
$env:NO_COLOR = '1'
$env:FORCE_COLOR = '0'
$evidenceRoot = $PSScriptRoot
function Protect-AuditText([string]$Value) {
  $Value = $Value.Replace($env:USERPROFILE.Replace('\','\\'), '%USERPROFILE%')
  $Value = $Value.Replace($env:USERPROFILE, '%USERPROFILE%').Replace($env:USERPROFILE.Replace('\','/'), '%USERPROFILE%')
  $Value = $Value.Replace($env:COMPUTERNAME, '%COMPUTERNAME%')
  return [regex]::Replace($Value, 'S-1-\d+(?:-\d+)+', '<SID>')
}
$checkPath = Join-Path $evidenceRoot "$Name.log.txt"
$writer = New-Object System.IO.StreamWriter($checkPath, $false, (New-Object System.Text.UTF8Encoding($false)))
$writer.AutoFlush = $true
$started = Get-Date
try {
  $writer.WriteLine((Protect-AuditText ("Node: " + (& node --version) + ' at ' + (Get-Command node).Source)))
  $writer.WriteLine((Protect-AuditText ('pnpm.cmd --config.verifyDepsBeforeRun=false ' + ($CheckArgs -join ' '))))
  & pnpm.cmd --config.verifyDepsBeforeRun=false @CheckArgs 2>&1 | ForEach-Object { $writer.WriteLine((Protect-AuditText $_.ToString())) }
  $checkExit = $LASTEXITCODE
  $writer.WriteLine("EXIT_CODE=$checkExit")
} finally { $writer.Dispose() }
$elapsed = [math]::Round(((Get-Date)-$started).TotalSeconds, 2)
$record = Protect-AuditText "$Name | exit=$checkExit | seconds=$elapsed | pnpm.cmd --config.verifyDepsBeforeRun=false $($CheckArgs -join ' ')"
[System.IO.File]::AppendAllText((Join-Path $evidenceRoot 'gate-results.log.txt'), "$record`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Output $record
Get-Content -LiteralPath $checkPath -Tail 6
