param([Parameter(Mandatory=$true)][string]$EvidenceRoot)
$ErrorActionPreference = 'Stop'
$evidence = (Resolve-Path -LiteralPath $EvidenceRoot).Path
$source = Get-Content -Raw -LiteralPath (Join-Path $evidence 'exact-source-admission.json') | ConvertFrom-Json
$env:GIT_OPTIONAL_LOCKS='0'
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$env:TURBO_TOKEN=''
$env:TURBO_TEAM=''
$identity=@(git rev-parse HEAD 'HEAD^{tree}' origin/main)
if($identity[0] -ne $source.head -or $identity[1] -ne $source.tree -or $identity[2] -ne $source.base){ throw 'Frozen source changed' }
if((git status --porcelain=v1)) { throw 'Checkout is not clean' }
$node=(node --version).Trim()
if($node -ne 'v22.23.4'){ throw 'Unsupported project runtime for this evidence run' }
$log=Join-Path $evidence 'forced-build.log'
$result=Join-Path $evidence 'forced-build-exit.json'
if((Test-Path -LiteralPath $log) -or (Test-Path -LiteralPath $result)){ throw 'Preserve first build evidence' }
$cache=Join-Path $evidence 'isolated-final-turbo-cache'
$began=[DateTime]::UtcNow.ToString('o')
pnpm.cmd build --force "--cache-dir=$cache" 2>&1 | Tee-Object -FilePath $log
$code=$LASTEXITCODE
$finished=[DateTime]::UtcNow.ToString('o')
$headNow=@(git rev-parse HEAD 'HEAD^{tree}' origin/main)
$clean=!(git status --porcelain=v1)
$sha=(Get-FileHash -LiteralPath $log).Hash.ToLowerInvariant()
[ordered]@{head=$identity[0];tree=$identity[1];base=$identity[2];after=$headNow;node=$node;exitCode=$code;
  startedAt=$began;finishedAt=$finished;cache=$cache;cleanAfter=$clean;logSha256=$sha} |
  ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8NoBOM -LiteralPath $result
if($code -ne 0) { exit $code }
if(!$clean -or (Compare-Object $identity $headNow -SyncWindow 0)) { throw 'Build did not preserve frozen checkout' }
