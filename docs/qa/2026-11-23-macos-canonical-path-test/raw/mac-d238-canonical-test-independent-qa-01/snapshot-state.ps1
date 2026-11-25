param([Parameter(Mandatory)][ValidateSet('before','after')][string]$Label)
$ErrorActionPreference = 'Stop'
$env:GIT_OPTIONAL_LOCKS = '0'
$taskRoot = 'G:\ggq\gg-mac-d238-alias-qa\GraphGoblin'
Set-Location -LiteralPath $taskRoot
$destination = Join-Path $PSScriptRoot "$Label.state.json"
if (Test-Path -LiteralPath $destination) { throw 'Snapshot already exists.' }
$files = foreach ($relative in (& git --no-optional-locks ls-files)) {
  $path = Join-Path $taskRoot $relative
  [ordered]@{path=$relative;sha256=if (Test-Path -LiteralPath $path -PathType Leaf) {(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()} else {$null}}
}
$index = & git --no-optional-locks rev-parse --path-format=absolute --git-path index
$common = & git --no-optional-locks rev-parse --path-format=absolute --git-common-dir
[ordered]@{
  utc=[DateTimeOffset]::UtcNow.ToString('o');cwd=$taskRoot
  head=(& git --no-optional-locks rev-parse HEAD);tree=(& git --no-optional-locks rev-parse 'HEAD^{tree}')
  parent=(& git --no-optional-locks rev-parse 'HEAD^')
  status=@(& git --no-optional-locks status --porcelain=v1 --untracked-files=all)
  indexPath=$index;indexSha256=(Get-FileHash -LiteralPath $index -Algorithm SHA256).Hash.ToLowerInvariant()
  orderedStagedEntries=@(& git --no-optional-locks ls-files --stage)
  sparseRules=@(& git --no-optional-locks sparse-checkout list)
  skipWorktreeEntries=@(& git --no-optional-locks ls-files -v | Where-Object {$_.StartsWith('S ')})
  commonIndexExists=(Test-Path -LiteralPath (Join-Path $common 'index'))
  trackedFiles=@($files)
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $destination -Encoding utf8NoBOM
Get-FileHash -LiteralPath $destination -Algorithm SHA256 | Format-List
