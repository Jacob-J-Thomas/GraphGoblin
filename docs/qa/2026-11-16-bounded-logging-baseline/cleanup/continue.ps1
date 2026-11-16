#Requires -Version 7.0
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$AdmissionSha256
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (!$IsWindows) { throw 'Windows only' }

$batch = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch'
$package = Join-Path $batch 'launcher-438-profile-cleanup-preparation'
$harness = Join-Path $batch 'launcher-438-native-preparation-v3'
$attempt = Join-Path $harness 'attempts\baseline-attempt-3'
$evidence = Join-Path $attempt 'evidence'
$disposable = Join-Path $attempt 'disposable'
$wrapper = Join-Path $harness 'receipts\baseline-attempt-3'
$junction = Join-Path $disposable 'profile\AppData\Local\Microsoft\Windows\INetCache\Content.IE5'
$target = Join-Path (Split-Path -Parent $junction) 'IE'
$admissionPath = Join-Path $package 'root-admission.json'
$metadataSource = Join-Path $package 'Metadata.cs'
$receipt = Join-Path $package 'continuation-receipt.jsonl'

function Assert-Condition($Condition, [string]$Message) {
  if (!$Condition) { throw $Message }
}

function Assert-OrdinaryDirectory([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  Assert-Condition ($item.PSIsContainer -and !$item.LinkType -and
      !($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $item.FullName -ieq $Path) "Unsafe directory $Path"
}

function Assert-Ancestry([string]$Path) {
  $root = [IO.Path]::GetPathRoot($Path)
  Assert-Condition ($root -ieq 'C:\' -and [IO.Path]::GetFullPath($Path) -ieq $Path) "Noncanonical path $Path"
  $cursor = $root
  Assert-OrdinaryDirectory $cursor
  foreach ($part in ($Path.Substring($root.Length).Split('\', [StringSplitOptions]::RemoveEmptyEntries))) {
    $cursor = Join-Path $cursor $part
    Assert-OrdinaryDirectory $cursor
  }
}

function Assert-OrdinaryInput([string]$Path) {
  Assert-Ancestry (Split-Path -Parent $Path)
  $item = Get-Item -LiteralPath $Path -Force
  Assert-Condition (!$item.PSIsContainer -and !$item.LinkType -and
      !($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $item.FullName -ieq $Path) "Unsafe input $Path"
}

function Initial-Hash([string]$Path) {
  Assert-OrdinaryInput $Path
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Bytes-Hash([byte[]]$Bytes) {
  [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()
}

function Read-Json([byte[]]$Bytes) {
  ([Text.UTF8Encoding]::new($false, $true).GetString($Bytes) | ConvertFrom-Json -AsHashtable -Depth 100)
}

function Equal-Json($Left, $Right) {
  (ConvertTo-Json -InputObject $Left -Depth 40 -Compress) -ceq (ConvertTo-Json -InputObject $Right -Depth 40 -Compress)
}

Assert-Condition ($PSScriptRoot -ieq $package -and $PSCommandPath -ieq (Join-Path $package 'continue.ps1')) 'Wrong script location'
Assert-Condition ((Initial-Hash $admissionPath) -ceq $AdmissionSha256) 'Admission digest mismatch'
$admission = Read-Json ([IO.File]::ReadAllBytes($admissionPath))
Assert-Condition ($admission.schema -ceq 'gg438-profile-cleanup-admission/v1' -and
    $admission.state -ceq 'root-admitted' -and $admission.attempt -ceq 'baseline-attempt-3' -and
    $admission.action -ceq 'unlink-known-junction-and-retain' -and $admission.behaviorReviewed -eq $true) 'No exact cleanup admission'
Assert-Condition ((Initial-Hash $PSCommandPath) -ceq $admission.scriptSha256) 'Continuation digest mismatch'
Assert-Condition ((Initial-Hash $metadataSource) -ceq $admission.metadataSha256) 'Metadata source digest mismatch'
Assert-Condition ((Initial-Hash $admissionPath) -ceq $AdmissionSha256) 'Admission changed'

# Reserve a single receipt before any mutation. CreateNew also rejects a previous failed invoke.
$receiptFile = [IO.File]::Open($receipt, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
$writer = [IO.StreamWriter]::new($receiptFile, [Text.UTF8Encoding]::new($false))
$writer.AutoFlush = $true

function Write-Event([string]$Stage, $Data) {
  $writer.WriteLine((ConvertTo-Json -InputObject ([ordered]@{ stage=$Stage; utc=[DateTime]::UtcNow.ToString('o'); data=$Data }) -Depth 40 -Compress))
}

$configNames = @('primary','wrong-store','occupied-port')
$files = [ordered]@{}
foreach ($name in @('result','cleanup','opening-binding','closing-binding','admission','pressure-summary',
    'work-after-pressure','invalid-authorization-observation','cold-gateway','clean-restart-gateway','ordinary-shell-gateway')) {
  $files[$name] = Join-Path $evidence ($name + '.json')
}
foreach ($name in @('launch','exit','capture')) {
  $files["wrapper-$name"] = Join-Path $wrapper ($name + '.json')
}
foreach ($name in $configNames) {
  $files["config-$name"] = Join-Path $disposable ("install\" + $name + '.qa438-private-config-42d8050e.json')
}

function Read-BoundInputs {
  Assert-Condition ($admission.sha256.Count -eq $files.Count) 'Bound input set is incomplete'
  $values = [ordered]@{}
  foreach ($name in $files.Keys) {
    $expected = $admission.sha256[$name]
    Assert-Condition ($expected -cmatch '^[a-f0-9]{64}$') "Missing digest for $name"
    Assert-Ancestry (Split-Path -Parent $files[$name])
    [byte[]]$bytes = [Gg438CleanupMetadata]::Read($files[$name])
    Assert-Condition ((Bytes-Hash $bytes) -ceq $expected) "Bound input changed $name"
    $values[$name] = Read-Json $bytes
  }
  foreach ($pin in @(@($admissionPath,$AdmissionSha256),@($PSCommandPath,$admission.scriptSha256),@($metadataSource,$admission.metadataSha256))) {
    Assert-Ancestry (Split-Path -Parent $pin[0])
    Assert-Condition ((Bytes-Hash ([Gg438CleanupMetadata]::Read($pin[0]))) -ceq $pin[1]) "Control input changed $($pin[0])"
  }
  return $values
}

function Confirm-Behavior($Inputs) {
  $result = $Inputs.result
  $cleanup = $Inputs.cleanup
  Assert-Condition ($result.mode -ceq 'baseline' -and $result.status -ceq 'incomplete' -and $result.completedAt -and
      !$result.Contains('firstFailure') -and !$result.Contains('bindingError')) 'Behavior or source binding did not finish'
  Assert-Condition (($admission.sha256['opening-binding'] -ceq $admission.sha256['closing-binding']) -and
      (Equal-Json $Inputs['opening-binding'] $Inputs['closing-binding']) -and
      ($Inputs['opening-binding'].head -cmatch '^[0-9a-f]{40}$') -and
      ($Inputs['opening-binding'].head -ceq $Inputs['opening-binding'].actualMain)) 'Opening/closing binding differs'
  Assert-Condition ($Inputs.admission.mode -ceq 'baseline' -and $Inputs.admission.attempt -ceq 'baseline-attempt-3') 'Wrong workload attempt'
  Assert-Condition ($Inputs['wrapper-launch'].attempt -ceq 'baseline-attempt-3' -and
      $Inputs['wrapper-launch'].pid -gt 0 -and $Inputs['wrapper-launch'].pid -eq $Inputs['wrapper-exit'].pid -and
      $Inputs['wrapper-exit'].exitCode -eq 1 -and $Inputs['wrapper-capture'].Contains('stdoutBytes') -and
      $Inputs['wrapper-capture'].Contains('stderrBytes')) 'No exact wrapper exit and pipe completion'
  Assert-Condition (!@((Get-ChildItem -LiteralPath $evidence -Force).Name | Where-Object { $_ -like 'first-failure*' }).Count) 'Original first failure exists'
  Assert-Condition (!$cleanup.Contains('disposableRemoved') -and !$cleanup.Contains('exclusive') -and
      @($cleanup.errors).Count -eq 1) 'Expected only the original inventory failure'
  $failure = $cleanup.errors[0]
  Assert-Condition ($failure.name -ceq 'AssertionError' -and $failure.code -ceq 'ERR_ASSERTION' -and
      $failure.actual -eq $false -and $failure.expected -eq $true -and $failure.message -ieq $junction -and
      $failure.stack.Contains('/launcher-438-native-preparation-v3/windows.mjs:') -and
      $failure.stack.Contains('confirmOwnedCleanup')) 'Cleanup did not fail solely at the exact junction'

  $requiredObservations = @('before-pressure','post-refusals','clean-restart','before-shell','after-shell','final-managed-files')
  $observations = @($result.observations)
  foreach ($label in $requiredObservations) {
    Assert-Condition (@($observations | Where-Object { $_.label -ceq $label -and !$_.unstable }).Count -eq 1) "Missing completed observation $label"
  }
  Assert-Condition ($observations[-1].label -ceq 'final-managed-files' -and
      $Inputs['pressure-summary'].last.gateway -gt 8388608 -and
      $Inputs['pressure-summary'].baselineWouldFailCandidateBytes -eq $true -and
      $Inputs['work-after-pressure'].status -ceq 'succeeded' -and
      $Inputs['invalid-authorization-observation'].invalidAuthorizationStatus -eq 401) 'Missing baseline pressure, work, or auth control'
  $launchOutcomes = [ordered]@{ cold=0; warm=0; 'wrong-store'=1; 'occupied-port'=1; 'clean-restart'=0 }
  Assert-Condition (@($result.processResults).Count -eq $launchOutcomes.Count) 'Unexpected launcher attempts'
  foreach ($label in $launchOutcomes.Keys) {
    $rows = @($result.processResults | Where-Object { $_.label -ceq $label })
    Assert-Condition ($rows.Count -eq 1 -and $rows[0].code -eq $launchOutcomes[$label] -and
        $rows[0].pid -gt 0) "Launcher outcome unavailable $label"
  }
  [uint32[]]$launchers = @($result.processResults.pid | Sort-Object -Unique)
  Assert-Condition ($launchers.Count -eq $launchOutcomes.Count -and @($cleanup.childCensus.rows).Count -eq 0 -and
      (Equal-Json $launchers ([uint32[]]@($cleanup.childCensus.parentPids | Sort-Object -Unique)))) 'Launcher census mismatch'
  return ,$launchers
}

function Derive-Ownership($Inputs, [uint32[]]$Launchers) {
  $cleanup = $Inputs.cleanup
  $labels = @('cold','clean-restart','ordinary-shell')
  $storeNames = @('store-a','store-b','store-port','store-shell')
  $namesByLabel = [ordered]@{ cold='store-a'; 'clean-restart'='store-a'; 'ordinary-shell'='store-shell' }
  $locks = @('graphgoblin.lock','graphgoblin.db.graphgoblin.lock')
  $ownedBirths = [Collections.Generic.List[object]]::new()
  Assert-Condition (@($cleanup.gateways).Count -eq 3) 'Three exact gateway exits required'
  foreach ($label in $labels) {
    $rows = @($cleanup.gateways | Where-Object { $_.label -ceq $label })
    Assert-Condition ($rows.Count -eq 1) "Duplicate or missing gateway $label"
    $row = $rows[0]
    $proof = $Inputs["$label-gateway"]
    Assert-Condition ($row.pid -gt 0 -and $row.original -cmatch '^[1-9][0-9]{16,18}$' -and
        $row.drainStatus -eq 202 -and ($row.after -is [Collections.IDictionary]) -and
        $row.after.creationFileTime -cne $row.original) "Gateway exit ambiguous $label"
    Assert-Condition ($proof.health.pid -eq $row.pid -and $proof.proc.pid -eq $row.pid -and
        $proof.proc.creationFileTime -ceq $row.original -and $proof.health.phase -ceq 'running' -and
        $proof.health.identity -cmatch '^[a-f0-9]{64}$' -and @($proof.leases).Count -eq 2) "Gateway evidence mismatch $label"
    $store = Join-Path $disposable $namesByLabel[$label]
    foreach ($lock in $locks) {
      $leases = @($proof.leases | Where-Object { $_.path -ieq (Join-Path $store $lock) })
      Assert-Condition ($leases.Count -eq 1 -and $leases[0].sha256 -cmatch '^[a-f0-9]{64}$') "Lease evidence mismatch $label"
    }
    $ownedBirths.Add([ordered]@{ role=$label; pid=[uint32]$row.pid; filetime=$row.original })
    if ($label -ceq 'cold') {
      $script = $row.work.scriptIdentity
      Assert-Condition ($row.work.terminal -ceq 'succeeded' -and $script.pid -gt 0 -and
          $script.pid -eq $row.work.scriptPid -and $script.parentPid -eq $row.pid -and
          $script.creationFileTime -cmatch '^[1-9][0-9]{16,18}$' -and
          ($row.work.scriptIdentityAfter -is [Collections.IDictionary]) -and
          $row.work.scriptIdentityAfter.creationFileTime -cne $script.creationFileTime) 'Owned Script exit ambiguous'
      $ownedBirths.Add([ordered]@{ role='held-script'; pid=[uint32]$script.pid; filetime=$script.creationFileTime })
    }
  }

  $configs = @($Inputs['config-primary'],$Inputs['config-wrong-store'],$Inputs['config-occupied-port'])
  for ($index=0; $index -lt $configs.Count; $index++) {
    Assert-Condition ($configs[$index].DataDir -ieq (Join-Path $disposable $storeNames[$index])) 'Config store escapes the exact fixture'
  }
  $primaryPort = $configs[0].Port
  $shellPort = ($cleanup.gateways | Where-Object { $_.label -ceq 'ordinary-shell' }).port
  [uint16[]]$ports = @($primaryPort,$configs[2].Port,$shellPort | Sort-Object -Unique)
  Assert-Condition ($ports.Count -eq 3 -and !($ports | Where-Object { $_ -in @(0,4747,4748) }) -and
      $configs[1].Port -eq $primaryPort -and
      !($cleanup.gateways | Where-Object { $_.label -ne 'ordinary-shell' -and $_.port -ne $primaryPort })) 'Fixture port ownership mismatch'
  Assert-Condition (@($cleanup.ports).Count -eq 3 -and !($cleanup.ports | Where-Object { $_.free -ne $true }) -and
      (Equal-Json $ports ([uint16[]]@($cleanup.ports.port | Sort-Object -Unique)))) 'Original listener outcomes incomplete'

  [ordered]@{ births=@($ownedBirths.ToArray()); launchers=$Launchers; ports=$ports;
      stores=@($storeNames | ForEach-Object { Join-Path $disposable $_ }); locks=$locks }
}

function Confirm-LiveAbsence($Owned) {
  $pids = @($Owned.births.pid + $Owned.launchers | Sort-Object -Unique)
  $pidFilter = ($pids | ForEach-Object { "ProcessId = $_" }) -join ' OR '
  $reuse = [Collections.Generic.List[object]]::new()
  foreach ($row in @(Get-CimInstance -ClassName Win32_Process -Filter $pidFilter -OperationTimeoutSec 6)) {
    $id = [uint32]$row.ProcessId
    Assert-Condition ($id -in $pids -and $id -notin $Owned.launchers -and $row.CreationDate) "Launcher PID or ambiguous native PID present $id"
    $filetime = $row.CreationDate.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)
    Assert-Condition (!($Owned.births | Where-Object { $_.pid -eq $id -and $_.filetime -ceq $filetime })) "Owned process birth still present $id"
    $reuse.Add([ordered]@{ pid=$id; filetime=$filetime })
  }
  $parentFilter = ($Owned.launchers | ForEach-Object { "ParentProcessId = $_" }) -join ' OR '
  $children = @(Get-CimInstance -ClassName Win32_Process -Filter $parentFilter -OperationTimeoutSec 6)
  Assert-Condition ($children.Count -eq 0) 'Recorded launcher parent still has a child'
  $portFilter = ($Owned.ports | ForEach-Object { "LocalPort = $_" }) -join ' OR '
  $listeners = @(Get-CimInstance -Namespace 'root/StandardCimv2' -ClassName MSFT_NetTCPConnection -Filter "State = 2 AND ($portFilter)" -OperationTimeoutSec 6)
  Assert-Condition ($listeners.Count -eq 0) 'Recorded fixture port still has a listener'
  [ordered]@{ pids=$pids; reused=@($reuse.ToArray()); matchingBirths=0; launcherChildren=0; ports=$Owned.ports; listeners=0 }
}

function Assert-Junction {
  Assert-Ancestry (Split-Path -Parent $junction)
  Assert-Ancestry $target
  $item = Get-Item -LiteralPath $junction -Force
  $targets = @($item.Target)
  Assert-Condition ($item.FullName -ieq $junction -and $item.PSIsContainer -and $item.LinkType -ceq 'Junction' -and
      ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $targets.Count -eq 1 -and $targets[0] -ieq $target) 'Unexpected junction type, location, or target'
  $meta = [Gg438CleanupMetadata]::Inspect($junction,$false)
  Assert-Condition ($meta.IsDirectory -and $meta.IsReparse) 'Junction changed'
  return $meta.Id
}

function Read-Inventory([bool]$AllowJunction) {
  Assert-Ancestry $disposable
  $stack = [Collections.Generic.Stack[string]]::new()
  $stack.Push($disposable)
  $rows = [Collections.Generic.List[object]]::new()
  $links = 0
  $prefix = $disposable + '\'
  while ($stack.Count) {
    $path = $stack.Pop()
    Assert-Condition ($path -ieq $disposable -or $path.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) "Inventory escaped $path"
    $meta = [Gg438CleanupMetadata]::Inspect($path,$false)
    if ($meta.IsReparse) {
      Assert-Condition ($AllowJunction -and $path -ieq $junction -and $meta.Id -ceq (Assert-Junction)) "Unapproved reparse entry $path"
      $links++
    } elseif ($meta.IsDirectory) {
      Assert-OrdinaryDirectory $path
      foreach ($item in Get-ChildItem -LiteralPath $path -Force) { $stack.Push($item.FullName) }
    } else {
      Assert-Condition ($meta.Links -eq 1) "Unexpected hardlink $path"
      if ($path.StartsWith($target + '\',[StringComparison]::OrdinalIgnoreCase)) {
        $hashed = [Gg438CleanupMetadata]::Inspect($path,$true)
        Assert-Condition ($hashed.Id -ceq $meta.Id -and $hashed.Modified -ceq $meta.Modified -and $hashed.Bytes -eq $meta.Bytes) "Target file changed $path"
        $meta = $hashed
      }
    }
    $rows.Add([ordered]@{ path=$path; id=$meta.Id; directory=$meta.IsDirectory; reparse=$meta.IsReparse;
        attributes=$meta.Attributes; links=$meta.Links; modified=$meta.Modified; bytes=$meta.Bytes; sha256=$meta.Sha256 })
  }
  Assert-Condition (($AllowJunction -and $links -eq 1) -or (!$AllowJunction -and $links -eq 0)) 'Unexpected junction count'
  Assert-Condition (@($rows | Where-Object { $_.path -ieq $target }).Count -eq 1) 'Exact target missing from physical inventory'
  return ,@($rows | Sort-Object { $_.path })
}

function Hold-StoreFiles($Owned, $Inventory, $Handles) {
  $names = @('graphgoblin.db','graphgoblin.db-wal','graphgoblin.db-shm')
  $witness = [Collections.Generic.List[object]]::new()
  foreach ($store in $Owned.stores) {
    Assert-Ancestry $store
    if ([IO.Path]::GetFileName($store) -in @('store-b','store-port')) {
      Assert-Condition (@(Get-ChildItem -LiteralPath $store -Force).Count -eq 0) "Refused store is no longer empty $store"
    }
    foreach ($lock in $Owned.locks) {
      foreach ($part in @($lock,($lock + '.reclaim'))) {
        $path = Join-Path $store $part
        Assert-Condition (!($Inventory | Where-Object { $_.path -ieq $path })) "Ownership artifact remains $path"
      }
    }
  }
  foreach ($row in $Inventory) {
    if ([IO.Path]::GetFileName($row.path) -notin $names) { continue }
    $parent = Split-Path -Parent $row.path
    Assert-Condition ($parent -in $Owned.stores -and !$row.directory -and !$row.reparse -and $row.links -eq 1) "Unexpected SQLite location $($row.path)"
    $handle = [Gg438CleanupMetadata]::OpenExclusive($row.path)
    $Handles.Add($handle)
    $info = [Gg438CleanupMetadata]::Describe($handle)
    Assert-Condition ($info.Id -ceq $row.id -and $info.Modified -ceq $row.modified -and $info.Bytes -eq $row.bytes) "SQLite identity changed $($row.path)"
    $witness.Add([ordered]@{path=$row.path; id=$info.Id; bytes=$info.Bytes})
  }
  foreach ($name in @('store-a','store-shell')) {
    $database = Join-Path $disposable "$name\graphgoblin.db"
    Assert-Condition (@($witness | Where-Object { $_.path -ieq $database }).Count -eq 1) "Expected database missing $database"
  }
  $present = @(foreach ($store in $Owned.stores) {
    foreach ($item in Get-ChildItem -LiteralPath $store -Force) {
      if ($item.Name -in $names) { $item.FullName }
      Assert-Condition ($item.Name -notin @($Owned.locks + @($Owned.locks | ForEach-Object { $_ + '.reclaim' }))) "Ownership artifact remains $($item.FullName)"
    }
  })
  Assert-Condition (Equal-Json @($present | Sort-Object) @($witness | ForEach-Object { $_.path } | Sort-Object)) 'SQLite names changed while locks were acquired'
  return ,@($witness.ToArray())
}

$removed = $false
$requested = $false
try {
  Write-Event 'admitted' ([ordered]@{ admissionSha256=$AdmissionSha256; disposable=$disposable;
      junction=$junction; target=$target; hashes=$admission.sha256 })
  Add-Type -LiteralPath $metadataSource
  $inputs = Read-BoundInputs
  $launchers = Confirm-Behavior $inputs
  $owned = Derive-Ownership $inputs $launchers
  Write-Event 'owned' $owned
  Assert-Ancestry $disposable
  $before = Read-Inventory $true
  Write-Event 'before' ([ordered]@{ absence=(Confirm-LiveAbsence $owned); inventory=$before })

  [void](Read-BoundInputs)
  $immediate = Read-Inventory $true
  Assert-Condition (Equal-Json $before $immediate) 'Disposable inventory changed before unlink'
  $handles = [Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]]::new()
  try {
    $exclusive = Hold-StoreFiles $owned $immediate $handles
    [void](Read-BoundInputs)
    $absence = Confirm-LiveAbsence $owned
    $linkId = Assert-Junction
    $linkRows = @($immediate | Where-Object { $_.path -ieq $junction })
    Assert-Condition ($linkRows.Count -eq 1 -and $linkId -ceq $linkRows[0].id) 'Admitted junction identity changed'
    Write-Event 'pre-unlink' ([ordered]@{ absence=$absence; exclusive=$exclusive; linkId=$linkId; boundInputsRechecked=$true })
    $requested = $true
    Write-Event 'unlink-requested' ([ordered]@{ path=$junction; recursive=$false })
    [IO.Directory]::Delete($junction,$false)
    $removed = $true
  } finally { foreach ($handle in $handles) { $handle.Dispose() } }

  $after = Read-Inventory $false
  $targetPrefix = $target + '\'
  $beforeTarget = @($before | Where-Object { $_.path -ieq $target -or $_.path.StartsWith($targetPrefix,[StringComparison]::OrdinalIgnoreCase) })
  $afterTarget = @($after | Where-Object { $_.path -ieq $target -or $_.path.StartsWith($targetPrefix,[StringComparison]::OrdinalIgnoreCase) })
  Assert-Condition (Equal-Json $beforeTarget $afterTarget) 'Physical junction target changed'
  Assert-Condition ($before.Count -eq ($after.Count + 1) -and
      (Equal-Json @($before | Where-Object { $_.path -ine $junction } | ForEach-Object { $_.path }) @($after | ForEach-Object { $_.path }))) 'Path set changed beyond the exact unlink'
  $handles = [Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]]::new()
  try {
    $exclusiveAfter = Hold-StoreFiles $owned $after $handles
    Assert-Condition (Equal-Json $exclusive $exclusiveAfter) 'Exclusive SQLite file inventory changed'
    $absenceAfter = Confirm-LiveAbsence $owned
    [void](Read-BoundInputs)
    Write-Event 'attested-retained' ([ordered]@{ absence=$absenceAfter; inventory=$after; targetUnchanged=$true;
        junctionAbsent=$true; disposableRetained=$true; rawEvidenceUnchanged=$true; exclusive=$exclusiveAfter })
  } finally { foreach ($handle in $handles) { $handle.Dispose() } }
} catch {
  Write-Event 'first-failure' ([ordered]@{ name=$_.Exception.GetType().FullName; message=$_.Exception.Message;
      scriptStack=$_.ScriptStackTrace; unlinkRequested=$requested; unlinkReturned=$removed;
      disposableDeletionRequested=$false })
  throw
} finally {
  $writer.Dispose()
  $receiptFile.Dispose()
}
'Exact profile junction unlinked. The original disposable tree is retained and attested.'

