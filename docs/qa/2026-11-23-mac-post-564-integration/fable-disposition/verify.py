from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,subprocess,os
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents');O=Path(__file__).resolve().parent
R=Path('G:/ggq/gg-macos-current-main/GraphGoblin');A=E/'mac-post-564-fable-admission-01';V=E/'mac-post-564-fable-review-01'
def rd(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return sha256(p.read_bytes()).hexdigest()
def save(n,v):
 with (O/n).open('x',encoding='utf-8',newline='\n') as f:json.dump(v,f,indent=2);f.write('\n')
t=rd(V/'terminal.json');p=rd(V/'process.json');s=rd(V/'source-after.json');a=rd(A/'ROOT-ADMISSION.json');c=rd(A/'ROOT-CONTROLS.json')
assert t['acceptedProcess'] and t['terminalCount']==1 and t['terminalReason']=='completed' and t['subtype']=='success' and t['processExit']==0 and not t['isError']
assert t['observedModels']==t['modelUsage']==['claude-fable-5-2']
assert len(t['toolRequests'])==t['matchedToolResults']==30 and not t['pendingToolRequests'] and not t['protocolProblems'] and not t['harvestErrors']
assert all(x['tool']=='Read' for x in t['toolRequests'])
assert p['directChildReaped'] and p['streamReadersFinished'] and not p['timeout'] and not p['originalFailure']
assert p['auth']=='claude.ai firstParty max' and p['effort']=='xhigh'
assert s['sourceAndControlsVerified'] and not s['changedPaths'] and not s['closureUncertainAtReadback']
assert sha(Path(a['config']['source']))==a['config']['sha256'] and sha(Path(a['controller']['source']))==a['controller']['sha256']
assert sha(Path(c['virtualStoreLock']['source']))==c['virtualStoreLock']['sha256']
for n,v in rd(A/'READ-COHORT.json').items(): assert (R/n).stat().st_size==v['bytes'] and sha(R/n)==v['sha256'],n
git=lambda *args:subprocess.check_output(['C:/Program Files/Git/cmd/git.exe','--no-optional-locks','-C',str(R),*args],env={**os.environ,'GIT_OPTIONAL_LOCKS':'0'},timeout=60)
assert git('rev-parse','HEAD').decode().strip()==a['source']['head'] and not git('status','--porcelain=v1','--untracked-files=all','-z')
f=c['freeze'];assert sha(Path(f['indexPath']))==f['indexSha256'];assert git('rev-parse','refs/heads/main').decode().strip()==f['mainRef']
common=Path(git('rev-parse','--path-format=absolute','--git-common-dir').decode().strip());assert sha(common/'HEAD')==f['commonHeadSha256'] and not (common/'index').exists()
assert not (E/'i5-d236-max-continuation-owner.lock').exists()
q=subprocess.run(['pwsh','-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"name='claude.exe'\" | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath) | ConvertTo-Json -Depth 4"],capture_output=True,check=True)
procs=json.loads(q.stdout.decode('utf-8-sig')) if q.stdout.strip() else []
if isinstance(procs,dict):procs=[procs]
assert all(x['ProcessId']==14984 for x in procs)
save('ROOT-PROCESS-AND-SOURCE-ACCEPTANCE.json',dict(utc=datetime.now(timezone.utc).isoformat(),source=a['source'],session75772ClosedExit0=True,model='claude-fable-5-2',effort='xhigh',subscription='Max',pairedReads=30,literalPathsRead=len(set(x['path'] for x in t['toolRequests'])),physicalReadCohortUnchanged=27,sourceIndexDependenciesCommonMainUnchanged=True,taskProviderReleased=True,otherClaudeProcesses=procs,osWideDescendantClosureClaim=False,ordinaryVerdict='ACCEPT with eight record findings',substantiveDispositionPending=True,deviceAcceptance=False,generalScanCount='2/3 unchanged'))
print('Actual Fable process/source controls verified; substantive eight-finding disposition remains separate.')
