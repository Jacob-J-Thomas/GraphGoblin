[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('baseline', 'candidate')][string]$Phase,
    [Parameter(Mandatory)][string]$Checkout,
    [Parameter(Mandatory)][string]$ExpectedCommit,
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$ChromeProxy,
    [Parameter(Mandatory)][ValidatePattern('^qa436-[a-z0-9-]{3,38}$')][string]$EvidenceName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (!$IsWindows -or ![Environment]::Is64BitProcess -or $PSVersionTable.PSVersion.Major -ne 7 -or
    [Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA -or
    $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or !$env:RUNNER_TEMP -or !$env:GITHUB_WORKSPACE) {
    throw 'Run the #436 driver in the disposable GitHub-hosted Windows job with PowerShell 7 x64 in STA.'
}
if ($ExpectedCommit -cnotmatch '^[0-9a-f]{40}$') { throw 'ExpectedCommit must be a full lowercase Git SHA.' }

$qaResults = [Collections.Generic.List[object]]::new()
$qaOwnedKnownLinks = [Collections.Generic.List[object]]::new()
$qaAttempt = 0
$qaTimer = [Diagnostics.Stopwatch]::StartNew()
$qaUtf8 = [Text.UTF8Encoding]::new($false)
$qaProcessLimit = 50
$qaDeadlineSeconds = 310
$qaFailure = $null
$qaCleanupFailure = $null
$qaRoot = Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) $EvidenceName
if (Test-Path -LiteralPath $qaRoot) { throw 'Use a fresh evidence name.' }
New-Item -ItemType Directory -Path $qaRoot | Out-Null
$qaEvidence = Join-Path $qaRoot 'evidence'
$qaWork = Join-Path $qaRoot 'work'
New-Item -ItemType Directory -Path $qaEvidence, $qaWork | Out-Null

function Require([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

function Save-Json([string]$Path, $Data) {
    $qaStream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        $qaBytes = $qaUtf8.GetBytes((ConvertTo-Json -InputObject $Data -Depth 30) + [Environment]::NewLine)
        $qaStream.Write($qaBytes)
    } finally { $qaStream.Dispose() }
}

function New-FixtureDirectory([string]$Path) {
    Require (!(Test-Path -LiteralPath $Path)) "Fixture path already exists: $Path"
    New-Item -ItemType Directory -Path $Path | Out-Null
    return $Path
}

function Digest([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Is-Within([string]$Path, [string]$Parent) {
    return $Path.StartsWith($Parent.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Is-PlainItem($Item) {
    return !(($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Get-KnownFolderPathFailure([Exception]$Exception, [bool]$CreatingFile = $false) {
    $qaCause = $Exception
    if ($qaCause -is [Management.Automation.MethodInvocationException] -and $qaCause.InnerException) {
        $qaCause = $qaCause.InnerException
    }
    $qaCode = switch ($qaCause) {
        { $_ -is [IO.FileNotFoundException] } { 2; break }
        { $_ -is [IO.DirectoryNotFoundException] } { 3; break }
        { $_ -is [UnauthorizedAccessException] -or $_ -is [Security.SecurityException] } { 5; break }
        { $_ -is [ComponentModel.Win32Exception] } { $_.NativeErrorCode; break }
        { $_ -is [IO.IOException] } { $_.HResult -band 0xffff; break }
    }
    if ($qaCode -in @(2, 3, 5, 21, 53, 67, 267) -or ($CreatingFile -and $qaCode -in @(80, 183))) {
        return [ordered]@{ code = $qaCode; type = $qaCause.GetType().FullName; detail = $qaCause.Message }
    }
    return $null
}

function Read-KnownFolder([System.Environment+SpecialFolder]$Folder, [string]$Profile) {
    $qaReadback = [ordered]@{ folder = $Folder.ToString(); path = ''; canonical = ''; reason = $null }
    $qaStep = 'resolve known folder'
    try {
        $qaReadback.path = [Environment]::GetFolderPath($Folder)
        if (!$qaReadback.path) {
            $qaReadback.reason = 'GetFolderPath returned an empty path.'
            return $qaReadback
        }
        if (![IO.Path]::IsPathFullyQualified($qaReadback.path)) {
            $qaReadback.reason = 'GetFolderPath did not return an absolute path.'
            return $qaReadback
        }
        $qaStep = 'check existing directory'
        $qaAttributes = [IO.File]::GetAttributes($qaReadback.path)
        if (($qaAttributes -band [IO.FileAttributes]::Directory) -eq 0) {
            $qaReadback.reason = 'The known folder path is not a directory.'
            return $qaReadback
        }
        $qaStep = 'resolve native directory identity'
        $qaReadback.canonical = [InstallerQa.Windows]::Identify($qaReadback.path).Path
        if (!(Is-Within $qaReadback.canonical $Profile)) {
            $qaReadback.reason = 'The resolved directory lies outside the disposable runner profile.'
        }
    } catch {
        $qaAvailability = Get-KnownFolderPathFailure $_.Exception
        if (!$qaAvailability) { throw }
        $qaReadback.reason = $qaStep
        $qaReadback['nativeError'] = $qaAvailability
    }
    return $qaReadback
}

function Get-DefaultSourceObstacle([string]$Path, [bool]$DirectoryProbe) {
    try {
        $qaAttributes = [IO.File]::GetAttributes($Path)
    } catch {
        $qaAvailability = Get-KnownFolderPathFailure $_.Exception
        if (!$qaAvailability) { throw }
        if ($qaAvailability.code -in @(2, 3)) { return $null }
        return [ordered]@{ reason = 'Could not check default source path.'; path = $Path; nativeError = $qaAvailability }
    }
    if (!$DirectoryProbe) {
        return [ordered]@{ reason = 'The exact default shortcut path is already occupied.'; path = $Path }
    }
    if (($qaAttributes -band [IO.FileAttributes]::Directory) -eq 0 -or
        ($qaAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        return [ordered]@{ reason = 'Chrome Apps is not a plain directory in runner Programs.'; path = $Path }
    }
    return $null
}

function New-Link([string]$Path, [string]$Target, [string]$Arguments, [string]$Icon, [string]$AppId) {
    Require (!(Test-Path -LiteralPath $Path)) "Refusing to overwrite a fixture link: $Path"
    [InstallerQa.Windows]::SaveLink($Path, $Target, $Arguments, (Split-Path -Parent $Target), $Icon)
    Require ([IO.File]::Exists($Path)) "Unicode Shell Link Save did not create the exact fixture path: $Path"
    $qaSaved = [InstallerQa.Windows]::Identify($Path)
    Require ($qaSaved.Path -ceq $Path) "Unicode Shell Link Save resolved a different fixture path: $($qaSaved.Path)"
    if ($AppId) { [InstallerQa.Windows]::WriteAppId($Path, $AppId) }
}

function Read-Link([string]$Path) {
    $qaLink = [InstallerQa.Windows]::LoadLink($Path)
    return [ordered]@{
        target = $qaLink.Target
        arguments = $qaLink.Arguments
        workingDirectory = $qaLink.WorkingDirectory
        icon = $qaLink.Icon
        appId = [InstallerQa.Windows]::ReadAppId($Path)
    }
}

function Snapshot([string]$Path) {
    try { $qaItem = Get-Item -LiteralPath $Path -Force }
    catch [Management.Automation.ItemNotFoundException] { return [ordered]@{ path = $Path; kind = 'absent' } }
    $qaIdentity = [InstallerQa.Windows]::Identify($Path)
    Require ((Is-Within $qaIdentity.Path $qaRoot) -or ($qaIdentity.Path -ieq $qaDesktopDefault)) `
        "Refusing to follow fixture output outside the owned area: $Path"
    if ($qaItem.PSIsContainer) {
        return [ordered]@{ path = $Path; kind = 'directory'; identity = $qaIdentity; plain = (Is-PlainItem $qaItem) }
    }
    Require (Is-PlainItem $qaItem) "Unexpected reparse point at a fixture output: $Path"
    $qaSnapshot = [ordered]@{
        path = $Path; kind = 'file'; identity = $qaIdentity; bytes = $qaItem.Length; sha256 = (Digest $Path)
    }
    if ($qaItem.Extension -ieq '.lnk') {
        # A wrong native link is still an artifact worth retaining in refusal evidence.
        try { $qaSnapshot['link'] = Read-Link $Path }
        catch { $qaSnapshot['linkReadError'] = $_.Exception.Message }
    }
    return $qaSnapshot
}

function Snapshot-Set($Paths) {
    $qaSnapshot = [ordered]@{}
    foreach ($qaItem in $Paths.GetEnumerator()) { $qaSnapshot[$qaItem.Key] = Snapshot $qaItem.Value }
    return $qaSnapshot
}

function Watch-Changes($Before, $After) {
    foreach ($qaKey in $Before.Keys) {
        $qaOld = $Before[$qaKey]
        $qaNew = $After[$qaKey]
        if ($qaOld.kind -ne $qaNew.kind -or
            ($qaOld.kind -eq 'file' -and ($qaOld.sha256 -cne $qaNew.sha256 -or $qaOld.bytes -ne $qaNew.bytes))) {
            $qaKey
        }
    }
}

function Preserve-Files([string]$Folder, $Snapshot) {
    New-FixtureDirectory $Folder | Out-Null
    foreach ($qaKey in $Snapshot.Keys) {
        $qaItem = $Snapshot[$qaKey]
        if ($qaItem.kind -eq 'file') {
            $qaCopy = Join-Path $Folder ($qaKey + [IO.Path]::GetExtension($qaItem.path))
            [IO.File]::Copy($qaItem.path, $qaCopy)
            Require ((Digest $qaCopy) -ceq $qaItem.sha256) "Artifact changed during capture: $($qaItem.path)"
        }
    }
}

function Invoke-OwnedChild([string]$Folder, [string]$Name, [string]$Executable, [string[]]$Arguments,
    [string]$WorkingDirectory, [string]$PrivateTemp, [string]$Path, [int]$TimeoutSeconds = 25) {
    $script:qaAttempt++
    Require ($script:qaAttempt -le $qaProcessLimit) 'Installer fixture process count exceeded.'
    $qaSecondsRemaining = $qaDeadlineSeconds - $qaTimer.Elapsed.TotalSeconds
    Require ($qaSecondsRemaining -ge 5) 'The installer fixture time budget is exhausted.'
    $qaMs = [int]([Math]::Min($TimeoutSeconds, $qaSecondsRemaining) * 1000)
    $qaPrefix = Join-Path $Folder $Name
    $qaStdoutPath = $qaPrefix + '.stdout'
    $qaStderrPath = $qaPrefix + '.stderr'
    Save-Json ($qaPrefix + '.attempt.json') ([ordered]@{
        executable = $Executable; arguments = @($Arguments); workingDirectory = $WorkingDirectory
        temp = $PrivateTemp; path = $Path; timeoutMs = $qaMs; requestedUtc = [DateTime]::UtcNow
    })
    $qaInfo = [Diagnostics.ProcessStartInfo]::new()
    $qaInfo.FileName = $Executable
    $qaInfo.WorkingDirectory = $WorkingDirectory
    $qaInfo.UseShellExecute = $false
    $qaInfo.CreateNoWindow = $true
    $qaInfo.RedirectStandardOutput = $true
    $qaInfo.RedirectStandardError = $true
    foreach ($qaArg in $Arguments) { $qaInfo.ArgumentList.Add($qaArg) }
    foreach ($qaKey in @($qaInfo.Environment.Keys)) {
        if ($qaKey -match '^(GG_|NODE_OPTIONS$|JEV_API_KEY$|OPENAI_API_KEY$|ANTHROPIC_API_KEY$)') {
            [void]$qaInfo.Environment.Remove($qaKey)
        }
    }
    $qaInfo.Environment['TEMP'] = $PrivateTemp
    $qaInfo.Environment['TMP'] = $PrivateTemp
    $qaInfo.Environment['PATH'] = $Path
    $qaInfo.Environment['NO_COLOR'] = '1'
    $qaInfo.Environment['POWERSHELL_TELEMETRY_OPTOUT'] = '1'
    $qaStdout = [IO.File]::Open($qaStdoutPath, 'CreateNew', 'Write', 'Read')
    $qaStderr = [IO.File]::Open($qaStderrPath, 'CreateNew', 'Write', 'Read')
    $qaChild = $null
    try {
        $qaChild = [Diagnostics.Process]::Start($qaInfo)
        Require ($null -ne $qaChild) "Child could not be obtained for $Name."
        $qaStreams = [Threading.Tasks.Task[]]@(
            $qaChild.StandardOutput.BaseStream.CopyToAsync($qaStdout)
            $qaChild.StandardError.BaseStream.CopyToAsync($qaStderr)
        )
        $qaCreatedUtc = $null
        try { $qaCreatedUtc = $qaChild.StartTime.ToUniversalTime().ToString('o') } catch { }
        Save-Json ($qaPrefix + '.spawn.json') ([ordered]@{
            pid = $qaChild.Id; startedUtc = $qaCreatedUtc; executable = $Executable
        })
        if (!$qaChild.WaitForExit($qaMs)) {
            Save-Json ($qaPrefix + '.timeout.json') ([ordered]@{ pid = $qaChild.Id; startedUtc = $qaCreatedUtc })
            throw "Owned child $($qaChild.Id) exceeded its deadline. Preserve the evidence and stop this job's QA."
        }
        $qaOutcome = [ordered]@{ pid = $qaChild.Id; startedUtc = $qaCreatedUtc; exitCode = $qaChild.ExitCode
            exitedUtc = $qaChild.ExitTime.ToUniversalTime().ToString('o') }
        Save-Json ($qaPrefix + '.exit.json') $qaOutcome
        Require ([Threading.Tasks.Task]::WaitAll($qaStreams, 5000)) "Child pipes did not close: $Name"
        $qaOutcome['streamsClosed'] = $true
        $qaOutcome['stdout'] = $qaStdoutPath
        $qaOutcome['stderr'] = $qaStderrPath
        $qaOutcome['stdoutBytes'] = $qaStdout.Length
        $qaOutcome['stderrBytes'] = $qaStderr.Length
        Save-Json ($qaPrefix + '.close.json') $qaOutcome
        return $qaOutcome
    } catch {
        Save-Json ($qaPrefix + '.runner-error.json') ([ordered]@{ error = $_.Exception.Message; stack = $_.ScriptStackTrace })
        throw
    } finally {
        if ($null -ne $qaChild) { $qaChild.Dispose() }
        $qaStdout.Dispose()
        $qaStderr.Dispose()
    }
}

function Listener([int]$Port) {
    $qaClient = [Net.Sockets.TcpClient]::new()
    try {
        $qaClient.Connect([Net.IPAddress]::Loopback, $Port)
        return $true
    } catch [Net.Sockets.SocketException] {
        if ($_.Exception.SocketErrorCode -ne [Net.Sockets.SocketError]::ConnectionRefused) { throw }
        return $false
    } finally { $qaClient.Dispose() }
}

function Choose-Port {
    $qaListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $qaListener.Start()
        $qaPort = $qaListener.LocalEndpoint.Port
    } finally { $qaListener.Stop() }
    Require ($qaPort -notin @(4747, 4748) -and !(Listener $qaPort)) 'Fixture port was not independently free.'
    return $qaPort
}

function Installer-Call($Case, [string]$Name, $Options, [string]$Path = $qaNormalPath) {
    $qaRequestPath = Join-Path $Case.folder ($Name + '.request.json')
    Save-Json $qaRequestPath ([ordered]@{ installer = $qaInstaller; options = $Options })
    Require (!(Listener $Case.port)) "Fixture port was occupied before running $Name."
    $qaOutcome = Invoke-OwnedChild $Case.folder $Name $qaPowerShell `
        @('-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', $qaInvoke, '-Request', $qaRequestPath) `
        $Case.work $Case.temp $Path
    $qaOutcome['portListeningAfter'] = Listener $Case.port
    return $qaOutcome
}

function App-Id([int]$Port) {
    $qaUrl = $qaUtf8.GetBytes("http://127.0.0.1:$Port/app/")
    $qaDigest = [Security.Cryptography.SHA256]::HashData([Security.Cryptography.SHA256]::HashData($qaUrl))
    $qaAppId = [Text.StringBuilder]::new(32)
    for ($qaI = 0; $qaI -lt 16; $qaI++) {
        [void]$qaAppId.Append([char](97 + ($qaDigest[$qaI] -shr 4)))
        [void]$qaAppId.Append([char](97 + ($qaDigest[$qaI] -band 15)))
    }
    return $qaAppId.ToString()
}

function Source-Link($Case, [string]$Path, [string]$Defect = '') {
    $qaOrigin = $Case.port
    if ($Defect -eq 'wrong-origin') { $qaOrigin = if ($qaOrigin -eq 65535) { 65534 } else { $qaOrigin + 1 } }
    $qaArguments = '--profile-directory="QA 436 fixture" --app-id=' + (App-Id $qaOrigin)
    if ($Defect -eq 'missing-profile') { $qaArguments = '--app-id=' + (App-Id $qaOrigin) }
    if ($Defect -eq 'missing-app-id') { $qaArguments = '--profile-directory="QA 436 fixture"' }
    $qaTarget = if ($Defect -eq 'wrong-proxy') { $qaPowerShell } else { $qaProxy }
    $qaId = if ($Defect -eq 'missing-app-user-model-id') { '' } else { 'GraphGoblin.QA436.Source' }
    New-Link $Path $qaTarget $qaArguments $qaProxy $qaId
}

function New-Case([string]$Name) {
    $qaFolder = New-FixtureDirectory (Join-Path $qaEvidence $Name)
    $qaFixture = New-FixtureDirectory (Join-Path $qaWork $Name)
    $qaSource = New-FixtureDirectory (Join-Path $qaFixture 'source')
    $qaOutput = New-FixtureDirectory (Join-Path $qaFixture 'output')
    $qaInstall = Join-Path $qaFixture 'install α'
    $qaStore = New-FixtureDirectory (Join-Path $qaFixture 'store')
    $qaTemp = New-FixtureDirectory (Join-Path $qaFixture 'temp')
    $qaPort = Choose-Port
    $qaPaths = [ordered]@{
        exe = Join-Path $qaInstall 'GraphGoblin.exe'
        config = Join-Path $qaInstall 'GraphGoblin.exe.json'
        source = Join-Path $qaSource 'Chrome α.lnk'
        desktop = Join-Path $qaOutput 'Desktop α.lnk'
        programs = Join-Path $qaOutput 'Programs 雪.lnk'
        pin = Join-Path $qaOutput 'Existing pin.lnk'
        foreign = Join-Path $qaOutput 'unrelated.txt'
    }
    [IO.File]::WriteAllText($qaPaths.foreign, 'QA436 unrelated fixture sentinel', $qaUtf8)
    $qaOptions = [ordered]@{
        RepoPath = $qaCheckout; NodePath = $qaNode; DataDir = $qaStore; Port = $qaPort
        InstallDir = $qaInstall; PwaShortcut = $qaPaths.source
        DesktopShortcut = $qaPaths.desktop; StartMenuShortcut = $qaPaths.programs
        Environment = [ordered]@{
            GG_LOG_LEVEL = 'info'; GG_REQUIRE_API_KEY = 'false'; GG_OLLAMA_ENABLED = 'false'; GG_SWAGGER_UI = 'false'
        }
    }
    $qaCase = [ordered]@{
        name = $Name; folder = $qaFolder; work = $qaFixture
        temp = $qaTemp; port = $qaPort; paths = $qaPaths; options = $qaOptions
    }
    Source-Link $qaCase $qaPaths.source
    return $qaCase
}

function Require-SameFile([string]$First, [string]$Second, [string]$Message) {
    $qaA = [InstallerQa.Windows]::Identify($First)
    $qaB = [InstallerQa.Windows]::Identify($Second)
    Require ($qaA.Volume -ceq $qaB.Volume -and $qaA.FileId -ceq $qaB.FileId) $Message
}

function Check-Install($Case, $Outcome, $Snapshot, [bool]$Shortcuts, [string]$LogLevel) {
    Require ($Outcome.exitCode -eq 0 -and !$Outcome.portListeningAfter) "Installation did not complete harmlessly: $($Case.name)"
    Require ($Snapshot.exe.kind -eq 'file' -and [InstallerQa.Windows]::IsX64WindowsImage($Snapshot.exe.path)) 'Expected native launcher image.'
    Require ($Snapshot.config.kind -eq 'file') 'Expected final configuration.'
    $qaConfig = Get-Content -LiteralPath $Snapshot.config.path -Raw | ConvertFrom-Json -AsHashtable
    Require-SameFile $qaConfig.Repo $qaCheckout 'Unexpected saved checkout identity.'
    Require-SameFile $qaConfig.Node $qaNode 'Unexpected saved runtime identity.'
    Require-SameFile $qaConfig.DataDir $Case.options.DataDir 'Unexpected saved store identity.'
    Require-SameFile $qaConfig.ChromeProxy $qaProxy 'Unexpected saved Chrome proxy identity.'
    Require ($qaConfig.Port -eq $Case.port -and $qaConfig.ChromeAppId -ceq (App-Id $Case.port)) 'Unexpected saved loopback origin.'
    $qaSource = $Snapshot.source.link
    Require ($qaConfig.ChromeProfile -ceq 'QA 436 fixture' -and
        $qaConfig.PwaAppUserModelId -ceq $qaSource.appId -and
        ($qaConfig.IconLocation -replace ',\s*', ',') -ieq ($qaSource.icon -replace ',\s*', ',') -and
        $qaConfig.Environment.GG_LOG_LEVEL -ceq $LogLevel -and $qaConfig.LauncherAppUserModelId) 'Unexpected saved launcher settings.'
    Require (@(Get-ChildItem -LiteralPath $Case.options.DataDir -Force).Count -eq 0) 'Installer changed the disposable store.'
    if ($Shortcuts) {
        $qaLinks = @('desktop', 'programs')
        if ($Case.options.Contains('PinnedShortcut')) { $qaLinks += 'pin' }
        foreach ($qaName in $qaLinks) {
            $qaOutput = $Snapshot[$qaName]
            Require ($qaOutput.kind -eq 'file' -and $qaOutput.Contains('link')) "Expected readable $qaName shortcut."
            $qaLink = $qaOutput.link
            Require-SameFile $qaLink.target $Snapshot.exe.path 'Shortcut did not target the final launcher.'
            Require-SameFile $qaLink.workingDirectory (Split-Path -Parent $Snapshot.exe.path) 'Shortcut did not name the final working directory.'
            $qaArguments = @([InstallerQa.Windows]::SplitArguments($qaLink.arguments))
            Require ($qaArguments.Count -eq 2 -and $qaArguments[0] -ceq '--config') 'Expected one explicit final-config argument.'
            Require-SameFile $qaArguments[1] $Snapshot.config.path 'Shortcut did not reference the final configuration.'
            Require ($qaLink.appId -ceq $qaConfig.LauncherAppUserModelId -and
                ($qaLink.icon -replace ',\s*', ',') -ieq ($qaSource.icon -replace ',\s*', ',')) 'Shortcut lost intended icon or AppUserModelID.'
        }
    }
    return $qaConfig.LauncherAppUserModelId
}

function Prepare-InstalledSentinel($Case) {
    $qaBefore = Snapshot-Set $Case.paths
    Save-Json (Join-Path $Case.folder 'seed-before.json') $qaBefore
    $qaSeed = Installer-Call $Case 'seed' $Case.options
    $qaAfter = Snapshot-Set $Case.paths
    Save-Json (Join-Path $Case.folder 'seed-after.json') $qaAfter
    Preserve-Files (Join-Path $Case.folder 'seed-files') $qaAfter
    [void](Check-Install $Case $qaSeed $qaAfter $true 'info')
    Require ($qaBefore.source.sha256 -ceq $qaAfter.source.sha256 -and $qaBefore.foreign.sha256 -ceq $qaAfter.foreign.sha256) 'Seed changed source or unrelated artifact.'
    [IO.File]::Copy($Case.paths.desktop, $Case.paths.pin)
}

function Run-Positive([string]$Name, [bool]$Update, [bool]$NoShortcuts, [bool]$DiscoverNode) {
    $qaCase = New-Case $Name
    $qaLog = 'info'
    $qaPrevious = $null
    if ($Update) {
        Prepare-InstalledSentinel $qaCase
        $qaConfig = Get-Content -Raw -LiteralPath $qaCase.paths.config | ConvertFrom-Json -AsHashtable
        $qaPrevious = $qaConfig.LauncherAppUserModelId
        $qaCase.options['PinnedShortcut'] = $qaCase.paths.pin
        $qaLog = 'warn'
        $qaCase.options.Environment.GG_LOG_LEVEL = $qaLog
    }
    if ($DiscoverNode) { $qaCase.options.Remove('NodePath') }
    if ($NoShortcuts) { $qaCase.options['NoShortcuts'] = $true }
    $qaBefore = Snapshot-Set $qaCase.paths
    Save-Json (Join-Path $qaCase.folder 'before.json') $qaBefore
    $qaRun = Installer-Call $qaCase 'installer' $qaCase.options
    $qaAfter = Snapshot-Set $qaCase.paths
    Save-Json (Join-Path $qaCase.folder 'after.json') $qaAfter
    Preserve-Files (Join-Path $qaCase.folder 'after-files') $qaAfter
    $qaId = Check-Install $qaCase $qaRun $qaAfter (!$NoShortcuts) $qaLog
    $qaDiff = @(Watch-Changes $qaBefore $qaAfter)
    Require ('source' -notin $qaDiff -and 'foreign' -notin $qaDiff) 'Successful install changed the source or unrelated file.'
    if ($Update) { Require ($qaId -ceq $qaPrevious -and 'config' -in $qaDiff) 'Same-path update did not publish with a stable identity.' }
    if ($NoShortcuts) { Require (!($qaDiff | Where-Object { $_ -in @('desktop', 'programs', 'pin') })) '-NoShortcuts changed shortcut files.' }
    $qaResult = [ordered]@{ case = $Name; status = 'positive-met'; process = $qaRun; changed = $qaDiff }
    Save-Json (Join-Path $qaCase.folder 'result.json') $qaResult
    $qaResults.Add($qaResult)
}

function Configure-Refusal($Case, [string]$Mutation) {
    switch ($Mutation) {
        'blank-node' { $Case.options.NodePath = ''; break }
        'missing-node-discovery' { $Case.options.Remove('NodePath'); break }
        'missing-node' { $Case.options.NodePath = Join-Path $Case.work 'GG436_PRIVATE_PATH_CANARY.exe'; break }
        'unlaunchable-node' {
            $Case.options.NodePath = Join-Path $Case.work 'invalid image.exe'
            [IO.File]::WriteAllText($Case.options.NodePath, 'Deliberately invalid PE image.', $qaUtf8)
            break
        }
        { $_ -in @('old-runtime', 'wrong-major', 'malformed-runtime', 'failed-runtime') } {
            $Case.options.NodePath = Join-Path $qaVersionDir ($_ + '.exe'); break
        }
        'reserved-environment' { $Case.options.Environment['GG_PORT'] = [string]$Case.port; break }
        'reserved-no-shortcuts' {
            $Case.options.Environment['GG_PORT'] = [string]$Case.port
            $Case.options['NoShortcuts'] = $true
            break
        }
        'missing-source' {
            $Case.paths['suppliedSource'] = Join-Path (Split-Path -Parent $Case.paths.source) 'absent.lnk'
            $Case.options.PwaShortcut = $Case.paths.suppliedSource
            break
        }
        { $_ -in @('wrong-proxy', 'missing-app-id', 'missing-profile', 'wrong-origin', 'missing-app-user-model-id') } {
            $Case.paths['suppliedSource'] = Join-Path (Split-Path -Parent $Case.paths.source) 'input variant.lnk'
            Source-Link $Case $Case.paths.suppliedSource $_
            $Case.options.PwaShortcut = $Case.paths.suppliedSource
            break
        }
        'missing-pin' {
            $Case.paths['requestedPin'] = Join-Path (Split-Path -Parent $Case.paths.pin) 'absent pin.lnk'
            $Case.options['PinnedShortcut'] = $Case.paths.requestedPin
            break
        }
        'directory-destination' {
            $Case.paths['requestedPrograms'] = New-FixtureDirectory (Join-Path $Case.work 'invalid output.lnk')
            $Case.paths['childSentinel'] = Join-Path $Case.paths.requestedPrograms 'sentinel.txt'
            [IO.File]::WriteAllText($Case.paths.childSentinel, 'fixture directory occupant', $qaUtf8)
            $Case.options.StartMenuShortcut = $Case.paths.requestedPrograms
            break
        }
        'same-source' { $Case.options.DesktopShortcut = $Case.paths.source; break }
        'case-source' {
            $qaOther = Join-Path (Split-Path -Parent $Case.paths.source) 'CHROME α.lnk'
            Require ($qaOther -cne $Case.paths.source) 'Case fixture has one lexical spelling.'
            Require-SameFile $Case.paths.source $qaOther 'Case alias is not one physical file.'
            $Case.paths['sourceAlias'] = $qaOther
            $Case.options.DesktopShortcut = $qaOther
            break
        }
        'junction-source' {
            $qaJunction = Join-Path $Case.work 'source junction α'
            New-Item -ItemType Junction -Path $qaJunction -Target (Split-Path -Parent $Case.paths.source) | Out-Null
            Require (!(Is-PlainItem (Get-Item -LiteralPath $qaJunction -Force))) 'Expected Windows directory junction.'
            $Case.paths['sourceAlias'] = Join-Path $qaJunction (Split-Path -Leaf $Case.paths.source)
            Require-SameFile $Case.paths.source $Case.paths.sourceAlias 'Junction does not reach the original link.'
            $Case.options.DesktopShortcut = $Case.paths.sourceAlias
            break
        }
        'hardlink-source' {
            $Case.paths['sourceAlias'] = Join-Path $Case.work 'hard-link.lnk'
            New-Item -ItemType HardLink -Path $Case.paths.sourceAlias -Target $Case.paths.source | Out-Null
            Require-SameFile $Case.paths.source $Case.paths.sourceAlias 'Hard link was not one physical file.'
            $Case.options.DesktopShortcut = $Case.paths.sourceAlias
            break
        }
        'pairwise-destination' { $Case.options.StartMenuShortcut = $Case.paths.desktop; break }
        'pin-destination' { $Case.options['PinnedShortcut'] = $Case.paths.desktop; break }
        'config-destination' { $Case.options.DesktopShortcut = $Case.paths.config; break }
        'default-desktop' {
            foreach ($qaBoundFolder in @($qaDesktop, $qaPrograms)) {
                $qaCurrentFolder = Read-KnownFolder $qaBoundFolder.folder $qaProfile
                if ($qaCurrentFolder.reason) { return $qaCurrentFolder }
                if ($qaCurrentFolder.canonical -ine $qaBoundFolder.canonical) {
                    return [ordered]@{ reason = 'The known folder moved after binding.'; before = $qaBoundFolder; after = $qaCurrentFolder }
                }
            }
            $qaObstacle = Get-DefaultSourceObstacle (Split-Path -Parent $qaChromeAppsDefault) $true
            if (!$qaObstacle) { $qaObstacle = Get-DefaultSourceObstacle $qaChromeAppsDefault $false }
            if (!$qaObstacle) { $qaObstacle = Get-DefaultSourceObstacle $qaDesktopDefault $false }
            if ($qaObstacle) { return $qaObstacle }
            $qaOriginalBytes = [IO.File]::ReadAllBytes($Case.paths.source)
            try {
                $qaKnownFile = [IO.File]::Open($qaDesktopDefault, 'CreateNew', 'Write', 'None')
            } catch {
                $qaAvailability = Get-KnownFolderPathFailure $_.Exception $true
                if (!$qaAvailability) { throw }
                return [ordered]@{ reason = 'Could not create the exact disposable Desktop shortcut.'; path = $qaDesktopDefault
                    nativeError = $qaAvailability }
            }
            try { $qaKnownFile.Write($qaOriginalBytes) }
            finally { $qaKnownFile.Dispose() }
            $qaLink = Snapshot $qaDesktopDefault
            $qaOwnedKnownLinks.Add($qaLink)
            $Case.paths['defaultDesktop'] = $qaDesktopDefault
            $Case.options.Remove('PwaShortcut')
            $Case.options.Remove('DesktopShortcut')
            break
        }
        'missing-built-helper' {
            $qaOverlay = New-FixtureDirectory (Join-Path $Case.work 'checkout fixture')
            $qaApps = New-FixtureDirectory (Join-Path $qaOverlay 'apps')
            $qaApi = New-FixtureDirectory (Join-Path $qaApps 'api')
            $qaApiDist = New-FixtureDirectory (Join-Path $qaApi 'dist')
            $qaWeb = New-FixtureDirectory (Join-Path $qaApps 'web')
            $qaWebDist = New-FixtureDirectory (Join-Path $qaWeb 'dist')
            $qaLauncher = New-FixtureDirectory (Join-Path $qaApps 'windows-launcher')
            [IO.File]::Copy((Join-Path $qaCheckout 'apps/api/dist/main.js'), (Join-Path $qaApiDist 'main.js'))
            [IO.File]::Copy((Join-Path $qaCheckout 'apps/web/dist/index.html'), (Join-Path $qaWebDist 'index.html'))
            [IO.File]::Copy((Join-Path $qaCheckout 'apps/windows-launcher/Launcher.cs'), (Join-Path $qaLauncher 'Launcher.cs'))
            $Case.options.RepoPath = $qaOverlay
            break
        }
        'compile-failure' {
            $qaOverlay = New-FixtureDirectory (Join-Path $Case.work 'checkout fixture')
            $qaApps = New-FixtureDirectory (Join-Path $qaOverlay 'apps')
            foreach ($qaName in @('api', 'web')) {
                New-Item -ItemType Junction -Path (Join-Path $qaApps $qaName) -Target (Join-Path $qaCheckout "apps/$qaName") | Out-Null
                Require-SameFile (Join-Path $qaApps $qaName) (Join-Path $qaCheckout "apps/$qaName") 'Compile fixture lost bound build inputs.'
            }
            $qaLauncher = New-FixtureDirectory (Join-Path $qaApps 'windows-launcher')
            [IO.File]::WriteAllText((Join-Path $qaLauncher 'Launcher.cs'), '#error GG436 deliberate source failure', $qaUtf8)
            $Case.options.RepoPath = $qaOverlay
            break
        }
        default { throw "Unknown fixture mutation: $Mutation" }
    }
}

function Run-Refusal([string]$Name, [string]$Mutation, [string]$Diagnostic, [bool]$Seed) {
    $qaCase = New-Case $Name
    if ($Seed) { Prepare-InstalledSentinel $qaCase }
    $qaUnavailable = Configure-Refusal $qaCase $Mutation
    if ($qaUnavailable) {
        $qaResult = [ordered]@{ case = $Name; mutation = $Mutation; status = 'unavailable'; availability = $qaUnavailable }
        Save-Json (Join-Path $qaCase.folder 'result.json') $qaResult
        $qaResults.Add($qaResult)
        return
    }
    $qaBefore = Snapshot-Set $qaCase.paths
    Save-Json (Join-Path $qaCase.folder 'before.json') $qaBefore
    Preserve-Files (Join-Path $qaCase.folder 'before-files') $qaBefore
    $qaPath = if ($Mutation -eq 'missing-node-discovery') { $qaSystemPath } else { $qaNormalPath }
    $qaRun = Installer-Call $qaCase 'installer' $qaCase.options $qaPath
    $qaAfter = Snapshot-Set $qaCase.paths
    Save-Json (Join-Path $qaCase.folder 'after.json') $qaAfter
    Preserve-Files (Join-Path $qaCase.folder 'after-files') $qaAfter
    $qaDiff = @(Watch-Changes $qaBefore $qaAfter)
    $qaMessage = [IO.File]::ReadAllText($qaRun.stdout) + [Environment]::NewLine + [IO.File]::ReadAllText($qaRun.stderr)
    $qaProblems = [Collections.Generic.List[string]]::new()
    if ($qaRun.exitCode -eq 0) { $qaProblems.Add('Installer returned zero for invalid input.') }
    if ($qaDiff.Count) { $qaProblems.Add('Final artifact bytes or presence changed.') }
    if ($qaRun.portListeningAfter -or @(Get-ChildItem -LiteralPath $qaCase.options.DataDir -Force).Count) {
        $qaProblems.Add('Disposable service or store has side effects.')
    }
    if ($qaMessage -notmatch $Diagnostic) { $qaProblems.Add('Expected diagnostic category was absent.') }
    if ($qaMessage -match 'GG436_(PRIVATE_PATH|RAW_VERSION)_CANARY') { $qaProblems.Add('Installer echoed a diagnostic canary.') }
    if ($Mutation -match 'node|runtime|wrong-major' -and $qaMessage -match 'Resolve-Path|cannot bind argument.*path') {
        $qaProblems.Add('Installer exposed a generic path-resolution refusal.')
    }
    $qaStatus = if (!$qaProblems.Count) { 'refusal-met' } elseif ($Phase -eq 'baseline') { 'baseline-difference' } else { 'candidate-failure' }
    $qaResult = [ordered]@{
        case = $Name; mutation = $Mutation; status = $qaStatus; process = $qaRun; changed = $qaDiff
        expectedDiagnostic = $Diagnostic; problems = $qaProblems.ToArray(); existingInstall = $Seed
    }
    Save-Json (Join-Path $qaCase.folder 'result.json') $qaResult
    $qaResults.Add($qaResult)
    Require (!$qaRun.portListeningAfter) "An unexpected listener remains on $($qaCase.port). Preserve the results and stop this job's QA."
}

try {
    $qaTemp = New-FixtureDirectory (Join-Path $qaWork 'temp')
    # This compiles only the independent fixture interop on a later admitted execution.
    $env:TEMP = $qaTemp
    $env:TMP = $qaTemp
    Add-Type -Path (Join-Path $PSScriptRoot 'windows.cs')
    $qaRunnerTemp = [InstallerQa.Windows]::Identify($env:RUNNER_TEMP).Path
    $qaRoot = [InstallerQa.Windows]::Identify($qaRoot).Path
    Require (Is-Within $qaRoot $qaRunnerTemp) 'Evidence does not resolve under runner temporary storage.'
    $qaEvidence = [InstallerQa.Windows]::Identify($qaEvidence).Path
    $qaWork = [InstallerQa.Windows]::Identify($qaWork).Path
    Require ((Is-Within $qaEvidence $qaRoot) -and (Is-Within $qaWork $qaRoot)) 'Fixture paths left the owned root.'
    $qaFs = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($qaRoot))
    Require ($qaFs.DriveFormat -ieq 'NTFS') 'Expected the disposable fixture root on NTFS.'
    $qaCheckout = [InstallerQa.Windows]::Identify($Checkout).Path
    $qaWorkspace = [InstallerQa.Windows]::Identify($env:GITHUB_WORKSPACE).Path
    Require ($qaCheckout -ieq $qaWorkspace -or (Is-Within $qaCheckout $qaWorkspace)) 'Checkout must be in the hosted workspace.'
    $env:GIT_OPTIONAL_LOCKS = '0'
    $qaHead = & git -C $qaCheckout rev-parse HEAD
    Require ($LASTEXITCODE -eq 0 -and $qaHead -ceq $ExpectedCommit) 'Bound source commit differs.'
    $qaNode = [InstallerQa.Windows]::Identify($NodePath).Path
    Require ((Split-Path -Leaf $qaNode) -ieq 'node.exe') 'Bind the supported Node executable used by the default discovery case.'
    $qaProxy = [InstallerQa.Windows]::Identify($ChromeProxy).Path
    $qaProgramFiles = [Environment]::GetFolderPath('ProgramFiles')
    $qaProgramFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
    $qaChromeRoots = @($qaProgramFiles, $qaProgramFilesX86) | Where-Object { $_ } |
        ForEach-Object { Join-Path $_ 'Google\Chrome\Application' }
    Require ((Split-Path -Leaf $qaProxy) -ieq 'chrome_proxy.exe' -and
        ($qaChromeRoots | Where-Object { Is-Within $qaProxy $_ }) -and
        (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $qaProxy) 'chrome.exe') -PathType Leaf)) 'Bind the hosted image Chrome proxy.'
    $qaCompiler = [InstallerQa.Windows]::Identify((Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe')).Path
    $qaPowerShell = Join-Path $PSHOME 'pwsh.exe'
    $qaInvoke = Join-Path $PSScriptRoot 'invoke.ps1'
    $qaInstaller = Join-Path $qaCheckout 'scripts/install-windows-launcher.ps1'
    $qaSystemPath = (Join-Path $env:SystemRoot 'System32') + ';' + $env:SystemRoot
    $qaNormalPath = (Split-Path -Parent $qaNode) + ';' + $qaSystemPath
    Require (!(Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32\node.exe')) -and
        !(Test-Path -LiteralPath (Join-Path $env:SystemRoot 'node.exe'))) 'System PATH unexpectedly includes a Node executable.'
    $qaProfile = [InstallerQa.Windows]::Identify($env:USERPROFILE).Path
    $qaDesktop = Read-KnownFolder 'Desktop' $qaProfile
    $qaPrograms = Read-KnownFolder 'Programs' $qaProfile
    $qaDesktopDefault = ''
    $qaChromeAppsDefault = ''
    $qaKnownFolderUnavailable = @(@($qaDesktop, $qaPrograms) | Where-Object { $_.reason })
    if (!$qaKnownFolderUnavailable.Count) {
        $qaDesktopDefault = Join-Path $qaDesktop.canonical 'GraphGoblin.lnk'
        $qaChromeAppsDefault = Join-Path $qaPrograms.canonical 'Chrome Apps\GraphGoblin.lnk'
    }
    $qaFiles = @($qaInstaller, $qaNode, $qaProxy, $qaCompiler, $qaPowerShell, $qaInvoke,
        (Join-Path $PSScriptRoot 'run.ps1'), (Join-Path $PSScriptRoot 'windows.cs'),
        (Join-Path $PSScriptRoot 'version-fixture.cs'))
    foreach ($qaRelative in @('apps/windows-launcher/Launcher.cs', 'apps/api/dist/main.js',
        'apps/api/dist/instance-identity.js', 'apps/web/dist/index.html', 'apps/web/dist-goblin/index.html')) {
        $qaFiles += Join-Path $qaCheckout $qaRelative
    }
    $qaBinding = [ordered]@{}
    foreach ($qaFile in $qaFiles) { $qaBinding[$qaFile] = Digest $qaFile }
    Save-Json (Join-Path $qaEvidence 'binding.json') ([ordered]@{
        phase = $Phase; head = $qaHead; files = $qaBinding; edition = $PSVersionTable.PSVersion.ToString()
        image = $env:ImageOS; imageVersion = $env:ImageVersion; os = [Runtime.InteropServices.RuntimeInformation]::OSDescription
        architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
        sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        session = [Diagnostics.Process]::GetCurrentProcess().SessionId; profile = $qaProfile
        desktop = $qaDesktop; programs = $qaPrograms; fixtureRoot = $qaRoot; pid = $PID
        browserFixture = 'independent native .lnk targeting image Chrome, no installed profile'
        networkEvidence = 'isolated-port snapshots; no continuous process-creation trace in this driver'
    })
    $qaVersionResult = Invoke-OwnedChild $qaEvidence 'real-node' $qaNode @('--version') $qaWork $qaTemp $qaNormalPath
    $qaVersion = [IO.File]::ReadAllText($qaVersionResult.stdout).Trim()
    Require ($qaVersionResult.exitCode -eq 0 -and $qaVersion -match '^v22\.\d+\.\d+$' -and
        [version]$qaVersion.Substring(1) -ge [version]'22.22.2') 'Expected supported Node 22 for the positive installer cases.'
    $qaVersionDir = New-FixtureDirectory (Join-Path $qaWork 'node-probe-fixtures')
    $qaShim = Join-Path $qaVersionDir 'fixture.exe'
    $qaBuildShim = Invoke-OwnedChild $qaEvidence 'version-fixture-compiler' $qaCompiler `
        @('/nologo', '/target:exe', '/platform:x64', "/out:$qaShim", (Join-Path $PSScriptRoot 'version-fixture.cs')) `
        $qaVersionDir $qaTemp $qaSystemPath
    Require ($qaBuildShim.exitCode -eq 0 -and (Test-Path -LiteralPath $qaShim -PathType Leaf)) 'Could not build the labelled version-only fixture.'
    foreach ($qaProbe in @('old-runtime', 'wrong-major', 'malformed-runtime', 'failed-runtime')) {
        [IO.File]::Copy($qaShim, (Join-Path $qaVersionDir ($qaProbe + '.exe')))
    }

    Run-Positive '01' $false $false $false
    Run-Positive '02' $true $false $false
    Run-Positive '03' $true $true $false
    Run-Positive '04' $false $false $true

    $qaNodeHelp = '(?is)\bNode\b.*22\.22\.2'
    $qaCollision = '(?i)collid|collision|same (file|path|shortcut)|overlap|distinct|duplicate|separate'
    Run-Refusal '05' 'blank-node' $qaNodeHelp $false
    Run-Refusal '06' 'missing-node-discovery' $qaNodeHelp $false
    Run-Refusal '07' 'missing-node' $qaNodeHelp $true
    Run-Refusal '08' 'old-runtime' $qaNodeHelp $false
    Run-Refusal '09' 'wrong-major' $qaNodeHelp $false
    Run-Refusal '10' 'malformed-runtime' $qaNodeHelp $false
    Run-Refusal '11' 'failed-runtime' $qaNodeHelp $false
    Run-Refusal '12' 'missing-built-helper' '(?i)build|identity helper' $true
    Run-Refusal '13' 'compile-failure' '(?i)compil|csc' $true
    Run-Refusal '14' 'reserved-environment' '(?i)GG_PORT|reserved|owned.*explicit' $true
    Run-Refusal '15' 'reserved-no-shortcuts' '(?i)GG_PORT|reserved|owned.*explicit' $true
    Run-Refusal '16' 'missing-source' '(?i)PwaShortcut|PWA.*shortcut' $false
    Run-Refusal '17' 'wrong-proxy' '(?i)proxy|PWA.*target' $true
    Run-Refusal '18' 'missing-app-id' '(?i)app.?id|PWA.*shortcut' $false
    Run-Refusal '19' 'missing-profile' '(?i)profile' $false
    Run-Refusal '20' 'wrong-origin' '(?i)origin|port' $true
    Run-Refusal '21' 'missing-app-user-model-id' '(?i)AppUserModelID|application user model' $false
    Run-Refusal '22' 'missing-pin' '(?i)pin.*shortcut|PinnedShortcut' $true
    Run-Refusal '23' 'directory-destination' '(?i)destination|output|regular file|shortcut.*path' $true
    Run-Refusal '24' 'same-source' $qaCollision $true
    Run-Refusal '25' 'case-source' $qaCollision $false
    Run-Refusal '26' 'junction-source' ($qaCollision + '|reparse|junction') $false
    Run-Refusal '27' 'hardlink-source' ($qaCollision + '|hard.?link') $false
    Run-Refusal '28' 'pairwise-destination' $qaCollision $true
    Run-Refusal '29' 'pin-destination' $qaCollision $true
    Run-Refusal '30' 'config-destination' ($qaCollision + '|extension|\.lnk|reserved|managed') $true
    if ($qaKnownFolderUnavailable.Count) {
        $qaResult = [ordered]@{ case = '31'; mutation = 'default-desktop'; status = 'unavailable'; availability = $qaKnownFolderUnavailable }
        Save-Json (Join-Path $qaEvidence '31-unavailable.json') $qaResult
        $qaResults.Add($qaResult)
    } else { Run-Refusal '31' 'default-desktop' $qaCollision $false }
    Run-Refusal '32' 'unlaunchable-node' $qaNodeHelp $false

    $qaPost = [ordered]@{}
    foreach ($qaFile in $qaBinding.Keys) {
        $qaPost[$qaFile] = Digest $qaFile
        Require ($qaPost[$qaFile] -ceq $qaBinding[$qaFile]) "Bound input changed: $qaFile"
    }
    Save-Json (Join-Path $qaEvidence 'post-binding.json') $qaPost
} catch {
    $qaFailure = $_.Exception.Message
    Save-Json (Join-Path $qaEvidence 'first-runner-failure.json') ([ordered]@{ error = $qaFailure; stack = $_.ScriptStackTrace })
} finally {
    $qaCleanup = [Collections.Generic.List[object]]::new()
    if ($null -eq $qaFailure) {
        try {
            foreach ($qaOwnedLink in $qaOwnedKnownLinks) {
                $qaCurrent = Snapshot $qaOwnedLink.path
                $qaSame = $qaCurrent.kind -eq 'file' -and $qaCurrent.sha256 -ceq $qaOwnedLink.sha256 -and
                    $qaCurrent.identity.Volume -ceq $qaOwnedLink.identity.Volume -and
                    $qaCurrent.identity.FileId -ceq $qaOwnedLink.identity.FileId
                if ($qaSame) { [IO.File]::Delete($qaOwnedLink.path) }
                $qaCleanup.Add([ordered]@{ path = $qaOwnedLink.path; deletedExactOriginal = $qaSame; retained = !$qaSame })
            }
        } catch { $qaCleanupFailure = $_.Exception.Message }
    }
    Save-Json (Join-Path $qaEvidence 'summary.json') ([ordered]@{
        phase = $Phase; status = if ($qaFailure -or $qaCleanupFailure -or ($qaResults | Where-Object { $_.status -in @('candidate-failure', 'unavailable') })) {
            'incomplete'
        } else { 'completed' }
        boundedChildCalls = $qaAttempt; seconds = $qaTimer.Elapsed.TotalSeconds; error = $qaFailure; cleanupError = $qaCleanupFailure
        cases = $qaResults.ToArray(); knownFolderCleanup = $qaCleanup.ToArray()
        retained = 'runner fixture tree and any ambiguous known-folder file; VM lifecycle owns teardown'
        gaps = @('post-mutation rollback/interrupt point', 'browser-created PWA provenance', 'continuous process-birth observation')
    })
}
if ($qaFailure -or $qaCleanupFailure -or ($qaResults | Where-Object { $_.status -in @('candidate-failure', 'unavailable') })) { exit 1 }
exit 0
