# Read-only process/listener census for #438 baseline attempt 3. Prints JSON; changes nothing.
param([string]$PortList = '4747,4748')
$Ports = @($PortList.Split(',') | ForEach-Object { [int]$_ })
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$at = [DateTime]::UtcNow.ToString('o')
$pattern = 'launcher-438-native-preparation-v3|GraphGoblinBaseline|baseline-attempt-3|launcher-438-baseline-invoke-03|apps[/\\]api[/\\]dist[/\\]main\.js'
$self = $PID
$rows = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and $_.CommandLine -match $pattern -and $_.ProcessId -ne $self -and $_.Name -notin @('bash.exe')
} | ForEach-Object {
    [ordered]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; name = $_.Name;
        creationUtc = $_.CreationDate.ToUniversalTime().ToString('o'); commandLine = $_.CommandLine }
}
$listen = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
    $_.LocalPort -in $Ports } | ForEach-Object {
    [ordered]@{ address = $_.LocalAddress; port = $_.LocalPort; owningPid = $_.OwningProcess } }
[ordered]@{ at = $at; ports = $Ports; matchingProcesses = @($rows); listeners = @($listen) } | ConvertTo-Json -Depth 4
