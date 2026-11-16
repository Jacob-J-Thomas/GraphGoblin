#Requires -Version 7.5
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$batch=Split-Path -Parent $PSScriptRoot
$prep=Join-Path $batch 'launcher-438-stdio-preparation'
$controls=Join-Path $prep 'controls'
$attempt=Join-Path $controls 'attempts\attempt-1'
$evidence=Join-Path $attempt 'evidence'
$scratch=Join-Path $attempt 'scratch'
function Need($Ok,[string]$Why) { if (!$Ok) { throw $Why } }
function ReadJson([string]$Path) { Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable -DateKind String }
function Ev([string]$Name) { ReadJson (Join-Path $evidence $Name) }
function Sha([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Same($Left,$Right) { (ConvertTo-Json -InputObject $Left -Depth 20 -Compress) -ceq (ConvertTo-Json -InputObject $Right -Depth 20 -Compress) }
function Utc([string]$Value) { [DateTimeOffset]::Parse($Value,[Globalization.CultureInfo]::InvariantCulture).UtcDateTime }
function EvidenceHashes {
  $hashes=[ordered]@{}
  foreach ($file in Get-ChildItem -LiteralPath $evidence -Force | Sort-Object Name) {
    Need (!$file.PSIsContainer -and !$file.LinkType -and !($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) "Unexpected evidence entry $($file.Name)"
    $hashes[$file.Name]=Sha $file.FullName
  }
  $hashes
}
$rawHashes=EvidenceHashes
$opening=Ev 'opening-binding.json'
$closing=Ev 'closing-binding.json'
$admission=Ev 'admission.json'
Need ((Same $opening $closing) -and $rawHashes['opening-binding.json'] -ceq $rawHashes['closing-binding.json']) 'Binding changed'
Need ($admission.schema -ceq 'gg438-stdio-controls-admission/v1' -and $admission.state -ceq 'root-admitted' -and
    $admission.attempt -ceq 'attempt-1' -and $opening.admissionSha -ceq $rawHashes['admission.json'] -and
    $opening.admissionSha -ceq (Sha (Join-Path $controls 'admission-attempt-1.json'))) 'Admission mismatch'
Need ($opening.hostRelease -ceq $admission.hostRelease -and $opening.hostRelease -ceq '10.0.26300' -and
    $opening.nodeVersion -ceq 'v22.23.4' -and $opening.arch -ceq 'x64') 'Runtime admission mismatch'
$expected=[ordered]@{
  driver=(Join-Path $controls 'run.mjs'); fixtureSource=(Join-Path $controls 'StdioFixtureHost.cs')
  fixtureExe=(Join-Path $controls 'StdioFixtureHost.exe'); fixtureCompileReceipt=(Join-Path $controls 'compile-check.json')
  observerSource=(Join-Path $prep 'ObserveStdio.cs'); observerExe=(Join-Path $prep 'ObserveStdio.compile-check.exe')
  observerCompileReceipt=(Join-Path $prep 'compile-check.json')
  node=(Join-Path (Split-Path -Parent (Split-Path -Parent $batch)) '.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe')
  ntdll=(Join-Path $env:SystemRoot 'System32\ntdll.dll'); kernel32=(Join-Path $env:SystemRoot 'System32\kernel32.dll')
  kernelbase=(Join-Path $env:SystemRoot 'System32\KernelBase.dll')
}
Need ($expected.Count -eq $opening.hashes.Count -and $expected.Count -eq $admission.sha256.Count) 'Unexpected binding references'
foreach ($key in $expected.Keys) {
  $pin=$opening.hashes[$key]
  Need ($pin.path -ieq $expected[$key] -and $pin.sha256 -ceq $admission.sha256[$key] -and
    $pin.sha256 -ceq (Sha $expected[$key])) "Binding mismatch $key"
}
foreach ($kind in @('fixture','observer')) {
  $compile=ReadJson $expected[$kind+'CompileReceipt']
  Need ($compile.exitCode -eq 0 -and $compile.sourceSha256 -ceq $admission.sha256[$kind+'Source'] -and
    $compile.outputSha256 -ceq $admission.sha256[$kind+'Exe']) "Compiler receipt mismatch $kind"
}
$node=$opening.hashes.node.path
$result=Ev 'result.json'
$cleanup=Ev 'cleanup.json'
$firstError=Ev 'first-failure.json'
Need ($result.status -ceq 'incomplete' -and (Same $result.firstFailure $firstError) -and
    $firstError.label -ceq 'execution or owned scratch cleanup' -and $firstError.message.StartsWith('Fixture scratch retained files') -and
    $firstError.message.Contains("'AppData'") -and $firstError.stack.Contains('controls/run.mjs:385:10') -and
    $cleanup.scratch -ceq $scratch -and $cleanup.scratchRemoved -eq $false) 'Unexpected driver completion'
function RecordedProcess([string]$Label,[int]$Code,[string]$Exe,$Arguments) {
  $request=Ev "$Label-request.json"
  $spawn=Ev "$Label-spawn.json"
  $p=Ev "$Label-process.json"
  Need ($p.pid -gt 0 -and $p.pid -eq $spawn.pid -and $p.at -ceq $spawn.at -and (Same $request $spawn.requested) -and
    (Same $request $p.requested) -and $request.exe -ieq $Exe -and $request.cwd -ceq $scratch -and (Same $request.args $Arguments)) "Launch binding $Label"
  Need ($p.exit.code -eq $Code -and $p.close.code -eq $Code -and $null -eq $p.exit.signal -and $null -eq $p.close.signal -and
    (Utc $p.exit.at) -le (Utc $p.close.at) -and (Utc $p.at) -le (Utc $p.exit.at)) "Exit or close mismatch $Label"
  foreach ($key in @('error','stdinError','timeoutAt','observerTermination','retainedAt')) { Need (!$p.Contains($key)) "Ambiguous outcome $Label $key" }
  foreach ($channel in @('stdout','stderr')) {
    $stream=$p[$channel]
    Need ($stream.endAt -and !$stream.Contains('streamError') -and (Utc $stream.endAt) -le (Utc $p.close.at) -and
      $stream.bytes -eq $stream.captured -and $stream.bytes -eq (Get-Item -LiteralPath (Join-Path $evidence "$Label-$channel.raw")).Length) "Stream receipt mismatch $Label $channel"
  }
  Need (((Utc $p.close.at)-(Utc $p.at)).TotalSeconds -lt 9 -or $Label.EndsWith('-host')) "Observer exceeded deadline $Label"
  [ordered]@{label=$Label; pid=$p.pid; born=$null; spawnedAt=$p.at; exit=$p.exit; close=$p.close;
    stdout=$p.stdout; stderr=$p.stderr; executable=$request.exe; args=$request.args}
}
function CheckNull($Slot,[bool]$Read,[bool]$Write,[bool]$Match) {
  $mask=[Convert]::ToUInt32($Slot.grantedAccess.Substring(2),16)
  Need ($Slot.win32FileType -eq 2 -and $Slot.objectType -ceq 'File' -and $Slot.objectName -ceq '\Device\Null' -and
    $Slot.nameStatus -ceq 'observed' -and ((($mask -band 1) -ne 0) -eq $Read) -and ((($mask -band 2) -ne 0) -eq $Write) -and
    $Slot.readData -eq $Read -and $Slot.writeData -eq $Write -and $Slot.matches -eq $Match) "NUL evidence $($Slot.slot)"
}
$procs=[Collections.Generic.List[object]]::new()
$cases=[Collections.Generic.List[object]]::new()
$mappings=@('positive','wrong-direction','wrong-destination')
Need (@($cleanup.fixtures).Count -eq 3) 'Wrong fixture count'
for ($i=0;$i -lt $mappings.Count;$i++) {
  $mapping=$mappings[$i]
  $hp=RecordedProcess "$mapping-host" 0 $expected.fixtureExe @($mapping,$node)
  $procs.Add($hp)
  $lines=@(Get-Content -LiteralPath (Join-Path $evidence "$mapping-host-stdout.raw"))
  Need ($lines.Count -eq 2 -and $hp.stderr.bytes -eq 0) "Host streams $mapping"
  $f=$lines[0] | ConvertFrom-Json -AsHashtable -DateKind String
  $x=$lines[1] | ConvertFrom-Json -AsHashtable -DateKind String
  $c=$cleanup.fixtures[$i]
  Need ((Same $f (Ev "$mapping-fixture.json")) -and $f.schema -ceq 'gg438-stdio-fixture/v1' -and $f.mapping -ceq $mapping -and
    $f.outcome -ceq 'spawned' -and $f.pid -gt 0 -and $f.birthFileTime -match '^[1-9][0-9]{16,18}$' -and
    $f.executable -ceq $node -and (Same $f.arguments @('-e','setTimeout(() => {}, 30000)')) -and
    $f.commandLine -ceq ('"'+$node+'" -e "setTimeout(() => {}, 30000)"') -and $f.cwd -ceq $scratch -and
    $f.startupFlags -ceq '0x00000100' -and $f.creationFlags -ceq '0x08080000' -and $f.inheritHandles -eq $true -and
    $f.handleListAttribute -ceq '0x00020002') "Fixture launch binding $mapping"
  $roles=@('nul-read','nul-write')
  $out='nul-write'
  if ($mapping -ceq 'wrong-direction') { $out='nul-read' }
  if ($mapping -ceq 'wrong-destination') { $out='pipe-write'; $roles += 'pipe-write' }
  Need ((Same $f.inheritedHandleRoles $roles) -and (Same $f.slots @('nul-read',$out,'nul-write')) -and
    $f.nul.name -ceq 'NUL' -and $f.nul.shareMode -ceq '0x00000003' -and $f.nul.disposition -ceq '0x00000003' -and
    $f.nul.flags -ceq '0x00000080' -and $f.nul.readAccess -ceq '0x80000000' -and $f.nul.writeAccess -ceq '0x40000000') "Fixture handles $mapping"
  $born=[DateTime]::FromFileTimeUtc([long]$f.birthFileTime)
  Need ($x.schema -ceq $f.schema -and $x.outcome -ceq 'natural-exit' -and $x.mapping -ceq $mapping -and
    $x.pid -eq $f.pid -and $x.exitCode -eq 0 -and $c.hostPid -eq $hp.pid -and $c.fixturePid -eq $f.pid -and
    $c.naturalExit -eq $true -and $c.born -ceq $f.birthFileTime -and $c.birthFileTime -ceq $f.birthFileTime -and $c.fixtureExitCode -eq 0 -and
    (Same $c.hostExit $hp.exit) -and (Same $c.hostClose $hp.close) -and ((Utc $hp.exit.at)-$born).TotalSeconds -ge 30) "Natural exit $mapping"
  $procs.Add([ordered]@{label="$mapping-fixture";pid=$f.pid;born=$f.birthFileTime;executable=$node;args=$f.arguments;nativeExit=$x;hostPid=$hp.pid})
  $code=if ($i -eq 0) {0} else {1}
  $o=RecordedProcess "$mapping-observer" $code $expected.observerExe @([string]$f.pid,$f.birthFileTime,$node)
  $procs.Add($o)
  $v=Ev "$mapping-observer-stdout.raw"
  $status=if ($i -eq 0) {'matched'} else {'nonconforming'}
  Need ($o.stderr.bytes -eq 0 -and (Same $v (Ev "$mapping-checked-slots.json")) -and (Utc $o.spawnedAt) -gt $born -and
    (Utc $o.close.at) -lt (Utc $hp.exit.at) -and $v.schema -ceq 'gg438-stdio-observation/v1' -and $v.status -ceq $status -and
    $v.pid -eq $f.pid -and $v.birthFileTime -ceq $f.birthFileTime -and $v.image -ceq $node -and $v.machine -ceq 'native-amd64' -and
    $v.dosNullCurrentTarget -ceq '\Device\Null' -and (Same $v.localStdHandleOffsets @(32,40,48)) -and
    (Same @($v.slots | ForEach-Object { $_.slot }) @('stdin','stdout','stderr'))) "Observer binding $mapping"
  CheckNull $v.slots[0] $true $false $true
  CheckNull $v.slots[2] $false $true $true
  if ($i -eq 0) { CheckNull $v.slots[1] $false $true $true }
  if ($i -eq 1) { CheckNull $v.slots[1] $true $false $false }
  if ($i -eq 2) {
    $slot=$v.slots[1]
    Need ($slot.objectType -ceq 'File' -and $slot.win32FileType -eq 3 -and $null -eq $slot.objectName -and
      $slot.nameStatus -ceq 'outside-character-device-probe' -and $slot.writeData -eq $true -and $slot.matches -eq $false -and
      ([Convert]::ToUInt32($slot.grantedAccess.Substring(2),16) -band 2) -ne 0) 'Writable PIPE was not correctly rejected'
  }
  $cases.Add([ordered]@{mapping=$mapping;fixture=$f;observerPid=$o.pid;observation=$v})
  if ($i -ne 0) { continue }
  $negative=@(
    @{label='wrong-birth-observer';reason='Target creation FILETIME mismatch';argv=@([string]$f.pid,[string]([long]$f.birthFileTime+1),$node)},
    @{label='wrong-image-observer';reason='Target executable mismatch';argv=@([string]$f.pid,$f.birthFileTime,(Join-Path $scratch 'different-node.exe'))}
  )
  foreach ($test in $negative) {
    $r=RecordedProcess $test.label 2 $expected.observerExe $test.argv
    $procs.Add($r)
    $reason=Ev "$($test.label)-stderr.raw"
    Need ($r.stdout.bytes -eq 0 -and (Utc $r.spawnedAt) -gt $born -and (Utc $r.close.at) -lt (Utc $hp.exit.at) -and
      $reason.schema -ceq 'gg438-stdio-observation/v1' -and $reason.status -ceq 'inconclusive' -and
      $reason.reason -ceq $test.reason -and !$reason.Contains('slots')) "Identity refusal $($test.label)"
    $cases.Add([ordered]@{control=$test.label;observerPid=$r.pid;observation=$reason})
  }
}
$pids=@($procs | ForEach-Object { [uint32]$_.pid } | Sort-Object -Unique)
Need ($pids.Count -eq 11) 'Expected 11 recorded process IDs'
$filter=($pids | ForEach-Object { "ProcessId = $_" }) -join ' OR '
$checkedAt=[DateTime]::UtcNow.ToString('o')
$rows=@(Get-CimInstance -ClassName Win32_Process -Filter $filter -Property ProcessId,CreationDate -OperationTimeoutSec 6 |
  Select-Object ProcessId,CreationDate)
Need ($rows.Count -eq 0) 'Exact PID current presence unresolved'
function Ordinary([string]$Path) {
  $item=Get-Item -LiteralPath $Path -Force
  Need ($item.PSIsContainer -and !$item.LinkType -and !($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
    $item.FullName -ieq $Path) "Unsafe scratch directory $Path"
}
$root=[IO.Path]::GetPathRoot($scratch)
$cursor=$root
Ordinary $cursor
foreach ($part in $scratch.Substring($root.Length).Split('\')) { $cursor=Join-Path $cursor $part; Ordinary $cursor }
$walk=[Collections.Generic.Stack[string]]::new()
$walk.Push($scratch)
$inventory=[Collections.Generic.List[object]]::new()
while ($walk.Count) {
  $directory=$walk.Pop()
  Ordinary $directory
  foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
    Need ($item.FullName.StartsWith($scratch+'\',[StringComparison]::OrdinalIgnoreCase)) 'Scratch path escaped'
    $link=($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or [bool]$item.LinkType
    $inventory.Add([ordered]@{path=$item.FullName.Substring($scratch.Length+1);directory=[bool]$item.PSIsContainer;
      reparse=$link;linkType=$item.LinkType;target=if($link){@($item.Target)}else{$null};
      bytes=if(!$link -and !$item.PSIsContainer){$item.Length}else{$null};attributes=$item.Attributes.ToString()})
    if (!$link -and $item.PSIsContainer) { $walk.Push($item.FullName) }
  }
}
Need ((Same $rawHashes (EvidenceHashes))) 'Original evidence drifted during review'
$receipt=[ordered]@{
  schema='gg438-stdio-control-independent-readback/v1'; reviewedAt=[DateTime]::UtcNow.ToString('o')
  sourceAttempt=$attempt;rawEvidenceSha256=$rawHashes;currentBindings=$opening
  publishedDriverStatus=$result.status;firstFailure=$firstError;qualifiedControls=$cases.ToArray();recordedProcesses=$procs.ToArray()
  exactPidReadback=[ordered]@{checkedAt=$checkedAt;query=$filter;pids=$pids;matches=$rows}
  scratch=[ordered]@{path=$scratch;retained=$true;traversedLinks=$false;entries=@($inventory | Sort-Object { $_.path })}
  verdict=[ordered]@{fiveControlsQualified=$true;recordedProcessesGone=$true;scratchOriginalCleanupCompleted=$false;gatewayObserved=$false}
}
$receipt | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'readback.json') -Encoding utf8NoBOM
$receipt.verdict

