param([Parameter(Mandatory=$true)][string]$Checkout)
$ErrorActionPreference='Stop'
$env:GIT_OPTIONAL_LOCKS='0'
$env:PATH="$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:TURBO_TOKEN=''
$env:TURBO_TEAM=''
$expected='993d58a781ed2f0b4d13756c39e83162307b0ccd'
$tree='77f0af8c8276fba6761f3bc63bfa12a2d706ffa4'
$effectiveBase='bf9f287652a23177b87488df110dfd6147acaad0'
$main='8fadcb0d44ac2caf80ff6279fe4648ce9398afd9'
$codeRoot = $PSScriptRoot
$buildLog=Join-Path $codeRoot 'forced-build.log'
$buildResult=Join-Path $codeRoot 'forced-build-exit.json'
if((Test-Path $buildLog) -or (Test-Path $buildResult)){throw 'Keep the first build log and exit record.'}
Push-Location -LiteralPath $Checkout
try {
  $frozen=@(git rev-parse HEAD 'HEAD^{tree}' origin/main)
  if($frozen[0] -ne $expected -or $frozen[1] -ne $tree -or $frozen[2] -ne $main -or (git status --porcelain=v1)){throw 'Frozen source changed.'}
  if((node --version).Trim() -ne 'v22.23.4'){throw 'Project runtime is required.'}
  $cache=Join-Path $codeRoot 'isolated-turbo-cache'
  $startedAt=[DateTime]::UtcNow.ToString('o')
  pnpm.cmd build --force "--cache-dir=$cache" 2>&1 | Tee-Object -FilePath $buildLog
  $exitCode=$LASTEXITCODE
  $after=@(git rev-parse HEAD 'HEAD^{tree}' origin/main)
  $cleanAfter=!(git status --porcelain=v1)
  [ordered]@{
    head=$expected; tree=$tree; base=$effectiveBase; actualMain=$main; node='v22.23.4'
    exitCode=$exitCode; cleanAfter=$cleanAfter; after=$after; startedAt=$startedAt
    finishedAt=[DateTime]::UtcNow.ToString('o'); logSha256=(Get-FileHash $buildLog).Hash.ToLowerInvariant()
  } | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8NoBOM -LiteralPath $buildResult
  if($exitCode -ne 0){exit $exitCode}
  if(!$cleanAfter -or (Compare-Object $after $frozen -SyncWindow 0)){throw 'Build changed frozen checkout.'}
} finally {
  Pop-Location
}
