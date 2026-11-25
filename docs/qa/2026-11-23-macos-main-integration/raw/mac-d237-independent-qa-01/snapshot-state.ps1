param([Parameter(Mandatory)][ValidateSet('before','after')][string]$Label)
$ErrorActionPreference = 'Stop'
$taskRoot = 'G:\ggq\gg-mac-d237-qa\GraphGoblin'
$env:GIT_OPTIONAL_LOCKS = '0'
Set-Location -LiteralPath $taskRoot
$destination = Join-Path $PSScriptRoot "$Label.state.json"
if (Test-Path -LiteralPath $destination) { throw "Refusing to overwrite $destination" }
$paths = & git --no-optional-locks ls-files
if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed' }
$tracked = foreach ($relative in $paths) {
  $path = Join-Path $taskRoot $relative
  [ordered]@{ path = $relative; sha256 = if (Test-Path -LiteralPath $path -PathType Leaf) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null } }
}
$indexPath = & git --no-optional-locks rev-parse --path-format=absolute --git-path index
$commonPath = & git --no-optional-locks rev-parse --path-format=absolute --git-common-dir
$staged = & git --no-optional-locks ls-files --stage
[ordered]@{
  utc = [DateTimeOffset]::UtcNow.ToString('o'); cwd = $taskRoot
  head = (& git --no-optional-locks rev-parse HEAD)
  tree = (& git --no-optional-locks rev-parse 'HEAD^{tree}')
  status = @(& git --no-optional-locks status --porcelain=v1 --untracked-files=all)
  indexPath = $indexPath
  indexSha256 = (Get-FileHash -LiteralPath $indexPath -Algorithm SHA256).Hash.ToLowerInvariant()
  orderedStagedEntries = @($staged)
  commonIndexPath = Join-Path $commonPath 'index'
  commonIndexExists = Test-Path -LiteralPath (Join-Path $commonPath 'index')
  trackedFiles = @($tracked)
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $destination -Encoding utf8NoBOM
Get-FileHash -LiteralPath $destination -Algorithm SHA256 | Format-List

