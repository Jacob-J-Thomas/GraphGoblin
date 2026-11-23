import difflib,hashlib,json,os,pathlib,subprocess
root=pathlib.Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin');evidence=pathlib.Path(__file__).parent;prep=evidence.parent
def sha(data):return hashlib.sha256(data).hexdigest()
def git(*args):return subprocess.check_output(['git','--no-optional-locks',*args],cwd=root,env=dict(os.environ,GIT_OPTIONAL_LOCKS='0')).decode().strip()
before=json.loads((evidence/'before.json').read_text())
assert git('rev-parse','HEAD')==before['head']=='3c35b3d0f345dd420c67b90d59de94a2f73d946b'
assert git('rev-parse','HEAD^{tree}')==before['tree']=='848ccedef110b258296c8bce67d3a2ed452cb850'
index=pathlib.Path(git('rev-parse','--path-format=absolute','--git-path','index'));assert sha(index.read_bytes())==before['indexSha256']
for key in ('selectedSources','dependencyInputs','metadata'):
    for name,digest in before[key].items():assert sha((root/name).read_bytes())==digest,(key,name)
manifest=prep/'PREPARATION-MANIFEST.json';assert sha(manifest.read_bytes())=='52f171d3758d26568818269755d3a11eed4f50f94eaa9c53aec5d44fa20fe2d0'
members=json.loads(manifest.read_text())['members']
for member in members:assert sha((prep/member['path']).read_bytes())==member['sha256']
copies=evidence/'executed-overlays';copies.mkdir(exist_ok=True);deltas=[];overlays={}
for name in before['overlays']:
    data=(root/name).read_bytes();target=copies/pathlib.Path(name).name
    if target.exists():assert target.read_bytes()==data
    else:target.write_bytes(data)
    overlays[name]=sha(data)
    original=(prep/'overlay-copies'/target.name).read_text(encoding='utf-8');current=data.decode('utf-8')
    deltas.extend(difflib.unified_diff(original.splitlines(True),current.splitlines(True),fromfile='prepared/'+name,tofile='executed/'+name))
(evidence/'FIXTURE-DELTA.diff').write_text(''.join(deltas),encoding='utf-8')
binding=dict(head=before['head'],tree=before['tree'],preparationMembersVerified=len(members),trackedSourceDependencyIndexBoundariesUnchanged=True,overlays=overlays,selection='src/runs/RunInspectorPage.independent-416.qa.test.tsx',plannedCases=49,workerLimit=1,retries=0,testTimeoutMs=20000,hookTimeoutMs=20000,productEdits=False,limitation='Selected source/dependency boundaries; fake HTTP/component execution only, no build/browser/provider.')
(evidence/'EXECUTION-BINDING.json').write_text(json.dumps(binding,indent=2)+'\n',encoding='utf-8');print(json.dumps(binding,indent=2))
