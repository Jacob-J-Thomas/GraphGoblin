param([Parameter(Mandatory)][string]$Label, [Parameter(Mandatory)][string]$Command)
$ErrorActionPreference = 'Stop'
$taskRoot = 'G:\ggq\gg-mac-d237-qa\GraphGoblin'
$evidenceRoot = $PSScriptRoot
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:GIT_OPTIONAL_LOCKS = '0'
$receiptPath = Join-Path $evidenceRoot "$Label.receipt.json"
if (Test-Path -LiteralPath $receiptPath) { throw "Refusing to overwrite $receiptPath" }
$stdoutPath = Join-Path $evidenceRoot "$Label.stdout.log"
$stderrPath = Join-Path $evidenceRoot "$Label.stderr.log"
$start = [DateTimeOffset]::UtcNow
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $env:ComSpec
$psi.ArgumentList.Add('/d')
$psi.ArgumentList.Add('/s')
$psi.ArgumentList.Add('/c')
$psi.ArgumentList.Add($Command)
$psi.WorkingDirectory = $taskRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $psi
$stdout = [IO.File]::Create($stdoutPath)
$stderr = [IO.File]::Create($stderrPath)
try {
  if (-not $process.Start()) { throw 'Command process failed to start.' }
  $outTask = $process.StandardOutput.BaseStream.CopyToAsync($stdout)
  $errTask = $process.StandardError.BaseStream.CopyToAsync($stderr)
  $process.WaitForExit()
  $outTask.GetAwaiter().GetResult()
  $errTask.GetAwaiter().GetResult()
  $exitCode = $process.ExitCode
} finally {
  $stdout.Dispose()
  $stderr.Dispose()
}
$receipt = [ordered]@{
  label = $Label; command = $Command; cwd = $taskRoot
  startUtc = $start.ToString('o'); endUtc = [DateTimeOffset]::UtcNow.ToString('o')
  exitCode = $exitCode; nodePath = (Get-Command node).Source; nodeVersion = (& node --version)
  pnpmPath = (Get-Command pnpm.cmd).Source
  stdout = $stdoutPath; stderr = $stderrPath
  stdoutSha256 = (Get-FileHash -LiteralPath $stdoutPath -Algorithm SHA256).Hash.ToLowerInvariant()
  stderrSha256 = (Get-FileHash -LiteralPath $stderrPath -Algorithm SHA256).Hash.ToLowerInvariant()
}
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receiptPath -Encoding utf8NoBOM
$receipt | ConvertTo-Json -Depth 5
Get-Content -LiteralPath $stdoutPath -Tail 35
Get-Content -LiteralPath $stderrPath -Tail 35
exit $exitCode

