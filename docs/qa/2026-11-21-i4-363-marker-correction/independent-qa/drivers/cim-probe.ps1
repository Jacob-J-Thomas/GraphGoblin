# Owned, read-only CIM/network probe for the #363 F3 independent QA driver.
# Serves numbered requests from -Dir. It queries Win32_Process only by explicit PID, by explicit
# ParentProcessId, or by a caller-supplied command-line substring, plus TCP/UDP endpoints for
# explicit PIDs. It never stops, signals or modifies any process.
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [int]$MaxSeconds = 900
)
$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding($false)
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function WriteJsonAtomic([string]$Path, $Obj) {
  $tmp = "$Path.tmp"
  [System.IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $Obj -Depth 8 -Compress), $enc)
  [System.IO.File]::Move($tmp, $Path)
}
function ProcInfo($p) {
  $created = $null
  if ($p.CreationDate) { $created = $p.CreationDate.ToUniversalTime().ToString('o') }
  [ordered]@{
    ProcessId       = [int]$p.ProcessId
    ParentProcessId = [int]$p.ParentProcessId
    Name            = [string]$p.Name
    ExecutablePath  = [string]$p.ExecutablePath
    CommandLine     = [string]$p.CommandLine
    CreationDate    = $created
  }
}
function QueryProcs([string]$Filter) {
  return @(@(Get-CimInstance -ClassName Win32_Process -Filter $Filter) | ForEach-Object { ProcInfo $_ })
}

# Warm the CIM and NetTCPIP providers before reporting ready.
$null = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$PID"
$null = Get-NetTCPConnection -OwningProcess $PID -ErrorAction SilentlyContinue
$null = Get-NetUDPEndpoint -OwningProcess $PID -ErrorAction SilentlyContinue
WriteJsonAtomic (Join-Path $Dir 'ready.json') ([ordered]@{
    pid     = $PID
    readyMs = (NowMs)
    ps      = $PSVersionTable.PSVersion.ToString()
  })

$deadline = (NowMs) + ($MaxSeconds * 1000)
$done = @{}
$stopFile = Join-Path $Dir 'stop'
while ((NowMs) -lt $deadline) {
  if (Test-Path -LiteralPath $stopFile) { break }
  $requests = @(Get-ChildItem -LiteralPath $Dir -Filter 'req-*.json' -File |
      Where-Object { $_.Name -match '^req-\d+\.json$' } | Sort-Object Name)
  foreach ($r in $requests) {
    if ($done.ContainsKey($r.Name)) { continue }
    $done[$r.Name] = $true
    $id = $r.BaseName.Substring(4)
    $resp = [ordered]@{ id = $id; startMs = (NowMs) }
    try {
      $req = Get-Content -LiteralPath $r.FullName -Raw | ConvertFrom-Json
      $byPid = [ordered]@{}
      foreach ($p in @($req.pids)) {
        if ($null -eq $p) { continue }
        $byPid["$p"] = @(QueryProcs ("ProcessId=" + [int]$p))
      }
      $children = [ordered]@{}
      foreach ($p in @($req.parents)) {
        if ($null -eq $p) { continue }
        $children["$p"] = @(QueryProcs ("ParentProcessId=" + [int]$p))
      }
      $like = [ordered]@{}
      foreach ($s in @($req.commandLineLike)) {
        if (-not $s) { continue }
        $hits = @(QueryProcs ("CommandLine LIKE '%" + [string]$s + "%'"))
        $like[[string]$s] = @($hits | Where-Object { $_.ProcessId -ne $PID })
      }
      $resp.byPid = $byPid
      $resp.childrenOf = $children
      $resp.commandLineLike = $like
      $resp.cimEndMs = (NowMs)
      if ($req.net) {
        $tcp = [ordered]@{}
        $udp = [ordered]@{}
        foreach ($p in @($req.pids)) {
          if ($null -eq $p) { continue }
          $tcp["$p"] = @(@(Get-NetTCPConnection -OwningProcess ([uint32]$p) -ErrorAction SilentlyContinue) | ForEach-Object {
              [ordered]@{
                LocalAddress  = [string]$_.LocalAddress
                LocalPort     = [int]$_.LocalPort
                RemoteAddress = [string]$_.RemoteAddress
                RemotePort    = [int]$_.RemotePort
                State         = [string]$_.State
              }
            })
          $udp["$p"] = @(@(Get-NetUDPEndpoint -OwningProcess ([uint32]$p) -ErrorAction SilentlyContinue) | ForEach-Object {
              [ordered]@{ LocalAddress = [string]$_.LocalAddress; LocalPort = [int]$_.LocalPort }
            })
        }
        $resp.tcp = $tcp
        $resp.udp = $udp
        $resp.netEndMs = (NowMs)
      }
      $resp.ok = $true
    }
    catch {
      $resp.ok = $false
      $resp.error = $_.Exception.Message
    }
    $resp.endMs = (NowMs)
    WriteJsonAtomic (Join-Path $Dir "res-$id.json") $resp
  }
  Start-Sleep -Milliseconds 10
}
WriteJsonAtomic (Join-Path $Dir 'exit.json') ([ordered]@{ pid = $PID; exitMs = (NowMs) })
