param(
  [Parameter(Mandatory=$true)][string]$Label,
  [Parameter(Mandatory=$true)][string]$Program,
  [Parameter(ValueFromRemainingArguments=$true)][string[]]$ProgramArguments
)
$ErrorActionPreference = 'Stop'
$evidenceDirectory = 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-362-draft-docs-author-01'
$commandDirectory = Join-Path $evidenceDirectory 'commands'
$receiptPath = Join-Path $commandDirectory "$Label.receipt.json"
if (Test-Path -LiteralPath $receiptPath) { throw "Receipt already exists: $receiptPath" }
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:TEMP = 'G:\ggq\qa-scratch\i4-362-draft-docs-author-01'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
$docPaths = @('docs/04-node-catalog.md','docs/guide/03-run-and-observe.md','docs/guide/07-troubleshooting.md')
function Get-DocHashes {
  @($docPaths | ForEach-Object { [pscustomobject]@{path=$_;sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLower()} })
}
$beforeHashes = Get-DocHashes
$stdoutPath = Join-Path $commandDirectory "$Label.stdout.txt"
$stderrPath = Join-Path $commandDirectory "$Label.stderr.txt"
$started = (Get-Date).ToUniversalTime().ToString('o')
& $Program @ProgramArguments 1> $stdoutPath 2> $stderrPath
$commandExit = $LASTEXITCODE
[pscustomobject]@{
  label=$Label;program=$Program;arguments=$ProgramArguments;cwd=(Get-Location).Path;
  startedUtc=$started;finishedUtc=(Get-Date).ToUniversalTime().ToString('o');exitCode=$commandExit;
  node=(Get-Command node).Source;nodeVersion=(& node --version);temp=$env:TEMP;tmp=$env:TMP;
  docHashesBefore=$beforeHashes;docHashesAfter=(Get-DocHashes);stdout=$stdoutPath;stderr=$stderrPath
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding utf8
Get-Content -LiteralPath $receiptPath
Get-Content -LiteralPath $stdoutPath -Tail 30
Get-Content -LiteralPath $stderrPath -Tail 40
exit $commandExit
