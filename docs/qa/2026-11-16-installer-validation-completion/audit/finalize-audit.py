"""Final read-only identity recheck and immutable audit-packet seal."""
from pathlib import Path
import datetime, hashlib, json, os, subprocess

OUT=Path(__file__).resolve().parent
REPO=Path(r'C:\Users\98jak\.codex\worktrees\gg-20261115-runtime\GraphGoblin')
BATCH=OUT.parent
HEAD='2732dd34457bcd9a7007e89c3fa11fe085af764c'
BASE='be633141be5a0cd2b4f960a46761fabbf2cb82c7'
TREE='d064706fb48def7bacac5e434f96825c5850d214'
MERGE='80c581ebc95de2000c25ed2b5995d5a648fa95ba'
os.environ['GIT_OPTIONAL_LOCKS']='0'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def git(*args): return subprocess.check_output(['git',*args],cwd=REPO).decode().strip()
assert git('rev-parse','HEAD')==HEAD and git('rev-parse','HEAD^{tree}')==TREE
assert not git('status','--porcelain=v1')
assert git('show','-s','--format=%H %T %P',MERGE)==f'{MERGE} {TREE} {BASE} {HEAD}'
refs=git('ls-remote','origin','refs/heads/main','refs/heads/codex/gg-20261116-installer-validation').splitlines()
assert set(refs)=={BASE+'\trefs/heads/main',HEAD+'\trefs/heads/codex/gg-20261116-installer-validation'}
assert not git('diff','--check',BASE,HEAD)
index=Path(git('rev-parse','--git-path','index'))
if not index.is_absolute(): index=REPO/index
prior=json.loads((OUT/'offline-verification.json').read_bytes())
assert sha(index)==prior['indexSha256Before']==prior['indexSha256After']
assert sha(BATCH/'launcher-436-discovery-corrected-candidate-source.json')=='c1586347fc360764babc193ff85b39147a687fc8808d6aaf27669d8348913c40'
for name in ('offline-verification.json','retained-lifetime-verification.json','retained-rollback-verification.json'):
    assert json.loads((OUT/name).read_bytes())['status']=='PASS'
assert 'Verdict: SIGN-OFF' in (OUT/'full-report.md').read_text(encoding='utf-8')
readback={'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS','head':HEAD,'target':BASE,'tree':TREE,
    'testedMerge':MERGE,'mergeParents':[BASE,HEAD],'remoteRefs':refs,'worktreeClean':True,'indexUnchanged':True,
    'indexSha256':sha(index),'diffCheck':'PASS','formalScan':2,'sharedCap':3,'verdict':'SIGN-OFF',
    'model':'gpt-6-astra','reasoningEffort':'max','modelEvidence':'Successful fresh collaboration dispatch; no separate provider-runtime payload exposed.',
    'reportSha256':sha(OUT/'full-report.md'),'inspectedInventorySha256':sha(OUT/'inspected-evidence.md'),
    'scope':'Read-only audit. No product/native rerun, source/index/GitHub write or owner resource access.'}
(OUT/'final-readback.json').write_text(json.dumps(readback,indent=2)+'\n',encoding='utf-8')
paths=sorted(p for p in OUT.rglob('*') if p.is_file() and p.name!='SHA256SUMS.txt')
seal=''.join(sha(p)+'  '+p.relative_to(OUT).as_posix()+'\n' for p in paths)
(OUT/'SHA256SUMS.txt').write_text(seal,encoding='utf-8')
for line in (OUT/'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
    expected,name=line.split('  ',1)
    assert sha(OUT/name)==expected
print(json.dumps({'status':'SEALED','files':len(paths),'head':HEAD,'target':BASE,
    'fullReportSha256':sha(OUT/'full-report.md'),'inspectedEvidenceSha256':sha(OUT/'inspected-evidence.md'),
    'checksumManifestSha256':sha(OUT/'SHA256SUMS.txt'),'finalReadbackSha256':sha(OUT/'final-readback.json'),
    'atUtc':readback['atUtc']},indent=2))
