# GraphGoblin #459 independent QA fixture: a real Windows PowerShell 5.1 query process (not product
# code). It handshakes with the driver, performs one real WMI query of the driver-owned sentinel
# process, optionally starts one ordinary nested Node child, then stalls like a slow query until
# its bounded natural lifetime (exit 43), a driver release (47) or a broken driver pipe (48).
$ErrorActionPreference = 'Stop'
$role = $env:QA459_PS_ROLE
$client = New-Object System.IO.Pipes.NamedPipeClientStream('.', $env:QA459_PIPE, [System.IO.Pipes.PipeDirection]::InOut)
try { $client.Connect(10000) } catch { exit 97 }
$writer = New-Object System.IO.StreamWriter($client)
$writer.AutoFlush = $true
$reader = New-Object System.IO.StreamReader($client)
$hello = @{ hello = 1; token = $env:QA459_TOKEN; case = $env:QA459_CASE; role = $role; pid = $PID } | ConvertTo-Json -Compress
$writer.WriteLine($hello)
$ack = $reader.ReadLine()
if ($null -eq $ack -or $ack -notmatch '"ack":true') { exit 97 }
$readyDir = Join-Path $env:QA459_CASE_DIR 'ready'
$null = New-Item -ItemType Directory -Force -Path $readyDir
[IO.File]::WriteAllText((Join-Path $readyDir $role), [string]$PID)
$started = [Diagnostics.Stopwatch]::StartNew()
$queried = $false
try {
  $owner = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$env:QA459_PS_QUERY_PID)
  $queried = ($null -ne $owner -and $null -ne $owner.CreationDate)
} catch { $queried = $false }
$queryMs = $started.ElapsedMilliseconds
if ($env:QA459_PS_NESTED) {
  $info = New-Object System.Diagnostics.ProcessStartInfo($env:QA459_NODE)
  $info.Arguments = '"' + $env:QA459_MEMBER + '" ' + $env:QA459_PS_NESTED
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $null = [System.Diagnostics.Process]::Start($info)
}
$writer.WriteLine((@{ event = 'query-done'; queried = $queried; queryMs = $queryMs } | ConvertTo-Json -Compress))
$pending = $reader.ReadLineAsync()
if ($pending.Wait([int]$env:QA459_PS_LIFETIME_MS)) {
  if ($null -eq $pending.Result) { exit 48 } else { exit 47 }
}
exit 43
