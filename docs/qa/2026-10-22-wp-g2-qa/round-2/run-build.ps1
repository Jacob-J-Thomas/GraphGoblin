$ErrorActionPreference = 'Stop'
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$taskRoot = (Get-Location).Path
$evidence = Join-Path $taskRoot 'docs/qa/2026-10-22-wp-g2-qa/round-2'
$stream = [System.IO.File]::Open((Join-Path $evidence 'gate-build.log.txt'), 'Create', 'Write', 'ReadWrite')
$writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false))
$writer.AutoFlush = $true
function Record([string]$line) {
  $portable = $line.Replace($taskRoot, '<worktree>').Replace($env:USERPROFILE, '<user>')
  $writer.WriteLine($portable)
  Write-Output $portable
}
try {
  Record ('UTC: ' + [DateTime]::UtcNow.ToString('o'))
  Record ('HEAD: ' + (& git rev-parse HEAD))
  Record ('Node: ' + (& node --version))
  Record 'Command: pnpm.cmd build'
  $started = [DateTime]::UtcNow
  # Windows PowerShell treats ordinary native stderr as ErrorRecords. pnpm writes
  # its command banner there; retain it without aborting the transcript pipeline.
  $ErrorActionPreference = 'Continue'
  & pnpm.cmd build 2>&1 | ForEach-Object { Record ([string]$_) }
  $result = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Record ('Exit: ' + $result + '; elapsed seconds: ' + ([DateTime]::UtcNow - $started).TotalSeconds)
} finally { $writer.Dispose() }
exit $result
