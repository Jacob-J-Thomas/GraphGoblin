param([string]$Label, [Parameter(ValueFromRemainingArguments=$true)][string[]]$CommandArgs)
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
if (!$env:GG_TEST_PORT_START) { $env:GG_TEST_PORT_START = '5600'; $env:GG_TEST_PORT_COUNT = '100' }
$outputPath = Join-Path $PSScriptRoot "$Label.log.txt"
("pnpm.cmd $($CommandArgs -join ' ')").Replace($env:USERPROFILE, '%USERPROFILE%').Replace($env:USERPROFILE.Replace('\','/'), '%USERPROFILE%') | Out-File -Encoding utf8 $outputPath
& pnpm.cmd @CommandArgs 2>&1 | ForEach-Object {
  $line = ([string]$_).Replace($env:USERPROFILE, '%USERPROFILE%').Replace($env:USERPROFILE.Replace('\','/'), '%USERPROFILE%').Replace($env:COMPUTERNAME, '%COMPUTERNAME%')
  $line -replace ('(?:[A-Za-z]:)?[\\/]+Users[\\/]+' + [regex]::Escape([IO.Path]::GetFileName($env:USERPROFILE))), '%USERPROFILE%' -replace 'S-\d(?:-\d+){2,}', '<SID>'
} | Out-File -Append -Encoding utf8 $outputPath
$result = $LASTEXITCODE
"EXIT $result" | Out-File -Append -Encoding utf8 $outputPath
Get-Content $outputPath -Tail 18
exit $result
