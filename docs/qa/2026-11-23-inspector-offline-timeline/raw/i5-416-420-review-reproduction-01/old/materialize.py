import hashlib,json,os,pathlib,subprocess
evidence=pathlib.Path(__file__).parent;root=pathlib.Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
relative='apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx';live=root/relative
draft=pathlib.Path('G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-420-review-reproduction-preparation-01/AUGMENTED-RunInspectorPage.independent-416.qa.test.tsx')
def sha(data):return hashlib.sha256(data).hexdigest()
before=json.loads((evidence/'before.json').read_text());prior=json.loads(pathlib.Path('G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-420-ui-independent-qa-01/component-execution-01/after.json').read_text())
for key in ('head','tree','indexSha256','stagedEntriesSha256','commonIndexExists','status','dependencyInputs','metadata','selectedSources','overlays'):assert before[key]==prior[key],key
assert before['head']=='3c35b3d0f345dd420c67b90d59de94a2f73d946b' and not before['commonIndexExists']
env=dict(os.environ,GIT_OPTIONAL_LOCKS='0')
controls=[]
for args,expected in ((['diff','--quiet'],0),(['diff','--cached','--quiet'],0),(['ls-files','--error-unmatch',relative],1)):
    result=subprocess.run(['git','--no-optional-locks',*args],cwd=root,env=env,capture_output=True)
    assert result.returncode==expected,(args,result.returncode)
    controls.append(dict(args=args,exitCode=result.returncode,expected=expected,stdout=result.stdout.decode(),stderr=result.stderr.decode()))
original=live.read_bytes();augmented=draft.read_bytes()
assert sha(original)=='d0eb5cabb5f047d745a547b866b52397ebcca31d7f4143e47e05ac185609f8fe'
assert sha(augmented)=='777eaa3272b6e573a5e7d2a815679ef112a8121738b131335e8fc65f0f734096'
assert augmented.startswith(original)
(evidence/'original49.component.tsx').write_bytes(original);(evidence/'initial-augmented.component.tsx').write_bytes(augmented)
live.write_bytes(augmented)
binding=dict(head=before['head'],tree=before['tree'],onlyWrittenCheckoutPath=relative,augmentedSha256=sha(augmented),original49Sha256=sha(original),original49Bytes=len(original),original49LiteralPrefix=True,otherPinnedBoundariesMatchPriorPhase=True,gitReadOnlyControls=controls)
(evidence/'MATERIALIZED.json').write_text(json.dumps(binding,indent=2)+'\n',encoding='utf-8');print(json.dumps(binding,indent=2))
