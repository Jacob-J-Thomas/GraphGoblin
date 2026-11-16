param(
    [Parameter(Mandatory)][string]$AttemptRoot,
    [Parameter(Mandatory)][string]$NativeHelper,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$PropertyHelperSha256,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$CheckoutHead
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
if (!$IsWindows -or !$env:GITHUB_ACTIONS -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or ![Environment]::Is64BitProcess -or
    [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA' -or $CheckoutHead -cne $env:GITHUB_SHA) {
    throw 'Run only in the admitted hosted Windows x64 STA checkout.'
}
$nativeHash = '4488dd959fd5c27ccfabbca5f67b93af616dcce8e24b9b7a128cc671ca89c049'
$propertyHelper = Join-Path $PSScriptRoot 'PropertyStoreProbe.cs'
function Digest([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
if ((Digest $NativeHelper) -cne $nativeHash -or (Digest $propertyHelper) -cne $PropertyHelperSha256) {
    throw 'Exact COM helper input changed.'
}
Add-Type -Path $NativeHelper
Add-Type -Path $propertyHelper
$runner = [InstallerQa.Windows]::Identify($env:RUNNER_TEMP).Path
$name = "qa436-com-probe-$($env:GITHUB_RUN_ID)-$($env:GITHUB_RUN_ATTEMPT)"
if ([IO.Path]::GetFullPath($AttemptRoot) -ine (Join-Path $runner $name)) { throw 'Unexpected attempt root.' }
$attempt = Get-Item -LiteralPath $AttemptRoot
if (!$attempt.PSIsContainer -or ($attempt.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    [InstallerQa.Windows]::Identify($AttemptRoot).Path -ine $attempt.FullName) {
    throw 'Attempt root is not the admitted real directory.'
}
$root = Join-Path $attempt.FullName 'probe'
New-Item -ItemType Directory -Path $root | Out-Null
function Save([string]$Path, $Data) {
    $file = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $file.Write($utf8.GetBytes((ConvertTo-Json -InputObject $Data -Depth 20) + [char]10)); $file.Flush($true) }
    finally { $file.Dispose() }
}
function Failure($Record) {
    $inner = $Record.Exception.GetBaseException()
    return [ordered]@{ type=$inner.GetType().FullName; hresult=('0x{0:x8}' -f $inner.HResult)
        message=$inner.Message; stack=$Record.ScriptStackTrace }
}
$proxyPath = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Google\Chrome\Application\chrome_proxy.exe'
$proxy = [InstallerQa.Windows]::Identify($proxyPath)
$target = $proxy.Path
$port = 53600 # Used only to construct fixture argv. No listener is opened.
$hash = [Security.Cryptography.SHA256]::HashData(
    [Security.Cryptography.SHA256]::HashData($utf8.GetBytes("http://127.0.0.1:$port/app/")))
$app = [Text.StringBuilder]::new(32)
for ($i=0; $i -lt 16; $i++) {
    [void]$app.Append([char](97 + ($hash[$i] -shr 4)))
    [void]$app.Append([char](97 + ($hash[$i] -band 15)))
}
$arguments = '--profile-directory="QA 436 fixture" --app-id=' + $app.ToString()
$appId = 'GraphGoblin.QA436.Source'
Save (Join-Path $root 'input.json') ([ordered]@{
    run=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT; checkoutHead=$CheckoutHead
    image=$env:ImageOS; imageVersion=$env:ImageVersion; windows=[Environment]::OSVersion.VersionString
    powerShell=$PSVersionTable.PSVersion.ToString(); sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    session=[Diagnostics.Process]::GetCurrentProcess().SessionId
    target=$proxy; targetSha256=Digest $target; arguments=$arguments; appUserModelId=$appId
    nativeHelperSha256=$nativeHash; propertyHelperSha256=$PropertyHelperSha256
})
function Read-Link([string]$Path) {
    $shell = New-Object -ComObject WScript.Shell
    try {
        $link = $shell.CreateShortcut($Path)
        try {
            return [ordered]@{ target=$link.TargetPath; arguments=$link.Arguments
                workingDirectory=$link.WorkingDirectory; icon=$link.IconLocation }
        } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($link) }
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}
function Snapshot([string]$Path, [string]$SavedBytes = '') {
    $parent = Split-Path -Parent $Path
    $state = [ordered]@{ requestedPath=$Path; entries=@(Get-ChildItem -LiteralPath $parent -Force |
        Select-Object Name, Attributes, Length); exactFileExists=[IO.File]::Exists($Path) }
    try {
        $identity = [InstallerQa.Windows]::Identify($Path)
        $state['file'] = $identity
        $state['sha256'] = Digest $Path
        if ($SavedBytes) {
            [IO.File]::Copy($Path, $SavedBytes)
            if ((Digest $SavedBytes) -cne $state.sha256) { throw 'Saved shortcut bytes changed during snapshot.' }
        }
    } catch { $state['fileInspectionError'] = Failure $_ }
    if ($state.exactFileExists) {
        try { $state['link'] = Read-Link $Path }
        catch { $state['linkInspectionError'] = Failure $_ }
    }
    return $state
}
$completed = 0
foreach ($case in @(@{ name='01-unicode'; file='Chrome α.lnk' }, @{ name='02-ascii'; file='Chrome A.lnk' })) {
    $result = Join-Path $root $case.name
    $source = Join-Path $root ('work\' + $case.name.Substring(0,2) + '\source')
    New-Item -ItemType Directory -Path $result,$source | Out-Null
    $path = Join-Path $source $case.file
    $stage = 'wsh-save'
    try {
        if (Test-Path -LiteralPath $path) { throw 'Expected a fresh link path.' }
        Save (Join-Path $result 'requested.json') ([ordered]@{ path=$path; target=$target; arguments=$arguments
            workingDirectory=(Split-Path -Parent $target); icon="$target,0"; appUserModelId=$appId })
        $saved = [ordered]@{ returned=$false }
        try {
            $shell = New-Object -ComObject WScript.Shell
            try {
                $link = $shell.CreateShortcut($path)
                try {
                    $link.TargetPath = $target
                    $link.Arguments = $arguments
                    $link.WorkingDirectory = Split-Path -Parent $target
                    $link.IconLocation = "$target,0"
                    $link.Save()
                    $saved.returned = $true
                } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($link) }
            } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
        } catch { $saved['failure'] = Failure $_ }
        Save (Join-Path $result 'wsh-save.json') $saved
        $stage = 'post-save'
        Save (Join-Path $result 'post-save.json') (Snapshot $path (Join-Path $result 'post-save.lnk.bin'))
        if (!$saved.returned -or $saved.Contains('failure')) {
            Save (Join-Path $result 'disposition.json') @{ state='wsh-save-failed'; propertyStoreAttempted=$false }
            $completed++
            continue
        }

        $record = [Action[string,int]]({
            param([string]$Call, [int]$HResult)
            $data = [ordered]@{
                operation=$Call; hresult=('0x{0:x8}' -f $HResult); succeeded=($HResult -ge 0)
            }
            $file = [IO.File]::Open((Join-Path $result "$Call.json"), [IO.FileMode]::CreateNew,
                [IO.FileAccess]::Write, [IO.FileShare]::Read)
            try { $file.Write($utf8.GetBytes((ConvertTo-Json -InputObject $data) + [char]10)); $file.Flush($true) }
            finally { $file.Dispose() }
        }.GetNewClosure())
        $stage = 'property-store-write'
        $written = [InstallerQa.PropertyStoreProbe]::Write($path, $appId, $record)
        $stage = 'property-store-reopen'
        $read = [InstallerQa.PropertyStoreProbe]::Read($path, $record)
        $stage = 'post-property-store'
        Save (Join-Path $result 'post-property-store.json') (Snapshot $path)
        Save (Join-Path $result 'disposition.json') @{
            state='property-store-observed'; writeSucceeded=$written; reopenedValue=$read
            roundTrip=($written -and $null -ne $read -and $read.VariantType -eq 31 -and $read.Value -ceq $appId)
        }
        $completed++
    } catch {
        Save (Join-Path $result 'probe-error.json') @{ stage=$stage; failure=(Failure $_) }
    }
}
Save (Join-Path $root 'summary.json') ([ordered]@{
    status=if ($completed -eq 2) { 'diagnostic-complete' } else { 'diagnostic-incomplete' }
    recordedCases=$completed; expectedCases=2
    meaning='Observation completed; inspect the per-operation dispositions. No installer acceptance run.'
})
if ($completed -ne 2) { exit 1 }
