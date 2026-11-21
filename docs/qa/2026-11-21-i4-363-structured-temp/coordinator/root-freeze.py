from pathlib import Path
import json, hashlib, subprocess
q=Path(__file__).resolve().parent
r=Path('G:/ggq/gg-i4-363-structured/GraphGoblin')
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(*a):return subprocess.check_output(['git',*a],cwd=r)
b=json.loads((q/'source-binding.json').read_bytes())
assert sha((q/'source-binding.json').read_bytes())=='8ccd080f29a274ce62e8e3f3feb03bb04800b213d5ce37a1d1291ffcb26a394c'
assert git('rev-parse','HEAD').decode().strip()==b['head']=='76beeb0f2e99343697578c2713ac06f80d59e7b5'
assert not git('diff','--cached','--name-only')
assert len(b['files'])==10
for f in b['files']:assert sha((r/f['path']).read_bytes())==f['sha256'],f['path']
git('diff','--check')
git('add','--',*[f['path'] for f in b['files']])
assert set(git('diff','--cached','--name-only').decode().splitlines())=={f['path'] for f in b['files']}
git('diff','--cached','--check')
output=git('commit','-m','Shorten the pinned Codex SDK schema directory prefix').decode()
head=git('rev-parse','HEAD').decode().strip()
assert git('rev-parse','HEAD^').decode().strip()==b['head']
assert not git('status','--porcelain')
record={'head':head,'tree':git('rev-parse','HEAD^{tree}').decode().strip(),'parent':b['head'],'authorBindingSha256':'8ccd080f29a274ce62e8e3f3feb03bb04800b213d5ce37a1d1291ffcb26a394c','files':[{'path':f['path'],'gitBlobSha256':sha(git('cat-file','blob',head+':'+f['path'])),'authorWorkingBytesSha256':f['sha256']} for f in b['files']],'commitOutput':output,'clean':True}
with (q.parent/'i4-363-sdk-root-freeze.json').open('x',encoding='utf-8') as f:f.write(json.dumps(record,indent=2)+'\n')
print(json.dumps({k:record[k] for k in ['head','tree','parent','clean']}))
