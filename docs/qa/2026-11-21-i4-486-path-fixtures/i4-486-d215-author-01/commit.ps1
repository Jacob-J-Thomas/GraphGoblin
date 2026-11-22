. 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d215-author-01/verification-environment.ps1'
$base = 'b8126de18080b76b15cbbbbc00fd791030fec3e1'
$baseTree = '86f422bb091515defe3d612df660988e5b47ffeb'
$baseBlob = 'a966e087a00d3b5d8d388860c2f54d6ef9e9b064'
$branch = 'codex/gg-i4-486-d215-fix'
$before = @(git @gitOptions rev-parse HEAD 'HEAD^{tree}')
$currentBranch = git @gitOptions branch --show-current
$changed = @(git @gitOptions diff --name-only HEAD)
$stagedBefore = @(git @gitOptions diff --cached --name-only)
$untracked = @(git @gitOptions ls-files --others --exclude-standard)
if (($before -join ',') -ne "$base,$baseTree" -or $currentBranch -ne $branch -or ($changed -join ',') -cne $source -or $stagedBefore.Count -ne 0 -or $untracked.Count -ne 0) {
  throw 'Precommit HEAD, branch, change, index or worktree admission failed'
}
Copy-Item -LiteralPath $source -Destination "$evidence/fs.test.after.ts"
$beforeSha = (Get-FileHash -LiteralPath "$evidence/fs.test.before.ts" -Algorithm SHA256).Hash.ToLowerInvariant()
$afterSha = (Get-FileHash -LiteralPath "$evidence/fs.test.after.ts" -Algorithm SHA256).Hash.ToLowerInvariant()
$afterBlob = git @gitOptions hash-object $source
$chatAudio = 'packages/infrastructure/src/fs/chat-audio.test.ts'
$chatAudioBaseBlob = git @gitOptions rev-parse "${base}:$chatAudio"
$chatAudioDiskBlob = git @gitOptions hash-object $chatAudio
if ($chatAudioBaseBlob -ne $chatAudioDiskBlob) { throw 'Unchanged comparison file failed its source binding' }
@{
  parent = $base
  parentTree = $baseTree
  branch = $branch
  path = $source
  changed = $changed
  indexBeforeStaging = $stagedBefore
  untrackedBeforeStaging = $untracked
  beforeGitBlob = $baseBlob
  afterGitBlob = $afterBlob
  beforeFileSha256 = $beforeSha
  afterFileSha256 = $afterSha
  unchangedChatAudioTestPath = $chatAudio
  unchangedChatAudioTestBaseBlob = $chatAudioBaseBlob
  unchangedChatAudioTestDiskBlob = $chatAudioDiskBlob
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath "$evidence/37-precommit-binding.json" -Encoding utf8
if ((Invoke-RetainedStep '38-uncommitted-diff-check' 'git' ($gitOptions + @('diff', '--check', 'HEAD'))) -ne 0) { throw 'Precommit whitespace check failed' }
git @gitOptions diff --no-ext-diff --binary HEAD -- $source > "$evidence/39-worktree.patch"
if ($LASTEXITCODE -ne 0) { throw 'Worktree diff capture failed' }
if ((Invoke-RetainedStep '40-stage' 'git' ($gitOptions + @('add', '--', $source))) -ne 0) { throw 'Scoped stage failed' }
$staged = @(git @gitOptions diff --cached --name-only)
$unstaged = @(git @gitOptions diff --name-only)
$stagedBlob = git @gitOptions rev-parse ":$source"
if (($staged -join ',') -cne $source -or $unstaged.Count -ne 0 -or $stagedBlob -ne $afterBlob) { throw 'Index differs from tested source' }
if ((Invoke-RetainedStep '41-staged-index' 'git' ($gitOptions + @('ls-files', '--stage', '--', $source))) -ne 0) { throw 'Index capture failed' }
if ((Invoke-RetainedStep '42-staged-diff-check' 'git' ($gitOptions + @('diff', '--cached', '--check'))) -ne 0) { throw 'Staged whitespace check failed' }
git @gitOptions diff --cached --no-ext-diff --binary -- $source > "$evidence/43-staged.patch"
if ($LASTEXITCODE -ne 0) { throw 'Staged diff capture failed' }
if ((Invoke-RetainedStep '44-commit' 'git' ($gitOptions + @('commit', '-m', 'Correct workspace path test fixtures'))) -ne 0) { throw 'Ordinary local commit failed' }
$identity = @(git @gitOptions rev-parse HEAD 'HEAD^{tree}' 'HEAD^')
$head = $identity[0]
$tree = $identity[1]
$parent = $identity[2]
$headBlob = git @gitOptions rev-parse "HEAD:$source"
$headChanges = @(git @gitOptions diff-tree --no-commit-id -r --name-only HEAD)
$status = @(git @gitOptions status --porcelain=v1)
if ($parent -ne $base -or $headBlob -ne $afterBlob -or ($headChanges -join ',') -cne $source -or $status.Count -ne 0) {
  throw 'Committed source binding or clean status failed'
}
if ((Invoke-RetainedStep '45-committed-index' 'git' ($gitOptions + @('ls-files', '--stage', '--', $source))) -ne 0) { throw 'Post-commit index capture failed' }
if ((Invoke-RetainedStep '46-final-status' 'git' ($gitOptions + @('status', '--porcelain=v1'))) -ne 0) { throw 'Final status command failed' }
if ((Invoke-RetainedStep '47-commit-summary' 'git' ($gitOptions + @('show', '-s', '--format=%H%n%T%n%P%n%G?%n%s', 'HEAD'))) -ne 0) { throw 'Commit summary capture failed' }
git @gitOptions diff --no-ext-diff --binary $base HEAD -- $source > "$evidence/48-committed.patch"
if ($LASTEXITCODE -ne 0) { throw 'Committed diff capture failed' }
$diffs = @(Get-FileHash -LiteralPath "$evidence/39-worktree.patch", "$evidence/43-staged.patch", "$evidence/48-committed.patch" -Algorithm SHA256)
if (@($diffs.Hash | Sort-Object -Unique).Count -ne 1) { throw 'Worktree, index and committed diffs disagree' }
$mainDir = 'G:/ggq/gg-delivery-next-independent/GraphGoblin'
$main = git @gitOptions -C $mainDir rev-parse HEAD
$mainIndex = @(git @gitOptions -C $mainDir ls-files)
$mainFiles = @(Get-ChildItem -LiteralPath $mainDir -Force -Name)
if ($main -ne 'a60843a9050b3a203726db84f6abf1f45b8bc694' -or $mainIndex.Count -ne 0 -or ($mainFiles -join ',') -ne '.git') { throw 'Independent main is no longer an untouched no-checkout worktree' }
@{
  head = $head
  tree = $tree
  parent = $parent
  branch = $branch
  changedPaths = $headChanges
  sourceGitBlob = $headBlob
  sourceFileSha256 = $afterSha
  diffSha256 = $diffs[0].Hash.ToLowerInvariant()
  cleanStatus = ($status.Count -eq 0)
  independentMain = $main
  independentMainIndexEntries = $mainIndex.Count
  independentMainEntries = $mainFiles
  worktree = "$task/GraphGoblin"
  gitCommonDir = (git @gitOptions rev-parse --git-common-dir)
} | ConvertTo-Json -Depth 4 | Tee-Object -FilePath "$evidence/49-candidate-binding.json"
