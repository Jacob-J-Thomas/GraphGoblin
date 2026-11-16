param(
    [Parameter(Mandatory)][string]$InstallerSnapshot,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedInstallerSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$batch = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$budget = Join-Path $batch 'launcher-436-candidate-budget-preparation'
$rollback = Join-Path $batch 'launcher-436-rollback-witness-preparation'
function Hash([string]$Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }
function Read-Seal([string]$Folder, [string]$Manifest, [string]$Expected, [int]$Count) {
    $path = Join-Path $Folder $Manifest
    if ((Hash $path) -cne $Expected) { throw "Manifest changed: $path" }
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($line in Get-Content -LiteralPath $path) {
        if ($line -cnotmatch '^([a-f0-9]{64})  ([a-zA-Z0-9_.\/-]+)$' -or
            $Matches[2].StartsWith('/') -or $Matches[2].Contains('..')) { throw 'Unsafe manifest row.' }
        $name = $Matches[2]
        $digest = $Matches[1]
        if (!$names.Add($name) -or (Hash (Join-Path $Folder $name)) -cne $digest) { throw "Sealed payload changed: $name" }
    }
    if ($names.Count -ne $Count) { throw "Unexpected manifest member count: $path" }
    [ordered]@{ sha256=$Expected; members=@($names | Sort-Object) }
}
$native = Read-Seal (Join-Path $budget 'native') 'SHA256SUMS.txt' '92633a444b327c8d9128aec387119fc5e7570093feece51d2aa57f647fce1fba' 6
$execution = Read-Seal (Join-Path $budget 'execution') 'SHA256SUMS.txt' 'e47289e57831e65eb4b39569cc9e5305318a0ec6165e1a7b87f469e57132b177' 10
$witness = Read-Seal $rollback 'HOSTED-SHA256SUMS.txt' '1b264ce75a482249ca72083926ab0cae977e36e2ea395d32685442105c238e11' 3
$source = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $InstallerSnapshot).Path)
$actual = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($source)).ToLowerInvariant()
if ($actual -cne $ExpectedInstallerSha256) { throw 'The supplied corrected source bytes do not match reviewed freeze.' }
$old = Get-Content -Raw -LiteralPath (Join-Path $rollback 'source-observation.json') | ConvertFrom-Json -AsHashtable
if ($actual -ceq $old.observedSourceSha256) { throw 'The supplied installer still has its original candidate SHA-256.' }
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$code = $utf8.GetString($source).TrimStart([char]0xFEFF)
$tokens = $null
$errors = $null
$root = [Management.Automation.Language.Parser]::ParseInput($code, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'The corrected installer failed syntax parsing.' }
$hashes = [ordered]@{}
foreach ($name in $old.functionSha256Lf.Keys) {
    $declaration = @($root.EndBlock.Statements | Where-Object {
        $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq $name
    })
    if ($declaration.Count -ne 1) { throw "Expected one exact top-level declaration: $name" }
    $extent = $declaration[0].Extent.Text.Replace(([string][char]13 + [char]10), [string][char]10)
    $sha = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($utf8.GetBytes($extent))).ToLowerInvariant()
    if ($sha -cne $old.functionSha256Lf[$name]) { throw "Rollback seam requires fresh review: $name" }
    $hashes[$name] = $sha
}
if ($hashes.Count -ne 5) { throw 'Expected five reviewed rollback declarations.' }
[ordered]@{
    scope='static corrected-source and seal readback only'
    priorInstallerSha256=$old.observedSourceSha256; correctedInstallerSha256=$actual
    checkedDeclarations=$hashes; native=$native; execution=$execution; hostedRollback=$witness
    sourceExecuted=$false
} | ConvertTo-Json -Depth 10
