[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Checkout,
    [Parameter(Mandatory)][string]$Node,
    [Parameter(Mandatory)][string]$Source,
    [string]$Evidence = 'ps7-smoke-owned',
    [switch]$Relative
)
$ErrorActionPreference = 'Stop'
$root = (New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot $Evidence)).FullName
$store = (New-Item -ItemType Directory -Path (Join-Path $root 'store')).FullName
$installer = Join-Path $Checkout 'scripts/install-windows-launcher.ps1'
$sourceHash = (Get-FileHash -LiteralPath $Source).Hash
$options = @{
    RepoPath = $Checkout
    NodePath = $Node
    DataDir = $store
    Port = 4830
    PwaShortcut = $Source
    InstallDir = Join-Path $root 'Install alpha'
    DesktopShortcut = Join-Path $root 'Desktop/GraphGoblin.lnk'
    StartMenuShortcut = Join-Path $root 'Programs/GraphGoblin.lnk'
    Environment = @{ GG_LOG_LEVEL = 'info' }
}
if ($Relative) {
    Set-Location -LiteralPath $root
    $options.NodePath = Resolve-Path -LiteralPath $Node -Relative
    $options.PwaShortcut = Resolve-Path -LiteralPath $Source -Relative
}
& $installer @options
$paths = @($options.DesktopShortcut, $options.StartMenuShortcut)
$before = @($paths | ForEach-Object { (Get-FileHash -LiteralPath $_).Hash })
$options['NoShortcuts'] = $true
$options.Environment.GG_LOG_LEVEL = 'warn'
& $installer @options
$after = @($paths | ForEach-Object { (Get-FileHash -LiteralPath $_).Hash })
$config = Get-Content -LiteralPath (Join-Path $options.InstallDir 'GraphGoblin.exe.json') -Raw | ConvertFrom-Json
if (Compare-Object $before $after) { throw 'NoShortcuts changed the installed links.' }
if ($config.Environment.GG_LOG_LEVEL -cne 'warn' -or $sourceHash -cne (Get-FileHash -LiteralPath $Source).Hash -or
    @(Get-ChildItem -LiteralPath $store -Force).Count -ne 0 -or
    @(Get-ChildItem -LiteralPath $root -Recurse -Directory -Filter 'gg-launcher-stage-*').Count -ne 0) {
    throw 'Unexpected installed configuration, PWA source, store or staging state.'
}
[ordered]@{ edition = $PSVersionTable.PSVersion.ToString(); status = 'first-and-replacement-installed';
    linkHashes = $after; preservedSource = $sourceHash; observedLogLevel = $config.Environment.GG_LOG_LEVEL } |
    ConvertTo-Json
