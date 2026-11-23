# Lists node processes running this worktree's repository-owned readiness fake CLI (exact path match).
$fixture = 'C:\Users\98jak\.codex\worktrees\gg-20261117-probe-466\GraphGoblin\packages\adapter-codex\src\fixtures\readiness-cli.mjs'
$found = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($fixture) } |
  Select-Object ProcessId, ParentProcessId, CreationDate, CommandLine
if ($found) { $found | Format-List | Out-String -Width 400 } else { 'no readiness-cli.mjs process from this worktree' }
