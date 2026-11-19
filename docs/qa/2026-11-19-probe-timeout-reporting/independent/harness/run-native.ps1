param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][string]$InputDirectory)
$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$packet = 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\pr505-midbody-dedup-independent-qa-02'
$scratch = 'D:\GraphGoblin-QA\2026-11-18\pr505-midbody-dedup-independent-qa-02'
if ($Name -notmatch '^[a-z][a-z0-9-]+$') { throw 'Unsafe run name' }
$output = Join-Path $packet $Name
$runPath = Join-Path (Join-Path $scratch 'runs') $Name
if ((Test-Path -LiteralPath $output) -or (Test-Path -LiteralPath $runPath)) { throw 'Run already exists' }
New-Item -ItemType Directory -Path $output | Out-Null
New-Item -ItemType Directory -Path $runPath -Force | Out-Null
$runTemp = Join-Path $runPath 'temp'
New-Item -ItemType Directory -Path $runTemp | Out-Null
$resolvedTemp = (Resolve-Path -LiteralPath $runTemp).ProviderPath
if ($resolvedTemp -ne [IO.Path]::GetFullPath($runTemp) -or [IO.Path]::GetDirectoryName($resolvedTemp) -ne [IO.Path]::GetFullPath($runPath)) { throw 'Unexpected owned temp' }
$env:TEMP = $resolvedTemp
$env:TMP = $resolvedTemp
$env:TMPDIR = $resolvedTemp
$env:GG505_OUTPUT = $output
$env:LIVE = '0'
$node = (Get-Command node.exe).Source
$version = & $node --version
if ($version -ne 'v22.23.4') { throw 'Unexpected Node runtime' }
$driver = Join-Path $packet 'run-case.mjs'
$receipt = [ordered]@{ name = $Name; node = $version; input = $InputDirectory; driver = $driver; runnerTemp = $resolvedTemp; startUtc = [DateTime]::UtcNow.ToString('o'); timeoutMs = 45000 }
$process = Start-Process -FilePath $node -ArgumentList @($driver, $InputDirectory) -WorkingDirectory $scratch -WindowStyle Hidden -RedirectStandardOutput (Join-Path $output 'stdout.log') -RedirectStandardError (Join-Path $output 'stderr.log') -PassThru
$receipt.runnerPid = $process.Id
$receipt.runnerBirthUtc = $process.StartTime.ToUniversalTime().ToString('o')
$finished = $process.WaitForExit(45000)
if (-not $finished) {
  $receipt.externalDeadlineReached = $true
  $process.Kill($true)
  $process.WaitForExit()
} else { $receipt.externalDeadlineReached = $false }
$receipt.actualExit = $process.ExitCode
$receipt.endUtc = [DateTime]::UtcNow.ToString('o')
$fixtureFragment = 'D:\GraphGoblin-QA\2026-11-18\pr505-preaborted-independent-qa\source-baseline\packages\adapter-codex\src\fixtures\readiness-cli.mjs'
$children = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($fixtureFragment) })
$receipt.ownedFakeProcessesAfterRun = @($children | ForEach-Object { [ordered]@{ pid = $_.ProcessId; birth = $_.CreationDate.ToString('o'); commandLine = $_.CommandLine } })
$receipt.runnerTempExistsBeforeExternalCleanup = Test-Path -LiteralPath $resolvedTemp
$receipt.runnerTempEntriesBeforeExternalCleanup = @(Get-ChildItem -LiteralPath $resolvedTemp -Recurse -Force | ForEach-Object { $_.FullName })
if ($children.Count -eq 0) {
  $checked = (Resolve-Path -LiteralPath $resolvedTemp).ProviderPath
  if ($checked -ne $resolvedTemp -or [IO.Path]::GetDirectoryName($checked) -ne [IO.Path]::GetFullPath($runPath)) { throw 'Refusing unexpected temp cleanup target' }
  Remove-Item -LiteralPath $checked -Recurse -Force
  $receipt.externalCleanup = 'removed only the verified runner-owned disposable temp after observations'
} else { $receipt.externalCleanup = 'retained temp because an owned fake CLI is still alive' }
$receipt.runnerTempExistsAfterExternalCleanup = Test-Path -LiteralPath $resolvedTemp
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output 'command-receipt.json')
$receipt | ConvertTo-Json -Depth 8
