$ErrorActionPreference = 'Stop'
$env:GIT_OPTIONAL_LOCKS = '0'
$qaOutput = 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-362-draft-docs-independent-01'
$expectedHead = '08633913a58cb42c32b4a18c72cd4aed67cfefa6'
$expectedTree = 'f7b63399b7f66ece81cc711c684073463fa39731'
$expectedParent = '505060e2c396db5355f0b1f1f4048cbeb9ec30f8'
$expectedDocs = [ordered]@{
  'docs/04-node-catalog.md' = 'fffee01d1e68409ec140bfc2f71ff132eec5e6a1baf58e24d88652547f39c830'
  'docs/guide/03-run-and-observe.md' = '9b7329496f4e28b427d6389bcbf9b5affd2abccddcf7a9472edc19bea707075b'
  'docs/guide/07-troubleshooting.md' = '33bdd0b1b0ffcb7fa24c9dfd45f785b5be1ca99c4fd27fe7f3b948b638e85bc9'
}
function Git([string[]]$GitArguments) {
  $output = @(& git @GitArguments)
  if ($LASTEXITCODE -ne 0) { throw "Git failed: $GitArguments" }
  return $output
}
$head = (Git @('rev-parse','HEAD')) -join ''
$tree = (Git @('rev-parse','HEAD^{tree}')) -join ''
$parent = (Git @('rev-parse','HEAD^')) -join ''
if ($head -ne $expectedHead -or $tree -ne $expectedTree -or $parent -ne $expectedParent) { throw 'Candidate binding differs' }
$changed = @(Git @('diff','--name-only',$expectedParent,$head))
if (Compare-Object -ReferenceObject @($expectedDocs.Keys | Sort-Object) -DifferenceObject @($changed | Sort-Object)) { throw 'Changed paths are not exactly authorized three docs' }
$status = @(Git @('status','--porcelain=v1','--untracked-files=all'))
$worktreeDiff = @(Git @('diff','--name-only'))
$indexDiff = @(Git @('diff','--cached','--name-only'))
if ($status.Count -or $worktreeDiff.Count -or $indexDiff.Count) { throw 'Checkout differs from candidate' }
$sourceFiles = @('AGENTS.md','docs/README.md','docs/12-implementation-plan.md','docs/15-issue-workflow.md','docs/08-triggers-and-integrations.md','apps/api/src/routes/runs.ts','packages/engine/src/run-manager.ts','packages/engine/src/definition-pin.ts','packages/engine/src/definition-pin.test.ts','packages/engine/src/testing/scenario.ts','packages/engine/src/handlers/script.ts','packages/infrastructure/src/process/scripts.ts','apps/api/src/definition-pins.test.ts','apps/api/src/testing/fake-classifier.ts','apps/web/src/runs/new/RunLauncher.tsx','apps/web/src/runs/new/NewRunPage.tsx','apps/api/src/routes/loops.ts','apps/api/src/triggers/trigger-service.ts','packages/infrastructure/src/sqlite/triggers.ts','packages/engine/package.json','packages/engine/vitest.config.ts','apps/api/package.json','apps/api/vitest.config.ts','apps/api/wait-storage.global-setup.ts','apps/api/api-ports.global-setup.ts','apps/api/api-ports.setup.ts','tooling/vitest.shared.mjs','tooling/package.json','turbo.json','pnpm-lock.yaml','docs/qa/2026-11-21-i4-362-batch-commands/independent/evidence/fixtures/a-api.mjs') + @($expectedDocs.Keys)
$sourceBindings = @()
foreach ($path in $sourceFiles) {
  $target = Join-Path $qaOutput ('source/' + $path.Replace('/','__'))
  if (Test-Path -LiteralPath $target) { throw "Source copy exists: $target" }
  Copy-Item -LiteralPath $path -Destination $target
  $sha = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()
  $copySha = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()
  $blob = (Git @('rev-parse',"${head}:$path")) -join ''
  $workingBlob = (Git @('hash-object','--',$path)) -join ''
  if ($sha -ne $copySha -or $blob -ne $workingBlob) { throw "Source bytes not candidate-bound: $path" }
  if ($expectedDocs.Contains($path) -and $sha -ne $expectedDocs[$path]) { throw "Frozen doc hash differs: $path" }
  $parentBlob = (Git @('rev-parse',"${parent}:$path")) -join ''
  $sourceBindings += [ordered]@{path=$path; copiedTo=$target.Substring($qaOutput.Length+1).Replace('\','/'); sha256=$sha; gitBlob=$blob; parentBlob=$parentBlob; unchangedFromParent=($blob -eq $parentBlob)}
}
$changedBlocks = @()
$links = @()
foreach ($path in $expectedDocs.Keys) {
  $before = ((Git @('show',"${parent}:$path")) -join "`n").TrimEnd()
  $after = (Get-Content -LiteralPath $path -Raw).Replace("`r`n","`n").TrimEnd()
  $oldBlocks = [regex]::Split($before,'\n[ \t]*\n')
  $newBlocks = [regex]::Split($after,'\n[ \t]*\n')
  if ($oldBlocks.Count -ne $newBlocks.Count) { throw "Paragraph count changed: $path" }
  for ($i = 0; $i -lt $oldBlocks.Count; $i++) {
    if ($oldBlocks[$i] -eq $newBlocks[$i]) { continue }
    $blockText = $newBlocks[$i]
    $offset = $after.IndexOf($blockText,[StringComparison]::Ordinal)
    $line = ($after.Substring(0,$offset).Split("`n")).Count
    $changedBlocks += [ordered]@{path=$path; paragraphIndex=$i; line=$line; old=$oldBlocks[$i]; current=$blockText}
    if ($blockText -notmatch 'fresh run' -or $blockText -notmatch 'versionId' -or $blockText -notmatch 'allowDraft: true' -or $blockText -notmatch 'published version') { throw "A changed paragraph lacks required distinction: $path/$line" }
    foreach ($match in [regex]::Matches($blockText,'\[[^\]]+\]\(([^)]+)\)')) {
      $href = $match.Groups[1].Value
      if ($href -match '^https?://') { continue }
      $parts = $href.Split('#',2)
      $target = if ($parts[0]) { [IO.Path]::GetFullPath((Join-Path (Split-Path $path) $parts[0])) } else { [IO.Path]::GetFullPath($path) }
      if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Missing local link: $path $href" }
      $slug = if ($parts.Count -gt 1) { $parts[1] } else { '' }
      if ($slug) {
        $slugs = @(Get-Content -LiteralPath $target | Where-Object { $_ -match '^#{1,6} ' } | ForEach-Object { (($_ -replace '^#{1,6} ','').ToLowerInvariant() -replace '[^\p{L}\p{N}_ -]','') -replace ' ','-' })
        if ($slug -notin $slugs) { throw "Missing heading anchor: $path $href" }
      }
      $links += [ordered]@{source=$path; line=$line; href=$href; resolved=$target; anchor=$slug; pass=$true}
    }
  }
}
if ($changedBlocks.Count -ne 6 -or $links.Count -ne 9) { throw "Expected 6 corrected paragraphs and 9 local links, got $($changedBlocks.Count)/$($links.Count)" }
$tests = @()
foreach ($suite in @(@{name='engine';expected=15},@{name='api';expected=4})) {
  $json = Get-Content -LiteralPath (Join-Path $qaOutput "observations/$($suite.name)-vitest.json") -Raw | ConvertFrom-Json
  if ($json.numTotalTests -ne $suite.expected -or $json.numPassedTests -ne $suite.expected -or $json.numFailedTests -ne 0 -or $json.numPendingTests -ne 0) { throw "Unexpected test totals: $($suite.name)" }
  foreach ($result in $json.testResults) {
    foreach ($case in $result.assertionResults) {
      if ($case.status -ne 'passed') { throw "Non-passing case: $($case.fullName)" }
      $tests += [ordered]@{suite=$suite.name; title=$case.fullName; status=$case.status; durationMs=$case.duration}
    }
  }
}
$finalReport = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-548-final-astra-01/REPORT.md'
$finalReportHash = (Get-FileHash -LiteralPath $finalReport -Algorithm SHA256).Hash.ToLower()
if ($finalReportHash -ne '11ea4ff863fc923388d0d19c26e3d7e4bed8d1e0a5a877626c80b6dbe30710f5') { throw 'Sealed negative final scan3 report changed' }
$indexPath = (Git @('rev-parse','--git-path','index')) -join ''
[ordered]@{checkedUtc=[DateTime]::UtcNow.ToString('o'); head=$head; tree=$tree; parent=$parent; exactChangedPaths=$changed; changedParagraphs=$changedBlocks.Count; localLinks=$links.Count; testsPassed=$tests.Count; buildRun=$false; sourceBinding='Normal package test scripts -> Vitest development export conditions -> TypeScript source; no dist process was launched'; status=$status; worktreeDiff=$worktreeDiff; indexDiff=$indexDiff; indexPath=$indexPath; indexSha256=(Get-FileHash -LiteralPath $indexPath -Algorithm SHA256).Hash.ToLower(); finalScan3Sha256=$finalReportHash; finalScan3Verdict='CHANGES_REQUIRED, scan 3 of 3; not superseded by scoped QA'; sourceFiles=$sourceBindings} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $qaOutput 'observations/source-binding.json') -Encoding utf8NoBOM
$changedBlocks | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $qaOutput 'observations/changed-paragraphs.json') -Encoding utf8NoBOM
$links | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $qaOutput 'observations/local-links.json') -Encoding utf8NoBOM
$tests | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $qaOutput 'observations/test-cases.json') -Encoding utf8NoBOM
Git @('diff','--no-ext-diff',"--output=$qaOutput/observations/candidate.patch",$parent,$head,'--') | Out-Null
Write-Output "PASS: exact head/tree/parent; 3 docs/6 paragraphs/9 links; 19 cases; clean source/index; negative scan3 seal unchanged; $($sourceBindings.Count) byte-verified source copies. No build required or run."
