# Configure a launcher for an already built checkout and an already installed Chrome PWA.
[CmdletBinding()]
param(
    [string]$RepoPath = (Split-Path $PSScriptRoot -Parent),
    [string]$NodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source,
    [string]$DataDir = $(if ($env:GG_DATA_DIR) { $env:GG_DATA_DIR } else { Join-Path $env:USERPROFILE '.graphgoblin' }),
    [ValidateRange(1, 65535)][int]$Port = 4747,
    [string]$PwaShortcut,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'GraphGoblin\Launcher'),
    [hashtable]$Environment = @{},
    [string]$DesktopShortcut = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'GraphGoblin.lnk'),
    [string]$StartMenuShortcut = (Join-Path ([Environment]::GetFolderPath('Programs')) 'GraphGoblin.lnk'),
    [string]$PinnedShortcut,
    [switch]$NoShortcuts
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'The desktop launcher requires Windows.' }
$RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$DataDir = [IO.Path]::GetFullPath($DataDir)
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$version = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v22\.\d+\.\d+$' -or [version]$version.Substring(1) -lt [version]'22.22.2') { throw "Select Node 22.22.2 or later; configured runtime reports $version" }
foreach ($file in @('apps/api/dist/main.js', 'apps/api/dist/instance-identity.js', 'apps/web/dist/index.html')) {
    if (!(Test-Path -LiteralPath (Join-Path $RepoPath $file))) { throw "Build the checkout first: missing $file" }
}
if (!$PwaShortcut) {
    $candidates = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'Chrome Apps\GraphGoblin.lnk'),
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'GraphGoblin.lnk'))
    $PwaShortcut = $candidates | Where-Object {
        Test-Path -LiteralPath $_
    } | Select-Object -First 1
}
if (!$PwaShortcut -or !(Test-Path -LiteralPath $PwaShortcut)) { throw 'Install the Chrome PWA, then supply -PwaShortcut with its .lnk path.' }
# Only explicitly supplied overrides are persisted. Inherited GG_* values are deliberately not
# copied (especially secrets); pass the installation's required overrides in -Environment.
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x C# compiler is required.' }
$exe = Join-Path $InstallDir 'GraphGoblin.exe'
& $compiler /nologo /target:winexe /optimize+ /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll "/out:$exe" (Join-Path $RepoPath 'apps/windows-launcher/Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
function Invoke-Launcher([string[]]$LauncherArguments) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $exe
    $info.Arguments = ($LauncherArguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
    $info.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
    $process = [Diagnostics.Process]::Start($info)
    try {
        $output = $process.StandardOutput.ReadToEnd()
        $errorText = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw $errorText }
        return $output.Trim()
    } finally { $process.Dispose() }
}
$pwa = (Invoke-Launcher -LauncherArguments @('--inspect-shortcut', (Resolve-Path -LiteralPath $PwaShortcut).Path)) | ConvertFrom-Json
if ($pwa.TargetPath -notmatch 'chrome_proxy\.exe$' -or !(Test-Path -LiteralPath $pwa.TargetPath) -or
    $pwa.Arguments -notmatch '--app-id=([a-p]{32})(\s|$)') { throw 'PwaShortcut must target the installed Chrome PWA (chrome_proxy.exe --app-id=...). ' }
$appId = $Matches[1]
if ($pwa.Arguments -notmatch '--profile-directory=(?:"([^"]+)"|(\S+))') { throw 'The PWA shortcut must identify its Chrome profile.' }
$profile = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
$expectedAppId = Invoke-Launcher -LauncherArguments @('--expected-app-id', $Port.ToString())
if ($appId -ne $expectedAppId) { throw "The PWA shortcut belongs to another origin. Install GraphGoblin from http://127.0.0.1:$Port/app/ and use that shortcut." }
$pwaId = Invoke-Launcher -LauncherArguments @('--read-shortcut-id', $PwaShortcut)
if (!$pwaId) { throw 'The PWA shortcut has no Windows AppUserModelID. Recreate it from Chrome.' }
$sha = [Security.Cryptography.SHA256]::Create()
try { $identity = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($exe.ToUpperInvariant())))).Replace('-', '').ToLowerInvariant().Substring(0, 24) }
finally { $sha.Dispose() }
$config = [ordered]@{
    Repo = $RepoPath; Node = $NodePath; DataDir = $DataDir; Port = $Port
    ChromeProxy = $pwa.TargetPath; ChromeProfile = $profile; ChromeAppId = $appId
    IconLocation = $pwa.IconLocation
    PwaAppUserModelId = $pwaId; LauncherAppUserModelId = "GraphGoblin.$identity"
    Environment = $Environment; StartupTimeoutSeconds = 60; WindowTimeoutSeconds = 30
}
$config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath "$exe.json" -Encoding UTF8
if (!$NoShortcuts) {
    $paths = @($DesktopShortcut, $StartMenuShortcut)
    if ($PinnedShortcut) {
        if (!(Test-Path -LiteralPath $PinnedShortcut)) { throw 'PinnedShortcut must name the existing GraphGoblin taskbar shortcut.' }
        $paths += $PinnedShortcut
    }
    foreach ($path in $paths) {
        New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
        Invoke-Launcher -LauncherArguments @('--create-shortcut', $path) | Out-Null
    }
}
Write-Output "Launcher configured: $exe"
Write-Output "Gateway: http://127.0.0.1:$Port/app/ ; store: $DataDir"
Write-Output 'Open GraphGoblin with the new desktop shortcut. Pin its running taskbar button, replacing any old direct Chrome pin.'
