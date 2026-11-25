import hashlib,json,os,subprocess,sys
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path('G:/ggq/gg-macos-current-main/GraphGoblin').resolve()
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
OUT=E/'mac-post-564-integration-01'
MAC='4690b5493390df6bac8ba16cadfd23a1c56bc6ca'
TARGET='d2df8600c2c8574bec420947de686b936910b245'
BASE='0f6c325becf3e3e0562ae69dfae2c42bcf1d7129'
MAIN='a60843a9050b3a203726db84f6abf1f45b8bc694'
env=dict(os.environ,GIT_OPTIONAL_LOCKS='0')
def sha(b): return hashlib.sha256(b).hexdigest()
def git(*args,check=True):
    p=subprocess.run(['C:/Program Files/Git/cmd/git.exe','--no-optional-locks','-C',str(ROOT),*args],env=env,capture_output=True)
    if check and p.returncode: raise RuntimeError(p.stderr.decode('utf-8',errors='replace'))
    return p
def txt(*args): return git(*args).stdout.decode('utf-8').strip()
def save(name,x):
    with (OUT/name).open('x',encoding='utf-8',newline='\n') as f: json.dump(x,f,indent=2);f.write('\n')
def snap():
    index=Path(txt('rev-parse','--path-format=absolute','--git-path','index'))
    common=Path(txt('rev-parse','--path-format=absolute','--git-common-dir'))
    return dict(head=txt('rev-parse','HEAD'),tree=txt('rev-parse','HEAD^{tree}'),branch=txt('branch','--show-current'),main=txt('rev-parse','refs/heads/main'),indexPath=str(index),indexSha256=sha(index.read_bytes()),commonHeadSha256=sha((common/'HEAD').read_bytes()),commonIndexExists=(common/'index').exists(),status=git('status','--porcelain=v1','--untracked-files=all','-z').stdout.decode('utf-8').split('\0')[:-1],lockSha256=sha((ROOT/'pnpm-lock.yaml').read_bytes()),modulesSha256=sha((ROOT/'node_modules/.modules.yaml').read_bytes()))
mode=sys.argv[1]
if mode=='admit':
    proof=json.loads((E/'i5-d242-postmerge-01/signed-merge-verification.json').read_text())
    assert proof['merge']==TARGET and proof['signature']['verified'] and proof['signature']['reason']=='valid' and proof['tree']=='f4895587b638e2f043707edfd9add5bace26533d'
    before=snap(); assert before['head']==MAC and before['main']==MAIN and before['branch']=='codex/gg-macos-current-main' and not before['status'] and not before['commonIndexExists']
    remote=txt('ls-remote','origin','refs/heads/main','refs/heads/codex/gg-20261116-macos-launcher')
    refs={line.split()[1]:line.split()[0] for line in remote.splitlines()}
    assert refs=={'refs/heads/main':TARGET,'refs/heads/codex/gg-20261116-macos-launcher':'6384342bcf561d81bab2f63064d61470aea65bdc'},refs
    save('BEFORE.json',before); (OUT/'index.before.raw').write_bytes(Path(before['indexPath']).read_bytes())
    p=git('fetch','origin','main',check=False)
    (OUT/'fetch.stdout.log').write_bytes(p.stdout);(OUT/'fetch.stderr.log').write_bytes(p.stderr);save('FETCH-RECEIPT.json',dict(exitCode=p.returncode))
    assert p.returncode==0 and txt('rev-parse','FETCH_HEAD')==TARGET
    assert txt('rev-parse',TARGET+'^{tree}')==proof['tree'] and txt('merge-base',MAC,TARGET)==BASE
    assert snap()==before
    mac=set(filter(None,git('diff','--no-renames','--name-only','-z',BASE,MAC).stdout.decode().split('\0')))
    target=set(filter(None,git('diff','--no-renames','--name-only','-z',BASE,TARGET).stdout.decode().split('\0')))
    overlap=sorted(mac & target);assert overlap==['.gitattributes','.prettierignore','CHANGELOG.md','docs/09-frontend-and-pwa.md']
    carry={}
    for side,commit,paths in [('mac',MAC,mac),('main',TARGET,target)]:
        for path in sorted(paths-set(overlap)):
            result=git('ls-tree',commit,'--',path).stdout.decode().strip()
            carry[side+':'+path]=result
    save('ADMISSION.json',dict(utc=datetime.now(timezone.utc).isoformat(),actualSignedTarget=TARGET,sourceMac=MAC,base=BASE,parentsExpected=[MAC,TARGET],macChangedPaths=len(mac),mainChangedPaths=len(target),overlap=overlap,runtimeOverlap=[],sourceUnchangedBeforeMerge=True,decision='D237 technical integration; D243 local test placement; no Mac device acceptance or final audit admission',carryObjects=carry))
    print('Admitted actual signed target; four documentation/metadata overlaps, no runtime overlap.')
elif mode=='merge':
    before=json.loads((OUT/'BEFORE.json').read_text());assert snap()==before
    p=git('merge','--no-ff','--no-commit',TARGET,check=False)
    (OUT/'merge.stdout.log').write_bytes(p.stdout);(OUT/'merge.stderr.log').write_bytes(p.stderr)
    conflicts=txt('diff','--name-only','--diff-filter=U').splitlines()
    save('MERGE-RECEIPT.json',dict(exitCode=p.returncode,conflicts=conflicts,head=txt('rev-parse','HEAD'),mergeHead=txt('rev-parse','MERGE_HEAD')))
    assert p.returncode in [0,1] and set(conflicts)<=set(['.gitattributes','.prettierignore','CHANGELOG.md','docs/09-frontend-and-pwa.md'])
    assert txt('rev-parse','HEAD')==MAC and txt('rev-parse','MERGE_HEAD')==TARGET and txt('rev-parse','refs/heads/main')==MAIN
    for rel in conflicts: (OUT/(rel.replace('/','_').lstrip('.')+'.conflicted.raw')).write_bytes((ROOT/rel).read_bytes())
    print(json.dumps({'exitCode':p.returncode,'conflicts':conflicts,'uncommitted':True}))
else: raise ValueError(mode)
