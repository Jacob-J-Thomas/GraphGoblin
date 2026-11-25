#Requires -Version 7.0
[CmdletBinding(DefaultParameterSetName = 'Execute')]
param(
    [Parameter(Mandatory)] [string]$Token,
    [Parameter(Mandatory, ParameterSetName = 'Preview')] [switch]$Preview,
    [Parameter(Mandatory, ParameterSetName = 'Execute')] [string]$Admission
)

$ErrorActionPreference = 'Stop'
$qaSsh = 'C:\Windows\System32\OpenSSH\ssh.exe'
$qaKey = 'C:\Users\98jak\.ssh\graphgoblin_qa_macmini_20261114'
$qaKnownHosts = 'C:\Users\98jak\.ssh\known_hosts'
$qaEndpoint = 'jake@10.0.0.85'
$qaAlias = 'jakes-mac-mini.local'
$qaUTF8 = [Text.UTF8Encoding]::new($false, $true)
$qaLF = [string][char]10
$qaSshDeadlineMs = 700000
$qaInputDeadlineMs = 12000
$qaEofDeadlineMs = 5000
$qaLocalStopDeadlineMs = 1500
$qaStage = "/Users/jake/Library/Caches/graphgoblin-456-owner-acceptance-$Token"
$qaReadinessSha256 = '12a5275096e576f84d75825a25f882240dfb744437918e3f7eeb791c6ce77fa5'
$qaPnpmStdoutSha256 = '85d32c32a37b5f97fd55e7d142e60dae8e5171e9e05561fb0985734e8a794ae4'
$qaStdoutMax = 50MB
$qaStderrMax = 64KB
$qaPhaseStreamMax = 4MB
$qaManifestMax = 1MB
$qaFrameMetaMax = 128KB
$qaBuildToken = 'd75d293f66da44ffb60198a07d8fa2e2'
$qaBuildStage = "/Users/jake/Library/Caches/graphgoblin-456-product-build-$qaBuildToken"
$qaBuildHead = '4341d1f8882f4b69651bfb0b5988345b7f074339'
$qaBuildTree = 'a5f8fa3e13fb297cbcdb386ae445cb8159156617'
$qaFreezeSha = '31a26763478b6e8c6e31ca3b64275a8eb3573a67b45cf92431341edcd1aa385d'
$qaBuildResultSha = '738c56a109a49f4c7b266ff97e6e5db8a7fc8fcb1e1ed0a623269045fb011656'

function Get-Sha([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-BytesSha([byte[]]$Bytes) {
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()
}

function Write-Bytes([string]$Path, [byte[]]$Bytes) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        if ($Bytes.Length -gt 0) { $stream.Write($Bytes, 0, $Bytes.Length) }
        $stream.Flush($true)
    } finally { $stream.Dispose() }
}

function Save-Json([string]$Directory, [string]$Name, $Value) {
    $json = ($Value | ConvertTo-Json -Depth 24) + $qaLF
    Write-Bytes (Join-Path $Directory $Name) ($qaUTF8.GetBytes($json))
}

function Read-Json([string]$Path) {
    [IO.File]::ReadAllText($Path, $qaUTF8) | ConvertFrom-Json -AsHashtable
}

function Get-SshArguments([string]$RemoteCommand) {
    @(
        '-F', 'none', '-T', '-i', $qaKey,
        '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
        '-o', 'PreferredAuthentications=publickey', '-o', 'PasswordAuthentication=no',
        '-o', 'KbdInteractiveAuthentication=no', '-o', 'NumberOfPasswordPrompts=0',
        '-o', "HostKeyAlias=$qaAlias", '-o', "UserKnownHostsFile=$qaKnownHosts",
        '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'GlobalKnownHostsFile=none',
        '-o', 'ClearAllForwardings=yes', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
        '-o', 'PermitLocalCommand=no', '-o', 'ConnectTimeout=8', '-o', 'ConnectionAttempts=1',
        '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2',
        $qaEndpoint, $RemoteCommand
    )
}

function Invoke-ExactSsh([string]$Directory, [string[]]$SshArgs, [byte[]]$Header, [byte[]]$Manifest, $Binding) {
    $info = [Diagnostics.ProcessStartInfo]::new($qaSsh)
    $info.WorkingDirectory = $PSScriptRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($value in $sshArgs) { $info.ArgumentList.Add($value) }
    Save-Json $Directory 'requested.json' ([ordered]@{
        at = [DateTime]::UtcNow.ToString('o')
        executable = $qaSsh
        executableSha256 = Get-Sha $qaSsh
        argv = $sshArgs
        keyFilePathOnly = $qaKey
        keyFileContentsRead = $false
        knownHostsPath = $qaKnownHosts
        commandSha256 = $Binding.remoteCommandSha256
        manifestSha256 = Get-BytesSha $Manifest
        manifestBytes = $Manifest.Length
        buildResultSha256 = $Binding.buildResultSha256
        bounds = [ordered]@{
            connectSeconds = 8
            connectionAttempts = 1
            sshDeadlineMs = $qaSshDeadlineMs
            inputDeadlineMs = $qaInputDeadlineMs
            eofDeadlineMs = $qaEofDeadlineMs
            birthBoundLocalStopMs = $qaLocalStopDeadlineMs
            stdoutMaxBytes = $qaStdoutMax
            stderrMaxBytes = $qaStderrMax
            serverAliveIntervalSeconds = 5
            serverAliveCountMax = 2
        }
        binding = $Binding
    })
    $stdoutPath = Join-Path $Directory 'stdout.raw'
    $stderrPath = Join-Path $Directory 'stderr.raw'
    $stdout = $null
    $stderr = $null
    $client = $null
    $birth = $null
    $streams = @()
    try {
        $stdout = [IO.File]::Open($stdoutPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
        $stderr = [IO.File]::Open($stderrPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $client = [Diagnostics.Process]::Start($info)
        $birth = $client.StartTime.ToUniversalTime()
        $streams = @(
            @{ name = 'stdout'; input = $client.StandardOutput.BaseStream; file = $stdout; cap = $qaStdoutMax },
            @{ name = 'stderr'; input = $client.StandardError.BaseStream; file = $stderr; cap = $qaStderrMax }
        )
        foreach ($stream in $streams) {
            $stream.buffer = [byte[]]::new(32768)
            $stream.eof = $false
            $stream.overflow = $false
            $stream.task = $stream.input.ReadAsync($stream.buffer,0,$stream.buffer.Length)
        }
        Save-Json $Directory 'launch.json' ([ordered]@{
            pid = $client.Id
            creationUtc = $birth.ToString('o')
            endpoint = $qaEndpoint
            hostKeyAlias = $qaAlias
        })
        $inputStream = $client.StandardInput.BaseStream
        $transfer = [Diagnostics.Stopwatch]::StartNew()
        foreach ($part in @($Header,$Manifest)) {
            $send = $inputStream.WriteAsync($part,0,$part.Length)
            if (!$send.Wait([Math]::Max(0,$qaInputDeadlineMs - [int]$transfer.ElapsedMilliseconds))) { throw 'SSH stdin manifest deadline' }
        }
        $client.StandardInput.Close()
        $exitTask = $client.WaitForExitAsync()
        $observedExit = $false
        $deadline = $qaSshDeadlineMs
        while ($true) {
            if (!$observedExit -and $exitTask.IsCompleted) {
                $exitTask.GetAwaiter().GetResult()
                $observedExit = $true
                $deadline = $clock.ElapsedMilliseconds + $qaEofDeadlineMs
                $code = $client.ExitCode
                Save-Json $Directory 'exit.json' ([ordered]@{
                    pid = $client.Id
                    creationUtc = $birth.ToString('o')
                    localSshExit = $code
                    exitTimeUtc = $client.ExitTime.ToUniversalTime().ToString('o')
                })
            }
            foreach ($stream in $streams) {
                if ($stream.eof -or !$stream.task.IsCompleted) { continue }
                $read = $stream.task.GetAwaiter().GetResult()
                if ($read -eq 0) { $stream.eof = $true; continue }
                $kept = [int][Math]::Min($read, $stream.cap - $stream.file.Length)
                if ($kept -gt 0) { $stream.file.Write($stream.buffer,0,$kept) }
                if ($kept -lt $read) { $stream.overflow = $true; throw "SSH $($stream.name) byte cap exceeded" }
                $stream.task = $stream.input.ReadAsync($stream.buffer,0,$stream.buffer.Length)
            }
            if ($observedExit -and $streams[0].eof -and $streams[1].eof) { break }
            $remaining = [Math]::Max(0,[int]($deadline - $clock.ElapsedMilliseconds))
            if ($remaining -eq 0) {
                if ($observedExit) { throw 'SSH raw stream EOF deadline' }
                throw 'SSH exit deadline'
            }
            $waiting = @($streams | Where-Object { !$_.eof } | ForEach-Object { $_.task })
            if (!$observedExit) { $waiting += $exitTask }
            $null = [Threading.Tasks.Task]::WaitAny([Threading.Tasks.Task[]]$waiting,$remaining)
        }
        $stdout.Flush($true)
        $stderr.Flush($true)
        $stdoutBytes = $stdout.Length
        $stderrBytes = $stderr.Length
        $stdout.Dispose()
        $stderr.Dispose()
        $stdout = $null
        $stderr = $null
        $stdoutHash = Get-Sha $stdoutPath
        $stderrHash = Get-Sha $stderrPath
        Save-Json $Directory 'pipe-close.json' ([ordered]@{
            completed = $true
            at = [DateTime]::UtcNow.ToString('o')
            stdout = @{ eof = $true; bytes = $stdoutBytes; sha256 = $stdoutHash }
            stderr = @{ eof = $true; bytes = $stderrBytes; sha256 = $stderrHash }
        })
        return [pscustomobject]@{
            Code = $code
            Stdout = $stdoutPath
            Stderr = $stderrPath
            StdoutBytes = $stdoutBytes
            StderrBytes = $stderrBytes
            StdoutSha256 = $stdoutHash
        }
    } catch {
        $failure = $_
        $stopped = $false
        if ($client -and $birth) {
            try {
                if (!$client.HasExited -and $client.StartTime.ToUniversalTime() -eq $birth) {
                    $client.Kill($false)
                    $stopped = $client.WaitForExit($qaLocalStopDeadlineMs)
                }
            } catch { $stopped = $false }
        }
        Save-Json $Directory 'incomplete.json' ([ordered]@{
            at = [DateTime]::UtcNow.ToString('o')
            error = $failure.Exception.Message
            pid = if ($client) { $client.Id }
            creationUtc = if ($birth) { $birth.ToString('o') }
            localStopConfirmed = $stopped
            streams = @($streams | ForEach-Object { @{ name = $_.name; eof = $_.eof; overflow = $_.overflow; bytes = $_.file.Length } })
            remoteCompletionUnverified = $true
        })
        throw $failure
    } finally {
        if ($stdout) { $stdout.Dispose() }
        if ($stderr) { $stderr.Dispose() }
        if ($client) { $client.Dispose() }
    }
}

function Safe-Item([string]$Path, [bool]$Directory) {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer -ne $Directory -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Unexpected local path type or reparse point: $Path"
    }
    $item
}

function Read-BoundedFile([string]$Path, [int]$Cap, [int]$Expected = 0) {
    $item = Safe-Item $Path $false
    $file = [IO.File]::Open($item.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ($file.Length -lt 1 -or $file.Length -gt $Cap -or ($Expected -gt 0 -and $file.Length -ne $Expected)) {
            throw "Unexpected local file length: $Path"
        }
        $bytes = [byte[]]::new([int]$file.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
            $read = $file.Read($bytes, $offset, $bytes.Length - $offset)
            if ($read -le 0) { throw "Local file ended before its expected length: $Path" }
            $offset += $read
        }
        if ($file.ReadByte() -ne -1) { throw "Local file changed length: $Path" }
        return ,$bytes
    } finally { $file.Dispose() }
}

function Quote-Sh([string]$Value) {
    $quote = [string][char]39
    $escaped = $quote + [char]92 + $quote + $quote
    $quote + $Value.Replace($quote, $escaped) + $quote
}

function Read-FrameBytes([IO.FileStream]$File, [int]$Count) {
    if ($Count -lt 0 -or $Count -gt ($File.Length - $File.Position)) { throw 'Incomplete result frame' }
    $bytes = [byte[]]::new($Count)
    $offset = 0
    while ($offset -lt $bytes.Length) {
        $read = $File.Read($bytes, $offset, $bytes.Length - $offset)
        if ($read -le 0) { throw 'Truncated result bytes' }
        $offset += $read
    }
    return ,$bytes
}

function Read-ResultFrames([string]$Path, [string]$Directory, $Binding) {
    $file = [IO.File]::OpenRead($Path)
    try {
        $magic = "GG456RECEIPTS1$qaLF"
        if ($qaUTF8.GetString((Read-FrameBytes $file $magic.Length)) -cne $magic) { throw 'Invalid receipt stream magic' }
        $phase = $null
        $result = $null
        while ($file.Position -lt $file.Length) {
            if ($result) { throw 'Unexpected bytes after the acceptance result' }
            $lengthBytes = Read-FrameBytes $file 4
            if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($lengthBytes) }
            $length = [BitConverter]::ToUInt32($lengthBytes,0)
            if ($length -lt 1 -or $length -gt $qaFrameMetaMax) { throw 'Invalid receipt frame size' }
            $meta = $qaUTF8.GetString((Read-FrameBytes $file ([int]$length))) | ConvertFrom-Json -AsHashtable
            if ($meta.type -ceq 'phase') {
                if ($phase -or $meta.phase -cne 'acceptance') { throw 'Unexpected or repeated acceptance phase' }
                foreach ($name in @('stdout','stderr')) {
                    $stream = $meta[$name]
                    if (($stream.bytes -isnot [long] -and $stream.bytes -isnot [int]) -or
                        $stream.bytes -lt 0 -or $stream.bytes -gt $qaPhaseStreamMax -or
                        $stream.sha256 -cnotmatch '\A[a-f0-9]{64}\z') { throw 'Invalid driver log binding' }
                    $raw = Read-FrameBytes $file $stream.bytes
                    if ((Get-BytesSha $raw) -cne $stream.sha256) { throw 'Driver log content pin mismatch' }
                    Write-Bytes (Join-Path $Directory "acceptance-$name.raw") $raw
                }
                $phase = $meta
                Save-Json $Directory 'acceptance.json' $phase
                continue
            }
            if ($meta.type -cne 'result' -or $meta.schema -cne 'gg456-owner-mac-acceptance/v1' -or $meta.token -cne $Token -or
                $meta.stagePath -cne $qaStage -or $meta.manifestSha256 -cne $Binding.transportManifestSha256 -or
                $meta.buildStage -cne $qaBuildStage -or $meta.buildResultSha256 -cne $qaBuildResultSha -or
                $meta.head -cne $qaBuildHead -or $meta.tree -cne $qaBuildTree) { throw 'Final acceptance binding mismatch' }
            $result = $meta
            $rows = @($meta.caseFiles | Where-Object { $null -ne $_ })
            if ($rows.Count -gt 512 -or ($rows.Count -gt 0 -and !$phase)) { throw 'Invalid case evidence count' }
            if ($rows.Count -gt 0) {
                $cases = Join-Path $Directory 'cases'
                New-Item -ItemType Directory -Path $cases -ErrorAction Stop | Out-Null
                $null = Safe-Item $cases $true
                $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
                $total = 0
                foreach ($row in $rows) {
                    $cap = if ($row.name -ceq 'manifest.json') { 1MB }
                        elseif ($row.name -ceq 'held-store.launcher.log') { 256KB }
                        elseif ($row.name -cmatch '\A(?:gateway\.log\.snapshot|api-managed-key-recheck\.gateway\.log|final-(?:gateway|launcher)\.log(?:\.1)?)\z') { 4MB }
                        elseif ($row.name -cmatch '\A\d{3}-[a-z0-9-]+\.(?:stdout|stderr)\z') { 256KB } else { -1 }
                    if (!$seen.Add($row.name) -or ($row.bytes -isnot [long] -and $row.bytes -isnot [int]) -or
                        $row.bytes -lt 0 -or $row.bytes -gt $cap -or $row.sha256 -cnotmatch '\A[a-f0-9]{64}\z') {
                        throw 'Unapproved case evidence row'
                    }
                    $total += $row.bytes
                    if ($total -gt 40MB) { throw 'Case evidence exceeds 40 MiB' }
                    $raw = Read-FrameBytes $file $row.bytes
                    if ((Get-BytesSha $raw) -cne $row.sha256) { throw 'Case raw evidence pin mismatch' }
                    Write-Bytes (Join-Path $cases $row.name) $raw
                }
            }
        }
        if ($result) { Save-Json $Directory 'result.json' $result }
        [pscustomobject]@{ Result=$result; Phase=$phase }
    } finally { $file.Dispose() }
}

if ($Token -cnotmatch '\A[a-f0-9]{32}\z' -or $Token -ceq $qaBuildToken) { throw 'Token must be a fresh lowercase 32-hex value' }
$null = Safe-Item $PSScriptRoot $true
$seal = Read-BoundedFile (Join-Path $PSScriptRoot 'SHA256SUMS.txt') 8KB
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($line in $qaUTF8.GetString($seal).TrimEnd([char]10).Split([char]10)) {
    if ($line -cnotmatch '\A([a-f0-9]{64})  ([A-Za-z0-9_.-]+)\z') { throw 'Preparation seal row invalid' }
    $sha = $Matches[1]
    $name = $Matches[2]
    if ($name -in @('.', '..', 'SHA256SUMS.txt') -or !$seen.Add($name)) { throw 'Invalid or duplicate preparation path' }
    if ((Get-BytesSha (Read-BoundedFile (Join-Path $PSScriptRoot $name) 128KB)) -cne $sha) { throw "Preparation file differs: $name" }
}
foreach ($name in @('Invoke-OwnerMacAcceptance.ps1','operator-owner-acceptance.mjs','request.sh.in','README.md','source-map.json')) {
    if (!$seen.Contains($name)) { throw "Missing sealed file: $name" }
}

$launcher = Split-Path -Parent $PSScriptRoot
$buildPacket = Join-Path $launcher 'macos-product-build-transport-implementation-01'
$build = Join-Path $buildPacket "receipts/product-build-$qaBuildToken"
$pins = [ordered]@{
    'result.json' = $qaBuildResultSha
    'validation.json' = '746502860ff36cafb49c838a8e39efeffa77817c27c73f0dd4fe8149a476903e'
    'pipe-close.json' = 'a214d059fbf3de399c06d8fb299c850a64e517a95802024508ced585d416e231'
    'exit.json' = '0f87ff6f3fb8d25447e946cc5b5a0a30d5f5df97f3ceed9bf4f59b31372d3eaf'
    'stdout.raw' = '0643aebcf04fa3e11275149a8bcccf47e621cc535e4623faf02bbb608e592a88'
    'stderr.raw' = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
}
foreach ($name in $pins.Keys) {
    if ((Get-Sha (Safe-Item (Join-Path $build $name) $false).FullName) -cne $pins[$name]) { throw "Successful build receipt differs: $name" }
}
$result = Read-Json (Join-Path $build 'result.json')
$validation = Read-Json (Join-Path $build 'validation.json')
$pipe = Read-Json (Join-Path $build 'pipe-close.json')
if ($result.status -cne 'product-build-exit-zero' -or $validation.exitCode -ne 0 -or !$pipe.stdout.eof -or !$pipe.stderr.eof -or
    $result.source.head -cne $qaBuildHead -or $result.source.tree -cne $qaBuildTree -or !$result.source.postBuildVerified -or
    $result.stage.path -cne $qaBuildStage -or $result.stage.ino -cne '178893353' -or $result.release.artifacts.Count -ne 10) {
    throw 'The selected receipt does not establish the complete successful candidate build'
}
$source = Read-BoundedFile (Join-Path $build 'source-freeze.json') $qaManifestMax 383408
if ((Get-BytesSha $source) -cne $qaFreezeSha) { throw 'Successful build source freeze differs' }
$readiness = Join-Path $launcher 'macos-build-readiness-preparation-04/receipts/readiness-b71461a2d1a64291b1f30baf87ff8017/stdout.raw'
$pnpmReceipt = Join-Path $launcher 'macos-pnpm-materialization-preparation-01/receipts/materialization-7dcdb45652c44a26b97a681a95075056/stdout.raw'
if ((Get-Sha $readiness) -cne $qaReadinessSha256 -or (Get-Sha $pnpmReceipt) -cne $qaPnpmStdoutSha256) { throw 'Toolchain source receipt mismatch' }
$pnpm = Read-Json $pnpmReceipt
$manifest = $qaUTF8.GetBytes(([ordered]@{schema='gg456-macos-owner-acceptance-input/v1'; token=$Token;
  buildStage=$qaBuildStage; buildResultSha256=$qaBuildResultSha; sourceFreezeBase64=[Convert]::ToBase64String($source);
  artifacts=$result.release.artifacts; pnpmFiles=$pnpm.verification.files} | ConvertTo-Json -Depth 12 -Compress) + $qaLF)
if ($manifest.Length -gt $qaManifestMax) { throw 'Acceptance input exceeds the 1 MiB cap' }
$manifestSha = Get-BytesSha $manifest
$length = [BitConverter]::GetBytes([uint32]$manifest.Length)
if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($length) }
$header = [byte[]]($qaUTF8.GetBytes("GG456BUILD1$qaLF") + $length)

$sourceModel = Read-BoundedFile (Join-Path $buildPacket 'source-model.mjs') 24KB
if ((Get-BytesSha $sourceModel) -cne 'b3de9ac2b1b065d64b8c6e4f2ca4f69b92d54d58670ae91348e311a464f0773c') { throw 'Shared source model differs' }
$text = $qaUTF8.GetString($sourceModel) + $qaLF + $qaUTF8.GetString((Read-BoundedFile (Join-Path $PSScriptRoot 'operator-owner-acceptance.mjs') 64KB))
$program = $qaUTF8.GetBytes($text.Replace("`r`n",$qaLF))
$programSha = Get-BytesSha $program
$zipBuffer = [IO.MemoryStream]::new()
try {
    $gzip = [IO.Compression.GZipStream]::new($zipBuffer,[IO.Compression.CompressionLevel]::Optimal,$true)
    try { $gzip.Write($program,0,$program.Length) } finally { $gzip.Dispose() }
    $executor = [Convert]::ToBase64String($zipBuffer.ToArray())
} finally { $zipBuffer.Dispose() }
$loader = "const{gunzipSync}=await import('node:zlib');const{createHash}=await import('node:crypto');const b=gunzipSync(Buffer.from('$executor','base64'),{maxOutputLength:98304});if(createHash('sha256').update(b).digest('hex')!=='$programSha')throw Error('Fixed executor SHA-256 mismatch');await import('data:text/javascript;base64,'+b.toString('base64'));"
$template = $qaUTF8.GetString((Read-BoundedFile (Join-Path $PSScriptRoot 'request.sh.in') 4KB)).Replace("`r`n",$qaLF)
$request = $template.Replace('__GG456_BUILD_EXECUTOR__',(Quote-Sh $loader)).Replace('__GG456_BUILD_TOKEN__',$Token).
    Replace('__GG456_MANIFEST_SHA256__',$manifestSha)
if ($request.Contains('__GG456_') -or $request.Contains([char]13)) { throw 'Unrendered shell template marker or line ending' }
$command = '/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=C LC_ALL=C /bin/sh -c ' + (Quote-Sh $request)
$sshArgs = @(Get-SshArguments $command)
$argvChars = $qaSsh.Length + 4
foreach ($arg in $sshArgs) {
    $argvChars += $arg.Length + 4
    foreach ($escaped in [regex]::Matches($arg,'\\*"|\\+$')) { $argvChars += $escaped.Length }
}
if ($argvChars -gt 30000) { throw 'Rendered SSH Windows argv limit exceeded' }
$binding = [ordered]@{
    schema='gg456-macos-owner-acceptance-admission/v1'; state='root-admitted-macos-owner-acceptance'; token=$Token;
    stagePath=$qaStage; buildStage=$qaBuildStage; buildStageInode='178893353'; head=$qaBuildHead; tree=$qaBuildTree;
    sourceFreezeSha256=$qaFreezeSha; buildResultSha256=$qaBuildResultSha; buildStdoutSha256=$pins['stdout.raw'];
    transportManifestSha256=$manifestSha; transportManifestBytes=$manifest.Length; transportSealSha256=Get-BytesSha $seal;
    fixedExecutorSha256=$programSha; remoteCommandSha256=Get-BytesSha ($qaUTF8.GetBytes($command));
    automaticRetries=0; allowedAction='one-committed-headless-alternate-install-acceptance'
}
if ($Preview) {
    [pscustomobject]@{ AdmissionFields=[pscustomobject]$binding; Request=$request; RemoteCommand=$command;
        WindowsArgvUpperBound=$argvChars; Header=$header; TransportManifest=$manifest; FixedExecutorBytes=$program.Length }
    return
}

$admissionBytes = Read-BoundedFile $Admission 16KB
$admitted = $qaUTF8.GetString($admissionBytes) | ConvertFrom-Json -AsHashtable
foreach ($key in $binding.Keys) {
    if ($null -eq $admitted[$key] -or $admitted[$key] -cne $binding[$key]) { throw "Admission does not bind $key" }
}
foreach ($file in @($qaSsh,$qaKey,$qaKnownHosts)) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing approved SSH input: $file" }
}
$receiptRoot = Join-Path $PSScriptRoot 'receipts'
if (!(Test-Path -LiteralPath $receiptRoot)) { New-Item -ItemType Directory -Path $receiptRoot -ErrorAction Stop | Out-Null }
$null = Safe-Item $receiptRoot $true
$receipt = Join-Path $receiptRoot "acceptance-$Token"
if (Test-Path -LiteralPath $receipt) { throw 'The token already has a local receipt path' }
New-Item -ItemType Directory -Path $receipt -ErrorAction Stop | Out-Null
$null = Safe-Item $receipt $true
Write-Bytes (Join-Path $receipt 'admission.json') $admissionBytes
Write-Bytes (Join-Path $receipt 'transport-manifest.json') $manifest
Write-Bytes (Join-Path $receipt 'request.sh') ($qaUTF8.GetBytes($request))
$capture = Invoke-ExactSsh $receipt $sshArgs $header $manifest $binding
$summary = [ordered]@{state='ssh-result-captured';exitCode=$capture.Code;stagePath=$qaStage; buildStage=$qaBuildStage;
    stdoutSha256=$capture.StdoutSha256;stderrSha256=Get-Sha $capture.Stderr;stdoutBytes=$capture.StdoutBytes;stderrBytes=$capture.StderrBytes}
if ($capture.StdoutBytes -gt 0) {
    try {
        $frames = Read-ResultFrames $capture.Stdout $receipt $binding
        $summary.remoteStatus = $frames.Result.status
        $summary.failure = $frames.Result.failure
        $summary.caseReadbackFailure = $frames.Result.caseReadbackFailure
        $summary.case = $frames.Result.case
        $phase = $frames.Phase
        if ($capture.Code -eq 0 -and $frames.Result.status -ceq 'owner-acceptance-exit-zero' -and $phase.code -eq 0 -and
            $phase.exitObserved -and $phase.stdout.eof -and $phase.stderr.eof -and !$phase.stdout.overflow -and !$phase.stderr.overflow -and
            $frames.Result.case.outcome -ceq 'passed' -and $frames.Result.case.cases.Count -eq 9 -and
            $frames.Result.postCaseBuild.ino -ceq '178893353' -and $frames.Result.postCasePnpm.files -eq 437 -and
            (Test-Path -LiteralPath (Join-Path $receipt 'cases/manifest.json') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $receipt 'cases/held-store.launcher.log') -PathType Leaf)) {
            $summary.state = 'owner-acceptance-exit-zero'
        } elseif ($frames.Result.status -ceq 'owner-acceptance-failed') { $summary.state = 'owner-acceptance-failed' }
        else { $summary.state = 'remote-result-unaccepted' }
    } catch { $summary.state='invalid-result-framing'; $summary.error=$_.Exception.Message }
}
Save-Json $receipt 'validation.json' $summary
[pscustomobject]@{State=$summary.state;ExitCode=$capture.Code;Receipt=$receipt;StagePath=$qaStage}
if ($summary.state -ceq 'owner-acceptance-exit-zero') { exit 0 }
if ($capture.Code -eq 0) { exit 2 }
exit $capture.Code

