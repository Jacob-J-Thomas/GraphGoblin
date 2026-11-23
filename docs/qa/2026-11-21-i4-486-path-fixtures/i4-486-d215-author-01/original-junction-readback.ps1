. 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d215-author-01/verification-environment.ps1' junction
$failure = Get-Content -LiteralPath "$evidence/20-original-junction-negative.log" -Raw
$expected = [regex]::Match($failure, '(?m)^Expected: "(?<path>[^"]+)"')
$received = [regex]::Match($failure, '(?m)^Received: "(?<path>[^"]+)"')
$exitMatch = $failure -match '(?m)^exit=1\r?$'
$testFailure = $failure -match '(?m)Tests\s+1 failed \| 19 skipped'
$firstAssertion = $failure -match 'fs\.test\.ts:141:52' -and $failure -match 'expect\(engine\.ports\.scripts\.calls\[0\]\?\.cwd\)\.toBe\(path\)'
if (!$expected.Success -or !$received.Success -or $expected.Groups['path'].Value -notlike '*junction-temp\gg-wp-e3-*\workspaces\*' -or $received.Groups['path'].Value -cne $expected.Groups['path'].Value.Replace('junction-temp', 'junction-physical') -or !$exitMatch -or !$testFailure -or !$firstAssertion) {
  throw 'Original negative control full-line readback failed'
}
@(
  'The first wrapper exited 1 at original-junction.ps1:18 with Unexpected negative control result 1.'
  'Vitest truncated both paths in the AssertionError summary. The original process log has complete Expected and Received lines and its own exit code.'
  'Verified original test exit 1, one failed and 19 skipped, exact first assertion line and physical versus configured path.'
  "expected=$($expected.Groups['path'].Value)"
  "received=$($received.Groups['path'].Value)"
) | Tee-Object -FilePath "$evidence/21-original-junction-readback.log"
Assert-TestCleanup "$task/junction-physical" 6>&1 | Tee-Object -FilePath "$evidence/22-original-junction-cleanup.log"
