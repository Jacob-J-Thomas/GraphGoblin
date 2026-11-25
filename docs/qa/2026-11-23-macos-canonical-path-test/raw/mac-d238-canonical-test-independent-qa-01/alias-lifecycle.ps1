param([Parameter(Mandatory)][ValidateSet('Create','Cleanup')][string]$Operation)
$ErrorActionPreference = 'Stop'
$identityPath = Join-Path $PSScriptRoot 'ALIAS.json'
function Inspect-Alias($identity) {
  $root = [IO.Path]::GetFullPath($identity.root)
  $expectedBase = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'scratch')) + [IO.Path]::DirectorySeparatorChar
  if (-not $root.StartsWith($expectedBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Owned root escaped evidence scratch.' }
  if ((Split-Path -Leaf $root) -notmatch '^run-[0-9a-f]{32}$') { throw 'Unexpected owned root name.' }
  $target = [IO.Path]::GetFullPath($identity.target)
  $alias = [IO.Path]::GetFullPath($identity.alias)
  if ($target -cne (Join-Path $root 'physical') -or $alias -cne (Join-Path $root 'alias')) { throw 'Unexpected alias/target paths.' }
  foreach ($directory in @($root,$target)) { if ((Get-Item -LiteralPath $directory -Force).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Owned physical directory was replaced by a reparse point.' } }
  $link = Get-Item -LiteralPath $alias -Force
  $resolved = [IO.DirectoryInfo]::new($alias).ResolveLinkTarget($true).FullName
  if ($link.LinkType -ne 'Junction' -or -not $resolved.Equals($target, [StringComparison]::OrdinalIgnoreCase)) { throw 'Junction identity/target changed.' }
  [ordered]@{utc=[DateTimeOffset]::UtcNow.ToString('o');root=$root;target=$target;alias=$alias;linkType=$link.LinkType;resolvedTarget=$resolved}
}
if ($Operation -eq 'Create') {
  if (Test-Path -LiteralPath $identityPath) { throw 'Refusing to replace alias identity.' }
  $root = Join-Path $PSScriptRoot ('scratch/run-' + [Guid]::NewGuid().ToString('N'))
  $target = Join-Path $root 'physical'
  $alias = Join-Path $root 'alias'
  New-Item -ItemType Directory -Path $target | Out-Null
  New-Item -ItemType Junction -Path $alias -Target $target | Out-Null
  $identity = Inspect-Alias ([pscustomobject]@{root=$root;target=$target;alias=$alias})
  $identity | ConvertTo-Json | Set-Content -LiteralPath $identityPath -Encoding utf8NoBOM
  $identity | ConvertTo-Json
} else {
  $identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
  $before = Inspect-Alias $identity
  foreach ($stage in @('parent-negative','corrected-positive')) {
    $witness = Get-Content -LiteralPath (Join-Path $PSScriptRoot "$stage.worker.json") -Raw | ConvertFrom-Json
    if (-not $witness.allChildrenClosed -or -not $witness.allFixtureDirectoriesAbsent) { throw "Owned resource closure failed for $stage" }
  }
  $before | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'cleanup-before.json') -Encoding utf8NoBOM
  [IO.Directory]::Delete($identity.alias, $false)
  if ((Test-Path -LiteralPath $identity.alias) -or -not (Test-Path -LiteralPath $identity.target)) { throw 'Nonrecursive junction removal did not preserve physical target.' }
  $root = [IO.Path]::GetFullPath($identity.root)
  $target = [IO.Path]::GetFullPath($identity.target)
  if ($target -cne (Join-Path $root 'physical') -or (Get-Item -LiteralPath $target).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Refusing unchecked physical cleanup.' }
  if (@(Get-ChildItem -LiteralPath $target -Recurse -Force -Attributes ReparsePoint).Count) { throw 'Unexpected reparse point in owned physical sandbox.' }
  Remove-Item -LiteralPath $target -Recurse -Force
  [IO.Directory]::Delete($root, $false)
  [ordered]@{utc=[DateTimeOffset]::UtcNow.ToString('o');aliasAbsent=(-not (Test-Path -LiteralPath $identity.alias));targetAbsent=(-not (Test-Path -LiteralPath $target));rootAbsent=(-not (Test-Path -LiteralPath $root));nonrecursiveJunctionRemoval=$true;bothWorkerClosuresVerified=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'CLEANUP.json') -Encoding utf8NoBOM
  Get-Content -LiteralPath (Join-Path $PSScriptRoot 'CLEANUP.json')
}
