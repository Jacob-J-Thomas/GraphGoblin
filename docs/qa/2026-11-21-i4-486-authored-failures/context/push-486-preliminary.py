from pathlib import Path
import subprocess,json,hashlib,datetime
q=Path(__file__).resolve().parent;proof=q/'i4-486-main-02a-preliminary-integration-01';out=q/'i4-486-preliminary-push-01';out.mkdir(exist_ok=False);repo=Path('G:/ggq/gg-i4-486-delivery/GraphGoblin')
head='d1177f105bd008fc084ccbbc086ee70e14d13e2f';source='633d9ac72c10fe4b8d76f7ba50221f9ed8557cb9';main='02a0000998fa119be7553ddc06a60b63fbde1e31';tree='dd2c051567d317f91d092a658bce553a8b8eb16b';branch='codex/gg-i4-486-delivery'
h=lambda b:hashlib.sha256(b).hexdigest()
seal=(proof/'seal.json').read_bytes();assert h(seal)=='1422725a922300b0c6dfa3d4fddfab62f2b7f79cd34f8d50fdb5a41f4ceb07ba';m=json.loads(seal);assert len(m['files'])==285
for x in m['files']:
 f=(proof/x['path']).resolve();assert f.is_relative_to(proof.resolve());b=f.read_bytes();assert len(b)==x['bytes'] and h(b)==x['sha256'],x['path']
def git(*a,cwd=repo):return subprocess.check_output(['git',*a],cwd=cwd)
freeze=json.loads((q/'i4-486-source-freeze-01/receipt.json').read_text())
for frozen in ['G:/ggq/gg-i4-486-authored-errors/GraphGoblin','G:/ggq/gg-i4-486-qa/GraphGoblin']:
 assert git('rev-parse','HEAD',cwd=frozen).decode().strip()==source and not git('status','--porcelain',cwd=frozen)
 for f in freeze['files']:
  b=(Path(frozen)/f['path']).read_bytes();assert len(b)==f['bytes'] and h(b)==f['sha256'],f['path']
assert git('rev-parse','HEAD').decode().strip()==head and git('rev-parse','HEAD^{tree}').decode().strip()==tree and git('show','-s','--format=%P','HEAD').decode().strip().split()==[source,main] and not git('status','--porcelain')
existing=json.loads(subprocess.check_output(['gh','api','repos/Jacob-J-Thomas/GraphGoblin/pulls?state=open&head=Jacob-J-Thomas:'+branch]));assert existing==[]
before=git('ls-remote','origin','refs/heads/'+branch,'refs/heads/main').decode();(out/'remote-before.txt').write_text(before)
refs={line.split()[1]:line.split()[0] for line in before.splitlines()};assert refs=={'refs/heads/main':main}
with (out/'push.stdout').open('wb') as stdout,(out/'push.stderr').open('wb') as stderr:p=subprocess.run(['git','push','origin','HEAD:refs/heads/'+branch],cwd=repo,stdout=stdout,stderr=stderr)
assert p.returncode==0
after=git('ls-remote','origin','refs/heads/'+branch,'refs/heads/main').decode();(out/'remote-after.txt').write_text(after);refsAfter={line.split()[1]:line.split()[0] for line in after.splitlines()};assert refsAfter=={'refs/heads/'+branch:head,'refs/heads/main':main}
record={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'issue':486,'head':head,'tree':tree,'parents':[source,main],'mainBeforeAndAfter':main,'newRemoteBranch':branch,'normalPush':True,'force':False,'integrationSeal':h(seal),'integrationEntriesVerified':285,'frozenSourceFilesVerified':len(freeze['files']),'bothFrozenCheckoutsRemain':source,'authority':'D200; unfinished draft for ordinary hosted verification only','reviewQAArchiveFinalAudit':'Still pending'}
(out/'receipt.json').write_bytes((json.dumps(record,indent=2)+'\n').encode());print(json.dumps(record))
