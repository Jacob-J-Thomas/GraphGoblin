from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,subprocess,os
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents'); O=Path(__file__).resolve().parent
R=Path('G:/ggq/gg-macos-current-main/GraphGoblin'); X=E/'mac-post-564-local-checks-01'
def rd(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return sha256(p.read_bytes()).hexdigest()
def save(n,v):
 with (O/n).open('x',encoding='utf-8',newline='\n') as f:json.dump(v,f,indent=2);f.write('\n')
phase=rd(X/'PHASE-RECEIPT.json');assert phase['stageReached']=='completed' and phase['failure'] is None and phase['closureFailure'] is None and phase['afterMatchesRootBinding']
assert rd(X/'before.json')==rd(X/'after.json')
assert sha(X/'index.before.raw')==sha(X/'index.after.raw')=='ff4b5204d3d3bbe4ec97aa20def69023aa7accdddc0c01ed8839949f8312110a'
assert len(phase['commands'])==4
for c in phase['commands']:
 assert c['exitCode']==0 and c['startOrCaptureFailure'] is None
 for stream in ('stdout','stderr'):assert sha(Path(c[stream]))==c[stream+'Sha256']
cohort=rd(E/'mac-post-564-local-admission-01/SOURCE-COHORT.json')
for n,p in cohort['files'].items():assert (R/n).stat().st_size==p['bytes'] and sha(R/n)==p['sha256'],n
git=lambda *a:subprocess.check_output(['C:/Program Files/Git/cmd/git.exe','--no-optional-locks','-C',str(R),*a],env={**os.environ,'GIT_OPTIONAL_LOCKS':'0'},timeout=60)
assert git('rev-parse','HEAD').decode().strip()==cohort['head']
assert not git('status','--porcelain=v1','--untracked-files=all','-z')
freeze=rd(E/'mac-post-564-integration-01/FREEZE.json')
assert sha(R/'pnpm-lock.yaml')==freeze['lockSha256'] and sha(R/'node_modules/.modules.yaml')==freeze['modulesSha256']
assert '193 passed | 21 skipped (214)' in (X/'02-api.stdout.log').read_text()
assert '162 passed (162)' in (X/'03-web.stdout.log').read_text()
tmp=Path('G:/ggq/mac-d913-qa-temp-01'); assert tmp.resolve().is_relative_to(Path('G:/ggq').resolve())
files=[{'path':p.relative_to(tmp).as_posix(),'bytes':p.stat().st_size} for p in sorted(tmp.rglob('*')) if p.is_file()]
leases=[p.name for p in tmp.iterdir() if 'api-ports' in p.name or 'wait-storage' in p.name]
save('TEMP-RESIDUE.json',{'root':str(tmp),'files':files,'fixtureLeaseRootsRemaining':leases,'action':'Retained owned fixture and compile-cache residue; no recursive deletion or owner-store access.'})
q=subprocess.run(['pwsh','-NoProfile','-Command',"$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -ge 62400 -and $_.LocalPort -lt 62440} | Select-Object LocalAddress,LocalPort,OwningProcess) | ConvertTo-Json -Depth 4"],capture_output=True,check=True)
listeners=json.loads(q.stdout.decode('utf-8-sig')) if q.stdout.strip() else []
assert not listeners
save('LISTENER-READBACK.json',{'utc':datetime.now(timezone.utc).isoformat(),'candidatePortStart':62400,'candidatePortCount':40,'listeners':listeners,'limit':'Point-in-time TCP listener readback, not OS-wide descendant closure.'})
report={'utc':datetime.now(timezone.utc).isoformat(),'head':cohort['head'],'tree':freeze['tree'],'processSession':87903,'sessionClosed':True,'sessionExitCode':0,'build':'PASS','api':{'files':11,'passedFiles':10,'skippedFiles':1,'passedTests':193,'skippedTests':21},'web':{'files':9,'passedTests':162,'skippedTests':0},'sourceCohortFiles':len(cohort['files']),'sourceAndIndexUnchanged':True,'dependenciesUnchanged':True,'ownedPortBandNoRemainingListeners':True,'ownedTempResidualFileCount':len(files),'ownedTempResidueRetained':True,'nativeMacOrGuiAcceptance':False,'fullCoverageOrFullRegression':False,'skips':'Actual aggregate platform skips; source-gated reasons are recorded separately and are not executed native evidence.','retryCount':0,'D243':'main.test remains required in hosted full coverage and native Mac suite.'}
save('REPORT.json',report)
members=[]
for root in (X,O):
 for p in sorted(root.iterdir()):
  if p.is_file() and p.name!='MANIFEST.json': members.append({'source':str(p),'bytes':p.stat().st_size,'sha256':sha(p)})
save('MANIFEST.json',{'members':members})
print(json.dumps(report))
