param([string]$Id,[string]$Executable,[string[]]$Arguments,[string]$WorkingDirectory='G:\ggq\gg-i4-362-qa\GraphGoblin')
$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:TEMP = 'G:\ggq\qa-scratch\i4-362-draft-docs-qa-01'
$env:TMP = $env:TEMP
$qaOutput = 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-362-draft-docs-independent-01'
$stdout = Join-Path $qaOutput "commands\$Id.stdout.txt"
$stderr = Join-Path $qaOutput "commands\$Id.stderr.txt"
$receiptPath = Join-Path $qaOutput "commands\$Id.receipt.json"
if (Test-Path -LiteralPath $receiptPath) { throw 'Receipt exists; refusing overwrite' }
Set-Location -LiteralPath $WorkingDirectory
$started = [DateTime]::UtcNow.ToString('o')
& $Executable @Arguments 1> $stdout 2> $stderr
$resultCode = $LASTEXITCODE
$receipt = [ordered]@{id=$Id; executable=$Executable; arguments=$Arguments; cwd=$WorkingDirectory; startedUtc=$started; finishedUtc=[DateTime]::UtcNow.ToString('o'); exitCode=$resultCode; node=(& node --version); pnpm=(& pnpm.cmd --version); TEMP=$env:TEMP; TMP=$env:TMP; head=(& git rev-parse HEAD); tree=(& git rev-parse 'HEAD^{tree}'); stdoutSha256=(Get-FileHash -LiteralPath $stdout -Algorithm SHA256).Hash.ToLower(); stderrSha256=(Get-FileHash -LiteralPath $stderr -Algorithm SHA256).Hash.ToLower()}
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptPath -Encoding utf8NoBOM
Get-Content -LiteralPath $stdout
Get-Content -LiteralPath $stderr
$receipt | ConvertTo-Json -Depth 6
exit $resultCode
