import csv,hashlib,json,os,subprocess
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path('G:/ggq/gg-macos-current-main/GraphGoblin')
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
OUT=E/'mac-post-564-integration-01'
PACK=E/'i5-d242-core-delivery-supplement-01'
MAC='4690b5493390df6bac8ba16cadfd23a1c56bc6ca'
TARGET='d2df8600c2c8574bec420947de686b936910b245'
BASE='0f6c325becf3e3e0562ae69dfae2c42bcf1d7129'
ENV=dict(os.environ,GIT_OPTIONAL_LOCKS='0')
def sha(b):return hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.run(['C:/Program Files/Git/cmd/git.exe','--no-optional-locks','-C',str(ROOT),*args],env=ENV,check=True,capture_output=True).stdout
def txt(*args):return git(*args).decode('utf-8').strip()
def save(name,data):
    with (OUT/name).open('x',encoding='utf-8',newline='\n') as f:json.dump(data,f,indent=2);f.write('\n')
def entries(commit):
    result={}
    for row in git('ls-tree','-r','-z',commit).split(b'\0'):
        if not row:continue
        meta,path=row.split(b'\t',1);mode,kind,blob=meta.decode().split();result[path.decode('utf-8')]=(mode,kind,blob)
    return result
before=json.loads((OUT/'BEFORE.json').read_text())
assert txt('rev-parse','HEAD')==MAC and txt('rev-parse','MERGE_HEAD')==TARGET
assert txt('rev-parse','refs/heads/main')==before['main']
common=Path(txt('rev-parse','--path-format=absolute','--git-common-dir'))
assert not (common/'index').exists() and sha((common/'HEAD').read_bytes())==before['commonHeadSha256']
assert sha((ROOT/'pnpm-lock.yaml').read_bytes())==before['lockSha256'] and sha((ROOT/'node_modules/.modules.yaml').read_bytes())==before['modulesSha256']
rows=list(csv.DictReader((PACK/'COPY-PLAN.csv').read_text(encoding='utf-8-sig').splitlines()))
paths=[r['repository_relative_destination'] for r in rows]+['.gitattributes','.prettierignore','CHANGELOG.md','docs/delivery/2026-11-17-five-intents-register.md']
for r in rows:assert sha((ROOT/r['repository_relative_destination']).read_bytes())==r['sha256']
spec=OUT/'stage-paths.nul';spec.write_bytes(('\0'.join(paths)+'\0').encode('utf-8'))
git('add','--sparse','-f','--pathspec-from-file='+str(spec),'--pathspec-file-nul')
assert not git('diff','--name-only','--diff-filter=U') and not git('diff','--name-only')
stage=txt('write-tree');b=entries(BASE);m=entries(MAC);t=entries(TARGET);actual=entries(stage)
changed_m={p for p in set(b)|set(m) if b.get(p)!=m.get(p)}
changed_t={p for p in set(b)|set(t) if b.get(p)!=t.get(p)}
assert changed_m & changed_t=={'.gitattributes','.prettierignore','CHANGELOG.md','docs/09-frontend-and-pwa.md'}
expected=dict(b)
for source,changed in [(m,changed_m),(t,changed_t)]:
    for p in changed:
        if p in source:expected[p]=source[p]
        else:expected.pop(p,None)
manual={'.gitattributes','.prettierignore','CHANGELOG.md','docs/09-frontend-and-pwa.md','docs/delivery/2026-11-17-five-intents-register.md'}
archive={r['repository_relative_destination'] for r in rows}
assert set(actual)==set(expected)|archive
for p,pin in expected.items():
    if p not in manual:assert actual[p]==pin,p
for r in rows:
    raw=(ROOT/r['repository_relative_destination']).read_bytes()
    blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    assert actual[r['repository_relative_destination']]==('100644','blob',blob)
register='docs/delivery/2026-11-17-five-intents-register.md'
original=git('show',TARGET+':'+register);current=git('show',stage+':'+register)
assert current.startswith(original.rstrip(b'\n')+b'\n')
doc='docs/09-frontend-and-pwa.md'
normalize=lambda raw:b'\n'.join(line for line in raw.splitlines() if not line.startswith(b'index '))
mac_doc=git('diff',BASE,MAC,'--',doc);integrated_doc=git('diff',TARGET,stage,'--',doc)
assert normalize(mac_doc)==normalize(integrated_doc),'Doc merge differs from exact Mac paragraph delta'
(OUT/'docs09-exact-mac-delta.patch').write_bytes(integrated_doc)
(OUT/'manual-resolution.patch').write_bytes(git('diff',MAC,stage,'--',*sorted(manual)))
proof=dict(utc=datetime.now(timezone.utc).isoformat(),tree=stage,expectedParents=[MAC,TARGET],baseEntries=len(b),macEntries=len(m),targetEntries=len(t),integratedEntries=len(actual),allNonmanualObjectsEqualExpectedParents=True,manualPaths=sorted(manual),newArchiveFiles=len(rows),allArchiveGitBlobBytesExact=True,registerParentPrefixPreserved=True,docs09ExactMacDeltaAppliedToTarget=True,appsWebTree=txt('rev-parse',stage+':apps/web'),targetAppsWebTree=txt('rev-parse',TARGET+':apps/web'),lockAndModulesUnchanged=True)
assert proof['appsWebTree']==proof['targetAppsWebTree']
save('STAGED-PROOF.json',proof)
result=subprocess.run(['C:/Program Files/Git/cmd/git.exe','-C',str(ROOT),'commit','-m','Integrate completed inspector work into macOS launcher'],env=ENV,capture_output=True)
(OUT/'commit.stdout.log').write_bytes(result.stdout);(OUT/'commit.stderr.log').write_bytes(result.stderr)
save('COMMIT-RECEIPT.json',dict(exitCode=result.returncode));assert result.returncode==0,result.stderr.decode()
head=txt('rev-parse','HEAD');parents=txt('show','-s','--format=%P','HEAD').split()
assert parents==[MAC,TARGET] and txt('rev-parse','HEAD^{tree}')==stage
assert not git('status','--porcelain=v1','--untracked-files=all','-z')
assert txt('rev-parse','refs/heads/main')==before['main'] and not (common/'index').exists() and sha((common/'HEAD').read_bytes())==before['commonHeadSha256']
index=Path(txt('rev-parse','--path-format=absolute','--git-path','index'))
freeze=dict(utc=datetime.now(timezone.utc).isoformat(),head=head,tree=stage,parents=parents,branch=txt('branch','--show-current'),clean=True,indexPath=str(index),indexSha256=sha(index.read_bytes()),stagedEntriesSha256=sha(git('ls-files','--stage','-z')),mainRef=before['main'],commonHeadSha256=before['commonHeadSha256'],commonIndexExists=False,lockSha256=sha((ROOT/'pnpm-lock.yaml').read_bytes()),modulesSha256=sha((ROOT/'node_modules/.modules.yaml').read_bytes()),appsWebTree=proof['appsWebTree'],noRuntimeConflictOrManualRuntimeEdit=True,actualMacQa=False,finalAudit=False)
save('FREEZE.json',freeze)
print(json.dumps(freeze,indent=2))
