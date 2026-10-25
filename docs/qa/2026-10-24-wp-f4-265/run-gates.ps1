$ErrorActionPreference = 'Continue'
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$env:LIVE = '0'
$env:LIVE_CLAUDE = '0'
$env:PERF = '0'
$env:GG_TEST_PORT_START = '5990'
$env:GG_TEST_PORT_COUNT = '10'
$env:GG_TEST_STORE_PREFIX = 'gg-wp-f4-265-'
$env:TURBO_CACHE_DIR = Join-Path (Get-Location) '.turbo/wp-f4-265-cache'
$evidenceRoot = Join-Path (Get-Location) 'docs/qa/2026-10-24-wp-f4-265'
$gates = @(
  @{ name='docs-generate'; args=@('docs:generate') },
  @{ name='typecheck'; args=@('typecheck') },
  @{ name='lint'; args=@('lint') },
  @{ name='format-check'; args=@('format:check') },
  @{ name='layers'; args=@('check:layers') },
  @{ name='deps'; args=@('check:deps') },
  @{ name='docs'; args=@('check:docs') },
  @{ name='migrations'; args=@('check:migrations') },
  @{ name='tokens'; args=@('check:tokens') },
  @{ name='engine-coverage'; args=@('--filter','@graphgoblin/engine','test:coverage','--maxWorkers=2') },
  @{ name='api-coverage'; args=@('--filter','@graphgoblin/api','test:coverage','--maxWorkers=2') },
  @{ name='web-coverage'; args=@('--filter','@graphgoblin/web','test:coverage','--maxWorkers=2') },
  @{ name='codex-coverage'; args=@('--filter','@graphgoblin/adapter-codex','test:coverage','--maxWorkers=2') },
  @{ name='contracts-coverage'; args=@('--filter','@graphgoblin/contracts','test:coverage','--maxWorkers=2') },
  @{ name='client-coverage'; args=@('--filter','@graphgoblin/api-client','test:coverage','--maxWorkers=2') },
  @{ name='build'; args=@('build') }
)
$results = @()
foreach ($gate in $gates) {
  $gateArgs = $gate.args
  Write-Output ('Running pnpm ' + ($gateArgs -join ' '))
  $startedAt = Get-Date
  & pnpm.cmd @gateArgs 2>&1 | ForEach-Object { "$($_)".Replace($env:USERPROFILE,'%USERPROFILE%') } | Tee-Object -FilePath (Join-Path $evidenceRoot ($gate.name + '.log.txt')) | Out-Null
  $gateExit = $LASTEXITCODE
  $result = [ordered]@{ command=('pnpm ' + ($gateArgs -join ' ')); exitCode=$gateExit; elapsedSeconds=[math]::Round(((Get-Date)-$startedAt).TotalSeconds,2); log=($gate.name+'.log.txt') }
  $results += $result
  $results | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $evidenceRoot 'gates.json') -Encoding utf8
  $result | ConvertTo-Json -Compress
}
node --version
