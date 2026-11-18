[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('baseline', 'candidate')]
  [string] $Phase
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$checkout = 'C:\Users\98jak\.codex\worktrees\gg-20261117-entry-495\GraphGoblin'
$evidence = $PSScriptRoot
$records = Join-Path $evidence $Phase
$alias = Join-Path $evidence 'a'
$doc = Join-Path $checkout 'docs/reference/api.md'
$stray = Join-Path $checkout 'packages/infrastructure/drizzle/9999_issue_495_stray.sql'
if ((Test-Path -LiteralPath $records) -or (Test-Path -LiteralPath $alias) -or (Test-Path -LiteralPath $stray)) {
  throw 'Evidence or fixture path already exists'
}
New-Item -ItemType Directory -Path $records | Out-Null
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
$pathTrace = [Uri]::new((Join-Path $evidence 'trace-entry.mjs')).AbsoluteUri
$previousNodeOptions = $env:NODE_OPTIONS
$previousPathLog = $env:GG_495_PATH_LOG
$original = [System.IO.File]::ReadAllBytes($doc)
$raw = Join-Path $records 'raw.json'
Set-Content -LiteralPath $raw -Value '{"schema":2,"workload":"readiness","cases":[{"cli":{"wallMs":1,"exitCode":0,"stdout":"ok Database reachable and migrated"}}]}'
$malformed = Join-Path $records 'malformed.json'
Set-Content -LiteralPath $malformed -Value '{"invalid":'

$tracked = @(
  'package.json', 'tooling/scripts/gen-docs.mjs', 'tooling/scripts/check-migrations.mjs',
  'tooling/perf/summary.mjs', 'docs/reference/api.md',
  'packages/infrastructure/drizzle/meta/_journal.json', 'pnpm-lock.yaml'
)
Push-Location -LiteralPath $checkout
try {
  @{
    head = git rev-parse HEAD
    status = @(git status --porcelain=v1)
    recordedAtUtc = [DateTime]::UtcNow.ToString('o')
    pwsh = $PSVersionTable.PSVersion.ToString()
    windows = $PSVersionTable.OS
    node = node --version
    pnpm = pnpm.cmd --version
    pnpmPath = (Get-Command pnpm.cmd).Source
    root = $checkout
    junction = $alias
    hashes = @($tracked | ForEach-Object {
      $hash = Get-FileHash -LiteralPath $_
      @{file = $_; sha256 = $hash.Hash.ToLowerInvariant()}
    })
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $records 'provenance.json')
} finally { Pop-Location }

function Invoke-Case {
  param([string] $Place, [string] $Name, [string] $Exe, [string[]] $CliArgs)
  if ($Place -eq 'alias') { $where = $alias } else { $where = $checkout }
  $stem = Join-Path $records "$Place-$Name"
  Push-Location -LiteralPath $where
  try {
    & $Exe @CliArgs *> "$stem.log"
    $code = $LASTEXITCODE
    @{
      cwd = $where
      executable = $Exe
      args = $CliArgs
      exit = $code
      startedUsingTrace = ($null -ne $env:GG_495_PATH_LOG)
    } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath "$stem.json"
    "$Place $Name exit $code"
  } finally { Pop-Location }
}

New-Item -ItemType Junction -Path $alias -Target $checkout | Out-Null
try {
  foreach ($place in 'real', 'alias') {
    Invoke-Case $place 'pnpm-docs-clean' pnpm.cmd @('check:docs')
    Invoke-Case $place 'pnpm-migrations-clean' pnpm.cmd @('check:migrations')
    $generatedDir = Join-Path $records "$place-reference"
    Invoke-Case $place 'pnpm-docs-generate' pnpm.cmd @('docs:generate', '--output', $generatedDir)
    $summary = Join-Path $records "$place-summary.json"
    Invoke-Case $place 'node-summary-valid' node @('tooling/perf/summary.mjs', "--out=$summary", $raw)
    if (Test-Path -LiteralPath $summary) {
      $summaryValue = Get-Content -Raw -LiteralPath $summary | ConvertFrom-Json
      "  summary exists; databaseReady=$($summaryValue.cases[0].preflight.databaseReady)"
    } else { '  summary missing' }
  }

  [System.IO.File]::WriteAllText($doc, "# Deliberately stale #495 reference fixture" + [Environment]::NewLine)
  [System.IO.File]::WriteAllText($stray, "-- Deliberately unjournalled #495 fixture" + [Environment]::NewLine)
  Get-FileHash -LiteralPath $doc,$stray | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $records 'negative-inputs.json')
  foreach ($place in 'real', 'alias') {
    Invoke-Case $place 'pnpm-docs-stale' pnpm.cmd @('check:docs')
    Invoke-Case $place 'pnpm-migrations-stray' pnpm.cmd @('check:migrations')
    Invoke-Case $place 'node-docs-stale' node @('tooling/scripts/gen-docs.mjs', '--check')
    Invoke-Case $place 'node-migrations-stray' node @('tooling/scripts/check-migrations.mjs')
    $badOut = Join-Path $records "$place-bad-out.json"
    Invoke-Case $place 'node-summary-malformed' node @('tooling/perf/summary.mjs', "--out=$badOut", $malformed)
  }

  # Trace the actual guarded script processes separately from the uninstrumented runs above.
  $env:NODE_OPTIONS = "$previousNodeOptions --import=$pathTrace".Trim()
  foreach ($place in 'real', 'alias') {
    $env:GG_495_PATH_LOG = Join-Path $records "$place-entry-trace.jsonl"
    Invoke-Case $place 'trace-pnpm-docs-stale' pnpm.cmd @('check:docs')
    Invoke-Case $place 'trace-pnpm-migrations-stray' pnpm.cmd @('check:migrations')
    Invoke-Case $place 'trace-node-docs-stale' node @('tooling/scripts/gen-docs.mjs', '--check')
    Invoke-Case $place 'trace-node-migrations-stray' node @('tooling/scripts/check-migrations.mjs')
    Invoke-Case $place 'trace-node-summary-malformed' node @('tooling/perf/summary.mjs', "--out=$badOut", $malformed)
  }
} finally {
  $env:NODE_OPTIONS = $previousNodeOptions
  $env:GG_495_PATH_LOG = $previousPathLog
  [System.IO.File]::WriteAllBytes($doc, $original)
  [System.IO.File]::Delete($stray)
  $junction = Get-Item -LiteralPath $alias
  if ($junction.LinkType -ne 'Junction' -or $junction.FullName -ne $alias -or $junction.Target -ne $checkout) {
    throw "Unexpected junction identity: $($junction.FullName) -> $($junction.Target)"
  }
  [System.IO.Directory]::Delete($alias, $false)
  @{
    docSha256After = (Get-FileHash -LiteralPath $doc).Hash.ToLowerInvariant()
    strayPresent = Test-Path -LiteralPath $stray
    junctionPresent = Test-Path -LiteralPath $alias
    checkoutPresent = Test-Path -LiteralPath $checkout
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $records 'cleanup.json')
}
