#Requires -Version 7.0
param([Parameter(Mandatory=$true)][string]$BindingPath,[switch]$Execute)
$ErrorActionPreference='Stop'
if(-not $Execute){throw 'UNARMED: explicit root execution is required'}
$binding=Get-Content -Raw -LiteralPath $BindingPath | ConvertFrom-Json -AsHashtable
if($binding.executionAdmitted -ne $true){throw 'UNARMED binding'}
function Sha([string]$file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
function Verify($ref){if((Get-Item -LiteralPath $ref.source).Length -ne $ref.bytes -or (Sha $ref.source) -ne $ref.sha256){throw "Pinned bytes changed: $($ref.source)"}}
Verify $binding.runtime.node; Verify $binding.runtime.pnpm; Verify $binding.rootAdmission
$admission=Get-Content -Raw -LiteralPath $binding.rootAdmission.source | ConvertFrom-Json -AsHashtable
if($admission.executionAdmitted -ne $true -or $admission.head -ne $binding.source.head -or $admission.selection -ne $binding.selection){throw 'Root source/selection admission mismatch'}
$taskRoot=[IO.Path]::GetFullPath('G:/ggq/delivery-evidence/2026-11-17-five-intents')
$taskOutput=[IO.Path]::GetFullPath($binding.outputDirectory)
if(-not $taskOutput.StartsWith($taskRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($taskOutput) -notmatch '^i5-d242-b2-native-(old-f642|corrected)-execution-[0-9]{2}$'){throw 'Unowned output path'}
if([IO.Path]::GetFullPath($binding.nativeDirectory) -ine (Join-Path $taskOutput 'native') -or (Test-Path -LiteralPath $taskOutput)){throw 'Output already exists or native path differs'}
if((Sha (Join-Path $PSScriptRoot 'MANIFEST.json')) -ne $binding.preparationManifestSha256){throw 'Preparation seal mismatch'}
[void][IO.Directory]::CreateDirectory($taskOutput)
[IO.File]::Copy([IO.Path]::GetFullPath($BindingPath),(Join-Path $taskOutput 'ROOT-BINDING.executed.json'),$false)
$taskTemp=Join-Path $taskOutput 'temp'; [void][IO.Directory]::CreateDirectory($taskTemp)
$env:PATH="$(Split-Path -Parent $binding.runtime.node.source);$env:PATH"
$taskArgs=@('--filter','@graphgoblin/web','exec','node',(Join-Path $PSScriptRoot 'native.cjs'),'--binding',[IO.Path]::GetFullPath($BindingPath),'--execute')
$psi=[Diagnostics.ProcessStartInfo]::new(); $psi.FileName=$binding.runtime.pnpm.source
foreach($arg in $taskArgs){$psi.ArgumentList.Add($arg)}
$psi.WorkingDirectory=$binding.runtime.workspace; $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true
$psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true
$psi.Environment['TEMP']=$taskTemp; $psi.Environment['TMP']=$taskTemp
$psi.Environment['GG_OLLAMA_ENABLED']='false'; $psi.Environment['LIVE']='0'
$start=[DateTimeOffset]::UtcNow.ToString('o')
$command=[ordered]@{fileName=$psi.FileName;argv=$taskArgs;cwd=$psi.WorkingDirectory;startUtc=$start;shell=$false;source=$binding.source;selection=$binding.selection;nodeFirstOnPath=$binding.runtime.node.source;childEnvironmentControl=@{TEMP=$taskTemp;TMP=$taskTemp;GG_OLLAMA_ENABLED='false';LIVE='0'}}
[IO.File]::WriteAllText((Join-Path $taskOutput 'COMMAND.start.json'),($command|ConvertTo-Json -Depth 15)+"`n",[Text.UTF8Encoding]::new($false))
$stdoutPath=Join-Path $taskOutput 'native.stdout.log';$stderrPath=Join-Path $taskOutput 'native.stderr.log'
$stdout=[IO.File]::Open($stdoutPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$stderr=[IO.File]::Open($stderrPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$process=[Diagnostics.Process]::new();$process.StartInfo=$psi;$code=$null;$failure=$null
try{
  if(-not $process.Start()){throw 'Pinned pnpm did not start'}
  $out=$process.StandardOutput.BaseStream.CopyToAsync($stdout);$err=$process.StandardError.BaseStream.CopyToAsync($stderr)
  $process.WaitForExit();[void]$out.GetAwaiter().GetResult();[void]$err.GetAwaiter().GetResult();$code=$process.ExitCode
}catch{$failure=$_.Exception.Message}
finally{$stdout.Dispose();$stderr.Dispose();$process.Dispose()}
$command.endUtc=[DateTimeOffset]::UtcNow.ToString('o');$command.exitCode=$code;$command.startOrCaptureFailure=$failure
$command.stdoutSha256=Sha $stdoutPath;$command.stderrSha256=Sha $stderrPath
$command.rootBindingSha256=Sha $BindingPath;$command.residualTempPolicy='Owned browser/compilation diagnostics retained; no recursive deletion by runner.'
[IO.File]::WriteAllText((Join-Path $taskOutput 'COMMAND.receipt.json'),($command|ConvertTo-Json -Depth 15)+"`n",[Text.UTF8Encoding]::new($false))
if($failure -or $code -ne 0){Write-Error "Native phase failed (exit=$code): $failure";exit 1}
exit 0
