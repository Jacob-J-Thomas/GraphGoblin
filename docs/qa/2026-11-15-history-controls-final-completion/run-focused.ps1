$ErrorActionPreference = 'Stop'
$env:GIT_OPTIONAL_LOCKS = '0'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$candidate = 'C:\Users\98jak\.codex\worktrees\gg-20261114-history-controls\GraphGoblin'
$auditRoot = $PSScriptRoot
Set-Location -LiteralPath $candidate
function Read-Identity {
  $indexPath = (git rev-parse --git-path index).Trim()
  [ordered]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    head = (git rev-parse HEAD).Trim()
    tree = (git rev-parse 'HEAD^{tree}').Trim()
    status = @(git status --porcelain=v1)
    indexSha256 = (Get-FileHash -LiteralPath $indexPath -Algorithm SHA256).Hash.ToLowerInvariant()
    product = @(git ls-tree -r HEAD -- apps packages tooling .github pnpm-lock.yaml package.json turbo.json)
  }
}
$before = Read-Identity
$before | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$auditRoot\focused-before.json"
$runtime = (node --version).Trim()
if ($runtime -ne 'v22.23.4') { throw "Unexpected runtime $runtime" }
$commands = @(
  [ordered]@{ name = 'existing'; args = @('--filter','@graphgoblin/web','exec','vitest','run','--reporter=verbose','src/components/layout/connection-banner.test.tsx','src/editor/EditorConnectionBanner.test.tsx','src/editor/EditorPage.connection.test.tsx','src/editor/EditorToolbar.test.tsx','src/editor/UndoRedo.press.test.tsx','src/editor/UndoRedo.test.tsx','src/editor/EditorPage.undo.test.tsx') },
  [ordered]@{ name = 'external'; args = @('--filter','@graphgoblin/web','exec','vitest','run','--config',"$auditRoot\audit-vitest.config.mts",'--reporter=verbose') }
)
$commands | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath "$auditRoot\focused-commands.json"
$results = @()
foreach ($check in $commands) {
  $start = (Get-Date).ToUniversalTime().ToString('o')
  $arguments = $check.args
  & pnpm.cmd @arguments *> "$auditRoot\$($check.name)-first.log"
  $code = $LASTEXITCODE
  $row = [ordered]@{ name = $check.name; runtime = $runtime; start = $start; end = (Get-Date).ToUniversalTime().ToString('o'); exit = $code; log = "$($check.name)-first.log"; sha256 = (Get-FileHash -LiteralPath "$auditRoot\$($check.name)-first.log" -Algorithm SHA256).Hash.ToLowerInvariant() }
  $results += $row
  $results | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$auditRoot\focused-results.json"
  $row | ConvertTo-Json -Compress
}
$after = Read-Identity
$after | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$auditRoot\focused-after.json"
if ($before.head -ne $after.head -or $before.tree -ne $after.tree -or $before.indexSha256 -ne $after.indexSha256 -or $after.status.Count -ne 0) { throw 'Candidate identity changed during focused tests' }
if (@($results | Where-Object { $_.exit -ne 0 }).Count) { exit 1 }
