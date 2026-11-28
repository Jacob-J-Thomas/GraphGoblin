$ErrorActionPreference = 'Stop'
$evidence = $PSScriptRoot
$python = 'C:/Users/98jak/AppData/Local/Programs/Python/Python311/python.exe'
$runner = Join-Path $evidence 'launch-independent-qa.py'
$stdout = Join-Path $evidence 'CONTROLLER-STDOUT.log'
$stderr = Join-Path $evidence 'CONTROLLER-STDERR.log'
$launchPath = Join-Path $evidence 'CLAUDE-LAUNCH.json'
$eventPath = Join-Path $evidence 'CLAUDE-EVENTS.private.jsonl'
if ((Test-Path -LiteralPath $stdout) -or (Test-Path -LiteralPath $launchPath)) {
  throw 'Retain the earlier attempt; use a new attempt directory for a retry.'
}
$controller = Start-Process -FilePath $python -ArgumentList @($runner) -WorkingDirectory $evidence -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
for ($attempt = 0; $attempt -lt 25; $attempt++) {
  if ((Test-Path -LiteralPath $launchPath) -and (Test-Path -LiteralPath $eventPath) -and (Get-Item -LiteralPath $eventPath).Length -gt 0) { break }
  if ($controller.HasExited) { break }
  Start-Sleep -Seconds 1
}
if (-not (Test-Path -LiteralPath $launchPath)) { Get-Content -LiteralPath $stderr; throw 'Independent native QA launch receipt absent' }
$launch = Get-Content -Raw -LiteralPath $launchPath | ConvertFrom-Json
$provider = Get-Content -LiteralPath $eventPath -TotalCount 12 | ForEach-Object { try { $_ | ConvertFrom-Json -ErrorAction Stop } catch {} } | Where-Object { $_.subtype -eq 'init' } | Select-Object -First 1
$worker = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $launch.pid)
$exitReceipt = Join-Path $evidence 'CLAUDE-EXIT.json'
if ($controller.HasExited -and (Test-Path -LiteralPath $exitReceipt)) {
  Get-Content -LiteralPath $exitReceipt
  exit 1
}
if ($launch.controllerPid -ne $controller.Id -or $worker.ParentProcessId -ne $controller.Id -or $worker.ExecutablePath -ne 'C:\Users\98jak\.local\bin\claude.exe') { throw 'Independent QA controller or worker identity mismatch' }
if ($provider.model -ne 'claude-opus-5-5' -or $provider.apiKeySource -ne 'none' -or @($provider.tools).Count -ne 1 -or $provider.tools[0] -ne 'Bash') { throw 'Expected ordinary Max QA provider init absent' }
[ordered]@{
  verifiedAt=[DateTimeOffset]::UtcNow.ToString('o');controllerPid=$controller.Id;claudePid=$launch.pid
  worktree=$launch.worktree;baseHead=$launch.baseHead;patchSha256=$launch.patchSha256
  providerModel=$provider.model;effort=$launch.effort;apiKeySource=$provider.apiKeySource
  providerSession=$provider.session_id;auth=$launch.auth;tools=$provider.tools
  providerWritePaths=$launch.providerWritePaths;eventFile=$eventPath;controllerLog=$stdout
  controllerExited=$controller.HasExited;resultReceipt=$exitReceipt
} | ConvertTo-Json -Depth 5 | Tee-Object -FilePath (Join-Path $evidence 'ACTIVE-QA-MONITOR.json')

