from pathlib import Path
from datetime import datetime, timezone
from hashlib import sha256
import json, os, subprocess

E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
OUT=Path(__file__).resolve().parent
ROOT=Path('G:/ggq/gg-macos-current-main/GraphGoblin')
GIT=Path('C:/Program Files/Git/cmd/git.exe')
CLI=Path('C:/Users/98jak/.local/bin/claude.exe')
HELPER=E/'mac-d237-claude-review-preparation-01/mac-review.draft.py'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def digest(raw): return sha256(raw).hexdigest()
def pin(p):
    b=p.read_bytes(); return dict(source=str(p),bytes=len(b),sha256=digest(b))
def save(name,data):
    with (OUT/name).open('x',encoding='utf-8',newline='\n') as f: json.dump(data,f,indent=2); f.write('\n')
def git(*args): return subprocess.check_output([str(GIT),'--no-optional-locks','-C',str(ROOT),*args],env={**os.environ,'GIT_OPTIONAL_LOCKS':'0'},timeout=60)
assert pin(HELPER)['sha256']=='880470e0fdcd8f641ae49f5a1e9021da45ae3ad8c2ac8b197776fb2259a4ac10'
assert pin(CLI)['sha256']=='5064e6e0572dca86257363ca04d48653eef20ef27f1bd04b504ed7199ed3fd13'
assert pin(GIT)['sha256']=='fec691d80fccc35fcc309fbc9f720536c1d795b8a562ec169f28c9923da9600f'
freeze=read(E/'mac-post-564-integration-01/FREEZE.json')
source={k:freeze[k] for k in ('head','tree','parents')}
assert git('rev-parse','HEAD').decode().strip()==source['head']
assert git('rev-parse','HEAD^{tree}').decode().strip()==source['tree']
assert git('show','-s','--format=%P','HEAD').decode().strip().split()==source['parents']
assert not git('status','--porcelain=v1','--untracked-files=all','-z')
assert pin(Path(freeze['indexPath']))['sha256']==freeze['indexSha256']
assert git('rev-parse','refs/heads/main').decode().strip()==freeze['mainRef']
common=Path(git('rev-parse','--path-format=absolute','--git-common-dir').decode().strip())
assert pin(common/'HEAD')['sha256']==freeze['commonHeadSha256'] and not (common/'index').exists()
assert pin(ROOT/'pnpm-lock.yaml')['sha256']==freeze['lockSha256']
assert pin(ROOT/'node_modules/.modules.yaml')['sha256']==freeze['modulesSha256']
c=read(E/'mac-post-564-fable-preparation-01/mac-review.unarmed.json')
reads=sorted(set(c['corePins'])|set([
 'AGENTS.md','docs/README.md','docs/15-issue-workflow.md','.github/workflows/ci.yml',
 'apps/api/src/main.test.ts','apps/api/src/testing/api-subprocess.ts','apps/api/src/serve.test.ts',
 'apps/api/src/config.ts','apps/api/src/container.ts','apps/api/src/testing/api-port.ts',
 'apps/api/src/testing/api-ports.global-setup.ts','apps/api/src/testing/api-ports.setup.ts',
 'apps/api/src/testing/wait-storage.global-setup.ts','apps/api/vitest.config.ts','apps/api/src/main-entry.test.ts',
 'docs/qa/2026-11-23-inspector-core-delivery/README.md']))
blobs={}
for row in git('ls-tree','-r','-z','HEAD','--',*reads).split(b'\0'):
    if not row: continue
    meta,name=row.split(b'\t',1); mode,typ,obj=meta.decode().split(); assert typ=='blob'
    blobs[name.decode()]={'mode':mode,'blob':obj}
assert set(blobs)==set(reads)
cohort={}
for name in reads:
    p=ROOT/name; b=p.read_bytes(); blob=sha256(b).hexdigest()
    import hashlib
    assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==blobs[name]['blob'],name
    cohort[name]={**blobs[name],**pin(p)}
save('READ-COHORT.json',cohort)
controls={'freeze':freeze,'cohort':pin(OUT/'READ-COHORT.json'),'helper':pin(HELPER),
 'virtualStoreLock':pin(ROOT/'node_modules/.pnpm/lock.yaml'),'commonIndexExists':False}
save('ROOT-CONTROLS.json',controls)
brief='''# Scoped opposing-family review of the second D237 Mac integration

You are actual Claude Fable 5.2 with xhigh reasoning on the ordinary Max subscription. Review only the GPT-authored integration and fixture-placement decision below. Return ACCEPT or CHANGES REQUIRED, numbered findings with severity, exact source citations, and evidence limits. This is a bounded integration review, not a general PR audit or the reserved final Astra MAX review. No commands, other agents, network, writes, credentials, browser, or tests. Read only listed literal checkout paths. Root-supplied Git/CI receipts are evidence inputs, not independently executed model checks.

Candidate d91386a7509a77db4bccdab6f95a3d01e730ad50 / tree b7f195c32652729270960b0e4cb08557e500ee28 is a normal merge of Mac4690b5493390df6bac8ba16cadfd23a1c56bc6ca and signed-main d2df8600c2c8574bec420947de686b936910b245. PR564 is signed merged; all five core intents are engineering complete (26/26 core,43/48 overall). Owner acceptance and deployment are separate. Mac PR501 remains draft, actual Finder/Dock observations missing, final Astra MAX reserved and count2/3. Conditional four issues cannot start before Mac engineering delivery. Do not infer GUI acceptance from CI or Windows tests.

Assess three things: (1) exact metadata/doc unions retain Mac and inspector obligations without conflicting claims; (2) parent object carry and protected archives supplied below substantiate the bounded integration with no runtime manual conflict; (3) D243 startup-fixture placement preserves mandatory hosted/native full coverage and has a sound shared-host isolation basis. Actual conflict paths were .gitattributes,.prettierignore,CHANGELOG only; docs09 merged automatically and its delta against new main exactly matches the original Mac paragraph. The register was appended and65 signed-core proof files were copied byte-exact. First copy preflight refused virtual ZIP!/member names before mutation; root corrected the reader to bounded ZipFile.read with pinned archive/member checks, no extraction. Do not invent a test failure from that preflight refusal.

The existing source fixtures run without overlays. Build/API11/web9 checks were launched under owned TEMP/TMP G:/ggq/mac-d913-qa-temp-01, candidate ports62400–62439, provider credential env cleared, one worker, zero retries. Their final closure/cleanup report is pending at brief creation. Local tests do not claim native Swift or GUI coverage. Final publication will also require normal12 static gates, full7-job CI,13 V8 package thresholds, nativeSwift90%line/region and Windows canonical verification. The approved Swift-region exception remains explicit.

Read relevant source and supplied diffs. Huge docs may be read in pertinent line windows rather than entirely. In particular inspect main.test, api-subprocess,config,container,serve,port/setup helpers and CI to verify D243; identify any missing containment fact or dropped hosted/native fixture. The existing review count and known separate inspector visual issue #563 are unchanged.
'''
inputs=[('D243 exact decision','mac-post-564-local-admission-decision-01/DECISION.md'),
 ('Root whole-tree composition proof','mac-post-564-integration-01/STAGED-PROOF.json'),
 ('Root freeze','mac-post-564-integration-01/FREEZE.json'),
 ('Root conflict and65-file copy receipt','mac-post-564-integration-01/RESOLUTION-AND-SUPPLEMENT.json'),
 ('Exact manual metadata/docs patch relative previous Mac head','mac-post-564-integration-01/manual-resolution.patch'),
 ('Exact docs09 Mac delta relative signed target','mac-post-564-integration-01/docs09-exact-mac-delta.patch'),
 ('Signed PR564 verification','i5-d242-postmerge-01/signed-merge-verification.json')]
for title,rel in inputs:
    p=E/rel; brief+='\n\n## '+title+'\n\nRoot-supplied input '+json.dumps(pin(p))+'\n\n```text\n'+p.read_text(encoding='utf-8-sig')+'\n```\n'
with (OUT/'BRIEF.md').open('x',encoding='utf-8',newline='\n') as f: f.write(brief)
process=subprocess.run(['pwsh','-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"name='claude.exe'\" | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId; parent=$_.ParentProcessId; created=$_.CreationDate.ToUniversalTime().ToString('o'); path=$_.ExecutablePath; printMode=($_.CommandLine -match '(?:^|\\s)(?:--print|-p)(?:\\s|$)')} }) | ConvertTo-Json -Depth 4"],capture_output=True,check=True)
processes=json.loads(process.stdout.decode('utf-8-sig')) if process.stdout.strip() else []
if isinstance(processes,dict): processes=[processes]
assert all(p['pid']==14984 and p['printMode'] is False for p in processes), 'Unexpected provider worker; root recheck required'
assert not (E/'i5-d236-max-continuation-owner.lock').exists()
save('PROCESS-READBACK.json',{'utc':datetime.now(timezone.utc).isoformat(),'processes':processes,'existingInteractiveUntouched':True,'noOtherOwnedProviderWorker':True,'scope':'Task-owned provider observation only; no OS-wide descendant closure claim'})
c.update(rootAdmitted=True,source=source,allowedReadPaths=reads,output=str(E/'mac-post-564-fable-review-01'))
c['corePins']={n:pin(ROOT/n) for n in c['corePins']}
c['brief']=pin(OUT/'BRIEF.md'); c['claudeBinary']=pin(CLI); c['gitBinary']=pin(GIT)
c['independentAcceptance']=pin(E/'mac-d237-claude-review-independent-01/ACCEPTANCE.json')
save('SINGLE-OWNER.json',dict(scope=c['scope'],role=c['role'],source=source,utc=datetime.now(timezone.utc).isoformat(),rootExclusiveOwner=True,noOtherOwnedWorker=True))
c['singleOwner']=pin(OUT/'SINGLE-OWNER.json')
save('ADMITTED-CONFIG.json',c)
save('ROOT-ADMISSION.json',{'utc':datetime.now(timezone.utc).isoformat(),'rootAdmitted':True,'controller':pin(HELPER),'config':pin(OUT/'ADMITTED-CONFIG.json'),'source':source,'model':c['model'],'effort':c['effort'],'writes':[],'apiRouteClosed':True,'finalGeneralAudit':False,'deviceQaEstablished':False})
print(json.dumps({'admitted':True,'source':source,'readPaths':len(reads),'configSha256':pin(OUT/'ADMITTED-CONFIG.json')['sha256']}))
