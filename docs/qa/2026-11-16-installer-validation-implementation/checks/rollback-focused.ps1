[CmdletBinding()]
param([Parameter(Mandatory)][string]$Installer, [string]$Evidence = 'rollback-focused-owned')
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'The bound production installer did not parse.' }
$functions = @('Initialize-InstallerPaths','Get-InstallerPath','Get-InstallerDigest','Test-InstallerFile','Publish-LauncherArtifacts')
foreach ($name in $functions) {
    $fn = $ast.Find({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
    }, $true)
    if (!$fn) { throw "Missing function $name" }
    . ([scriptblock]::Create($fn.Extent.Text))
}
$publisher = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -ceq 'Publish-LauncherArtifacts'
}, $true)
$default = $publisher.Body.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -ceq 'PublishOne' }
$native = [scriptblock]::Create($default.DefaultValue.Extent.Text).InvokeReturnAsIs()
Initialize-InstallerPaths
$root = (New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot $Evidence)).FullName
$entries = @(
    foreach ($id in 'first','later') {
        $original = Join-Path $root ($id + '.json')
        $staged = Join-Path $root ($id + '.staged')
        [IO.File]::WriteAllText($original, "old-$id")
        [IO.File]::WriteAllText($staged, "new-$id")
        [pscustomobject]@{
            Original = Get-InstallerPath $original
            OriginalDigest = Get-InstallerDigest $original
            Staged = $staged
            StageDigest = Get-InstallerDigest $staged
            StageId = (Get-InstallerPath $staged).Id
            Backup = $staged + '.backup'
        }
    }
)
$observed = [ordered]@{ order = @(); firstPublished = $false; sharingError = $null }
$monitor = {
    param($entry)
    $observed.order += [IO.Path]::GetFileName($entry.Original.Path)
    if ($observed.order.Count -eq 1) {
        & $native $entry
        $observed.firstPublished = [IO.File]::ReadAllText($entry.Original.Path) -ceq 'new-first'
        return
    }
    $lock = [IO.File]::Open($entry.Original.Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try { & $native $entry }
    catch {
        $observed.sharingError = $_.Exception.InnerException.HResult
        throw
    } finally { $lock.Dispose() }
}
$result = Publish-LauncherArtifacts -Artifacts $entries -PublishOne $monitor
$restored = @($entries | ForEach-Object { [IO.File]::ReadAllText($_.Original.Path) })
[ordered]@{result = $result; observed = $observed; final = $restored } | ConvertTo-Json -Depth 5
if ($result -cne 'restored' -or !$observed.firstPublished -or $observed.sharingError -ne -2147024864 -or
    $restored[0] -cne 'old-first' -or $restored[1] -cne 'old-later') {
    throw 'Real publication and restoration observations did not match.'
}
