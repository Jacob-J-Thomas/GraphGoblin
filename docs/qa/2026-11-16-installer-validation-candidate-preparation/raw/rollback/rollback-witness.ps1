param(
    [Parameter(Mandatory)][ValidateSet('seed','observe')][string]$Phase,
    [Parameter(Mandatory)][string]$AttemptRoot,
    [Parameter(Mandatory)][string]$Checkout,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$CheckoutHead,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$InstallerSha256,
    [Parameter(Mandatory)][string]$NativeHelper,
    [Parameter(Mandatory)][string]$Node,
    [Parameter(Mandatory)][string]$ChromeProxy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = [Text.UTF8Encoding]::new($false, $true)
if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or
    $PSVersionTable.PSVersion.Minor -ne 1 -or ![Environment]::Is64BitProcess -or
    [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA' -or
    $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $CheckoutHead -cne $env:GITHUB_SHA) {
    throw 'Expected the admitted hosted x64 STA Windows PowerShell 5.1 child.'
}
function Require([bool]$Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Digest([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { [BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function FileHash([string]$Path) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
        finally { $sha.Dispose() }
    } finally { $stream.Dispose() }
}
function Read-Json([string]$Path) { ConvertFrom-Json ([IO.File]::ReadAllText($Path)) }
function Save([string]$Name, $Value) {
    $file = Join-Path $recordRoot ($Name + '.json')
    $stream = [IO.File]::Open($file, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
        $bytes = $utf8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 24) + [char]10)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }
}
function Failure($Record) {
    $exception = $Record.Exception.GetBaseException()
    [ordered]@{ type=$exception.GetType().FullName; hresult=('0x{0:x8}' -f $exception.HResult)
        message=$exception.Message; stack=$Record.ScriptStackTrace }
}
$expected = Join-Path $env:RUNNER_TEMP "qa436-rollback-$($env:GITHUB_RUN_ID)-$($env:GITHUB_RUN_ATTEMPT)"
Require ([IO.Path]::GetFullPath($AttemptRoot) -ceq $expected) 'Use the exact supervised owned attempt.'
$recordRoot = Join-Path $AttemptRoot 'evidence'
$sourceObservation = Read-Json (Join-Path $PSScriptRoot 'source-observation.json')
Require ((FileHash $NativeHelper) -ceq $sourceObservation.windowsFixtureHelperSha256) 'The independent native helper changed.'
Add-Type -Path $NativeHelper
Require ([InstallerQa.Windows]::Identify($AttemptRoot).Path -ceq $AttemptRoot -and
    [InstallerQa.Windows]::Identify($recordRoot).Path -ceq $recordRoot) 'Attempt or evidence root has an unexpected native path.'
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($AttemptRoot))
Require ($drive.DriveFormat -ceq 'NTFS') 'This witness requires a disposable NTFS volume.'
$installer = Join-Path $Checkout 'scripts\install-windows-launcher.ps1'
$sourceBytes = [IO.File]::ReadAllBytes($installer)
Require ((Digest $sourceBytes) -ceq $InstallerSha256) 'The installer differs from the reviewed frozen source.'
$work = Join-Path $AttemptRoot 'work'
$install = Join-Path $work 'install'
$output = Join-Path $work 'links'
$store = Join-Path $work 'store'
$paths = [ordered]@{
    exe = Join-Path $install 'GraphGoblin.exe'
    config = Join-Path $install 'GraphGoblin.exe.json'
    desktop = Join-Path $output ('Desktop ' + [char]0x03B1 + '.lnk')
    programs = Join-Path $output ('Programs ' + [char]0x96EA + '.lnk')
    pin = Join-Path $output 'Existing Pin.lnk'
    source = Join-Path $work ('Chrome ' + [char]0x03B1 + '.lnk')
}
$own = [Diagnostics.Process]::GetCurrentProcess()
Save "$Phase-input" ([ordered]@{
    phase=$Phase; pid=$PID; birthUtc=$own.StartTime.ToUniversalTime().ToString('o')
    executable=$own.MainModule.FileName; edition=$PSVersionTable.PSEdition
    powerShell=$PSVersionTable.PSVersion.ToString(); thread=[Threading.Thread]::CurrentThread.ApartmentState.ToString()
    image=$env:ImageOS; imageVersion=$env:ImageVersion; session=$own.SessionId
    userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    sourceHead=$CheckoutHead; scriptSha256=$InstallerSha256; node=$Node; chromeProxy=$ChromeProxy; paths=$paths
})
function Capture-File([string]$Name, [string]$Path, [string]$CopyRoot) {
    $file = Get-Item -LiteralPath $Path
    $identity = [InstallerQa.Windows]::Identify($Path)
    Require (!$file.PSIsContainer -and !($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
        $identity.Path -ceq $Path -and $Path.StartsWith($work + '\', [StringComparison]::Ordinal)) "Non-owned artifact: $Name"
    $bytes = [IO.File]::ReadAllBytes($Path)
    $extension = [IO.Path]::GetExtension($Path)
    $copy = Join-Path $CopyRoot ($Name + $extension + '.bin')
    $stream = [IO.File]::Open($copy, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $stream.Write($bytes, 0, $bytes.Length) }
    finally { $stream.Dispose() }
    $result = [ordered]@{ identity=$identity; bytes=$bytes.Length; sha256=(Digest $bytes); copy=$copy }
    if ($extension -ceq '.lnk') {
        $link = [InstallerQa.Windows]::LoadLink($Path)
        $result['link'] = [ordered]@{ target=$link.Target; arguments=$link.Arguments; icon=$link.Icon
            workingDirectory=$link.WorkingDirectory; appId=[InstallerQa.Windows]::ReadAppId($Path) }
    }
    return $result
}
function Capture-Set([string]$Label) {
    $copies = Join-Path $recordRoot $Label
    New-Item -ItemType Directory -Path $copies | Out-Null
    $set = [ordered]@{}
    foreach ($name in $paths.Keys) { $set[$name] = Capture-File $name $paths[$name] $copies }
    Save $Label $set
    return $set
}
function Assert-Seed($Files, [int]$Port) {
    $config = Read-Json $paths.config
    Require ($config.Repo -ceq $Checkout -and $config.Node -ceq $Node -and $config.DataDir -ceq $store -and
        $config.Port -eq $Port -and $config.Environment.GG_LOG_LEVEL -ceq 'info' -and
        $config.PwaAppUserModelId -ceq 'GraphGoblin.QA436.Rollback' -and $config.ChromeProxy -ceq $ChromeProxy -and
        $config.ChromeProfile -ceq 'QA 436 rollback') 'Unexpected seed config.'
    foreach ($name in @('desktop','programs','pin')) {
        $link = $Files[$name].link
        $argv = [InstallerQa.Windows]::SplitArguments($link.arguments)
        Require ($link.target -ceq $paths.exe -and $link.workingDirectory -ceq $install -and
            $argv.Length -eq 2 -and $argv[0] -ceq '--config' -and $argv[1] -ceq $paths.config -and
            $link.icon -ceq $Files.source.link.icon -and $link.appId -ceq $config.LauncherAppUserModelId) "Unexpected seed link: $name"
    }
    Require (@([IO.Directory]::EnumerateFileSystemEntries($store)).Count -eq 0) 'Public seed changed the disposable store.'
}
$stage = 'prepare fixture'
try {
    if ($Phase -ceq 'seed') {
        Require (!(Test-Path -LiteralPath $work)) 'Seed workspace already exists.'
        New-Item -ItemType Directory -Path $work,$install,$output,$store | Out-Null
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
        try { $listener.Start(); $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port }
        finally { $listener.Stop() }
        Require ($port -ne 4747 -and $port -ne 4748) 'Refusing a protected port.'
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $origin = $sha.ComputeHash($sha.ComputeHash($utf8.GetBytes("http://127.0.0.1:$port/app/"))) }
        finally { $sha.Dispose() }
        $app = [Text.StringBuilder]::new(32)
        for ($i = 0; $i -lt 16; $i++) {
            [void]$app.Append([char](97 + ($origin[$i] -shr 4)))
            [void]$app.Append([char](97 + ($origin[$i] -band 15)))
        }
        $arguments = '--profile-directory="QA 436 rollback" --app-id=' + $app.ToString()
        [InstallerQa.Windows]::SaveLink($paths.source, $ChromeProxy, $arguments, (Split-Path -Parent $ChromeProxy), $ChromeProxy)
        Require ([InstallerQa.Windows]::Identify($paths.source).Path -ceq $paths.source) 'Exact Unicode seed source missing.'
        [InstallerQa.Windows]::WriteAppId($paths.source, 'GraphGoblin.QA436.Rollback')
        $sourceSha = FileHash $paths.source
        [IO.File]::Copy($paths.source, $paths.pin)
        $options = @{
            RepoPath=$Checkout; NodePath=$Node; DataDir=$store; Port=$port; InstallDir=$install
            PwaShortcut=$paths.source; DesktopShortcut=$paths.desktop; StartMenuShortcut=$paths.programs
            PinnedShortcut=$paths.pin; Environment=@{ GG_LOG_LEVEL='info'; GG_REQUIRE_API_KEY='false'
                GG_OLLAMA_ENABLED='false'; GG_SWAGGER_UI='false' }
        }
        Save 'seed-request' @{ installer=$installer; options=$options; sourceSha256=$sourceSha }
        $stage = 'public seed installer'
        & $installer @options
        Require ($?) 'Public seed installer did not return success.'
        $stage = 'independent seed readback'
        $before = Capture-Set 'old'
        Assert-Seed $before $port
        Require ($before.source.sha256 -ceq $sourceSha) 'Seed changed the source shortcut bytes.'
        Save 'seed-result' @{ status='public-seed-verified'; port=$port; files=$paths.Count }
        exit 0
    }

    $stage = 'exact publisher AST selection'
    $tokens = $null
    $errors = $null
    $sourceText = $utf8.GetString($sourceBytes).TrimStart([char]0xFEFF)
    $ast = [Management.Automation.Language.Parser]::ParseInput($sourceText,[ref]$tokens,[ref]$errors)
    Require ($errors.Count -eq 0) 'The bound production installer did not parse in Windows PowerShell.'
    $names = @('Initialize-InstallerPaths','Get-InstallerPath','Get-InstallerDigest','Test-InstallerFile','Publish-LauncherArtifacts')
    $definitions = @(
        foreach ($name in $names) {
            $matches = @($ast.EndBlock.Statements | Where-Object {
                $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq $name
            })
            Require ($matches.Count -eq 1) "Expected one exact top-level function: $name"
            $text = $matches[0].Extent.Text
            $lf = $text.Replace(([string][char]13 + [char]10), [string][char]10)
            $expectedHash = $sourceObservation.functionSha256Lf.PSObject.Properties[$name].Value
            Require ((Digest ($utf8.GetBytes($lf))) -ceq $expectedHash) "Reviewed function bytes changed: $name"
            $text
        }
    )
    # Evaluate only the five admitted declarations, with the source top level excluded.
    . ([scriptblock]::Create(($definitions -join [char]10)))
    Initialize-InstallerPaths
    Save 'publisher-source' @{ installerSha256=$InstallerSha256; declarations=$sourceObservation.functionSha256Lf
        publicationOrder=$sourceObservation.expectedOrder; lockedDestination=$sourceObservation.lockedDestination }

    $stage = 'build composed artifacts'
    $seed = Read-Json (Join-Path $recordRoot 'seed-result.json')
    Require ($seed.status -ceq 'public-seed-verified') 'The public seed proof is unavailable.'
    $old = Read-Json (Join-Path $recordRoot 'old.json')
    $stageRoot = Join-Path $work 'staged'
    New-Item -ItemType Directory -Path $stageRoot | Out-Null
    $order = @('exe','config','desktop','programs','pin')
    Require (($order -join ',') -ceq ($sourceObservation.expectedOrder -join ',')) 'Publisher order differs from review.'
    $entries = @(
        foreach ($name in $order) {
            $original = $old.PSObject.Properties[$name].Value
            $current = Get-InstallerPath $paths[$name]
            Require ($current.Path -ceq $paths[$name] -and $current.Id -and !$current.IsDirectory -and !$current.IsLink -and
                (FileHash $current.Path) -ceq $original.sha256) "Seed changed before publication: $name"
            $staged = Join-Path $stageRoot ($name + [IO.Path]::GetExtension($current.Path))
            if ($name -ceq 'config') {
                $config = Read-Json $current.Path
                Require ($config.Environment.GG_LOG_LEVEL -ceq 'info') 'The seed log level is not distinguishable.'
                $config.Environment.GG_LOG_LEVEL = 'warn'
                [IO.File]::WriteAllText($staged, (ConvertTo-Json $config -Depth 12), $utf8)
            } else { [IO.File]::Copy($current.Path, $staged) }
            $candidate = Get-InstallerPath $staged
            Require ($candidate.Id -and !$candidate.IsDirectory -and !$candidate.IsLink -and
                $candidate.Id.Split(':')[0] -ceq $current.Id.Split(':')[0]) "Stage left owned regular destination volume: $name"
            [pscustomobject]@{ Original=$current; OriginalDigest=(Get-InstallerDigest $current.Path)
                Staged=$candidate.Path; StageId=$candidate.Id; StageDigest=(Get-InstallerDigest $candidate.Path)
                Backup=$candidate.Path + '.previous' }
        }
    )
    Require ($entries[1].StageDigest -cne $entries[1].OriginalDigest) 'Staged config bytes must differ.'
    Save 'composed-input' $entries
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $state = @{ Calls=0; Stream=$null; Handle=$null; Changed=$null; Lock=$null; Error=$null; Result=$null }
    $completed = [Collections.Generic.List[object]]::new()
    $stage = 'production composed publication'
    $publish = {
        param($Entry)
        $index = $state.Calls
        $state.Calls++
        Require ($index -lt $order.Count -and $Entry.Original.Path -ceq $paths[$order[$index]]) 'Unexpected delegate order.'
        $name = $order[$index]
        if ($name -ceq 'programs') {
            Require ($null -ne $state.Changed) 'No completed config change precedes lock acquisition.'
            $state.Stream = [IO.File]::Open($Entry.Original.Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            $state.Handle = $state.Stream.SafeFileHandle
            $identity = [InstallerQa.Windows]::Identify($Entry.Original.Path)
            Require ($identity.FileId -ceq $old.programs.identity.FileId -and $identity.Volume -ceq $old.programs.identity.Volume) 'The lock does not name the original Programs file.'
            $state.Lock = [ordered]@{ tick=$clock.ElapsedTicks; path=$Entry.Original.Path; identity=$identity
                access='Read'; share='Read'; handleOpen=!$state.Handle.IsClosed }
            Save 'later-lock' $state.Lock
        }
        $attemptTick = $clock.ElapsedTicks
        try { [IO.File]::Replace($Entry.Staged, $Entry.Original.Path, $Entry.Backup) }
        catch {
            $state.Error = [ordered]@{ name=$name; path=$Entry.Original.Path; attemptTick=$attemptTick
                completedTick=$clock.ElapsedTicks; failure=(Failure $_) }
            Save 'native-failure' $state.Error
            throw
        }
        $readback = [ordered]@{ op='File.Replace'; path=$Entry.Original.Path; name=$name; attemptedTick=$attemptTick
            completedTick=$clock.ElapsedTicks; finalSha256=(FileHash $Entry.Original.Path) }
        $completed.Add($readback)
        Save "complete-$index" $readback
        if ($name -ceq 'config') {
            $config = Read-Json $Entry.Original.Path
            Require ($config.Environment.GG_LOG_LEVEL -ceq 'warn' -and $readback.finalSha256 -cne $old.config.sha256 -and
                (Get-InstallerDigest $Entry.Original.Path) -ceq $Entry.StageDigest) 'Final config does not hold the completed staged bytes.'
            $state.Changed = [ordered]@{ tick=$clock.ElapsedTicks; finalSha256=$readback.finalSha256; logLevel='warn' }
            Capture-File 'changed-config' $paths.config $recordRoot | Out-Null
            Save 'completed-config-change' $state.Changed
        }
    }
    try {
        $state.Result = Publish-LauncherArtifacts -Artifacts $entries -PublishOne $publish
        $returned = $clock.ElapsedTicks
        $heldAtReturn = $null -ne $state.Handle -and !$state.Handle.IsClosed
        Save 'publisher-result' @{ result=$state.Result; tick=$returned; delegateCalls=$state.Calls
            completed=@($completed.ToArray()); heldDuringReturn=$heldAtReturn }
    } finally {
        if ($null -ne $state.Stream) { $state.Stream.Dispose() }
    }

    $stage = 'independent restoration readback'
    $after = Capture-Set 'restored'
    $comparisons = @(
        foreach ($name in $paths.Keys) {
            $previous = $old.PSObject.Properties[$name].Value
            $actual = $after[$name]
            $linkProperty = $previous.PSObject.Properties['link']
            $linkEqual = $true
            if ($linkProperty) {
                foreach ($key in $actual.link.Keys) {
                    if ($linkProperty.Value.PSObject.Properties[$key].Value -cne $actual.link[$key]) { $linkEqual = $false }
                }
            }
            [ordered]@{ name=$name; oldSha256=$previous.sha256; newSha256=$actual.sha256
                bytesEqual=($previous.sha256 -ceq $actual.sha256 -and $previous.bytes -eq $actual.bytes)
                nativeLinkEqual=$linkEqual; oldId=$previous.identity.FileId; newId=$actual.identity.FileId }
        }
    )
    Save 'restoration-comparison' $comparisons
    $stageFiles = @(
        foreach ($path in [IO.Directory]::EnumerateFiles($stageRoot)) {
            Capture-File ([IO.Path]::GetFileName($path)) $path $recordRoot
        }
    )
    Save 'stage-remnants' $stageFiles
    Require ($state.Result -ceq 'restored' -and $state.Calls -eq 4 -and $completed.Count -eq 3) 'Production publisher did not restore after three replacements.'
    Require ($null -ne $state.Changed -and $null -ne $state.Lock -and $null -ne $state.Error -and
        $state.Lock.handleOpen -and $heldAtReturn -and $state.Handle.IsClosed -and
        $state.Error.name -ceq 'programs' -and $state.Error.failure.hresult -ceq '0x80070020' -and
        $state.Changed.tick -lt $state.Lock.tick -and $state.Lock.tick -lt $state.Error.attemptTick -and
        $state.Error.attemptTick -le $state.Error.completedTick -and $state.Error.completedTick -lt $returned) 'Ordered real sharing failure and restoration evidence was incomplete.'
    Require (@($comparisons | Where-Object { !$_.bytesEqual -or !$_.nativeLinkEqual }).Count -eq 0) 'Old bytes or native metadata differ.'
    Require ((FileHash $installer) -ceq $InstallerSha256) 'Installer source changed while observing rollback.'
    Save 'rollback-result' @{ status='restored-after-native-sharing-failure'; shell='Windows PowerShell 5.1'
        context='production publisher composed'; orderedMutation='config'; lockedLaterDestination='programs'
        lockDisposed=$state.Handle.IsClosed; restoredArtifacts=$comparisons.Count }
    exit 0
} catch {
    Save "$Phase-first-failure" @{ stage=$stage; failure=(Failure $_) }
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
