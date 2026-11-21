from pathlib import Path
import hashlib,json,os,subprocess
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
out=E/'i4-486-final-root-publication-01'
repo=Path('G:/ggq/gg-i4-486-review-fixes/GraphGoblin')
source='4d982162ca60e885d5af22f66076383a048215db'
prefix='docs/qa/2026-11-21-i4-486-authored-failures/'
arc=repo/prefix
artifact=prefix+'historical-target-02a/integration/conflict/0/worktree-original'
artifact_sha='98047f736843b54ebcf2918f8369be0b7383a7959c8f3a5394000bc577db3d8b'
sha=lambda b:hashlib.sha256(b).hexdigest()
os.environ['GIT_OPTIONAL_LOCKS']='0'
def git(*args):return subprocess.check_output(['git',*args],cwd=repo)
def save(name,raw):
    p=out/name;assert not p.exists()
    p.write_bytes(raw if isinstance(raw,bytes) else (json.dumps(raw,indent=2)+'\n').encode())
assert git('rev-parse','HEAD').decode().strip()==source
assert not (out/'evidence-commit-receipt.json').exists()
assert not git('ls-files','--unmerged') and not git('diff','--name-only')
manifest_raw=(arc/'integration-manifest.json').read_bytes();manifest=json.loads(manifest_raw)
files=manifest['files']+[{'path':'integration-manifest.json','sha256':sha(manifest_raw),'bytes':len(manifest_raw)}]
expected={prefix+x['path'] for x in files}|{'.gitattributes','.prettierignore'}
assert set(git('diff','--cached','--name-only','-z').decode().split('\0')[:-1])==expected
assert sha((repo/artifact).read_bytes())==artifact_sha
sparse=Path(git('rev-parse','--path-format=absolute','--git-path','info/sparse-checkout').decode().strip())
sparse_before=sparse.read_bytes()
prior=json.loads((out/'sparse-resume-decision.json').read_bytes())
assert sha(sparse_before)==prior['sparseRulesSHA256']
check=subprocess.run(['git','diff','--cached','--check'],cwd=repo,capture_output=True)
assert check.returncode==2 and check.stderr==b''
assert check.stdout.decode().splitlines()==[artifact+f':{line}: leftover conflict marker' for line in (7,9,28)]
save('d211-full-check-before.stdout',check.stdout)
attributes=repo/'.gitattributes';before=attributes.read_bytes()
assert git('cat-file','blob',':.gitattributes')==before
addition=(f'\n# Retain the original seven-character markers in this sealed historical conflict transcript.\n{artifact} conflict-marker-size=32\n').encode()
assert artifact.encode() not in before
save('d211-attributes-before.txt',before)
attributes.write_bytes(before+addition)
save('d211-attributes-after.txt',attributes.read_bytes())
git('add','--','.gitattributes')
attr=git('check-attr','conflict-marker-size','--',artifact,'packages/engine/src/run-manager.ts')
assert attr.decode().splitlines()==[artifact+': conflict-marker-size: 32','packages/engine/src/run-manager.ts: conflict-marker-size: unspecified']
save('d211-effective-attributes.txt',attr)
check=subprocess.run(['git','diff','--cached','--check'],cwd=repo,capture_output=True)
save('d211-full-check-after.stdout',check.stdout);save('d211-full-check-after.stderr',check.stderr)
assert check.returncode==0 and not check.stdout and not check.stderr
assert not git('ls-files','--unmerged') and not git('diff','--name-only')
assert set(git('diff','--cached','--name-only','-z').decode().split('\0')[:-1])==expected
for item in files:
    raw=(arc/item['path']).read_bytes();assert len(raw)==item['bytes'] and sha(raw)==item['sha256']
# Batch native Git object reads retain byte verification without thousands of subprocesses.
def verify_objects(ref):
    queries=[(ref+prefix+x['path']).encode() for x in files]
    assert all(b'\n' not in q and b'\r' not in q for q in queries)
    raw=subprocess.check_output(['git','cat-file','--batch'],cwd=repo,input=b'\n'.join(queries)+b'\n')
    cursor=0
    for item in files:
        end=raw.index(b'\n',cursor);header=raw[cursor:end].split();assert len(header)==3 and header[1]==b'blob'
        size=int(header[2]);cursor=end+1
        assert size==item['bytes'] and sha(raw[cursor:cursor+size])==item['sha256'],item['path']
        cursor+=size;assert raw[cursor:cursor+1]==b'\n';cursor+=1
    assert cursor==len(raw)
    return len(files)
index_count=verify_objects(':')
for path in ['.gitattributes','.prettierignore']:assert git('cat-file','blob',':'+path)==(repo/path).read_bytes()
save('d211-precommit-verification.json',{'manifestSHA256':sha(manifest_raw),'archiveIndexBlobsVerified':index_count,'stagedPaths':len(expected),'fullDiffCheckExit':0,'unmergedEntries':0,'artifactSHA256':artifact_sha,'exactPathMarkerSize':32,'ordinarySourceMarkerSize':'unspecified','sparseRulesSHA256':sha(sparse_before),'priorAttemptsRetained':True,'originalArchiveSealUnchanged':True})
commit_output=git('commit','-m','docs(qa): preserve authored failure reviews and bounded QA')
save('publication-attempt3-commit.stdout',commit_output)
head=git('rev-parse','HEAD').decode().strip();tree=git('rev-parse','HEAD^{tree}').decode().strip()
assert git('rev-parse','HEAD^').decode().strip()==source
assert not git('status','--porcelain')
committed_count=verify_objects(head+':')
assert sparse.read_bytes()==sparse_before
before_tree=(out/'prior-archive-tree.txt').read_bytes();after_tree=git('ls-tree','-r','HEAD','--','docs/qa')
assert set(before_tree.splitlines())<=set(after_tree.splitlines())
assert git('diff','--name-only',source,'HEAD','--','packages','apps')==b''
receipt={'sourceParent':source,'head':head,'tree':tree,'archive':prefix,'archiveBlobsVerified':files,'changedPaths':sorted(expected),'commitOutput':commit_output.decode(),'cleanAfter':True,'batchGitObjectReadVerification':True,'sparseRulesUnchanged':True,'historicalMarkerAttributeExactPath':artifact}
save('evidence-commit-receipt.json',receipt)
save('publication-verification.json',{'manifestSHA256':sha(manifest_raw),'manifestMembers':len(manifest['files']),'physicalOriginals':manifest['copiedOriginals'],'archiveBlobsVerified':committed_count,'priorArchiveEntriesUnchanged':len(before_tree.splitlines()),'sparseRulesUnchanged':True,'head':head,'tree':tree,'firstAndSecondAttemptsRetained':True,'fullDiffCheckPassedWithoutExclusions':True})
print(json.dumps({'head':head,'tree':tree,'archiveBlobsVerified':committed_count,'changedPaths':len(expected),'clean':True,'priorArchiveEntriesUnchanged':len(before_tree.splitlines()),'fullDiffCheck':True}))
