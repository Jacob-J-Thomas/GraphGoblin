from pathlib import Path
import hashlib, subprocess, sys, json
W,E,R,Q=map(Path,sys.argv[1:5])
base='3a6943a136594162665667a7a55e2b46520912eb'
start='58227ea02a00fcfe67775ddc8d337b3bab61406d'
head='0f500bd9355d22a7497f5e4e211a85376a53151f'
parent='9a895ce29a53e568b540bfd7de1a0e8fb37fa5f9'
def git(*args): return subprocess.check_output(['git','--no-optional-locks','-C',str(W),*args])
def sig(b): return hashlib.sha256(b).hexdigest()
def checkfile(p):
    content=p.read_bytes()
    return {'path':str(p), 'length':len(content),'sha256':sig(content)}
def names(a,b):return git('diff','--name-only',a,b).decode().splitlines()
def entry_at(ref,path):
    rec=git('ls-tree',ref,'--',path).decode().strip()
    if not rec:return None
    blob=rec.split()[2]
    data=git('cat-file','blob',blob)
    result={'blob':blob,'bytes':len(data),'sha256':sig(data)}
    if ref==head:assert sig((W/path).read_bytes())==result['sha256'],path
    return result
candidate=E/'i5-d227-stable-candidate-01/CANDIDATE.json'
assert sig(candidate.read_bytes())=='2b57ba0841024d7e1c9c22f5d7b8bffb315abe95b49228092709d1d8edf985bd'
c=json.loads(candidate.read_bytes().decode('utf-8-sig'))
assert git('show','--no-patch','--format=%H %T %P','HEAD').decode().split()==[head,'a9154362e2938cb7645acc79f8ab3dc109953a3d',parent]
assert git('status','--porcelain=v1','--untracked-files=all')==b''
assert len(names(start,head))==19 and len(names(parent,head))==9
assert set(names(base,head))=={f['path'] for f in c['files']}
members=[]
for f in c['files']:
    path=f['path']; current=entry_at(head,path)
    assert current['sha256']==f['sha256'] and current['bytes']==f['bytes']
    members.append(dict(path=path,firstReviewed=entry_at(start,path),candidate=current))
protected={}
for path in ['apps/web/e2e/claude-harness.spec.ts','apps/web/src/runs/projections.ts']:
    a=entry_at(base,path);b=entry_at(start,path);d=entry_at(head,path)
    assert a==b==d
    protected[path]=d
assert protected['apps/web/e2e/claude-harness.spec.ts']['sha256']=='e509374ea3e05cba35232ab0f59559b31f810a4c2c2fe5d228a5bf3ab07936f0'
spec='apps/web/e2e/inspector-truthfulness.spec.ts'
a=git('show',start+':'+spec).splitlines(keepends=True);b=git('show',head+':'+spec).splitlines(keepends=True)
assert len(a)==len(b)
changed=[i for i,(x,y) in enumerate(zip(a,b),1) if x!=y]
assert changed==[127,128] and all(x.lstrip().startswith(b'//') for i in changed for x in [a[i-1],b[i-1]])
refs=[
'E/i5-386-gpt-review-01/README.md','E/i5-386-gpt-review-01/SEAL.json','E/i5-386-gpt-review-01/SHA256-MANIFEST.json','E/i5-386-gpt-review-01/review-ledger.json',
'E/i5-386-correction-architecture-01/README.md','E/i5-386-correction-architecture-01/SEAL.json',
'E/i5-d227-stable-candidate-01/CANDIDATE.json','E/i5-d227-stable-candidate-01/comment-only-proof.json',
'E/i5-d227-finalization-admission-01/decision-227.md','E/i5-386-root-inputs-01/BRIEF.md','E/i5-d225-review-closure-01/root-disposition.json','E/i5-d223-local-gates-01/decision-223.md',
'Q/component-summary.json','Q/component-command-result.json','Q/types-lint-command-result.json','Q/build-command-result.json',
'Q/held-projection-browser-command-result.json','Q/held-projection-browser.log.txt','Q/original-claude-browser-command-result.json','Q/original-claude-browser.log.txt','Q/original-claude-browser-selected-command-result.json','Q/original-claude-browser-selected.log.txt','Q/qa-overlay/apps/web/src/runs/RunInspectorPage.corrective-boundaries-qa.test.tsx','Q/qa-overlay/apps/web/src/runs/RunInspectorPage.corrective-independent-qa.test.tsx']
inputs=[checkfile({'E':E,'Q':Q}[ref[0]]/ref[2:]) for ref in refs]
proof=dict(signedMain=base,fromHead=start,fromTree=git('rev-parse',start+'^{tree}').decode().strip(),head=head,tree=c['tree'],soleParent=parent,clean=True,candidateManifest=checkfile(candidate),cumulativePaths=len(members),correctivePaths=names(start,head),supportingPaths=names(parent,head),members=members,protected=protected,fixtureCommentChanges=changed,inputs=inputs,probeGitBlobCount=len(json.loads((R/'probe-parity.json').read_bytes())['members']))
(R/'source-and-inputs.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
print('Verified 22 candidate files, 19 corrective files, 9 supporting files, both protected Git blob identities, comment-only lines and 494 probe blobs; clean source.')
