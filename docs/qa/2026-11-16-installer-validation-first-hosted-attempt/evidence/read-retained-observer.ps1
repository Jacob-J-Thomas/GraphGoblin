$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Join-Path $PSScriptRoot '..\..\launcher-436-execution-preparation\ProcessTrace.cs'
$observer = Join-Path $PSScriptRoot 'observer-offline.ps1'
if ((Get-FileHash -LiteralPath $source).Hash -cne '17E34C96A36F77939763F840B002B6EDCF2564B46CB94C17CDCBDC484C5601D3' -or
    (Get-FileHash -LiteralPath $observer).Hash -cne 'D47BBE2F37671E380E9413D2CF5A54D1017E72184C9073780896CFB4A6AFEB1E') {
    throw 'Offline parser input changed.'
}
# The observer calls only SplitArguments on retained command lines.
Add-Type -Path $source
. $observer
$qaUtf8 = [Text.UTF8Encoding]::new($false)
function Read-QaJson([string]$Path) { ConvertFrom-Json -AsHashtable ([IO.File]::ReadAllText($Path)) }
function Save-QaJson([string]$Path, $Data) {
    $file = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $file.Write($qaUtf8.GetBytes((ConvertTo-Json -InputObject $Data -Depth 40) + [char]10)); $file.Flush($true) }
    finally { $file.Dispose() }
}
$supervisor = Join-Path $PSScriptRoot 'artifact\qa436-baseline-first-supervisor'
$evidence = Join-Path $PSScriptRoot 'artifact\qa436-baseline-first\evidence'
function Read-Process([string]$Name) {
    $record = [ordered]@{}
    foreach ($part in @('spawn','exit','close')) {
        $record[$part] = Read-QaJson (Join-Path $supervisor "$Name.$part.json")
    }
    return $record
}
function Read-Canary([string]$Name) {
    $record = Read-Process $Name
    $record['marker'] = [IO.File]::ReadAllText((Join-Path $supervisor "$Name.stdout"))
    $record['script'] = $record.spawn.arguments[1]
    return $record
}
$run = Read-Process 'driver'
$before = Read-Canary 'canary-before'
$after = Read-Canary 'canary-after'
$node = $before.spawn.executable
$driver = $run.spawn.arguments[5]
if ($run.exit.exitCode -ne 1 -or $driver -cnotmatch '\\packets\\native\\run\.ps1$') {
    throw 'Offline readback expected the failed hosted setup receipt.'
}
Read-QaProcessTrace -Xml (Join-Path $supervisor 'process-start.xml') -Run $run -Before $before -After $after `
    -Driver $driver -Evidence $evidence -ValidatorArgument '' -Output (Join-Path $PSScriptRoot 'observer-offline-summary.json') `
    -Node $node -NodeCanonical $node
