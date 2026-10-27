param([string]$Name, [string]$Program = 'pnpm.cmd', [string[]]$CommandArgs)
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:GG_TEST_PORT_START = '6600'
$env:GG_TEST_PORT_COUNT = '50'
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
$auditStart = Get-Date
$auditOutput = & $Program @CommandArgs 2>&1 | Out-String -Width 4096
$auditExit = $LASTEXITCODE
$auditText = "COMMAND: $Program $($CommandArgs -join ' ')`nSTART: $($auditStart.ToUniversalTime().ToString('o'))`n$auditOutput`nEXIT: $auditExit`nEND: $((Get-Date).ToUniversalTime().ToString('o'))`n"
$auditText = $auditText.Replace($env:USERPROFILE, '%USERPROFILE%').Replace($env:COMPUTERNAME, '%COMPUTERNAME%') -replace 'S-1-5-21-\d+-\d+-\d+-\d+', '<SID>'
$auditText | Set-Content -Encoding utf8 -LiteralPath (Join-Path $PSScriptRoot "$Name.log.txt")
Write-Output "$Name EXIT $auditExit"
Write-Output (($auditText -split "`n" | Select-Object -Last 12) -join "`n")
