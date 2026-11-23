# node.exe processes whose command line references the QA tree or this QA evidence folder (API children, vitest workers, foreign sentinels).
$qa = 'gg-20261117-ports-407-qa'; $ev = 'i1-ports-407-correction-independent-claude-qa'
$p = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$qa*" -or $_.CommandLine -like "*$ev*") } | Select-Object ProcessId, ParentProcessId, CommandLine)
ConvertTo-Json -InputObject @{ at = (Get-Date).ToUniversalTime().ToString('o'); count = $p.Count; processes = $p } -Depth 3
