<#
.SYNOPSIS
  Install GraphGoblin from this checkout: check prerequisites, install, build, create the data
  directory, and run the first-run preflight.

.DESCRIPTION
  Safe to run again: every step is idempotent. Needs no administrator rights. Exits non-zero when
  a prerequisite is missing, a step fails, or a preflight check fails.

  Run from anywhere:
    powershell -ExecutionPolicy Bypass -File scripts/install.ps1

  Environment: GG_DATA_DIR (default ~/.graphgoblin), GG_HOST, GG_PORT, and every other GG_*
  variable the server reads (docs/guide/01-install-and-first-run.md).
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$MinNodeMajor = 22
$Root = Split-Path -Parent $PSScriptRoot

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Fail([string]$Text) {
  Write-Host "error: $Text" -ForegroundColor Red
  exit 1
}

# Prefer the .cmd shims on Windows: execution policy can block the .ps1 ones.
function Resolve-Tool([string]$Name) {
  foreach ($candidate in @("$Name.cmd", $Name)) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) { return $command.Source }
  }
  return $null
}

Write-Step 'Checking Node.js'
$node = Resolve-Tool 'node'
if ($null -eq $node) { Fail "Node.js $MinNodeMajor or newer is required: https://nodejs.org/" }
$nodeVersion = (& $node --version).Trim()
$nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt $MinNodeMajor) { Fail "Node.js $nodeVersion is too old; install $MinNodeMajor or newer." }
Write-Host "    Node.js $nodeVersion"

Write-Step 'Checking pnpm'
$pnpm = Resolve-Tool 'pnpm'
if ($null -eq $pnpm) {
  Fail "pnpm is required. Enable it with 'corepack enable' (ships with Node.js), or see https://pnpm.io/installation"
}
$pnpmVersion = (& $pnpm --version | Out-String).Trim()
Write-Host "    pnpm $pnpmVersion"

Write-Step 'Checking the Codex CLI login'
$codex = Resolve-Tool 'codex'
if ($null -eq $codex) {
  Write-Host "    warning: no 'codex' on PATH. Install the Codex CLI and run 'codex login' as this user;" -ForegroundColor Yellow
  Write-Host '    the API runs turns through the CLI bundled with the SDK, which uses that login.' -ForegroundColor Yellow
} else {
  $status = ((& $codex login status 2>&1 | ForEach-Object { "$_" }) -join "`n").Trim()
  if ($LASTEXITCODE -eq 0) {
    Write-Host "    $status"
  } else {
    Write-Host "    warning: $status" -ForegroundColor Yellow
    Write-Host "    Run 'codex login' as this user before starting runs." -ForegroundColor Yellow
  }
}

Push-Location $Root
try {
  Write-Step 'Installing dependencies (pnpm install --frozen-lockfile)'
  & $pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { Fail 'pnpm install failed.' }

  Write-Step 'Building (pnpm build)'
  & $pnpm build
  if ($LASTEXITCODE -ne 0) { Fail 'pnpm build failed.' }

  $dataDir = $env:GG_DATA_DIR
  if ([string]::IsNullOrWhiteSpace($dataDir)) { $dataDir = Join-Path $HOME '.graphgoblin' }
  $dataDir = [System.IO.Path]::GetFullPath($dataDir)
  Write-Step "Creating the data directory $dataDir"
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

  Write-Step 'Running the first-run preflight'
  $previous = $env:GG_DATA_DIR
  $env:GG_DATA_DIR = $dataDir
  try {
    & $node apps/api/dist/main.js --preflight
    $preflight = $LASTEXITCODE
  } finally {
    $env:GG_DATA_DIR = $previous
  }
} finally {
  Pop-Location
}

$hostName = if ($env:GG_HOST) { $env:GG_HOST } else { '127.0.0.1' }
$port = if ($env:GG_PORT) { $env:GG_PORT } else { '4747' }
$dataHint = if ([string]::IsNullOrWhiteSpace($env:GG_DATA_DIR)) { '' } else {
  "`$env:GG_DATA_DIR = '$dataDir'; "
}

Write-Host ''
Write-Host 'Start GraphGoblin from the repository root with either of:'
Write-Host ('    ' + $dataHint + 'pnpm.cmd start')
Write-Host ('    ' + $dataHint + 'node apps/api/dist/main.js')
Write-Host "Then open http://${hostName}:${port}/app/"
Write-Host ''
Write-Host 'Requiring API keys (GG_REQUIRE_API_KEY=true)? Create the first key with:'
Write-Host '    node apps/api/dist/main.js --create-api-key <name> [--scopes a,b]'
Write-Host ''

if ($preflight -ne 0) {
  Fail 'a preflight check failed; fix it (see the table above) and run this script again.'
}
Write-Host 'Install complete.' -ForegroundColor Green
exit 0
