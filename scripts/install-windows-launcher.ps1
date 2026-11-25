# Configure a launcher for an already built checkout and an already installed Chrome PWA.
[CmdletBinding()]
param(
    [string]$RepoPath = (Split-Path $PSScriptRoot -Parent),
    [string]$NodePath = (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
    [string]$DataDir = $(if ($env:GG_DATA_DIR) { $env:GG_DATA_DIR } else { Join-Path $env:USERPROFILE '.graphgoblin' }),
    [ValidateRange(1, 65535)][int]$Port = 4747,
    [string]$PwaShortcut,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'GraphGoblin\Launcher'),
    [hashtable]$Environment = @{},
    [string]$DesktopShortcut,
    [string]$StartMenuShortcut,
    [string]$PinnedShortcut,
    [switch]$NoShortcuts
)
$ErrorActionPreference = 'Stop'

function Refuse-LauncherInstall([string]$Message) {
    $failure = [InvalidOperationException]::new($Message)
    $failure.Data['LauncherInstallerRefusal'] = $true
    throw $failure
}

function Invoke-InstallerProcess([string]$Executable, [string[]]$Arguments, [int]$TimeoutSeconds) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    # Windows PowerShell 5.1 has no ArgumentList on ProcessStartInfo.
    $info.Arguments = ($Arguments | ForEach-Object {
        '"' + (($_ -creplace '(\\*)"', '$1$1\"') -creplace '(\\+)$', '$1$1') + '"'
    }) -join ' '
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $info.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $process = [Diagnostics.Process]::Start($info)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit($TimeoutSeconds * 1000)) {
            if (!$process.HasExited) { try { $process.Kill() } catch { if (!$process.HasExited) { throw } } }
            [void]$process.WaitForExit(2000)
            throw [TimeoutException]::new()
        }
        if (![Threading.Tasks.Task]::WaitAll(@($stdout, $stderr), 2000)) {
            throw [TimeoutException]::new()
        }
        [pscustomobject]@{ Code = $process.ExitCode; Stdout = $stdout.Result; Stderr = $stderr.Result }
    } finally {
        $process.Dispose()
    }
}

function Get-InstallerNode([string]$Path) {
    $guidance = 'Select a working Node 22 executable (22.22.2 or later) with -NodePath, then run the installer again.'
    if ([string]::IsNullOrWhiteSpace($Path)) {
        Refuse-LauncherInstall "Node was not found. Install Node 22 from https://nodejs.org/. $guidance"
    }
    try {
        $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
        if (![IO.File]::Exists($full)) { $full = $null }
    } catch { $full = $null }
    if (!$full) { Refuse-LauncherInstall "The selected Node executable was not found. $guidance" }

    try { $result = Invoke-InstallerProcess $full @('--version') 10 }
    catch { Refuse-LauncherInstall "The selected Node executable could not be run. $guidance" }
    if ($result.Code -ne 0) { Refuse-LauncherInstall "The selected Node executable could not be run. $guidance" }
    $version = $result.Stdout.Trim()
    if ($result.Stderr -or $version -cnotmatch '^v[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$') {
        Refuse-LauncherInstall "The selected Node executable reported an unrecognized version. $guidance"
    }
    $parsed = [version]$version.Substring(1)
    if ($parsed.Major -ne 22 -or $parsed -lt [version]'22.22.2') {
        Refuse-LauncherInstall "The selected Node reports $version. $guidance"
    }
    $full
}

function Initialize-InstallerPaths {
    if ('GraphGoblin.Installation.Paths' -as [type]) { return }
    Add-Type -TypeDefinition @'
using Microsoft.Win32.SafeHandles;
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace GraphGoblin.Installation
{
    public sealed class PathIdentity
    {
        public string Path, Anchor, Id;
        public bool IsDirectory, IsLink;
    }

    public static class Paths
    {
        [StructLayout(LayoutKind.Sequential)]
        struct FileInformation
        {
            public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh,
                WriteLow, WriteHigh, Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security,
            uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern uint GetFileAttributes(string path);

        public static PathIdentity Read(string path)
        {
            path = Path.GetFullPath(path);
            // Zero requested access supports identity reads on files opened by another reader.
            using (var handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero))
            {
                if (handle.IsInvalid)
                {
                    int error = Marshal.GetLastWin32Error();
                    string parent = Path.GetDirectoryName(path);
                    if ((error != 2 && error != 3) || parent == null || GetFileAttributes(path) != uint.MaxValue)
                        throw new Win32Exception(error);
                    var ancestor = Read(parent);
                    if (ancestor.Id != null && !ancestor.IsDirectory) throw new IOException();
                    return new PathIdentity { Path = Path.Combine(ancestor.Path, Path.GetFileName(path)), Anchor = ancestor.Anchor };
                }

                FileInformation information;
                if (!GetFileInformationByHandle(handle, out information)) throw new Win32Exception();
                var output = new StringBuilder(32768);
                uint length = GetFinalPathNameByHandle(handle, output, (uint)output.Capacity, 0);
                if (length == 0 || length >= output.Capacity) throw new Win32Exception();
                string resolved = output.ToString();
                if (resolved.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
                    resolved = @"\\" + resolved.Substring(8);
                else if (resolved.StartsWith(@"\\?\", StringComparison.Ordinal))
                    resolved = resolved.Substring(4);
                bool directory = (information.Attributes & 16) != 0;
                uint attributes = GetFileAttributes(path);
                if (attributes == uint.MaxValue) throw new Win32Exception();
                return new PathIdentity {
                    Path = resolved, Anchor = directory ? resolved : Path.GetDirectoryName(resolved),
                    Id = information.Volume.ToString("X8") + ":" + information.IndexHigh.ToString("X8") + information.IndexLow.ToString("X8"),
                    IsDirectory = directory, IsLink = (attributes & 0x400) != 0,
                };
            }
        }
    }
}
'@
}

function Get-InstallerPath([string]$Path) {
    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    [GraphGoblin.Installation.Paths]::Read($full)
}

function Get-InstallerDigest([string]$Path) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { [BitConverter]::ToString($sha.ComputeHash($stream)) }
        finally { $sha.Dispose() }
    } finally { $stream.Dispose() }
}

function Test-InstallerFile($Identity, [string]$ExpectedId, [string]$ExpectedDigest) {
    $Identity.Id -and !$Identity.IsDirectory -and !$Identity.IsLink -and
        $Identity.Id -ceq $ExpectedId -and (Get-InstallerDigest $Identity.Path) -ceq $ExpectedDigest
}

function Publish-LauncherArtifacts {
    param(
        [Parameter(Mandatory)][object[]]$Artifacts,
        [scriptblock]$PublishOne = {
            param($Entry)
            if ($Entry.Original.Id) { [IO.File]::Replace($Entry.Staged, $Entry.Original.Path, $Entry.Backup) }
            else { [IO.File]::Move($Entry.Staged, $Entry.Original.Path) }
        }
    )
    $attempted = [Collections.Generic.List[object]]::new()
    try {
        foreach ($entry in $Artifacts) {
            $current = Get-InstallerPath $entry.Original.Path
            if ($current.Path -ine $entry.Original.Path -or $current.Id -cne $entry.Original.Id -or
                ($current.Id -and !(Test-InstallerFile $current $entry.Original.Id $entry.OriginalDigest))) {
                throw [IO.IOException]::new()
            }
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($current.Path))
            # Record the attempt before native I/O: Replace can move the original and still fail.
            $attempted.Add($entry)
            & $PublishOne $entry | Out-Null
            if (!(Test-InstallerFile (Get-InstallerPath $current.Path) $entry.StageId $entry.StageDigest)) {
                throw [IO.IOException]::new()
            }
        }
        return 'published'
    } catch {
        $verified = $true
        $restored = $false
        for ($index = $attempted.Count - 1; $index -ge 0; $index--) {
            $entry = $attempted[$index]
            try {
                $current = Get-InstallerPath $entry.Original.Path
                if ($current.Path -ine $entry.Original.Path) { throw [IO.IOException]::new() }
                if ($entry.Original.Id) {
                    if (Test-InstallerFile $current $entry.Original.Id $entry.OriginalDigest) { continue }
                    $backup = Get-InstallerPath $entry.Backup
                    if (!(Test-InstallerFile $backup $entry.Original.Id $entry.OriginalDigest)) {
                        throw [IO.IOException]::new()
                    }
                    if (!$current.Id) {
                        [IO.File]::Move($entry.Backup, $current.Path)
                    } elseif (Test-InstallerFile $current $entry.StageId $entry.StageDigest) {
                        [IO.File]::Replace($entry.Backup, $current.Path, $entry.Backup + '.replacement')
                    } else { throw [IO.IOException]::new() }
                    if (!(Test-InstallerFile (Get-InstallerPath $current.Path) $entry.Original.Id $entry.OriginalDigest)) {
                        throw [IO.IOException]::new()
                    }
                    $restored = $true
                } elseif ($current.Id) {
                    if (!(Test-InstallerFile $current $entry.StageId $entry.StageDigest)) { throw [IO.IOException]::new() }
                    [IO.File]::Delete($current.Path)
                    if ((Get-InstallerPath $current.Path).Id) { throw [IO.IOException]::new() }
                    $restored = $true
                }
            } catch { $verified = $false }
        }
        if (!$verified) { return 'recovery-required' }
        if ($restored) { return 'restored' }
        return 'publication-refused'
    }
}

# The .NET Framework C# compiler reports failed Win32 resource preparation as error CS1567 or
# CS1619; a long staging path is one cause. Each stdout and stderr line is classified by its leading
# diagnostic field alone. The line either starts with it, as in 'error CS1619:', or it follows a csc
# tool label or file name prefix, with or without a numeric location, that ends at the first colon
# other than a leading drive colon; file names may contain spaces. The field is identified before
# the allowlist applies, so a warning, fatal error or other code never qualifies, nor does a later
# separator or code text in its message. Only an allowlisted code from a failed compile is
# returned, never compiler text, paths or the localized system reason.
function Get-CompilerResourceFailure($Result) {
    if ($Result.Code -eq 0) { return $null }
    foreach ($text in @($Result.Stdout, $Result.Stderr)) {
        if (!$text) { continue }
        foreach ($line in $text -split '\r\n|\r|\n') {
            # The prefix is optional and tried last, so a line that starts with a field keeps it.
            if ($line -imatch '^(?:(?:[a-z]:[\\/]|[^\s:])[^:]*:\s*)??((?:fatal\s+)?error|warning)\s+([^\s:]+)\s*:' -and
                $Matches[1] -ceq 'error' -and $Matches[2] -cin 'CS1567', 'CS1619') { return $Matches[2] }
        }
    }
    $null
}

function Invoke-StagedLauncher([string[]]$Arguments, [string]$Failure) {
    $result = Invoke-InstallerProcess $stagedExe $Arguments 15
    if ($result.Code -ne 0 -or $result.Stderr) { Refuse-LauncherInstall $Failure }
    $result.Stdout.Trim()
}

function New-InstallerStage([string]$Anchor) {
    $name = 'gg-launcher-stage-' + [Guid]::NewGuid().ToString('N')
    $path = Join-Path $Anchor $name
    $item = New-Item -ItemType Directory -Path $path
    $owned = Get-InstallerPath $item.FullName
    if (!$owned.IsDirectory -or $owned.IsLink -or $owned.Path -ine $path) { throw [IO.IOException]::new() }
    $stages.Add($owned)
    $owned.Path
}

$stages = [Collections.Generic.List[object]]::new()
$retainStages = $false
try {
    if ($env:OS -ne 'Windows_NT') { Refuse-LauncherInstall 'The desktop launcher requires Windows.' }
    # Refuse before creating a stage or serializing any values, including empty credentials.
    # PSBase avoids a supplied 'Keys' entry shadowing the hashtable property.
    foreach ($key in $Environment.psbase.Keys) {
        if ([string]::Equals($key, 'GG_MASTER_KEY', [StringComparison]::OrdinalIgnoreCase) -or
            [string]::Equals($key, 'GG_JEV_API_KEY', [StringComparison]::OrdinalIgnoreCase)) {
            Refuse-LauncherInstall 'Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY (case-insensitive). Keep credentials in GraphGoblin secret stores; use the data directory master.key for encryption.'
        }
    }
    $NodePath = Get-InstallerNode $NodePath
    $RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path
    $DataDir = [IO.Path]::GetFullPath($DataDir)
    $InstallDir = [IO.Path]::GetFullPath($InstallDir)
    # The staged native validator also requires the exact bounded-log protocol in the built entry.
    foreach ($file in @('apps/api/dist/main.js', 'apps/api/dist/instance-identity.js', 'apps/api/dist/windows-log/guard.js', 'apps/web/dist/index.html')) {
        if (![IO.File]::Exists((Join-Path $RepoPath $file))) { Refuse-LauncherInstall "Build the checkout first: missing $file" }
    }
    $desktop = [Environment]::GetFolderPath('Desktop')
    $programs = [Environment]::GetFolderPath('Programs')
    if (!$PwaShortcut) {
        $candidates = @(
            if ($programs) { Join-Path $programs 'Chrome Apps\GraphGoblin.lnk' }
            if ($desktop) { Join-Path $desktop 'GraphGoblin.lnk' }
        )
        $PwaShortcut = $candidates | Where-Object { [IO.File]::Exists($_) } | Select-Object -First 1
    }
    if ($PwaShortcut) {
        try { $PwaShortcut = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PwaShortcut) }
        catch { $PwaShortcut = $null }
    }
    if (!$PwaShortcut -or ![IO.File]::Exists($PwaShortcut) -or [IO.Path]::GetExtension($PwaShortcut) -ine '.lnk') {
        Refuse-LauncherInstall 'Install the Chrome PWA, then supply -PwaShortcut with its .lnk path.'
    }

    Initialize-InstallerPaths
    $source = Get-InstallerPath $PwaShortcut
    $sourceDigest = Get-InstallerDigest $source.Path
    $exe = Join-Path $InstallDir 'GraphGoblin.exe'
    $paths = @($exe, "$exe.json")
    if (!$NoShortcuts) {
        if (!$PSBoundParameters.ContainsKey('DesktopShortcut') -and $desktop) {
            $DesktopShortcut = Join-Path $desktop 'GraphGoblin.lnk'
        }
        if (!$PSBoundParameters.ContainsKey('StartMenuShortcut') -and $programs) {
            $StartMenuShortcut = Join-Path $programs 'GraphGoblin.lnk'
        }
        $paths += @($DesktopShortcut, $StartMenuShortcut)
        if ($PSBoundParameters.ContainsKey('PinnedShortcut')) {
            if ($PinnedShortcut) {
                try { $PinnedShortcut = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PinnedShortcut) }
                catch { $PinnedShortcut = $null }
            }
            if (!$PinnedShortcut -or ![IO.File]::Exists($PinnedShortcut)) {
                Refuse-LauncherInstall 'PinnedShortcut must name the existing GraphGoblin taskbar shortcut.'
            }
            $paths += $PinnedShortcut
        }
    }
    $destinations = [Collections.Generic.List[object]]::new()
    $originalDigests = [Collections.Generic.List[string]]::new()
    $seenPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $seenIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    [void]$seenPaths.Add($source.Path)
    [void]$seenIds.Add($source.Id)
    foreach ($path in $paths) {
        if ([string]::IsNullOrWhiteSpace($path)) { Refuse-LauncherInstall 'Choose a valid output shortcut path.' }
        try { $destination = Get-InstallerPath $path }
        catch { Refuse-LauncherInstall 'Choose an available output path and parent directory.' }
        foreach ($earlier in $seenPaths) {
            if ($destination.Path.StartsWith($earlier + '\', [StringComparison]::OrdinalIgnoreCase) -or
                $earlier.StartsWith($destination.Path + '\', [StringComparison]::OrdinalIgnoreCase)) {
                Refuse-LauncherInstall 'The PWA source and launcher outputs must use distinct files and paths. Choose a separate shortcut destination.'
            }
        }
        if (!$seenPaths.Add($destination.Path) -or ($destination.Id -and !$seenIds.Add($destination.Id))) {
            Refuse-LauncherInstall 'The PWA source and launcher outputs must use distinct files and paths. Choose a separate shortcut destination.'
        }
        if ($destination.IsDirectory -or $destination.IsLink -or
            ($destinations.Count -ge 2 -and [IO.Path]::GetExtension($destination.Path) -ine '.lnk')) {
            Refuse-LauncherInstall 'Choose a regular output file with the required shortcut extension.'
        }
        $destinations.Add($destination)
        $originalDigest = if ($destination.Id) { Get-InstallerDigest $destination.Path } else { '' }
        $originalDigests.Add($originalDigest)
    }
    $exe = $destinations[0].Path
    # Preserve the adjacent config rule even if the selected install folder uses a junction.
    if ($destinations[1].Path -ine "$exe.json") { Refuse-LauncherInstall 'Choose adjacent launcher executable and configuration files.' }

    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (![IO.File]::Exists($compiler)) { Refuse-LauncherInstall '.NET Framework 4.x C# compiler is required.' }
    $stage = New-InstallerStage $destinations[0].Anchor
    $stagedExe = Join-Path $stage 'GraphGoblin.exe'
    $stagedConfig = "$stagedExe.json"
    try {
        $compile = Invoke-InstallerProcess $compiler @(
            '/nologo', '/target:winexe', '/optimize+', '/platform:x64',
            '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll',
            "/out:$stagedExe", (Join-Path $RepoPath 'apps/windows-launcher/Launcher.cs')
        ) 30
    } catch { Refuse-LauncherInstall 'Launcher compilation failed. Check the .NET Framework compiler and checkout.' }
    $resourceFailure = Get-CompilerResourceFailure $compile
    if ($resourceFailure) {
        Refuse-LauncherInstall "Launcher compilation failed while the .NET Framework C# compiler prepared the launcher's Win32 resources (compiler error $resourceFailure). The installer compiles in a temporary gg-launcher-stage folder inside the install folder, or its nearest existing parent, and that staging path may be too long for this compiler. Choose a shorter writable local folder with -InstallDir, then run the installer again."
    }
    if ($compile.Code -ne 0 -or ![IO.File]::Exists($stagedExe)) { Refuse-LauncherInstall 'Launcher compilation failed.' }

    $linkHelp = 'PwaShortcut must name an installed Chrome PWA shortcut.'
    $pwa = (Invoke-StagedLauncher @('--inspect-shortcut', $source.Path) $linkHelp) | ConvertFrom-Json
    if ([IO.Path]::GetFileName($pwa.TargetPath) -ine 'chrome_proxy.exe' -or ![IO.File]::Exists($pwa.TargetPath)) {
        Refuse-LauncherInstall 'The PWA shortcut must target an existing Chrome chrome_proxy.exe.'
    }
    if ($pwa.Arguments -cnotmatch '(?:^|\s)--app-id=([a-p]{32})(?:\s|$)') {
        Refuse-LauncherInstall 'The PWA shortcut must supply a Chrome app ID.'
    }
    $appId = $Matches[1]
    if ($pwa.Arguments -cnotmatch '(?:^|\s)--profile-directory=(?:"([^"]+)"|(\S+))') {
        Refuse-LauncherInstall 'The PWA shortcut must identify its Chrome profile.'
    }
    $profile = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
    $expectedAppId = Invoke-StagedLauncher @('--expected-app-id', $Port.ToString()) 'Could not check the Chrome PWA origin.'
    if ($appId -cne $expectedAppId) {
        Refuse-LauncherInstall "The PWA shortcut belongs to another origin. Install GraphGoblin from http://127.0.0.1:$Port/app/ and use that shortcut."
    }
    $pwaId = Invoke-StagedLauncher @('--read-shortcut-id', $source.Path) 'Could not read the PWA shortcut AppUserModelID.'
    if (!$pwaId) { Refuse-LauncherInstall 'The PWA shortcut has no Windows AppUserModelID. Recreate it from Chrome.' }
    if (!$NoShortcuts -and $PinnedShortcut) {
        Invoke-StagedLauncher @('--inspect-shortcut', $destinations[$destinations.Count - 1].Path) 'PinnedShortcut must be an existing Windows shortcut.' | Out-Null
    }

    $sha = [Security.Cryptography.SHA256]::Create()
    try { $identity = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($exe.ToUpperInvariant())))).Replace('-', '').ToLowerInvariant().Substring(0, 24) }
    finally { $sha.Dispose() }
    # Only explicitly supplied overrides are persisted.
    $config = [ordered]@{
        Repo = $RepoPath; Node = $NodePath; DataDir = $DataDir; Port = $Port
        ChromeProxy = $pwa.TargetPath; ChromeProfile = $profile; ChromeAppId = $appId
        IconLocation = $pwa.IconLocation
        PwaAppUserModelId = $pwaId; LauncherAppUserModelId = "GraphGoblin.$identity"
        Environment = $Environment; StartupTimeoutSeconds = 60; WindowTimeoutSeconds = 30
    }
    [IO.File]::WriteAllText($stagedConfig, ($config | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
    $validation = Invoke-InstallerProcess $stagedExe @('--validate-install', '--config', $stagedConfig) 15
    if ($validation.Code -ne 0 -or $validation.Stderr -or $validation.Stdout) {
        Refuse-LauncherInstall 'The staged launcher configuration was refused. Check the launcher paths, built checkout and reserved GG_* overrides.'
    }

    $staged = @($stagedExe, $stagedConfig)
    for ($index = 2; $index -lt $destinations.Count; $index++) {
        $linkStage = New-InstallerStage $destinations[$index].Anchor
        $link = Join-Path $linkStage 'GraphGoblin.lnk'
        Invoke-StagedLauncher @('--stage-shortcut', $link, $stagedConfig, $exe) 'Could not prepare a launcher shortcut.' | Out-Null
        $staged += $link
    }
    $artifacts = @(
        for ($index = 0; $index -lt $destinations.Count; $index++) {
            $destination = $destinations[$index]
            $candidate = Get-InstallerPath $staged[$index]
            if (!$candidate.Id -or $candidate.IsDirectory -or $candidate.IsLink) { throw [IO.IOException]::new() }
            [pscustomobject]@{
                Original = $destination
                OriginalDigest = $originalDigests[$index]
                Staged = $candidate.Path
                StageId = $candidate.Id
                StageDigest = Get-InstallerDigest $candidate.Path
                Backup = $candidate.Path + '.previous'
            }
        }
    )
    $currentSource = Get-InstallerPath $source.Path
    if (!(Test-InstallerFile $currentSource $source.Id $sourceDigest)) {
        Refuse-LauncherInstall 'The PWA shortcut changed during preparation. Select its current file and run the installer again.'
    }

    $retainStages = $true
    $result = Publish-LauncherArtifacts -Artifacts $artifacts
    $retainStages = $result -eq 'recovery-required'
    switch ($result) {
        'published' { }
        'restored' { Refuse-LauncherInstall 'Launcher publication failed. The previous files were restored.' }
        'publication-refused' { Refuse-LauncherInstall 'Launcher publication was refused before any files were replaced. Check the output paths and permissions.' }
        default {
            $retainStages = $true
            Refuse-LauncherInstall 'Launcher publication failed and restoration could not be verified. Keep the gg-launcher-stage folders near the requested outputs for recovery.'
        }
    }
    Write-Output 'Launcher configured.'
    Write-Output "Gateway: http://127.0.0.1:$Port/app/"
    if (!$NoShortcuts) {
        Write-Output 'Open GraphGoblin with the new desktop shortcut. Pin its running taskbar button, replacing any old direct Chrome pin.'
    }
} catch {
    if ($_.Exception.Data['LauncherInstallerRefusal']) { throw $_.Exception.Message }
    if ($retainStages) { throw 'Launcher publication failed and restoration could not be verified. Keep the gg-launcher-stage folders near the requested outputs for recovery.' }
    throw 'Could not prepare the launcher installation. Check the built checkout, PWA shortcut and output paths.'
} finally {
    if (!$retainStages) {
        foreach ($ownedStage in $stages) {
            try {
                $currentStage = Get-InstallerPath $ownedStage.Path
                if ($currentStage.Id -cne $ownedStage.Id -or $currentStage.IsLink -or
                    $currentStage.Path -ine $ownedStage.Path) { continue }
                foreach ($file in [IO.Directory]::EnumerateFiles($ownedStage.Path)) {
                    [IO.File]::Delete($file)
                }
                [IO.Directory]::Delete($ownedStage.Path, $false)
            } catch { }
        }
    }
}
