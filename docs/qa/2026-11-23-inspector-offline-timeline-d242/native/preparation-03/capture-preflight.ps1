#Requires -Version 7.0
$ErrorActionPreference='Stop'
$binding=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'OLD-ROOT-BINDING.template.json') | ConvertFrom-Json -AsHashtable
$node=$binding.runtime.node.source
if((Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant() -ne $binding.runtime.node.sha256){throw 'Node pin mismatch'}
$stdoutPath=Join-Path $PSScriptRoot 'dependency-import.stdout.log';$stderrPath=Join-Path $PSScriptRoot 'dependency-import.stderr.log'
if((Test-Path -LiteralPath $stdoutPath) -or (Test-Path -LiteralPath $stderrPath)){throw 'Preflight already attempted; preserve and stop'}
$temp=Join-Path $PSScriptRoot 'import-temp';[void][IO.Directory]::CreateDirectory($temp)
$psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$node;$psi.ArgumentList.Add((Join-Path $PSScriptRoot 'dependency-import-preflight.mjs'))
$psi.WorkingDirectory=$PSScriptRoot;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
$psi.Environment['PATH']="$(Split-Path -Parent $node);$($psi.Environment['PATH'])"
$psi.Environment['TEMP']=$temp;$psi.Environment['TMP']=$temp;$psi.Environment['NODE_DISABLE_COMPILE_CACHE']='1'
[void]$psi.Environment.Remove('NODE_OPTIONS');[void]$psi.Environment.Remove('NODE_PATH');[void]$psi.Environment.Remove('NODE_COMPILE_CACHE')
$psi.Environment['GG_OLLAMA_ENABLED']='false';$psi.Environment['LIVE']='0'
$start=[DateTimeOffset]::UtcNow.ToString('o')
$process=[Diagnostics.Process]::new();$process.StartInfo=$psi
$stdout=[IO.File]::Open($stdoutPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$stderr=[IO.File]::Open($stderrPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$code=$null;$failure=$null
try{
  if(-not $process.Start()){throw 'Node import preflight did not start'}
  $out=$process.StandardOutput.BaseStream.CopyToAsync($stdout);$err=$process.StandardError.BaseStream.CopyToAsync($stderr)
  $process.WaitForExit();[void]$out.GetAwaiter().GetResult();[void]$err.GetAwaiter().GetResult();$code=$process.ExitCode
}catch{$failure=$_.Exception.Message}
finally{$stdout.Dispose();$stderr.Dispose();$process.Dispose()}
$receipt=[ordered]@{fileName=$node;argv=@((Join-Path $PSScriptRoot 'dependency-import-preflight.mjs'));cwd=$PSScriptRoot;startUtc=$start;endUtc=[DateTimeOffset]::UtcNow.ToString('o');exitCode=$code;startOrCaptureFailure=$failure;shell=$false;scope='One authorized dependency import and pure schema prerequisite only';stdoutSha256=(Get-FileHash -LiteralPath $stdoutPath -Algorithm SHA256).Hash.ToLowerInvariant();stderrSha256=(Get-FileHash -LiteralPath $stderrPath -Algorithm SHA256).Hash.ToLowerInvariant();browserOrProductCasesStarted=0;serverOrProviderLaunched=$false;semanticProjectionsChanged=$false;childEnvironmentControl=@{TEMP=$temp;TMP=$temp;NODE_DISABLE_COMPILE_CACHE='1';NODE_OPTIONS='absent';NODE_PATH='absent';NODE_COMPILE_CACHE='absent';GG_OLLAMA_ENABLED='false';LIVE='0'}}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'dependency-import.receipt.json'),($receipt|ConvertTo-Json -Depth 12)+"`n",[Text.UTF8Encoding]::new($false))
$receipt|ConvertTo-Json -Depth 12
if($failure -or $code -ne 0){exit 1}
exit 0
