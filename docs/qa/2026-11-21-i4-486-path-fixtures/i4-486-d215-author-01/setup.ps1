$ErrorActionPreference = 'Stop'
$task = 'G:/ggq/gg-i4-486-d215-fix'
$evidence = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d215-author-01'
$parent = 'G:/ggq/gg-delivery-next-independent/GraphGoblin'
$candidate = "$task/GraphGoblin"
$branch = 'codex/gg-i4-486-d215-fix'
$base = 'b8126de18080b76b15cbbbbc00fd791030fec3e1'
$tree = '86f422bb091515defe3d612df660988e5b47ffeb'
$main = 'a60843a9050b3a203726db84f6abf1f45b8bc694'
$env:TEMP = "$task/process-temp"
$env:TMP = $env:TEMP
$env:Path = 'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;' + $env:Path
$PSNativeCommandUseErrorActionPreference = $false

function Invoke-GitStep {
  param([string]$Name, [string[]]$GitArguments)
  $gitOptions = @('-c', 'maintenance.auto=false', '-c', 'gc.auto=0')
  $command = 'git ' + (($gitOptions + $GitArguments) -join ' ')
  $command | Tee-Object -FilePath "$evidence/$Name.log" | Out-Host
  $result = @(& git @gitOptions @GitArguments 2>&1)
  $exit = $LASTEXITCODE
  $result | Tee-Object -FilePath "$evidence/$Name.log" -Append | Out-Host
  "exit=$exit" | Tee-Object -FilePath "$evidence/$Name.log" -Append | Out-Host
  if ($exit -ne 0) { throw "$Name exited $exit" }
  return $result
}

Set-Location -LiteralPath $parent
$gitDir = Invoke-GitStep '01-main-git-dir' @('rev-parse', '--absolute-git-dir')
$objectsDir = (Resolve-Path -LiteralPath '.git/objects').Path
$mainHead = Invoke-GitStep '02-main-head-before' @('rev-parse', 'HEAD')
$mainIndex = @(Invoke-GitStep '03-main-index-before' @('ls-files'))
$worktreeNames = @(Get-ChildItem -LiteralPath $parent -Force -Name)
if ($gitDir -ne "$parent/.git" -or $objectsDir -notlike 'G:\*' -or $mainHead -ne $main -or $mainIndex.Count -ne 0 -or ($worktreeNames -join ',') -ne '.git' -or (Test-Path -LiteralPath '.git/objects/info/alternates')) {
  throw 'Independent G no-checkout repository precondition failed'
}
$null = Invoke-GitStep '04-worktrees-before' @('worktree', 'list', '--porcelain')
$null = Invoke-GitStep '05-fetch-pr553' @('fetch', '--no-tags', 'origin', "refs/pull/553/head:refs/heads/$branch")
$actual = Invoke-GitStep '06-fetched-source' @('rev-parse', $branch, "$branch^{tree}")
if (($actual -join ',') -ne "$base,$tree") { throw "Expected frozen source $base/$tree, got $actual" }
$null = Invoke-GitStep '07-add-worktree' @('worktree', 'add', '--no-checkout', $candidate, $branch)
Set-Location -LiteralPath $candidate
$null = Invoke-GitStep '08-sparse-pattern' @('sparse-checkout', 'set', '--no-cone', '/*', '!/docs/qa/')
$null = Invoke-GitStep '09-populate-index-and-source' @('read-tree', '-mu', 'HEAD')
if ((Test-Path -LiteralPath 'docs/qa') -or !(Test-Path -LiteralPath 'docs/README.md') -or !(Test-Path -LiteralPath 'packages/infrastructure/src/fs/fs.test.ts')) { throw 'Sparse checkout source precondition failed' }
$status = @(Invoke-GitStep '10-candidate-status-before' @('status', '--porcelain=v1'))
if ($status.Count -ne 0) { throw 'Candidate checkout is dirty before changes' }
$null = Invoke-GitStep '11-candidate-tree-before' @('rev-parse', 'HEAD', 'HEAD^{tree}', '--git-common-dir')
$null = Invoke-GitStep '12-candidate-index-path-before' @('ls-files', '--stage', '--', 'packages/infrastructure/src/fs/fs.test.ts')
$null = Invoke-GitStep '13-candidate-sparse-list' @('sparse-checkout', 'list')
Set-Location -LiteralPath $parent
$mainHead = Invoke-GitStep '14-main-head-after' @('rev-parse', 'HEAD')
$mainIndex = @(Invoke-GitStep '15-main-index-after' @('ls-files'))
if ($mainHead -ne $main -or $mainIndex.Count -ne 0 -or ((Get-ChildItem -LiteralPath $parent -Force -Name) -join ',') -ne '.git') { throw 'Independent main worktree changed' }
