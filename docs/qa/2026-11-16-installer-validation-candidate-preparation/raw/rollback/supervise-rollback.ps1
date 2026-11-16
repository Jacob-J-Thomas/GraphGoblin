param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$HostedManifestSha256,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$InstallerSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (!$IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or ![Environment]::Is64BitProcess) { throw 'Expected hosted x64 Windows.' }
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Read-Json([string]$Path) { ConvertFrom-Json -AsHashtable ([IO.File]::ReadAllText($Path)) }
$root = Join-Path $env:RUNNER_TEMP "qa436-rollback-$($env:GITHUB_RUN_ID)-$($env:GITHUB_RUN_ATTEMPT)"
if (Test-Path -LiteralPath $root) { throw 'Expected a new exact rollback attempt path.' }
$evidence = Join-Path $root 'evidence'
$temp = Join-Path $root 'temp'
New-Item -ItemType Directory -Path $root,$evidence,$temp | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
function Save([string]$Name, $Value) {
    $path = Join-Path $evidence ($Name + '.json')
    $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $stream.Write($utf8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 24) + [char]10)); $stream.Flush($true) }
    finally { $stream.Dispose() }
}
function Launch([string]$Name, [string]$Exe, [string[]]$Arguments, [string]$Working, [int]$WaitMs) {
    Save "$Name.attempt" @{ exe=$Exe; arguments=$Arguments; deadlineMs=$WaitMs; closeMs=10000
        executableSha256=(Hash $Exe); requestedUtc=[DateTime]::UtcNow.ToString('o') }
    $info = [Diagnostics.ProcessStartInfo]::new($Exe)
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.WorkingDirectory = $Working
    foreach ($arg in $Arguments) { $info.ArgumentList.Add($arg) }
    foreach ($key in @($info.Environment.Keys)) {
        if ($key -match '^(GG_|NODE_OPTIONS$|NODE_PATH$|JEV_API_KEY$|OPENAI_API_KEY$|ANTHROPIC_API_KEY$)') {
            [void]$info.Environment.Remove($key)
        }
    }
    $info.Environment['TEMP'] = $temp
    $info.Environment['TMP'] = $temp
    $stdout = [IO.File]::Open((Join-Path $evidence "$Name.stdout"), [IO.FileMode]::CreateNew)
    $stderr = [IO.File]::Open((Join-Path $evidence "$Name.stderr"), [IO.FileMode]::CreateNew)
    $child = $null
    try {
        $child = [Diagnostics.Process]::Start($info)
        $tasks = [Threading.Tasks.Task[]]@($child.StandardOutput.BaseStream.CopyToAsync($stdout),
            $child.StandardError.BaseStream.CopyToAsync($stderr))
        $birth = $child.StartTime.ToUniversalTime().ToString('o')
        Save "$Name.spawn" @{ pid=$child.Id; birthUtc=$birth; parentPid=$PID }
        if (!$child.WaitForExit($WaitMs)) {
            Save "$Name.deadline" @{ pid=$child.Id; birthUtc=$birth; actualExitObserved=$false }
            throw "Direct child deadline elapsed: $Name"
        }
        Save "$Name.exit" @{ pid=$child.Id; birthUtc=$birth; exitCode=$child.ExitCode; exitUtc=$child.ExitTime.ToUniversalTime().ToString('o') }
        if (![Threading.Tasks.Task]::WaitAll($tasks, 10000)) { throw "Separate pipe close deadline elapsed: $Name" }
        $stdout.Flush($true)
        $stderr.Flush($true)
        Save "$Name.close" @{ pid=$child.Id; closedUtc=[DateTime]::UtcNow.ToString('o')
            streamsClosed=$true; stdoutBytes=$stdout.Length; stderrBytes=$stderr.Length }
        if ($child.ExitCode -ne 0 -or $stderr.Length -ne 0) { throw "Direct child failed: $Name" }
    } finally {
        $stdout.Dispose()
        $stderr.Dispose()
        if ($child) { $child.Dispose() }
    }
}
$first = $null
$rechecked = $false
$matrixProof = $null
$stage = 'verify exact package and matrix'
try {
    $manifest = Join-Path $PSScriptRoot 'HOSTED-SHA256SUMS.txt'
    if ((Hash $manifest) -cne $HostedManifestSha256) { throw 'Rollback packet manifest differs.' }
    $members = @('rollback-witness.ps1','source-observation.json','supervise-rollback.ps1')
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($line in Get-Content -LiteralPath $manifest) {
        if ($line -cnotmatch '^([a-f0-9]{64})  ([a-z0-9_.-]+)$') { throw 'Malformed rollback manifest row.' }
        $sha = $Matches[1]
        $name = $Matches[2]
        if ($name -cnotin $members -or !$seen.Add($name) -or (Hash (Join-Path $PSScriptRoot $name)) -cne $sha) {
            throw 'Rollback packet file differs.'
        }
    }
    if ($seen.Count -ne $members.Count) { throw 'Incomplete rollback packet membership.' }
    $admissionPath = Join-Path $env:QA436_CONTROL 'admission.json'
    $qa = Read-Json $admissionPath
    if ($qa.phase -cne 'candidate' -or $qa.githubRunId -cne $env:GITHUB_RUN_ID -or
        $qa.githubRunAttempt -cne $env:GITHUB_RUN_ATTEMPT -or $qa.expectedCommit -cne $env:GITHUB_SHA -or
        $qa.evidenceName -cnotmatch '^qa436-[a-z0-9-]{3,38}$') { throw 'No exact candidate matrix admission.' }
    $matrixRoot = Join-Path $env:RUNNER_TEMP ($qa.evidenceName + '-supervisor')
    $outcome = Read-Json (Join-Path $matrixRoot 'launch-result.json')
    $closedPath = Join-Path $matrixRoot 'binding-after.json'
    $closedHash = Hash $closedPath
    $closing = Read-Json $closedPath
    $admissionSha = Hash $admissionPath
    if (!$outcome.closingIdentityVerified -or $outcome.status -cne 'matrix-and-witness-finished-for-review' -or
        $outcome.caseCount -ne 32 -or $outcome.head -cne $qa.expectedCommit -or
        $closing.admission.sha256 -cne $admissionSha -or
        $closedHash -cne (Hash (Join-Path $matrixRoot 'binding-before.json'))) { throw 'The matrix binding or disposition is incomplete.' }
    $binder = $closing.packet.files['bind.mjs']
    $helper = $closing.driver.files['windows.cs']
    $installer = Join-Path $closing.checkout 'scripts\install-windows-launcher.ps1'
    if ((Hash $installer) -cne $InstallerSha256 -or (Hash $binder.path) -cne $binder.sha256 -or
        (Hash $helper.path) -cne $helper.sha256) { throw 'Frozen installer, binder or independent Windows helper differs.' }
    $matrixProof = [ordered]@{ run=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT; head=$qa.expectedCommit
        tree=$qa.expectedTree; product=$qa.productCommit; base=$qa.baseCommit; admissionSha256=$admissionSha
        matrixClosingSha256=$closedHash; installerSha256=$InstallerSha256; manifestSha256=$HostedManifestSha256
        binderSha256=$binder.sha256; nativeHelperSha256=$helper.sha256 }
    Save 'admission-reference' $matrixProof

    $stage = 'fresh rollback pre-binding'
    $before = Join-Path $evidence 'binding-before.json'
    Launch 'bind-before' $closing.tools.node.path @($binder.path,$admissionPath,$admissionSha,$before) $closing.checkout 60000
    if ((Hash $before) -cne $closedHash) { throw 'Fresh rollback binding differs from matrix closure.' }
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $witness = Join-Path $PSScriptRoot 'rollback-witness.ps1'
    $witnessArgs = @('-NoLogo','-NoProfile','-NonInteractive','-STA','-File',$witness,
        '-AttemptRoot',$root,'-Checkout',$closing.checkout,'-CheckoutHead',$qa.expectedCommit,
        '-InstallerSha256',$InstallerSha256,'-NativeHelper',$helper.path,
        '-Node',$closing.tools.node.path,'-ChromeProxy',$closing.tools.chromeProxy.path)
    $stage = 'public Windows PowerShell seed'
    Launch 'seed' $windowsPowerShell ($witnessArgs + @('-Phase','seed')) $closing.checkout 200000
    if ((Read-Json (Join-Path $evidence 'seed-result.json')).status -cne 'public-seed-verified') { throw 'Seed proof unavailable.' }
    $stage = 'composed Windows PowerShell rollback'
    Launch 'observe' $windowsPowerShell ($witnessArgs + @('-Phase','observe')) $closing.checkout 45000
    $result = Read-Json (Join-Path $evidence 'rollback-result.json')
    if ($result.status -cne 'restored-after-native-sharing-failure' -or !$result.lockDisposed -or
        $result.restoredArtifacts -ne 6) { throw 'Independent ordered rollback evidence unavailable.' }
} catch {
    $first = @{ stage=$stage; message=$_.Exception.Message; stack=$_.ScriptStackTrace }
    Save 'first-failure' $first
} finally {
    if ($matrixProof) {
        try {
            $after = Join-Path $evidence 'binding-after.json'
            Launch 'bind-after' $closing.tools.node.path @($binder.path,$admissionPath,$admissionSha,$after) $closing.checkout 60000
            if (!(Test-Path -LiteralPath $before -PathType Leaf) -or (Hash $after) -cne $closedHash -or
                (Hash $before) -cne (Hash $after) -or (Hash $installer) -cne $InstallerSha256) {
                throw 'Exact closing rollback identity differs.'
            }
            $rechecked = $true
        } catch {
            $closingFailure = @{ stage='closing rollback binding'; message=$_.Exception.Message; stack=$_.ScriptStackTrace }
            Save 'closing-failure' $closingFailure
            if (!$first) { $first = $closingFailure; Save 'first-failure' $first }
        }
    }
}
$status = if (!$first -and $rechecked) { 'rollback-witness-finished-for-review' } else { 'incomplete' }
Save 'launch-result' @{ status=$status; firstFailure=$first; closingIdentityVerified=$rechecked; scope='composed production publisher' }
if ($first -or !$rechecked) { exit 1 }
exit 0
