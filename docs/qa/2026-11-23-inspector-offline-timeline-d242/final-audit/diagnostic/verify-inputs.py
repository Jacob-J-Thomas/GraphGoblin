from pathlib import Path
from collections import Counter
import csv, hashlib, json, os, re, subprocess, sys, zipfile
from urllib.parse import urlsplit
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
Q=Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents')
R=Path('G:/ggq/gg-i5-offline-inspector/GraphGoblin')
archive='docs/qa/2026-11-23-inspector-offline-timeline'
A=R/archive
prep=E/'i5-564-final-audit-preparation-01'
admit=E/'i5-564-final-audit-admission-01'
CI=Q/'i5-564-headf642-target0f6c-ci-01'
WIN=Q/'i5-564-headf642-target0f6c-ci-01-windows'
BR=E/'i5-416-420-post-feedback-browser12-execution-01'
head='f64287619b499c14601e11bce3d1c6b5414b6227'; main='0f6c325becf3e3e0562ae69dfae2c42bcf1d7129'; freeze='a0ce7b781e333b70f4711b5e9201ef63c157df1d'
os.environ['GIT_OPTIONAL_LOCKS']='0'
def load(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def h(b):return hashlib.sha256(b).hexdigest()
def verify(p,s):
 b=Path(p).read_bytes(); assert h(b)==(s if isinstance(s,str) else s['sha256']),p
 if isinstance(s,dict) and 'bytes' in s:assert len(b)==s['bytes'],p
 return b
def git(*args):return subprocess.check_output(['git','--no-optional-locks',*args],cwd=R)
def names(a,b):return {s.decode() for s in git('diff','--no-renames','--name-only','-z',a,b).split(b'\0') if s}
def treemap(ref,paths):
 o={}
 for entry in git('ls-tree','-rz',ref,'--',*paths).split(b'\0'):
  if entry:
   info,n=entry.split(b'\t',1);o[n.decode()]=info.decode().split()
 return o
def treefile(p,rec):
 b=Path(p).read_bytes(); assert rec[0]=='100644' and rec[1]=='blob'
 assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==rec[2],p
 return b
r={}
inv=load(E/'i5-416-420-final-source-inventory-01/INVENTORY.json')
paths=set(inv['paths']);s0=treemap(freeze,sorted(paths));s1=treemap(head,sorted(paths))
assert paths==names(main,freeze) and len(paths)==18 and s0==s1
for name in paths:
 pin=inv['paths'][name]['head']; assert h(treefile(R/name,s1[name]))==pin['sha256'] and pin['blob']==s1[name][2]
assert git('rev-parse','HEAD').decode().strip()==head and git('rev-parse','HEAD^').decode().strip()==freeze
assert not git('status','--porcelain=v1','-uall').strip()
bound=load(admit/'ROOT-BINDING.admitted.json');receipt=load(admit/'ADMISSION-RECEIPT.json')
verify(admit/'ROOT-BINDING.admitted.json',receipt['binding'])
pr=load(prep/'SOURCE-REFERENCES.json')['closedLocalReferences']
for p,pin in pr.items():verify(p,pin)
for ekey, f in [('pr','LIVE-PR.json'),('main','LIVE-MAIN.json'),('merge','LIVE-MERGE.json')]:
 verify(admit/f,bound['freshLivePrAndMainReadback'][ekey])
for ent in ['closedCiReceipt','closedWindowsReplayReceipt']:
 verify(Q/bound[ent]['qRelativePath'],bound[ent]['sha256'])
seal=load(A/'ARCHIVE-SEAL.json');pub=load(E/'i5-416-420-archive-integration-01/PUBLICATION-CANDIDATE.json')
copy=load(E/'i5-416-420-archive-integration-01/COPY-RESULT.json')
meta=copy['metadataAfterCopy']; selected=treemap(head,[archive,*meta])
packed={archive+'/'+p for p in seal['files']}|{archive+'/ARCHIVE-SEAL.json'}
assert packed|set(meta)==names(freeze,head)==set(selected)
assert names(main,head)==paths|packed|set(meta)
for n,pin in seal['files'].items():
 assert h(treefile(A/n,selected[archive+'/'+n]))==pin['sha256'] and (A/n).stat().st_size==pin['bytes'],n
verify(A/'ARCHIVE-SEAL.json',pub['archiveSeal']);treefile(A/'ARCHIVE-SEAL.json',selected[archive+'/ARCHIVE-SEAL.json'])
for n,pin in meta.items():assert h(treefile(R/n,selected[n]))==pin['sha256']
with (A/'ARCHIVE-COPY-PLAN.csv').open(encoding='utf-8-sig',newline='') as f:plan=list(csv.DictReader(f))
ready={a['destination']:a for a in plan if a['row_state']=='READY_TO_COPY'}
assembly=load(A/'ASSEMBLY-MANIFEST.json')
for a in assembly['files']:
 n=a['path'];assert ready[n]['source']==a['originalSource'] and ready[n]['sha256']==a['sha256']==seal['files'][n]['sha256'] and int(ready[n]['bytes'])==a['bytes']==seal['files'][n]['bytes']
assert len(assembly['files'])==len(ready)==1425 and len(set(n.casefold() for n in ready))==1425
assert set(seal['files'])==set(ready)|{'ASSEMBLY-MANIFEST.json','ARCHIVE-COPY-PLAN.csv'}
qa_seal=load(E/'i5-416-420-final-archive-reconciliation-03/CHECKPOINT-SEAL.json')
for n,v in qa_seal['members'].items(): verify(E/'i5-416-420-final-archive-reconciliation-03'/n,v)
idx=Path(git('rev-parse','--path-format=absolute','--git-path','index').decode().strip())
common=Path(git('rev-parse','--path-format=absolute','--git-common-dir').decode().strip())
assert h(idx.read_bytes())==pub['index']['sha256'] and not (common/'index').exists()
r['source']={'head':head,'base':main,'freeze':freeze,'tree':git('rev-parse','HEAD^{tree}').decode().strip(),'changed':len(names(main,head)),'source18':len(paths),'archive':len(packed),'sealSha256':pub['archiveSeal']['sha256'],'readyFiles':len(ready),'readyBytes':sum(int(v['bytes']) for v in ready.values()),'futureHoles':sum(a['row_state']=='FUTURE_HOLE' for a in plan),'metadata':list(meta),'closedReferences':len(pr),'index':h(idx.read_bytes()),'checkoutClean':True,'commonIndexAbsent':True}
ci=load(CI/'verified.json');w=load(WIN/'verified.json'); coverage={}
for n,v in load(CI/'files.json').items(): verify(CI/n,v)
with zipfile.ZipFile(CI/'coverage.zip') as z:
 assert set(z.namelist())==set(ci['coverage']['members']) and len(z.namelist())==13
 for n,s in ci['coverage']['members'].items():
  b=z.read(n);assert h(b)==s['sha256']; m=json.loads(b)['total']
  scores={t:m[t]['pct'] for t in ('lines','branches','functions','statements')};assert all(scores[t]==s[t] and scores[t]>=90 for t in scores)
  coverage[n.split('/coverage/')[0]]=scores
verify(CI/'coverage.zip',ci['coverage']['sha256']);verify(WIN/'archive.zip',w['digest'])
with zipfile.ZipFile(WIN/'archive.zip') as z:
 assert set(z.namelist())==set(w['files'])
 for n,s in w['files'].items():
  assert h(z.read(n))==s
  assert z.read(n)==(WIN/'corpus'/n).read_bytes()
 manifest=json.loads(z.read('manifest.json'));result=json.loads(z.read('result.json'));obs=[json.loads(line) for line in z.read('observations.ndjson').splitlines()]
assert manifest['binding']['sha']==ci['testedMerge'] and manifest['binding']['eventHead']==head
wa=result['observations']; assert (wa['records'],wa['state'],wa['rejected'],wa['omittedRecords'])==(len(obs),'valid',0,0)
replay=load(WIN/'replay/replay-results.json')['cases'][0];assert replay['exactResultReplay'] and replay['records']==len(obs) and replay['exitSeven']==0 and replay['rejected']==[] and replay['omittedRecords']==0
assert verify(R/'tooling/scripts/windows-launcher-evidence.mjs',load(WIN/'replay/replay-results.json')['sha256'])
roll=load(CI/'jobs.json')['jobs'];assert len(roll)==6 and all(x['conclusion']=='success' and x['status']=='completed' for x in roll)
covraw=(CI/'coverage.log').read_text(encoding='utf-8-sig')
covraw=re.sub(r'\x1b\[[0-9;]*m','',covraw)
rows=re.findall(r'Z\s+Tests\s+(\d+) passed(?: \| (\d+) skipped)? \(\d+\)',covraw)
assert (sum(int(a) for a,b in rows),sum(int(b or 0) for a,b in rows))==(10564,63)
browserlog=(CI/'browser.log').read_text(encoding='utf-8-sig')
assert '494 passed' in browserlog and '1 skipped' in browserlog and 'live.spec.ts' in browserlog
assert '# pass 27' in (CI/'windows-launcher.log').read_text(encoding='utf-8-sig')
r['hosted']={'run':ci['run'],'attempt':ci['attempt'],'testedMerge':ci['testedMerge'],'testedTree':ci['testedTree'],'jobs':[j['name'] for j in roll],'unitPassed':ci['unitPassed'],'unitSkipped':ci['unitSkipped'],'browserPassed':494,'browserSkipped':1,'coverage':coverage,'windows':{'id':w['artifact'],'archiveSha256':w['digest'],'bytes':(WIN/'archive.zip').stat().st_size,'members':list(w['files']),'casesPassed':27,'recordTypeCounts':wa['byType'],'records':len(obs),'rejected':wa['rejected'],'omitted':wa['omittedRecords'],'canonicalResultMatched':replay['exactResultReplay']}}
def vitest(p):
 j=load(p); assertions=[a for f in j['testResults'] for a in f['assertionResults']]; return {'files':len(j['testResults']),'counts':dict(Counter(a['status'] for a in assertions))}
r['components']={k:vitest(p) for k,p in {'focused':E/'i5-d241-session-feedback-checks-01/vitest-results.json','fresh2':E/'i5-d241-session-feedback-corrected-qa-01/06-fresh2.json','full63':E/'i5-d241-session-feedback-corrected-qa-01/07-full63.json','wholeWeb':E/'i5-416-420-post-feedback-web-coverage-01/vitest-results.json'}.items()}
gates={}
for tag,sub in [('first','i5-416-420-local-static-execution-01'),('tail','i5-416-420-local-static-tail-execution-01')]:
 root=E/sub;man=load(root/'MANIFEST.json')
 for f in man['members']: verify(root/f['path'],f)
 for f in sorted(root.glob('*.receipt.json')):
  v=load(f)
  if 'argv' in v and 'exitCode' in v:gates[tag+'/'+v['label']]=[v['argv'],v['exitCode']]
r['localStatic']=gates
for n in ('BUILD-EVIDENCE-MANIFEST.json','BROWSER-EVIDENCE-MANIFEST.json'):
 v=load(BR/n)
 for name,pin in v['members'].items():verify(BR/name,pin)
r['nativeLocal']={}
ref=load(BR/'BROWSER-API-READBACK.json')
tracecounts=[]
for f in ref['cases']:
 rel=f['trace'];verify(BR/rel,f['sha256'])
 with zipfile.ZipFile(BR/rel) as zi:
  assert zi.testzip() is None
  eventCount=0
  for n in zi.namelist():
   if n.endswith('.trace') or n.endswith('.network'):
    for line in zi.read(n).splitlines():
     j=json.loads(line);eventCount+=1
 tracecounts.append({'title':f['title'],'status':f['status'],'trace':rel,'entriesRead':eventCount})
r['nativeLocal']['cases']=tracecounts
c3=ref['b3'];assert all(a['method']=='GET' for a in c3['requestAttachment']['requests']) and len(c3['requestAttachment']['requests'])==21
r['nativeLocal']['B3']={'browserRequests':21,'observedRunPosts':c3['observedBrowserRunPostCount'],'controlledFailureSeq':c3['browserControlledFailureSeq']}
ref=load(BR/'G1-THREE-WAY.json')
recomputed={}
for k,pkg in [('baseline0f','i5-416-420-baseline-g1-execution-01'),('prior223','i5-416-420-browser12-execution-01'),('currentA0',BR.name)]:
 f=E/pkg/'geometry/real-geometry-matrix.json';verify(f,ref['sources'][k]);raw=load(f)['measurements']
 samples=[]
 for g,cell in zip(raw,ref['cells'],strict=True):
  v=g['viewport']; metrics=dict(documentScrollWidth=v['scrollWidth'],bodyScrollWidth=v['bodyScrollWidth'],outsideVisibleTextRanges=len(v['visibleTextOutsideViewport']),overlaps=len(g['overlaps']),sequenceClips=len(g['number']['clipping']),eventTypeClips=len(g['type']['clipping']),sequenceFontPx=g['number']['fontSize'],eventTypeFontPx=g['type']['fontSize'])
  assert (g['width'],g['textScale'],g['seq'])==(cell['width'],cell['textScale'],cell['sequence']) and metrics==cell[k]
  samples.append(metrics)
 recomputed[k]=samples
assert recomputed['prior223']==recomputed['currentA0'] and len(recomputed['currentA0'])==12
r['nativeLocal']['G1threeWay']=ref['cells']
out=Path(sys.argv[1]);assert not out.exists()
out.write_text(json.dumps(r,indent=2)+'\n',encoding='utf-8')
print('Verified',r['source']);print('Raw assertion counts',r['components']);print('Hosted',ci['run'],len(coverage),len(obs),'native traces',len(tracecounts),'geometry cells',len(ref['cells']))
