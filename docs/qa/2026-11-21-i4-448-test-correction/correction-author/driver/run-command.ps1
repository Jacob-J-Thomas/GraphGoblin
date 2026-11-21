param(
  [Parameter(Mandatory=$true)][string]$Label,
  [Parameter(Mandatory=$true)][string]$Program,
  [Parameter(ValueFromRemainingArguments=$true)][string[]]$ProgramArguments
)
$ErrorActionPreference = 'Stop'
$evidenceDirectory = 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-448-test-author-01'
$commandDirectory = Join-Path $evidenceDirectory 'commands'
$receiptPath = Join-Path $commandDirectory "$Label.receipt.json"
if (Test-Path -LiteralPath $receiptPath) { throw "Receipt already exists: $receiptPath" }
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:TEMP = 'G:\ggq\qa-scratch\i4-448-test-correction-01'
$env:TMP = $env:TEMP
$env:NODE_OPTIONS = "--require=$evidenceDirectory\driver\observer.cjs"
$env:D194_OBSERVER_LOG = Join-Path $commandDirectory "$Label.observer.jsonl"
$env:D194_STORAGE_TRACE = '1'
$env:D194_STORAGE_BLOBS = Join-Path $evidenceDirectory 'fixtures\blobs'
$stdoutPath = Join-Path $commandDirectory "$Label.stdout.txt"
$stderrPath = Join-Path $commandDirectory "$Label.stderr.txt"
$sourcePath = 'apps/api/src/preflight-catalog.test.ts'
$beforeHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLower()
$started = (Get-Date).ToUniversalTime().ToString('o')
& $Program @ProgramArguments 1> $stdoutPath 2> $stderrPath
$commandExit = $LASTEXITCODE
[pscustomobject]@{
  label=$Label;program=$Program;arguments=$ProgramArguments;cwd=(Get-Location).Path;
  startedUtc=$started;finishedUtc=(Get-Date).ToUniversalTime().ToString('o');exitCode=$commandExit;
  node=(Get-Command node).Source;nodeVersion=(& node --version);temp=$env:TEMP;tmp=$env:TMP;
  nodeOptions=$env:NODE_OPTIONS;observerLog=$env:D194_OBSERVER_LOG;
  sourceSha256Before=$beforeHash;sourceSha256After=(Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLower();
  stdout=$stdoutPath;stderr=$stderrPath
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding utf8
Get-Content -LiteralPath $receiptPath
Get-Content -LiteralPath $stdoutPath -Tail 40
Get-Content -LiteralPath $stderrPath -Tail 50
exit $commandExit
