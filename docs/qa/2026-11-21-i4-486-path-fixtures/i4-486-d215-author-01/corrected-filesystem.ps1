. 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d215-author-01/verification-environment.ps1'
$ordinary = Invoke-RetainedStep '24-corrected-ordinary-fs-suite' 'pnpm.cmd' @('--filter', '@graphgoblin/infrastructure', 'test', 'src/fs', '--reporter=verbose')
Assert-TestCleanup $baselineTemp 6>&1 | Tee-Object -FilePath "$evidence/25-corrected-ordinary-cleanup.log"
if ($ordinary -ne 0) { throw "Ordinary filesystem suite exited $ordinary" }

$env:TEMP = "$task/junction-temp"
$env:TMP = $env:TEMP
$junction = Invoke-RetainedStep '26-corrected-junction-fs-suite' 'pnpm.cmd' @('--filter', '@graphgoblin/infrastructure', 'test', 'src/fs', '--reporter=verbose')
Assert-TestCleanup "$task/junction-physical" 6>&1 | Tee-Object -FilePath "$evidence/27-corrected-junction-cleanup.log"
if ($junction -ne 0) { throw "Junction filesystem suite exited $junction" }

$crossParent = 'C:/Users/98jak/graphgoblin-qa'
$crossTemp = "$crossParent/d215-small-native-temp-$([Guid]::NewGuid().ToString('N'))"
$freeBefore = (Get-PSDrive -Name C).Free
if ($freeBefore -lt 20MB -or (Test-Path -LiteralPath $crossTemp)) { throw 'Cross-volume fixture capacity or path check failed' }
$null = New-Item -ItemType Directory -Path $crossTemp
$env:TEMP = $crossTemp
$env:TMP = $crossTemp
try {
  $probe = 'const os = require("node:os"); const path = require("node:path"); const cwd = process.cwd(); const temp = os.tmpdir(); const originalFixture = path.relative(cwd, path.join(temp, "gg-wp-e3-control", "relative")); const correctedFixture = path.relative(cwd, path.join(cwd, "gg-wp-relative-control", "workspace")); const roots = [path.parse(cwd).root, path.parse(path.resolve(temp)).root]; console.log(JSON.stringify({ cwd, temp, roots, originalFixture, originalIsAbsolute: path.isAbsolute(originalFixture), correctedFixture, correctedIsAbsolute: path.isAbsolute(correctedFixture) })); if (process.platform !== "win32" || roots[0] === roots[1] || !path.isAbsolute(originalFixture) || path.isAbsolute(correctedFixture)) process.exit(1);'
  Push-Location -LiteralPath "$task/GraphGoblin/packages/infrastructure"
  try {
    if ((Invoke-RetainedStep '28-cross-volume-native-probe' 'node' @('-e', $probe)) -ne 0) { throw 'Cross-volume native probe failed' }
  } finally {
    Pop-Location
  }
  $crossCases = 'resolves fixed, relative, and temporary directories and reuses them|uses real relative paths'
  $cross = Invoke-RetainedStep '29-corrected-cross-volume-relative-tests' 'pnpm.cmd' ($testArgs + @('--reporter=verbose', '-t', $crossCases))
  Assert-TestCleanup $crossTemp 6>&1 | Tee-Object -FilePath "$evidence/30-corrected-cross-volume-cleanup.log"
  if ($cross -ne 0) { throw "Cross-volume tests exited $cross" }
  $crossLog = Get-Content -LiteralPath "$evidence/29-corrected-cross-volume-relative-tests.log" -Raw
  if ($crossLog -notmatch '(?m)Tests\s+2 passed \| 18 skipped') { throw 'Expected both cross-volume cases to execute' }
} finally {
  $env:TEMP = $baselineTemp
  $env:TMP = $baselineTemp
  $exact = (Resolve-Path -LiteralPath $crossTemp).Path
  if ($exact -notmatch '^C:\\Users\\98jak\\graphgoblin-qa\\d215-small-native-temp-[a-f0-9]{32}$' -or (Get-Item -LiteralPath $exact).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw "Unexpected fixture path $exact" }
  [IO.Directory]::Delete($exact)
  "path=$exact removed=$(!(Test-Path -LiteralPath $exact)) freeBeforeBytes=$freeBefore freeAfterBytes=$((Get-PSDrive -Name C).Free)" | Tee-Object -FilePath "$evidence/30-corrected-cross-volume-cleanup.log" -Append
}
