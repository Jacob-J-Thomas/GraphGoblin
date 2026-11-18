# Lists processes whose command line references the QA tree (node children, vitest workers, foreign listeners).
$qa = 'gg-20261117-ports-407-qa'
$ev = 'i1-ports-407-independent-claude-qa'
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$qa*" -or $_.CommandLine -like "*$ev*") -and $_.ProcessId -ne $PID -and $_.CommandLine -notlike '*children.ps1*' } |
  Select-Object ProcessId, ParentProcessId, Name, CommandLine | ConvertTo-Json -Depth 2
