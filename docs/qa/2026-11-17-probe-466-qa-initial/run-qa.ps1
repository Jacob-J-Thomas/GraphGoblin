param([ValidateSet('matrix','live','live-control','double-fault')] [string]$Run)
$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$workspace = 'C:/Users/98jak/.codex/worktrees/gg-20261117-probe-466-qa/GraphGoblin'
$evidence = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-probe-466-independent-qa'
$runId = [Guid]::NewGuid().ToString('N').Substring(0, 10)
$originalTemp = (Resolve-Path -LiteralPath $env:TEMP).ProviderPath
$ownedPath = [IO.Path]::GetFullPath((Join-Path $originalTemp "g466qa-$runId"))
if ([IO.Path]::GetDirectoryName($ownedPath) -ne $originalTemp -or (Test-Path -LiteralPath $ownedPath)) {
  throw "Unexpected run temp path: $ownedPath"
}
New-Item -ItemType Directory -Path $ownedPath | Out-Null
$created = (Resolve-Path -LiteralPath $ownedPath).ProviderPath
if ($created -ne $ownedPath) { throw "Unexpected resolved run temp path: $created" }
$env:TEMP = $ownedPath
$env:TMP = $ownedPath
$env:TMPDIR = $ownedPath
$env:GG_466_QA_SCENARIO = $Run
$env:GG_466_QA_OBSERVATION = Join-Path $evidence "$Run-events.jsonl"
$filter = if ($Run -eq 'matrix') { 'src/probe-directory.test.ts' } else { 'src/probe-directory.independent-qa.test.ts' }
$receipt = Join-Path $evidence "$Run-receipt.txt"
$log = Join-Path $evidence "$Run-vitest.log"
$currentNode = node --version
$currentPnpm = pnpm.cmd --version
if ($currentNode -ne 'v22.23.4' -or $currentPnpm -ne '12.8.1') { throw 'Unexpected Node or pnpm runtime' }
if ((Test-Path -LiteralPath $receipt) -or (Test-Path -LiteralPath $log)) { throw "Existing receipt for $Run" }
Push-Location -LiteralPath $workspace
try {
  @(
    "workdir=$workspace"
    "scenario=$Run"
    "node=$currentNode pnpm=$currentPnpm"
    "owned_temp=$ownedPath"
    "start_utc=$([DateTime]::UtcNow.ToString('o'))"
    "command=pnpm.cmd --filter @graphgoblin/adapter-codex test $filter --reporter=verbose"
  ) | Set-Content -LiteralPath $receipt
  pnpm.cmd --filter @graphgoblin/adapter-codex test $filter --reporter=verbose *> $log
  $code = $LASTEXITCODE
  @("test_exit=$code", "end_utc=$([DateTime]::UtcNow.ToString('o'))") | Add-Content -LiteralPath $receipt
  Get-Content -LiteralPath $log
} finally {
  Pop-Location
  $processCliFragment = ($workspace -replace '/', '\') + '\packages\adapter-codex\src\fixtures\readiness-cli.mjs'
  $children = @(
    Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($processCliFragment) }
  )
  "owned_fake_cli_processes_after_vitest=$($children.Count)" | Add-Content -LiteralPath $receipt
  foreach ($child in $children) {
    "survivor_pid=$($child.ProcessId) creation=$($child.CreationDate)" | Add-Content -LiteralPath $receipt
    $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $($child.ProcessId)"
    if ($process -and $process.CreationDate -eq $child.CreationDate -and $process.CommandLine -eq $child.CommandLine) {
      Stop-Process -Id $child.ProcessId -ErrorAction Stop
      "external_process_cleanup_pid=$($child.ProcessId)" | Add-Content -LiteralPath $receipt
    }
  }
  if ($children.Count -gt 0) {
    $survivorsAfterCleanup = @(
      Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($processCliFragment) }
    )
    "owned_fake_cli_processes_after_external_cleanup=$($survivorsAfterCleanup.Count)" | Add-Content -LiteralPath $receipt
    if ($survivorsAfterCleanup.Count -ne 0) { throw 'Owned process cleanup did not complete' }
  }
  $resolved = (Resolve-Path -LiteralPath $ownedPath).ProviderPath
  if ($resolved -ne $created -or [IO.Path]::GetDirectoryName($resolved) -ne $originalTemp) {
    throw "Refusing cleanup of $resolved"
  }
  $entries = @(Get-ChildItem -LiteralPath $resolved -Recurse -Force -ErrorAction Stop)
  "owned_temp_entries_before_external_cleanup=$($entries.Count)" | Add-Content -LiteralPath $receipt
  foreach ($entry in $entries) { "remaining_owned_temp_entry=$($entry.FullName)" | Add-Content -LiteralPath $receipt }
  Remove-Item -LiteralPath $resolved -Recurse -Force
  "owned_temp_exists_after_external_cleanup=$(Test-Path -LiteralPath $resolved)" | Add-Content -LiteralPath $receipt
  Get-Content -LiteralPath $receipt
}
exit $code
