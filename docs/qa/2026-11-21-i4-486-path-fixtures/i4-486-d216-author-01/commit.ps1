. 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d216-author-01/environment.ps1'
$branch = git @gitOptions branch --show-current
$headBefore = git @gitOptions rev-parse HEAD
$indexBefore = git @gitOptions rev-parse ":$source"
$indexPaths = @(git @gitOptions diff --cached --name-only)
$changed = @(git @gitOptions diff --name-only HEAD)
$untracked = @(git @gitOptions ls-files --others --exclude-standard)
$correctedBlob = git @gitOptions hash-object $source
$correctedSha = (Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant()
$original = Get-Content -LiteralPath "$evidence/06-original-short-name-tests.json" -Raw | ConvertFrom-Json
$shortResult = Get-Content -LiteralPath "$evidence/08-original-short-name-result.json" -Raw | ConvertFrom-Json
if ($original.head -ne $base -or $original.tree -ne $baseTree -or $original.indexBlob -ne $baseBlob -or $original.worktreeBlob -ne $baseBlob -or $original.worktreeSha256 -ne $baseSourceSha256 -or $original.exit -ne 1 -or $shortResult.testSummary -ne 'Tests  3 failed | 17 skipped (20)' -or !$shortResult.resolverAssertionObserved) { throw 'Retained short-name negative control did not bind to frozen original' }
if ($branch -ne 'codex/gg-i4-486-d215-fix' -or $headBefore -ne $base -or $indexBefore -ne $baseBlob -or $indexPaths.Count -ne 0 -or ($changed -join ',') -ne $source -or $untracked.Count -ne 0) { throw 'Commit safety check found unexpected branch, index or paths' }
$verification = @(
  '11-corrected-uppercase-temp-test', '13-corrected-short-name-tests', '16-corrected-cross-volume-relative-tests',
  '19-corrected-ordinary-fs-test', '22-corrected-junction-fs-test',
  '24-infrastructure-typecheck', '25-scoped-eslint', '26-scoped-prettier'
)
foreach ($name in $verification) {
  $checked = Get-Content -LiteralPath "$evidence/$name.json" -Raw | ConvertFrom-Json
  if ($checked.exit -ne 0 -or $checked.head -ne $base -or $checked.tree -ne $baseTree -or $checked.indexBlob -ne $baseBlob -or $checked.worktreeBlob -ne $correctedBlob -or $checked.worktreeSha256 -ne $correctedSha) { throw "Verification does not bind to the staged candidate source: $name" }
}
Save-Json '27-precommit-source-binding' @{
  head=$headBefore; tree=$baseTree; branch=$branch; baseBlob=$baseBlob; indexBefore=$indexBefore
  sourceBlob=$correctedBlob; sourceSha256=$correctedSha; verifiedRuns=$verification; changedPaths=$changed
  unrelatedIndexPaths=$indexPaths; untracked=$untracked
}
if ((Invoke-Retained '28-worktree-diff-check' 'git' ($gitOptions + @('diff', '--check', 'HEAD'))) -ne 0) { throw 'Worktree diff check failed' }
if ((Invoke-Retained '29-stage-one-path' 'git' ($gitOptions + @('add', '--', $source))) -ne 0) { throw 'Staging test-only path failed' }
$staged = @(git @gitOptions diff --cached --name-only)
$stagedBlob = git @gitOptions rev-parse ":$source"
$unstaged = @(git @gitOptions diff --name-only)
if (($staged -join ',') -ne $source -or $stagedBlob -ne $correctedBlob -or $unstaged.Count -ne 0) { throw 'Staged source differs from validated source' }
if ((Invoke-Retained '30-staged-index' 'git' ($gitOptions + @('ls-files', '--stage', '--', $source))) -ne 0) { throw 'Could not capture staged index' }
if ((Invoke-Retained '31-staged-diff-check' 'git' ($gitOptions + @('diff', '--cached', '--check'))) -ne 0) { throw 'Staged diff check failed' }
git @gitOptions diff --cached --no-ext-diff --binary -- $source > "$evidence/32-staged.patch"
if ($LASTEXITCODE -ne 0) { throw 'Could not capture staged diff' }
if ((Invoke-Retained '33-commit' 'git' ($gitOptions + @('commit', '-m', 'Use native resolution in workspace path expectations'))) -ne 0) { throw 'Ordinary local commit failed' }
$identity = @(git @gitOptions rev-parse HEAD 'HEAD^{tree}' 'HEAD^')
$commitBlob = git @gitOptions rev-parse "HEAD:$source"
$paths = @(git @gitOptions diff-tree --no-commit-id -r --name-only HEAD)
$status = @(git @gitOptions status --porcelain=v1)
if ($identity[2] -ne $base -or $commitBlob -ne $correctedBlob -or ($paths -join ',') -ne $source -or $status.Count -ne 0) { throw 'Commit contains unexpected paths or source' }
if ((Invoke-Retained '34-committed-index' 'git' ($gitOptions + @('ls-files', '--stage', '--', $source))) -ne 0) { throw 'Could not capture committed index' }
if ((Invoke-Retained '35-final-status' 'git' ($gitOptions + @('status', '--porcelain=v1'))) -ne 0) { throw 'Could not read final status' }
if ((Invoke-Retained '36-commit-identity' 'git' ($gitOptions + @('show', '-s', '--format=%H%n%T%n%P%n%G?%n%s', 'HEAD'))) -ne 0) { throw 'Could not read commit identity' }
git @gitOptions diff --no-ext-diff --binary $base HEAD -- $source > "$evidence/37-committed.patch"
if ($LASTEXITCODE -ne 0) { throw 'Could not capture committed diff' }
$hashes = @(Get-FileHash -LiteralPath "$evidence/09-worktree.patch", "$evidence/32-staged.patch", "$evidence/37-committed.patch")
if (@($hashes.Hash | Sort-Object -Unique).Count -ne 1) { throw 'Worktree, staged and committed patches differ' }
$candidate = [ordered]@{
  head=$identity[0]; tree=$identity[1]; parent=$identity[2]; parentTree=$baseTree
  branch=$branch; sourceBlob=$commitBlob; sourceSha256=$correctedSha; clean=($status.Count -eq 0)
  changedPaths=$paths; committedDiffSha256=$hashes[0].Hash.ToLowerInvariant()
  worktree=$workspaceRoot; gitCommonDir=(git @gitOptions rev-parse --git-common-dir)
}
Save-Json '38-candidate-binding' $candidate
$candidate | ConvertTo-Json -Depth 6
