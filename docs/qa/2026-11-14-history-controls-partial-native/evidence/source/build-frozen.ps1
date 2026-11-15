param([Parameter(Mandatory=$true)][string]$AdmissionFile)
$ErrorActionPreference = 'Stop'
$packet = $PSScriptRoot
$admissionPath = (Resolve-Path -LiteralPath $AdmissionFile).Path
$admission = Get-Content -Raw -LiteralPath $admissionPath | ConvertFrom-Json
if ($admission.status -ne 'authorized' -or -not $admission.buildGrant) { throw 'Requires exact root build authorization' }
$env:GIT_OPTIONAL_LOCKS = '0'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:TURBO_TOKEN = ''
$env:TURBO_TEAM = ''
$log = Join-Path $packet 'forced-build.log'
$result = Join-Path $packet 'forced-build-exit.json'
if ((Test-Path -LiteralPath $log) -or (Test-Path -LiteralPath $result)) { throw 'Preserve first build evidence' }
node (Join-Path $packet 'verify-binding.mjs') $admissionPath source
if ($LASTEXITCODE -ne 0) { throw 'Source admission failed' }
Push-Location -LiteralPath $admission.checkout
try {
  $node = (node --version).Trim()
  if ($node -ne 'v22.23.4') { throw 'Unexpected Node runtime' }
  $cache = Join-Path $packet 'isolated-turbo-cache'
  $started = [DateTime]::UtcNow.ToString('o')
  pnpm.cmd build --force "--cache-dir=$cache" 2>&1 | Tee-Object -FilePath $log
  $code = $LASTEXITCODE
  $finished = [DateTime]::UtcNow.ToString('o')
  $after = @(git rev-parse HEAD 'HEAD^{tree}' origin/main)
  $clean = !(git status --porcelain=v1 --untracked-files=all)
  [ordered]@{ head = $admission.head; tree = $admission.tree; actualMain = $admission.actualMain;
    after = $after; node = $node; exitCode = $code; startedAt = $started; finishedAt = $finished;
    cleanAfter = $clean; logSha256 = (Get-FileHash -LiteralPath $log).Hash.ToLowerInvariant() } |
    ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8NoBOM -LiteralPath $result
  if ($code -ne 0) { exit $code }
  if (!$clean -or (Compare-Object @($admission.head,$admission.tree,$admission.actualMain) $after -SyncWindow 0)) {
    throw 'Build identity changed'
  }
} finally {
  Pop-Location
}
node (Join-Path $packet 'verify-binding.mjs') $admissionPath before
exit $LASTEXITCODE
