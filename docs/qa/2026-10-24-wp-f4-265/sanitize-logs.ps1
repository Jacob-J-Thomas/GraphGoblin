param([string[]] $Exclude = @())

$ErrorActionPreference = 'Stop'
# These are normalized terminal captures, not byte-preserving provider/event evidence.
# Do not apply this script to the adjacent raw JSON, JSONL or source captures.
$qaRoot = $PSScriptRoot
# The sandbox process account can differ from the workspace owner's environment.
$profileRoot = $env:USERPROFILE
$profileTail = $profileRoot.Substring($profileRoot.IndexOf('\'))
$variants = @(
  $profileRoot.Replace('\', '\\'),
  $profileRoot.Replace('\', '/'),
  $profileRoot,
  $profileTail.Replace('\', '\\'),
  $profileTail.Replace('\', '/'),
  $profileTail
) | Select-Object -Unique
foreach ($capture in Get-ChildItem -LiteralPath $qaRoot -Filter '*.log.txt' -File) {
  if ($Exclude -contains $capture.Name) { continue }
  $normalized = [IO.File]::ReadAllText($capture.FullName)
  foreach ($variant in $variants) {
    $normalized = $normalized.Replace($variant, '%USERPROFILE%')
  }
  if ($env:COMPUTERNAME) {
    $normalized = $normalized.Replace($env:COMPUTERNAME, '%COMPUTERNAME%')
  }
  [IO.File]::WriteAllText($capture.FullName, $normalized, [Text.UTF8Encoding]::new($false))
}
