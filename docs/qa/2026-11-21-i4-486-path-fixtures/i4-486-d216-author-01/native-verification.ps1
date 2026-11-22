. 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d216-author-01/environment.ps1'
$expectedBranch = 'codex/gg-i4-486-d215-fix'
$resolvedGitDir = git @gitOptions rev-parse --git-common-dir
$actualStatus = @(git @gitOptions status --porcelain=v1)
$actualBranch = git @gitOptions branch --show-current
$actualHead = git @gitOptions rev-parse HEAD
$actualTree = git @gitOptions rev-parse 'HEAD^{tree}'
$actualBlob = git @gitOptions hash-object $source
$actualIndex = git @gitOptions ls-files --stage -- $source
$actualSha = (Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant()
if ($actualStatus.Count -ne 0 -or $actualBranch -ne $expectedBranch -or $actualHead -ne $base -or $actualTree -ne $baseTree -or $actualBlob -ne $baseBlob -or $actualSha -ne $baseSourceSha256 -or $resolvedGitDir -ne 'G:/ggq/gg-delivery-next-independent/GraphGoblin/.git') {
  throw 'Expected clean frozen D215 author checkout on independent G object store'
}
if ((node --version) -ne 'v22.23.4' -or (pnpm.cmd --version) -ne '12.8.1') { throw 'Unexpected Node or pnpm runtime' }
if ((Test-Path -LiteralPath $ordinary) -or (Test-Path -LiteralPath $junctionPhysical) -or (Test-Path -LiteralPath $junction)) { throw 'D216 G fixture roots already exist' }
$null = New-Item -ItemType Directory -Path $ordinary, $junctionPhysical
$null = New-Item -ItemType Junction -Path $junction -Target $junctionPhysical
Copy-Item -LiteralPath $source -Destination "$evidence/fs.test.before.ts"
Save-Json '01-base-binding' @{ head=$actualHead; tree=$actualTree; gitCommonDir=$resolvedGitDir; branch=$actualBranch; status=$actualStatus; source=$source; worktreeBlob=$actualBlob; worktreeSha256=$actualSha; index=$actualIndex }
$review = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d215-fable-review-01/provider/provider-final-message.md'
$decision = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/decision-216.md'
$control = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d215-native-resolver-control-02/SHA256-MANIFEST.json'
$decisionHash = (Get-FileHash -LiteralPath $decision).Hash.ToLowerInvariant()
$reviewHash = (Get-FileHash -LiteralPath $review).Hash.ToLowerInvariant()
$controlHash = (Get-FileHash -LiteralPath $control).Hash.ToLowerInvariant()
if ($decisionHash -ne '57b1747c156f8b77115b2bd4302fe777785ea19be49a8ad956d5ea8aa073df50' -or $reviewHash -ne 'efb678287c7279d1eb5e09e65f3c6119861fc47321206035fa61ade359df86cb' -or $controlHash -ne 'de9b649d5c8bc1073f8525e65f2dd47d39f45b9482fddff775541cede0838f95') { throw 'D216 authority or counterexample hash differs' }
Save-Json '02-authority-binding' @{ decision=$decision; decisionSha256=$decisionHash; review=$review; reviewSha256=$reviewHash; uppercaseOldFailureManifest=$control; uppercaseOldFailureManifestSha256=$controlHash }
$crossRoot = "C:/Users/98jak/graphgoblin-qa/d216-small-native-temp-$([Guid]::NewGuid().ToString('N'))"
$beforeFree = (Get-PSDrive -Name C).Free
if ($beforeFree -lt 20MB -or (Test-Path -LiteralPath $crossRoot)) { throw 'Cross-volume capacity or ownership precondition failed' }
$null = New-Item -ItemType Directory -Path $crossRoot
$resolvedC = (Resolve-Path -LiteralPath $crossRoot).Path
$shortCases = 'uses real (fixed|temp|template) paths'
try {
  $shortCode = Invoke-Retained '03-short-name-native-probe-c' 'node' @("$evidence/probe.mjs", 'short-name', $resolvedC)
  if ($shortCode -ne 0) { throw 'C: 8.3 availability probe failed' }
  $short = Get-Content -LiteralPath "$evidence/03-short-name-native-probe-c.stdout" -Raw | ConvertFrom-Json
  if (!$short.available) {
    $shortPhysical = (Resolve-Path -LiteralPath $ordinary).Path
    $shortCode = Invoke-Retained '04-short-name-native-probe-g' 'node' @("$evidence/probe.mjs", 'short-name', $shortPhysical)
    if ($shortCode -ne 0) { throw 'G: 8.3 availability probe failed' }
    $short = Get-Content -LiteralPath "$evidence/04-short-name-native-probe-g.stdout" -Raw | ConvertFrom-Json
  }
  Save-Json '05-short-name-selection' @{
    available = [bool]$short.available; examined = $short.physical; tempSpelling = $short.input
    samePhysicalRoot = [bool]$short.samePhysicalRoot
  }
  if ($short.available) {
    $env:TEMP = $short.input
    $env:TMP = $env:TEMP
    $negative = Invoke-Retained '06-original-short-name-tests' 'pnpm.cmd' ($testArgs + @('-t', $shortCases))
    Confirm-CleanFixtures '07-original-short-name-cleanup' $short.physical
    $oldStdout = Get-Content -LiteralPath "$evidence/06-original-short-name-tests.stdout" -Raw
    $oldStderr = Get-Content -LiteralPath "$evidence/06-original-short-name-tests.stderr" -Raw
    Save-Json '08-original-short-name-result' @{
      exit = $negative; testSummary = ([regex]::Match($oldStdout, '(?m)^\s*Tests\s+[^\r\n]+').Value.Trim())
      executedFixedTempTemplate = ($oldStdout -match 'uses real fixed paths' -and $oldStdout -match 'uses real temp paths' -and $oldStdout -match 'uses real template paths')
      resolverAssertionObserved = ($oldStderr -match 'engine\.ports\.scripts\.calls\[0\]\?\.cwd|journal\.use\)\.toHaveBeenCalledExactlyOnceWith')
    }
  }

  $env:TEMP = $ordinary
  $env:TMP = $env:TEMP
  if ((git @gitOptions hash-object $source) -ne $baseBlob -or @(git @gitOptions status --porcelain=v1).Count -ne 0) { throw 'Frozen original modified before correction' }
  $path = (Resolve-Path -LiteralPath $source).Path
  $raw = [IO.File]::ReadAllText($path)
  $newline = if ($raw.Contains([Environment]::NewLine)) { [Environment]::NewLine } else { [string][char]10 }
  $oldTemp = "        const path = kind === 'temp' ? join(realpathSync(dataDir), 'workspaces', run.id) : target;"
  $newTemp = "        const path =" + $newline + "          kind === 'temp' ? join(realpathSync.native(dataDir), 'workspaces', run.id) : target;"
  $oldJournal = '        const actual = realpathSync(path);'
  $newJournal = '        const actual = realpathSync.native(path);'
  foreach ($needle in $oldTemp, $oldJournal) {
    if ([regex]::Matches($raw, [regex]::Escape($needle)).Count -ne 1) { throw "Could not bind exact old resolver expectation: $needle" }
  }
  $expected = $raw.Replace($oldTemp, $newTemp).Replace($oldJournal, $newJournal)
  [IO.File]::WriteAllText($path, $expected, [Text.UTF8Encoding]::new($false))
  Copy-Item -LiteralPath $source -Destination "$evidence/fs.test.after.ts"
  $delta = @(git @gitOptions diff --name-only HEAD)
  $indexDelta = @(git @gitOptions diff --cached --name-only)
  if (($delta -join ',') -ne $source -or $indexDelta.Count -ne 0) { throw 'Scope or unstaged verification failure' }
  git @gitOptions diff --check
  if ($LASTEXITCODE -ne 0) { throw 'Whitespace verification failed' }
  git @gitOptions diff --no-ext-diff --binary HEAD -- $source > "$evidence/09-worktree.patch"
  if ($LASTEXITCODE -ne 0) { throw 'Patch capture failed' }

  $upper = ((Resolve-Path -LiteralPath $ordinary).Path).ToUpperInvariant()
  $env:TEMP = $upper
  $env:TMP = $upper
  if ((Invoke-Retained '10-uppercase-resolver-probe' 'node' @("$evidence/probe.mjs", 'uppercase', $ordinary)) -ne 0) { throw 'Case-variant native probe failed' }
  $test = Invoke-Retained '11-corrected-uppercase-temp-test' 'pnpm.cmd' ($testArgs + @('-t', 'uses real temp paths'))
  Confirm-CleanFixtures '12-corrected-uppercase-cleanup' $ordinary
  Confirm-Tests '11-corrected-uppercase-temp-test' $test '1 passed \| 19 skipped \(20\)'

  if ($short.available) {
    $env:TEMP = $short.input
    $env:TMP = $env:TEMP
    $test = Invoke-Retained '13-corrected-short-name-tests' 'pnpm.cmd' ($testArgs + @('-t', $shortCases))
    Confirm-CleanFixtures '14-corrected-short-name-cleanup' $short.physical
    Confirm-Tests '13-corrected-short-name-tests' $test '3 passed \| 17 skipped \(20\)'
  }

  $env:TEMP = $resolvedC
  $env:TMP = $resolvedC
  Push-Location -LiteralPath $packageRoot
  try {
    if ((Invoke-Retained '15-cross-volume-probe' 'node' @("$evidence/probe.mjs", 'cross-volume', $resolvedC)) -ne 0) { throw 'Cross-volume probe failed' }
  } finally {
    Pop-Location
  }
  $relativeCases = 'resolves fixed, relative, and temporary directories and reuses them|uses real relative paths'
  $test = Invoke-Retained '16-corrected-cross-volume-relative-tests' 'pnpm.cmd' ($testArgs + @('-t', $relativeCases))
  Confirm-CleanFixtures '17-corrected-cross-volume-cleanup' $resolvedC
  Confirm-Tests '16-corrected-cross-volume-relative-tests' $test '2 passed \| 18 skipped \(20\)'
} finally {
  $env:TEMP = $ordinary
  $env:TMP = $ordinary
  $exact = (Resolve-Path -LiteralPath $crossRoot).Path
  if ($exact -notmatch '^C:\\Users\\98jak\\graphgoblin-qa\\d216-small-native-temp-[a-f0-9]{32}$' -or (Get-Item -LiteralPath $exact).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw "Unexpected C: fixture path $exact" }
  [IO.Directory]::Delete($exact)
  Save-Json '18-cross-volume-root-removal' @{
    path=$exact; removed=(!(Test-Path -LiteralPath $exact)); freeBeforeBytes=$beforeFree; freeAfterBytes=(Get-PSDrive -Name C).Free
  }
}

$test = Invoke-Retained '19-corrected-ordinary-fs-test' 'pnpm.cmd' $testArgs
Confirm-CleanFixtures '20-corrected-ordinary-cleanup' $ordinary
Confirm-Tests '19-corrected-ordinary-fs-test' $test '20 passed \(20\)'
$env:TEMP = $junction
$env:TMP = $junction
if ((Invoke-Retained '21-junction-resolver-probe' 'node' @("$evidence/probe.mjs", 'junction', $junctionPhysical)) -ne 0) { throw 'Junction native probe failed' }
$test = Invoke-Retained '22-corrected-junction-fs-test' 'pnpm.cmd' $testArgs
Confirm-CleanFixtures '23-corrected-junction-cleanup' $junctionPhysical
Confirm-Tests '22-corrected-junction-fs-test' $test '20 passed \(20\)'
