$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$task = 'G:/ggq/gg-i4-486-d215-fix'
$evidence = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d216-author-01'
$source = 'packages/infrastructure/src/fs/fs.test.ts'
$base = '6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08'
$baseTree = '34b80f155c8434abc69fc72105ae7462fc460377'
$baseBlob = '3e385dc2199c5debf41c7171e44b0ee80e8d3d7e'
$baseSourceSha256 = 'b8012a8676b26641c845b78b94f2419cd1f225ece0e8eb417874215646db9e41'
$ordinary = "$task/d216-process-temp"
$junctionPhysical = "$task/d216-junction-physical"
$junction = "$task/d216-junction-temp"
$gitOptions = @('--no-optional-locks', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0')
$testArgs = @('--filter', '@graphgoblin/infrastructure', 'test', 'src/fs/fs.test.ts', '--reporter=verbose')
$workspaceRoot = "$task/GraphGoblin"
$packageRoot = "$workspaceRoot/packages/infrastructure"
Set-Location -LiteralPath $workspaceRoot
$env:Path = 'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;' + $env:Path
$env:TEMP = $ordinary
$env:TMP = $env:TEMP

function Save-Json {
  param([string]$Name, $Object)
  $path = "$evidence/$Name.json"
  if (Test-Path -LiteralPath $path) { throw "Evidence already exists: $path" }
  ConvertTo-Json -InputObject $Object -Depth 7 | Set-Content -LiteralPath $path -Encoding utf8NoBOM
}

function Invoke-Retained {
  param([string]$Name, [string]$Executable, [string[]]$Arguments)
  $prefix = "$evidence/$Name"
  if (Test-Path -LiteralPath "$prefix.json") { throw "Evidence already exists: $prefix" }
  $receipt = [ordered]@{
    utc = (Get-Date).ToUniversalTime().ToString('o')
    cwd = (Get-Location).Path; executable = $Executable; args = @($Arguments)
    TEMP = $env:TEMP; TMP = $env:TMP; node = (node --version)
    head = (git @gitOptions rev-parse HEAD); tree = (git @gitOptions rev-parse 'HEAD^{tree}')
    indexBlob = (git @gitOptions rev-parse ":$source")
    worktreeBlob = (git @gitOptions hash-object "$workspaceRoot/$source")
    worktreeSha256 = (Get-FileHash -LiteralPath "$workspaceRoot/$source").Hash.ToLowerInvariant()
  }
  & $Executable @Arguments > "$prefix.stdout" 2> "$prefix.stderr"
  $exit = $LASTEXITCODE
  $receipt.exit = $exit
  Save-Json $Name $receipt
  "exit=$exit $Name" | Out-Host
  return $exit
}

function Confirm-CleanFixtures {
  param([string]$Name, [string]$TempRoot)
  $temp = @(Get-ChildItem -LiteralPath $TempRoot -Force -Filter 'gg-wp-e3-*')
  $relative = @(Get-ChildItem -LiteralPath $packageRoot -Force -Filter 'gg-wp-relative-*')
  $topRelative = @(Get-ChildItem -LiteralPath $workspaceRoot -Force -Filter 'gg-wp-relative-*')
  Save-Json $Name @{
    tempRoot = $TempRoot
    tempFixtures = @($temp.Name)
    packageRelativeFixtures = @($relative.Name)
    repoRelativeFixtures = @($topRelative.Name)
  }
  if (($temp.Count + $relative.Count + $topRelative.Count) -ne 0) { throw "Temporary fixture residue under $TempRoot or the checkout" }
}

function Confirm-Tests {
  param([string]$Name, [int]$ExitCode, [string]$ExpectedSummary)
  $log = Get-Content -LiteralPath "$evidence/$Name.stdout" -Raw
  if ($ExitCode -ne 0 -or $log -notmatch "(?m)Tests\s+$ExpectedSummary") {
    throw "Unexpected test result in $Name (exit $ExitCode)"
  }
}

