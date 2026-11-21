param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [Parameter(Mandatory = $true)][string]$StopFile,
  [Parameter(Mandatory = $true)][string]$ReadyFile,
  [int]$IntervalMs = 250
)
# QA448 native supplementary observer: records every TCP connection row and UDP endpoint owned by any
# descendant of $RootPid (excluding this poller). DNS performed by the Windows DNS client service is not
# attributable at this layer. Short-lived processes that start and exit between process scans can be missed.
$ErrorActionPreference = 'Continue'
$self = $PID
$tracked = @{}
$tracked[$RootPid] = 'root'
$samples = 0
$rowsWritten = 0
$lastScan = [datetime]::MinValue
function Write-Rec($obj) {
  $obj['utc'] = (Get-Date).ToUniversalTime().ToString('o')
  Add-Content -LiteralPath $OutFile -Value ($obj | ConvertTo-Json -Compress -Depth 4) -Encoding utf8
}
Write-Rec @{ event = 'poller-start'; rootPid = $RootPid; pollerPid = $self; intervalMs = $IntervalMs }
$first = $true
while (-not (Test-Path -LiteralPath $StopFile)) {
  $now = Get-Date
  if (($now - $lastScan).TotalMilliseconds -ge 1000) {
    $procs = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine, CreationDate)
    do {
      $added = $false
      foreach ($p in $procs) {
        $id = [int]$p.ProcessId
        if ($id -ne $self -and -not $tracked.ContainsKey($id) -and $tracked.ContainsKey([int]$p.ParentProcessId)) {
          $tracked[$id] = $p.Name
          $added = $true
          $cmd = [string]$p.CommandLine
          if ($cmd.Length -gt 400) { $cmd = $cmd.Substring(0, 400) }
          Write-Rec @{ event = 'process-tracked'; pid = $id; ppid = [int]$p.ParentProcessId; name = $p.Name; created = [string]$p.CreationDate; commandLine = $cmd }
        }
      }
    } while ($added)
    $lastScan = $now
    if ($first) { Set-Content -LiteralPath $ReadyFile -Value 'ready'; $first = $false }
  }
  $tcp = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $tracked.ContainsKey([int]$_.OwningProcess) })
  foreach ($c in $tcp) {
    Write-Rec @{ event = 'tcp-row'; pid = [int]$c.OwningProcess; name = $tracked[[int]$c.OwningProcess]; state = [string]$c.State; local = [string]$c.LocalAddress; localPort = [int]$c.LocalPort; remote = [string]$c.RemoteAddress; remotePort = [int]$c.RemotePort }
    $rowsWritten++
  }
  $udp = @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $tracked.ContainsKey([int]$_.OwningProcess) })
  foreach ($u in $udp) {
    Write-Rec @{ event = 'udp-endpoint'; pid = [int]$u.OwningProcess; name = $tracked[[int]$u.OwningProcess]; local = [string]$u.LocalAddress; localPort = [int]$u.LocalPort }
    $rowsWritten++
  }
  $samples++
  Start-Sleep -Milliseconds $IntervalMs
}
Write-Rec @{ event = 'poller-stop'; samples = $samples; rowsWritten = $rowsWritten; trackedPids = @($tracked.Keys | ForEach-Object { [int]$_ }) }
