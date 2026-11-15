param(
  [Parameter(Mandatory=$true)][string]$AdmissionPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$AdmissionSha256
)
$ErrorActionPreference='Stop'
$env:GIT_OPTIONAL_LOCKS='0'
$env:PATH="$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:TURBO_TOKEN=''
$env:TURBO_TEAM=''
$literal=(Resolve-Path -LiteralPath $AdmissionPath).Path
$runner=Join-Path $PSScriptRoot 'corrected-native.mjs'
node $runner before $literal $AdmissionSha256
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$admission=Get-Content -Raw -LiteralPath $literal | ConvertFrom-Json
$candidate=$admission.candidate
$root=(Resolve-Path -LiteralPath $candidate.evidenceRoot).Path
$log=Join-Path $root 'forced-build.log'
$receipt=Join-Path $root 'forced-build-exit.json'
if((Test-Path $log) -or (Test-Path $receipt)){throw 'Preserve first build evidence'}
Push-Location -LiteralPath $candidate.checkout
try {
  $frozen=@(git rev-parse HEAD 'HEAD^{tree}' origin/main)
  if($frozen[0] -ne $candidate.head -or $frozen[1] -ne $candidate.tree -or $frozen[2] -ne $candidate.actualMain -or (git status --porcelain=v1)){throw 'Frozen source changed'}
  $runtime=(node --version).Trim()
  if($runtime -ne 'v22.23.4'){throw 'Exact project Node 22 runtime required'}
  $cache=Join-Path $root 'isolated-turbo-cache'
  $startedAt=[DateTime]::UtcNow.ToString('o')
  pnpm.cmd build --force "--cache-dir=$cache" 2>&1 | Tee-Object -FilePath $log
  $code=$LASTEXITCODE
  $after=@(git rev-parse HEAD 'HEAD^{tree}' origin/main)
  $cleanAfter=!(git status --porcelain=v1)
  [ordered]@{
    head=$candidate.head; tree=$candidate.tree; base=$candidate.target; actualMain=$candidate.actualMain; node=$runtime
    exitCode=$code; cleanAfter=$cleanAfter; after=$after; startedAt=$startedAt
    finishedAt=[DateTime]::UtcNow.ToString('o'); logSha256=(Get-FileHash $log).Hash.ToLowerInvariant()
  } | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8NoBOM -LiteralPath $receipt
  if($code -ne 0){exit $code}
  if(!$cleanAfter -or (Compare-Object $after $frozen -SyncWindow 0)){throw 'Build changed frozen source'}
  node $runner admit $literal $AdmissionSha256
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
