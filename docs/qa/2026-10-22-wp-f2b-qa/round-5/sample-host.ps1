param([string]$Name='host-before')
# <repo>: read-only host inventory. Command-line values are redacted before saving.
$qaRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
function Redact([string]$Value){
  $qaText=$Value.Replace($qaRoot,'<repo>').Replace($qaRoot.Replace('\','/'),'<repo>')
  if($env:USERPROFILE){$qaText=$qaText.Replace($env:USERPROFILE,'<profile>').Replace($env:USERPROFILE.Replace('\','/'),'<profile>')}
  $qaText=[regex]::Replace($qaText,'(?i)[A-Z]:[\\/]+Users[\\/]+[^\\/\s"]+','<profile>')
  $qaText=[regex]::Replace($qaText,'(?i)(--(?:api[-_]?key|token|secret|password)(?:=|\s+))\S+','$1<redacted>')
  $qaText=[regex]::Replace($qaText,'(?i)(Bearer\s+)\S+','$1<redacted>')
  return $qaText
}
$qaStarted=(Get-Date).ToUniversalTime()
$qaCores=[Environment]::ProcessorCount
$qaBefore=Get-Process
$qaCommandLines=@{}
$qaCommandStatus='available'
try{
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop | ForEach-Object {$qaCommandLines[[string]$_.ProcessId]=Redact $_.CommandLine}
}catch{$qaCommandStatus='Unavailable: CIM process command-line inventory denied'}
$qaNodesBefore=@($qaBefore | Where-Object ProcessName -eq 'node' | ForEach-Object {
  @{pid=$_.Id;cpuSeconds=$_.CPU;workingSetMiB=[math]::Round($_.WorkingSet64/1MB,1);commandLine=$qaCommandLines[[string]$_.Id]}
})
$qaCounter=$null
try{$qaCounter=New-Object Diagnostics.PerformanceCounter('Processor','% Processor Time','_Total');$null=$qaCounter.NextValue()}catch{}
$qaSamples=@()
$qaPriorCpu=($qaBefore | Measure-Object CPU -Sum).Sum
$qaPriorTime=Get-Date
for($qaI=0;$qaI -lt 12;$qaI++){
  Start-Sleep -Seconds 5
  $qaNow=Get-Date
  $qaProcesses=Get-Process
  $qaCpu=($qaProcesses | Measure-Object CPU -Sum).Sum
  $qaElapsed=($qaNow-$qaPriorTime).TotalSeconds
  $qaValue=$null
  if($qaCounter){try{$qaValue=[math]::Round($qaCounter.NextValue(),2)}catch{}}
  $qaSamples+=@{utc=$qaNow.ToUniversalTime().ToString('o');hostCpuPercent=$qaValue;visibleProcessCpuPercent=[math]::Round([math]::Max(0,($qaCpu-$qaPriorCpu)/$qaElapsed/$qaCores*100),2);processCount=$qaProcesses.Count;nodeCount=@($qaProcesses | Where-Object ProcessName -eq 'node').Count}
  $qaPriorCpu=$qaCpu;$qaPriorTime=$qaNow
}
$qaAfter=Get-Process
$qaElapsedTotal=((Get-Date).ToUniversalTime()-$qaStarted).TotalSeconds
$qaNodesAfter=@($qaAfter | Where-Object ProcessName -eq 'node' | ForEach-Object {
  $qaOld=@($qaNodesBefore | Where-Object pid -eq $_.Id)
  $qaDelta=if($qaOld.Count -gt 0){[math]::Max(0,$_.CPU-$qaOld[0].cpuSeconds)}else{$null}
  @{pid=$_.Id;cpuSeconds=$_.CPU;cpuDeltaSeconds=$qaDelta;workingSetMiB=[math]::Round($_.WorkingSet64/1MB,1);commandLine=$qaCommandLines[[string]$_.Id]}
})
$qaResult=@{startedUtc=$qaStarted.ToString('o');durationSeconds=$qaElapsedTotal;logicalProcessors=$qaCores;processCountBefore=$qaBefore.Count;processCountAfter=$qaAfter.Count;commandLineInventory=$qaCommandStatus;nodesBefore=$qaNodesBefore;nodesAfter=$qaNodesAfter;samples=$qaSamples;note='Other processes are read only; no test, build, process termination or provider turn started by this sampler.'}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot ($Name+'.json')),($qaResult | ConvertTo-Json -Depth 8))
if($qaCounter){$qaCounter.Dispose()}
Write-Output ('Host sample saved: '+$Name)