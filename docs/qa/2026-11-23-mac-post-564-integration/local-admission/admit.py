import hashlib,json,os,subprocess
from pathlib import Path
from datetime import datetime,timezone
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
ROOT=Path('G:/ggq/gg-macos-current-main/GraphGoblin')
PREP=E/'mac-post-564-local-checks-preparation-01'
OUT=E/'mac-post-564-local-admission-01'
TEMP=Path('G:/ggq/mac-d913-qa-temp-01')
def sha(b):return hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.run(['C:/Program Files/Git/cmd/git.exe','--no-optional-locks','-C',str(ROOT),*args],env=dict(os.environ,GIT_OPTIONAL_LOCKS='0'),check=True,capture_output=True).stdout
def save(name,data):
    with (OUT/name).open('x',encoding='utf-8',newline='\n') as f:json.dump(data,f,indent=2);f.write('\n')
raw=(PREP/'MANIFEST.json').read_bytes();assert sha(raw)=='63fb4b872e5abc715d053fccacd7361830423247daa19aa27a6efbdc92ce93ae'
for m in json.loads(raw)['members']:
    b=(PREP/m['path']).read_bytes();assert len(b)==m['bytes'] and sha(b)==m['sha256']
prior=(E/'i5-d242-local-static-preparation-01/run-static-gates.ps1').read_bytes()
for a,b in [(b'G:/ggq/gg-i5-offline-inspector/GraphGoblin',b'G:/ggq/gg-macos-current-main/GraphGoblin'),(b'i5-d242-local-static-execution-01',b'mac-post-564-local-checks-01'),(b'from the corrected documentation-qualified baseline',b'from the frozen post-564 Mac baseline'),(b'All12 static gates completed with exact before/after controls; hosted CI remains separate.',b'Build and both bounded local test checks completed with exact before/after controls; hosted CI remains separate.')]:prior=prior.replace(a,b)
assert prior==(PREP/'run-local-checks.ps1').read_bytes()
freeze=json.loads((E/'mac-post-564-integration-01/FREEZE.json').read_text())
assert git('rev-parse','HEAD').decode().strip()==freeze['head']=='d91386a7509a77db4bccdab6f95a3d01e730ad50'
assert not git('status','--porcelain=v1','--untracked-files=all','-z')
assert sha(Path(freeze['indexPath']).read_bytes())==freeze['indexSha256']
assert sha(git('ls-files','--stage','-z'))==freeze['stagedEntriesSha256']
assert sha((ROOT/'pnpm-lock.yaml').read_bytes())==freeze['lockSha256'] and sha((ROOT/'node_modules/.modules.yaml').read_bytes())==freeze['modulesSha256']
binding=json.loads((PREP/'ROOT-BINDING.template.json').read_text())
assert len(binding['source18'])==18 and len(binding['gates'])==3
paths=set(binding['source18'])
for gate in binding['gates']:
    if gate['label']=='01-build':assert gate['argv']==['build'];continue
    args=gate['argv'];prefix='apps/api/' if gate['label']=='02-api' else 'apps/web/'
    selected=[x for x in args if x.startswith('src/')]
    assert len(selected)==(11 if gate['label']=='02-api' else 9)
    assert 'src/main.test.ts' not in selected and args[-2:]==['--maxWorkers=1','--retry=0']
    paths.update(prefix+x for x in selected)
paths.update(['apps/api/api-ports.global-setup.ts','apps/api/api-ports.setup.ts','apps/api/wait-storage.global-setup.ts','apps/api/vitest.config.ts','apps/web/src/__fixtures__/render.tsx'])
entries={}
for row in git('ls-tree','-r','-z','HEAD','--',*sorted(paths)).split(b'\0'):
    if not row:continue
    meta,path=row.split(b'\t',1);mode,kind,blob=meta.decode().split();entries[path.decode()]=(mode,kind,blob)
cohort={}
for path in sorted(paths):
    data=(ROOT/path).read_bytes();mode,kind,blob=entries[path]
    assert kind=='blob' and hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==blob,path
    cohort[path]={'mode':mode,'blob':blob,'bytes':len(data),'sha256':sha(data)}
for path,pin in binding['source18'].items():assert cohort[path]==pin,path
assert TEMP.resolve()==TEMP and TEMP.is_relative_to(Path('G:/ggq')) and not TEMP.exists()
TEMP.mkdir()
for k in binding['source']:binding['source'][k]=[] if k=='status' else freeze[k]
save('SOURCE-COHORT.json',{'head':freeze['head'],'files':cohort})
save('ROOT-ADMISSION.json',dict(executionAdmitted=True,head=freeze['head'],tree=freeze['tree'],utc=datetime.now(timezone.utc).isoformat(),preparationManifestSha256=sha(raw),sourceCohortSha256=sha((OUT/'SOURCE-COHORT.json').read_bytes()),scope='Build followed by D243 API11 and unchanged web9, single worker, zero retries, first failure stops.',localHeavySlotAllocated=True,fixtureEnvironment={'TEMP':str(TEMP),'TMP':str(TEMP),'GG_TEST_PORT_START':'62400','GG_TEST_PORT_COUNT':'40','GG_OLLAMA_ENABLED':'false','LIVE':'0'},fixtureLimits='Owned temporary roots; transient wildcard availability probes; platform skips and actual cleanup must be recorded. No claim of Mac GUI or native POSIX acceptance.',startupPlacement='main.test omitted locally only; unchanged full hosted coverage and native Mac startup remain mandatory.',sanitization='Parent clears ambient GG_* and named provider credential variables without reading or logging values; child inherits owned temp/range and runner sets discovery false/LIVE0.'))
binding['executionAdmitted']=True;binding['preparationManifestSha256']=sha(raw)
binding['rootAdmission']={'path':str(OUT/'ROOT-ADMISSION.json'),'sha256':sha((OUT/'ROOT-ADMISSION.json').read_bytes())}
save('ROOT-BINDING.json',binding)
print(json.dumps({'head':freeze['head'],'sourceFilesVerified':len(cohort),'bindingSha256':sha((OUT/'ROOT-BINDING.json').read_bytes()),'ownedTemp':str(TEMP)}))
