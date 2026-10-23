$ErrorActionPreference = 'Continue'
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$taskRoot = (Get-Location).Path
$evidence = Join-Path $taskRoot 'docs/qa/2026-10-22-wp-g2-qa/round-2'
$commands = @('typecheck', 'lint', 'check:layers', 'check:deps', 'check:licenses', 'check:tokens', 'check:docs')
$failures = 0
foreach ($command in $commands) {
  $stream = [System.IO.File]::Open((Join-Path $evidence ($command.Replace(':', '-') + '.log.txt')), 'Create', 'Write', 'ReadWrite')
  $writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false))
  $writer.AutoFlush = $true
  try {
    $writer.WriteLine('HEAD: ' + (& git rev-parse HEAD))
    $writer.WriteLine('Node: ' + (& node --version))
    $writer.WriteLine('Command: pnpm.cmd ' + $command)
    & pnpm.cmd $command 2>&1 | ForEach-Object {
      $portable = ([string]$_).Replace($taskRoot, '<worktree>').Replace($env:USERPROFILE, '<user>')
      $writer.WriteLine($portable)
    }
    $result = $LASTEXITCODE
    $writer.WriteLine('Exit: ' + $result)
    Write-Output ($command + ': exit ' + $result)
    if ($result -ne 0) { $failures++ }
  } finally { $writer.Dispose() }
}
if ($failures) { exit 1 }
