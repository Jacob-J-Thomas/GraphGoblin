from pathlib import Path
from datetime import datetime, timezone
import json, hashlib, subprocess
O=Path(__file__).resolve().parent
E=O.parent
C=E/'i5-d241-actual-max-small-followup-01'
W=Path('G:/ggq/gg-i5-offline-inspector/GraphGoblin')
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def pin(p):
 b=p.read_bytes(); return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def save(n,v):
 with (O/n).open('x',encoding='utf-8') as f: json.dump(v,f,indent=2); f.write('\n')
def git(*a): return subprocess.check_output(['git','--no-optional-locks','-C',str(W),*a])

f=read(E/'i5-d241-first-correction-freeze-01/FREEZE.json')
p=read(C/'process.json'); t=read(C/'terminal.json'); s=read(C/'source-after.json')
assert p['directChildReaped'] and p['streamReadersFinished'] and not p['timeout'] and p['originalFailure'] is None
assert t['acceptedProcess'] and t['processExit']==0 and not t['pendingToolRequests'] and not t['protocolProblems'] and not t['harvestErrors']
assert s['sourceAndControlsVerified'] and not s['closureUncertainAtReadback'] and s['snapshot']==s['baseline']
assert s['snapshot']['source']==f['source']
assert set(s['changedPaths'])=={'CHANGELOG.md','docs/09-frontend-and-pwa.md','apps/web/src/runs/RunInspectorPage.offline.test.tsx'}
assert git('rev-parse','HEAD').decode().strip()==f['source']['head']
assert not git('diff','--cached','--name-only') and not git('ls-files','--others','--exclude-standard')
assert set(git('diff','--name-only').decode().splitlines())==set(s['changedPaths'])
for n,h in f['files'].items():
 if n not in s['changedPaths']: assert pin(W/n)==h,n
for n,h in f['protectedCore'].items(): assert pin(W/n)==h,n
for n in s['changedPaths']:
 target=O/'raw-claude-followup'/n; target.parent.mkdir(parents=True,exist_ok=True)
 with target.open('xb') as stream: stream.write((W/n).read_bytes())
with (O/'claude-followup.patch').open('xb') as stream: stream.write(git('diff','--binary'))

# Apply the exact remaining doc contradiction flagged by the actual author's handoff.
# No product semantic or test change is made by root.
doc=W/'docs/09-frontend-and-pwa.md'
raw=doc.read_bytes()
old=b'was already sent keeps its actual outcome; a delete-ready confirmation whose review expired while\n' + b'it was in flight reports that the change may or may not have been saved.'
newline=b'\r\n' if b'\r\n' in raw else b'\n'
old=old.replace(b'\n',newline)
new=b'was already sent keeps its actual outcome; a delete-ready confirmation whose review expired while\n' + b'it was in flight reports that outcome beside the controls.'
new=new.replace(b'\n',newline)
assert raw.count(old)==1
doc.write_bytes(raw.replace(old,new))
save('ROOT-DOC-DISPOSITION.json',{'utc':datetime.now(timezone.utc).isoformat(),'actualClaudeClosure':{n:pin(C/n) for n in ['ordinary-handoff.md','process.json','terminal.json','source-after.json']},'rootReadFullHandoffAndThreeFileDiff':True,'rootDocChange':{'path':'docs/09-frontend-and-pwa.md','before':{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()},'after':pin(doc),'reason':'Actual author flagged the preceding universal uncertainty sentence. Replace it with actual outcome beside controls, leaving the immediately following precise success/transport/HTTP cases intact. This is a root-owned prose correction, not attributed to Claude or treated as new runtime behavior.','alternativesDeclined':['leave the contradictory universal uncertainty sentence','change correct product outcomes to match stale prose','start another implementation round for a one-sentence prose correction']},'otherConcerns':[{'item':'HistoryEligibility hold comment','disposition':'No change: its preceding sentence scopes the hold to the open or outage-expired review; the new docs now explain native dismissal explicitly.'},{'item':'Saving label in newer native-dismissal preview','disposition':'No change in this bounded outage correction: existing shared busy label represents the still-pending confirmation, stays disabled, and permits no second send; ordinary healthy behavior is outside this change.'}],'runtimeChangedByRoot':False,'checksAndAcceptance':'Not yet passed on these bytes; sole-heavy-slot runner must execute later.'})
b=read(O/'BINDING.template.json')
b['rootAdmitted']=True
b['correctedAuthorFiles']={n:pin(W/n) for n in f['files']}
b['correctionPaths']=sorted(s['changedPaths'])
b['closedEvidenceSha256']={n:pin(C/n)['sha256'] for n in b['closedEvidenceSha256']}
b['rootDocDisposition']=pin(O/'ROOT-DOC-DISPOSITION.json')
save('BINDING.json',b)
print(json.dumps({'binding':pin(O/'BINDING.json'),'closedTools':t['matchedToolResults'],'changedPaths':b['correctionPaths'],'runtimeEqualTo':f['source']['head'],'rootDocCorrectionRecorded':True}))
