$ErrorActionPreference = 'Stop'
$evidenceDirectory = 'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-448-test-author-01'
$sourcePath = (Resolve-Path -LiteralPath 'apps/api/src/preflight-catalog.test.ts').Path
$candidateBytes = [IO.File]::ReadAllBytes($sourcePath)
$candidateHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllBytes((Join-Path $evidenceDirectory 'originals\candidate-before-valid-counterfactual.test.ts'), $candidateBytes)
$candidateText = [Text.Encoding]::UTF8.GetString($candidateBytes)
$start = $candidateText.IndexOf('function expectStoreUnchanged(')
$end = $candidateText.IndexOf('async function storedCatalog(', $start)
if ($start -lt 0 -or $end -lt 0) { throw 'Cannot identify exact helper boundaries' }
$oldPredicate = @'
function expectStoreUnchanged(
  dbFile: string,
  before: Record<string, Buffer>,
  after: Record<string, Buffer>,
) {
  expect(after).toEqual(before);
}

'@
$strictText = $candidateText.Substring(0, $start) + $oldPredicate + $candidateText.Substring($end)
try {
  [IO.File]::WriteAllText($sourcePath, $strictText, [Text.UTF8Encoding]::new($false))
  Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $evidenceDirectory 'originals\counterfactual-strict-valid.test.ts')
  & (Join-Path $evidenceDirectory 'driver\run-command.ps1') -Label '03-strict-counterfactual-valid' -Program 'pnpm.cmd' -ProgramArguments @('--filter','@graphgoblin/api','test','src/preflight-catalog.test.ts','-t','initially absent WAL','--reporter=verbose')
  $counterfactualExit = $LASTEXITCODE
} finally {
  [IO.File]::WriteAllBytes($sourcePath, $candidateBytes)
  $restoredHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLower()
  [pscustomobject]@{candidateSha256=$candidateHash;restoredSha256=$restoredHash;equal=($candidateHash -eq $restoredHash);counterfactualExit=$counterfactualExit;utc=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidenceDirectory 'observations\valid-counterfactual-restoration.json') -Encoding utf8
  if ($candidateHash -ne $restoredHash) { throw 'Candidate source restoration failed' }
}
if ($counterfactualExit -ne 1) { throw "Expected strict predicate to fail once; exit was $counterfactualExit" }
