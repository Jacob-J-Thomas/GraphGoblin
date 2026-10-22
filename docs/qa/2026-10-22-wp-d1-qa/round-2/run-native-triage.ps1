$qaCases = @(
  @('native-utf8-alone', 'src/process/scripts.test.ts', 'kills and closes a real process cancelled with incomplete UTF-8 pending'),
  @('native-timeout-alone', 'src/process/scripts.test.ts', 'kills the process tree on timeout'),
  @('native-abort-alone', 'src/process/scripts.test.ts', 'kills the process when the signal aborts'),
  @('native-tree-alone', 'src/adversarial.test.ts', '6/QA-LIMIT-001'),
  @('native-claude-deadline-alone', 'src/claude/process.test.ts', 'kills on deadline and output overflow'),
  @('native-claude-abort-alone', 'src/claude/process.test.ts', 'does not spawn for an already aborted signal'),
  @('native-claude-descendant-alone', 'src/claude/process.test.ts', 'kills the descendant that a long-lived child started')
)
foreach ($qaCase in $qaCases) {
  & (Join-Path $PSScriptRoot 'run-case.ps1') -Name $qaCase[0] -Package infrastructure -TestPath $qaCase[1] -Pattern $qaCase[2]
}
