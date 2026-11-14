# Lists processes that could belong to this phase: the e2e server, anything started from this
# worktree or this QA folder, vitest/playwright children, and any msedge/msedgewebview2 launched
# with a playwright profile (headless automation), plus a count of all msedge for context.
$procs = Get-CimInstance Win32_Process
$mine = $procs | Where-Object {
  $c = $_.CommandLine
  $c -and (
    $c.Contains('e2e/server.ts') -or $c.Contains('e2e\server.ts') -or
    $c.Contains('gg-20261114-i08-input') -or $c.Contains('ui-235-claude-phase3') -or
    $c.Contains('playwright') -or $c.Contains('vitest') -or
    ($_.Name -eq 'msedge.exe' -and ($c.Contains('--remote-debugging-pipe') -or $c.Contains('--headless') -or $c.Contains('playwright')))
  )
}
"owned/automation processes found: $(@($mine).Count)"
$mine | Select-Object ProcessId, ParentProcessId, Name, @{n='Cmd';e={$_.CommandLine.Substring(0,[Math]::Min(150,$_.CommandLine.Length))}} | Format-Table -AutoSize | Out-String -Width 250
"all msedge.exe processes (context): $(@($procs | Where-Object { $_.Name -eq 'msedge.exe' }).Count)"
