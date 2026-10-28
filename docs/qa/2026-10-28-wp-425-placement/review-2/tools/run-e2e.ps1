# Reviewer runner (WP-425 scan 2): run Playwright specs in headless Edge against a given web build,
# with every GG_* variable and JEV_API_KEY removed, the reviewer's test port range and temp prefix,
# and Playwright output under %TEMP%\gg-rev425b-pw-<label>. Writes a UTF-8 log.
#   run-e2e.ps1 -Label <name> -Dist <web dist or ''> -Log <log path> -Specs <spec args...>
[CmdletBinding(PositionalBinding = $false)]
param(
  [Parameter(Mandatory = $true)][string]$Label,
  [string]$Dist = '',
  [Parameter(Mandatory = $true)][string]$Log,
  [string]$ReportDir = '',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Specs
)
$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
foreach ($name in @(Get-ChildItem env: | Where-Object { $_.Name -like 'GG_*' -or $_.Name -eq 'JEV_API_KEY' } | ForEach-Object Name)) {
  Remove-Item "env:$name"
}
$env:GG_TEST_PORT_START = '7500'
$env:GG_TEST_PORT_COUNT = '40'
$env:GG_TEST_DATA_PREFIX = 'gg-rev425b-'
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
if ($Dist) { $env:GG_E2E_WEB_DIST = $Dist }
if ($ReportDir) { $env:GG_ROUTING_REPORT_DIR = $ReportDir }
$out = Join-Path $env:TEMP "gg-rev425b-pw-$Label"
$web = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..\..\apps\web')
Set-Location $web
$header = "label=$Label dist=$(if ($Dist) { $Dist } else { 'apps/web/dist' }) node=$(node --version) specs=$($Specs -join ' ')"
$quoted = $Specs | ForEach-Object { if ($_ -match '[\s|&<>^]') { '"' + $_ + '"' } else { $_ } }
$pwArgs = @('exec', 'playwright', 'test') + $quoted + @('--output', $out)
$text = & cmd /c "pnpm.cmd $($pwArgs -join ' ') 2>&1"
$code = $LASTEXITCODE
$body = ($header, ($text -join "`n"), "exit=$code") -join "`n"
$home2 = $env:USERPROFILE
$body = $body.Replace($home2, '%USERPROFILE%').Replace($home2.Replace('\', '/'), '%USERPROFILE%').Replace($home2.Replace('\', '\\'), '%USERPROFILE%')
$body = [regex]::Replace($body, [regex]::Escape($env:COMPUTERNAME), '%COMPUTERNAME%', 'IgnoreCase')
[System.IO.File]::WriteAllText($Log, $body + "`n", (New-Object System.Text.UTF8Encoding($false)))
"exit=$code"
