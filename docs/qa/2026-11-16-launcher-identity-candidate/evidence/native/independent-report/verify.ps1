$ErrorActionPreference='Stop'
$qaBatch=(Get-Location).Path
$qaBase=Join-Path $qaBatch 'launcher/435-native-corrected-junction-candidate-first'
$qaOut=Join-Path $qaBatch 'launcher/435-native-junction-candidate-independent-report'
if (!(Test-Path -LiteralPath $qaOut -PathType Container) -or (Test-Path -LiteralPath (Join-Path $qaOut 'independent-readback.json'))) {throw 'Unexpected candidate readback path'}
function Q($qaTest,$qaLabel) { if (!$qaTest) { throw $qaLabel } }
function Read-QaCandidateJson($qaPath) { Get-Content -Raw -LiteralPath $qaPath | ConvertFrom-Json -AsHashtable }
function Get-QaCandidateHash($qaPath) { (Get-FileHash -LiteralPath $qaPath -Algorithm SHA256).Hash.ToLowerInvariant() }
function Same($qaA,$qaB) { ($qaA | ConvertTo-Json -Depth 20 -Compress) -ceq ($qaB | ConvertTo-Json -Depth 20 -Compress) }
$qaInputs=[ordered]@{}
function Check-File($qaPath,$qaDigest) {
 $qaHash=Get-QaCandidateHash $qaPath
 if ($qaDigest) { Q ($qaHash -ceq $qaDigest) "Digest differs: $qaPath" }
 $qaKey=[IO.Path]::GetRelativePath($qaBatch,$qaPath).Replace('\','/')
 if ($qaKey.StartsWith('../')) { $qaKey=$qaPath }
 $qaInputs[$qaKey]=$qaHash
}
$qaAPath=Join-Path $qaBatch 'launcher/435-corrected-junction-candidate-admission-01.json'
$qaA=Read-QaCandidateJson $qaAPath
Check-File $qaAPath '501f7651921cc543750b53764b9ed5d753ae2708725280109c980b71e02fc414'
$qaR=Read-QaCandidateJson (Join-Path $qaBase 'launch-result.json')
$qaP=Read-QaCandidateJson (Join-Path $qaBase 'preflight.json')
$qaL=Read-QaCandidateJson (Join-Path $qaBase 'launch.json')
$qaS=Read-QaCandidateJson (Join-Path $qaR.evidence 'summary.json')
$qaRunner=Read-QaCandidateJson (Join-Path $qaR.evidence 'runner.json')
$qaB=Read-QaCandidateJson $qaA.buildBinding.path
Check-File $qaA.buildBinding.path 'b247b045d4394c976b7339df1ada61b0399677d847e740b4d2b19c4c4ff114f6'
Check-File $qaA.originalVerification.path $qaA.originalVerification.sha256
Check-File $qaB.buildReceipt.path $qaB.buildReceipt.sha256
Check-File (Join-Path $qaBase 'preflight.json') $qaR.preflightSha256
Check-File (Join-Path $qaBase 'launch-result.json') $null
Check-File (Join-Path $qaR.evidence 'summary.json') 'c3f8f9e7c935e1ea97320737540977f413f316a922385c6f7b56be8364df1164'
foreach ($qaPair in $qaR.rawSha256.GetEnumerator()) { Check-File (Join-Path $qaBase $qaPair.Key) $qaPair.Value }
foreach ($qaPair in $qaR.evidenceSha256.GetEnumerator()) { Check-File (Join-Path $qaR.evidence $qaPair.Key) $qaPair.Value }
foreach ($qaKind in @('junction','symlink')) {
 $qaSuite=$qaR.correctedFixtures[$qaKind]
 Check-File $qaSuite.manifest.file $qaA.correctedManifestSha256[$qaKind]
 foreach ($qaEntry in $qaSuite.members.Values) { Check-File $qaEntry.file $qaEntry.sha256 }
}
foreach ($qaEntry in $qaS.bindings.Values) { Check-File $qaEntry.file $qaEntry.sha256 }
foreach ($qaEntry in $qaP.expectedFixtureBindings.GetEnumerator()) {
 Q (Same $qaEntry.Value $qaS.bindings[$qaEntry.Key]) "Fixture expected source differs: $($qaEntry.Key)"
}
Q (Same $qaA.buildBinding $qaR.buildBinding) 'Admitted build mismatch'
Q (Same $qaR.buildBinding $qaP.buildBinding) 'Preflight build mismatch'
Q ($qaR.closingBindingVerified -and !$qaR.observationError -and $qaR.status -ceq 'matrix-finished-for-review' -and
   $qaS.status -ceq 'assertions-met' -and $qaS.phase -ceq 'candidate' -and $qaS.runnerPid -eq 33264 -and
   $qaRunner.runnerPid -eq $qaS.runnerPid -and $qaL.pid -eq $qaS.runnerPid -and $qaR.childExit.pid -eq $qaS.runnerPid -and
   $qaR.childClose.pid -eq $qaS.runnerPid -and $qaL.birthUtc -eq $qaR.childExit.birthUtc -and
   $qaR.childExit.exitCode -eq 0 -and !$qaR.childExit.deadlineExpired -and $qaR.childClose.exitCode -eq 0 -and
   !$qaR.childClose.stdoutBytes -and !$qaR.childClose.stderrBytes) 'Native final process receipts'
$env:GIT_OPTIONAL_LOCKS='0'
$qaGit=@(git.exe -C $qaB.checkout rev-parse HEAD 'HEAD^{tree}' refs/remotes/origin/main)
Q ($LASTEXITCODE -eq 0 -and $qaGit[0] -ceq 'c75e277695dae260f0e14279cff8705bab84ef4c' -and
 $qaGit[0] -ceq $qaB.head -and $qaGit[1] -ceq $qaB.tree -and $qaGit[2] -ceq $qaB.actualMain) 'Current candidate identity'
$qaDirty=@(git.exe -C $qaB.checkout status --porcelain=v1 --untracked-files=all)
Q ($LASTEXITCODE -eq 0 -and !$qaDirty.Count) 'Current candidate checkout is dirty'
Check-File $qaB.indexPath $qaB.indexSha256
$qaRegression = Join-Path $qaB.checkout 'tooling/scripts/windows-launcher.acceptance.mjs'
Check-File $qaRegression '4cac8f617ebe4d96e8b54c4ba0bfe3c5a4647e284480b97f77fe0e847281c4ee'
Check-File (Join-Path $qaB.checkout 'apps/api/src/instance-identity.ts') $qaB.sourceFiles['apps/api/src/instance-identity.ts']

$qaTemp=Join-Path $qaR.evidence 'temp'
$qaProc=@{}
for ($i=0; $i -lt $qaS.processes.Count; $i++) {
  $qaKey='process-'+($i+1).ToString('000')
  $qaRec=$qaS.processes[$i]
  $qaAttempt=Read-QaCandidateJson (Join-Path $qaTemp "$qaKey-attempt.json")
  $qaSpawn=Read-QaCandidateJson (Join-Path $qaTemp "$qaKey-spawn.json")
  $qaOutcome=Read-QaCandidateJson (Join-Path $qaTemp "$qaKey-outcome.json")
  Q ((Same $qaOutcome $qaRec) -and $qaAttempt.label -ceq $qaRec.label -and $qaSpawn.pid -eq $qaRec.pid -and
    (Same $qaAttempt.args $qaRec.args) -and (Same $qaSpawn.args $qaRec.args) -and
    $qaRec.exit.code -eq $qaRec.close.code -and $null -eq $qaRec.exit.signal -and $null -eq $qaRec.close.signal) "Process triplet differs: $qaKey"
  if (!$qaProc.ContainsKey($qaRec.label)) { $qaProc[$qaRec.label]=@() }
  $qaProc[$qaRec.label]+=$qaRec
}
Q ($qaS.processes.Count -eq 46 -and @(Get-ChildItem -LiteralPath $qaTemp -Filter '*-outcome.json' -File).Count -eq 46) 'Incorrect process receipt count'
$qaDigest=$qaS.cases.helper.fingerprint
foreach ($qaLabel in @('direct helper identity','relative entry from direct cwd','junction helper identity')) {
 $qaItem=$qaProc[$qaLabel][0]
 Q ($qaItem.exit.code -eq 0 -and $qaItem.stdout -ceq ($qaDigest+[char]10) -and $qaItem.stdoutBytes -eq 65 -and !$qaItem.stderr) 'Identity output mismatch'
}
foreach ($qaLabel in @('direct store state','junction store state')) {
 $qaItem=$qaProc[$qaLabel][0]
 Q ($qaItem.exit.code -eq 0 -and $qaItem.stdout -ceq ('{"state":"free"}'+[char]10) -and !$qaItem.stderr) 'Wrong prelaunch store state'
}
foreach ($qaItem in $qaProc['imported helper remains inert']) {
 Q ($qaItem.exit.code -eq 0 -and $qaItem.stdout -ceq ('qa435-import-ok'+[char]10) -and !$qaItem.stderr) 'Import side effect'
}
foreach ($qaItem in $qaProc['invalid helper environment']) {
 Q ($qaItem.exit.code -eq 1 -and !$qaItem.stdout -and $qaItem.stderr -match '^Launcher configuration is invalid\.') 'Invalid config changed'
}
Q ($qaProc['missing aliased entry'][0].exit.code -eq 1 -and $qaProc['missing aliased entry'][0].stderr -match 'MODULE_NOT_FOUND') 'Missing entry changed'
Q ($qaS.cases.negativeInvocation.unknownFlagExit -eq 1 -and $qaS.cases.negativeInvocation.missingRepoExit -eq 1 -and
 $qaS.cases.negativeInvocation.targetStillFree -and $qaS.cases.helper.readOnlyEmptyStores) 'Prelaunch negative or store preservation'
$qaPhases=[ordered]@{}
foreach ($qaPhase in @('real','alias')) {
 $qaC=$qaS.cases[$qaPhase]
 $qaIdentityFile=Join-Path $qaR.evidence "$qaPhase-gateway-identity.json"
 Check-File $qaIdentityFile $null
 $qaIdent=Read-QaCandidateJson $qaIdentityFile
 $qaGateway=$qaC.before
 $qaOwner=$qaGateway.identityProof
 Q ((Same $qaIdent.before $qaGateway) -and $qaIdent.launcherPid -eq $qaC.coldLauncherPid -and
  $qaGateway.actualEntryArgument -ceq ($qaC.configuredRepo+'\apps/api/dist/main.js') -and
  $qaOwner.pid -eq $qaGateway.pid -and $qaOwner.parentPid -eq $qaC.coldLauncherPid -and $qaOwner.executable -ceq $qaB.nodePath -and
  $qaGateway.phase -ceq 'running' -and $qaGateway.identity -cmatch '^[a-f0-9]{64}$') 'Native cold identity differs'
 $qaCalculated=$qaDigest
 if ($qaPhase -ceq 'alias') { $qaCalculated=$qaProc['canonical expected fingerprint for aliased store'][0].stdout.Trim() }
 Q ($qaGateway.identity -ceq $qaCalculated) 'Native serving digest differs from expected config'
 $qaHeld=$qaProc["$qaPhase live --store-state"][0].stdout | ConvertFrom-Json -AsHashtable
 Q ($qaHeld.state -ceq 'held' -and $qaHeld.path -ceq $qaGateway.dirLock.file) 'Live store-state pointed elsewhere'
 foreach ($qaField in @('dirLock','dbLock')) {
  $qaLease=$qaGateway[$qaField]
  Q ($qaLease.pid -eq $qaGateway.pid -and $qaLease.creation -ceq $qaOwner.creationFileTime -and $qaLease.sha256 -cmatch '^[a-f0-9]{64}$') 'Lease does not bind the live process'
 }
 foreach ($qaShell in $qaC.shells) {
  $qaWeb=if ($qaShell.route -ceq '/app/') {'apps/web/dist'} else {'apps/web/dist-goblin'}
  Q ($qaB.outputFiles["$qaWeb/index.html"] -ceq $qaShell.shellSha256 -and
   $qaB.outputFiles[$qaWeb+'/'+$qaShell.asset.Substring($qaShell.route.Length)] -ceq $qaShell.assetSha256) 'Static bytes differ from build'
 }
 foreach ($qaLabel in @("$qaPhase cold","$qaPhase warm","$qaPhase warm via other spelling")) {
  $qaItem=$qaProc[$qaLabel][0]
  Q ($qaItem.exit.code -eq 0 -and !$qaItem.stdout -and !$qaItem.stderr) "Expected native success at $qaLabel"
 }
 Q ($qaC.crossPathWarm.unchangedServingPid -eq $qaGateway.pid -and $qaC.crossPathWarm.exit.code -eq 0) 'Cross spelling did not reuse'
 foreach ($qaSuffix in @('store','settings')) {
  $qaNegative=$qaS.cases["$qaPhase-wrong-$qaSuffix"]
  $qaAlternate=$qaProc["$qaPhase wrong $qaSuffix"][0]
  Q ($qaNegative.refused -and $qaNegative.changedFingerprint -cne $qaGateway.identity -and $qaNegative.originalPid -eq $qaGateway.pid -and
     $qaNegative.originalCreation -ceq $qaOwner.creationFileTime -and $qaAlternate.exit.code -eq 1 -and
     $qaAlternate.stderr -match 'unrelated or differently configured service') "Wrong configuration controls $qaPhase/$qaSuffix"
 }
 foreach ($qaConfigType in @('opposite-spelling','wrong-store','wrong-settings')) {
  Q (!(Test-Path -LiteralPath (Join-Path $qaR.evidence "native-$qaPhase-$qaConfigType/gateway.log"))) 'Unexpected secondary gateway log'
 }
 $qaNative=@($qaProc["Win32_Process exact PID $($qaGateway.pid)"])
 Q ($qaNative.Count -eq 7) 'Expected six correlated live snapshots and one post-drain absence'
 for ($i=0; $i -lt 7; $i++) {
  $qaRecord=$qaNative[$i]
  Q ($qaRecord.exit.code -eq 0 -and !$qaRecord.stderr) 'Corrected PowerShell process probe stderr or failure'
  $qaProof=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($qaRecord.stdout.Trim())) | ConvertFrom-Json -AsHashtable
  if ($i -lt 6) { Q (Same $qaProof $qaOwner) 'Serving native process record changed before managed drain' }
  else { Q (!$qaProof.Count) 'Retired exact process still appeared' }
 }
 Q ($qaC.gateway.drainStatus -eq 202 -and $qaC.gateway.locksReleased -and $qaC.gateway.portRefused -and !$qaC.gateway.pidAfter.Count) 'Managed cleanup not established'
 $qaPhases[$qaPhase]=[ordered]@{ role=$qaPhase; gateway=$qaGateway.pid; birth=$qaOwner.creationFileTime;
     parent=$qaOwner.parentPid; fingerprint=$qaGateway.identity; main=$qaGateway.actualEntryArgument; port=$qaC.gateway.port;
     nativeSnapshots=$qaNative.Count; sameSpellingWarm=$qaC.warmLauncherPid; crossSpellingWarm=$qaC.crossPathWarm.launcherPid; drain=202 }
}
Q ($qaS.cleanup.junctionRemoved -and !$qaS.remainingVerifiedGateways.Count -and !(Test-Path -LiteralPath $qaS.junction.alias)) 'Alias or gateway remains'
foreach ($qaStore in @('direct-store','aliased-store','refused-real-store','refused-alias-store')) {
 $qaPath=Join-Path $qaR.evidence $qaStore
 $qaReceipt=$qaS.cleanup[$qaPath]
 Q ($qaReceipt.empty -and @(Get-ChildItem -LiteralPath $qaPath -Force).Count -eq 0) 'Owned store not empty'
 if ($qaReceipt.before.Count) {
  $qaProbe=$qaProc['exclusive owned store files'] | Where-Object pid -EQ $qaReceipt.probePid
  Q ($qaProbe.exit.code -eq 0 -and $qaProbe.stdout.Trim() -ceq "qa-exclusive-open-ok $($qaReceipt.before.Count)" -and !$qaProbe.stderr) 'Invalid exclusive-open receipt'
 } 
}
$qaKnown=@($qaL.pid,$qaL.parentPid,24412,46292,47656,30996)
$qaPids=@($qaKnown | ForEach-Object {
 $qaProcNow=Get-Process -Id $_ -ErrorAction SilentlyContinue
 [ordered]@{pid=$_;exists=($null -ne $qaProcNow);birth=$(if ($qaProcNow) {$qaProcNow.StartTime.ToUniversalTime().ToString('o')})}
})
$qaNet = & (Join-Path $env:SystemRoot 'System32/netstat.exe') -ano -p tcp
Q ($LASTEXITCODE -eq 0) 'Host TCP inventory failed'
$qaTcp=@($qaNet | Where-Object { $_ -match '^\s*TCP\s+\S+:(?:51620|51622)\s+' })
Q (!@($qaPids | Where-Object exists).Count -and !@($qaTcp | Where-Object {$_ -match 'LISTENING'}).Count) 'Owned runtime appears live'
$qaRead=[ordered]@{checkedAtUtc=[DateTime]::UtcNow.ToString('o');head=$qaB.head;tree=$qaB.tree;actualMain=$qaB.actualMain;
  sourceFiles=$qaB.sourceFiles.Count;outputs=$qaB.outputFiles.Count;dependencyFiles=$qaB.dependencyFiles.Count;links=$qaB.workspaceLinks.Count;
  subprocessTriplets=$qaS.processes.Count; hostProcesses=$qaPids; tcpRows=$qaTcp; roles=$qaPhases;
  inputAndReceiptDigests=$qaInputs}
[IO.File]::WriteAllText((Join-Path $qaOut 'independent-readback.json'),($qaRead | ConvertTo-Json -Depth 12) + [char]10,[Text.UTF8Encoding]::new($false))
[ordered]@{at=$qaRead.checkedAtUtc;tree=$qaB.tree;subprocess=$qaRead.subprocessTriplets;hostProcesses=$qaPids;tcpRows=$qaTcp;roles=$qaPhases} | ConvertTo-Json -Depth 10
