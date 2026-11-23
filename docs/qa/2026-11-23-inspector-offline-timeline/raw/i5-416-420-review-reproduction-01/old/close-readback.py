import hashlib,json,os,pathlib,subprocess
root=pathlib.Path(__file__).parent;checkout=pathlib.Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
def read(name):return json.loads((root/name).read_text(encoding='utf-8-sig'))
def sha(data):return hashlib.sha256(data).hexdigest()
before,after=read('before.json'),read('after.json');mb,ma=read('before.modules.json'),read('after.modules.json')
parity={key:before[key]==after[key] for key in ('head','tree','indexSha256','stagedEntriesSha256','commonIndexExists','status','selectedSources','dependencyInputs','metadata')}
component='apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'
parity['otherFourOverlaysUnchanged']=all(before['overlays'][p]==after['overlays'][p] for p in before['overlays'] if p!=component)
parity['selectedModulesAndNodeUnchanged']=mb['node']==ma['node'] and mb['selected']==ma['selected']
parity['commonIndexAbsent']=not before['commonIndexExists'] and not after['commonIndexExists']
original=(root/'original49.component.tsx').read_bytes();final=(checkout/component).read_bytes();first=(root/'first-structured12.component.tsx').read_bytes()
line=b"      api.override('GET /healthz', () => Response.json({ status: 'ok' }));\n"
parity['original49LiteralPrefixUnchanged']=final.startswith(original) and sha(original)=='d0eb5cabb5f047d745a547b866b52397ebcca31d7f4143e47e05ac185609f8fe'
parity['C1CorrectionExactlyOneHealthOverride']=final.count(line)==1 and final.replace(line,b'',1)==first
parity['finalMatchesC1ExecutedCopy']=final==(root/'C1-corrected.component.tsx').read_bytes()
sealed=[]
for folder,manifest in (('i5-416-420-ui-independent-qa-01','PREPARATION-MANIFEST.json'),('i5-416-420-ui-independent-qa-01/component-execution-01','MANIFEST.json')):
    base=pathlib.Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')/folder
    members=json.loads((base/manifest).read_text())['members'];ok=all(sha((base/item['path']).read_bytes())==item['sha256'] for item in members)
    sealed.append(dict(path=str(base/manifest),members=len(members),unchanged=ok))
parity['earlierSealedEvidenceUnchanged']=all(item['unchanged'] for item in sealed)
runs=[]
for name in ('09-review12.json','11-structured-review12.json','13-structured-C1.json'):
    report=read(name);cases=[case for file in report['testResults'] for case in file['assertionResults']]
    active=[case for case in cases if case['status'] in ('passed','failed')]
    runs.append(dict(file=name,total=len(cases),active=len(active),passed=sum(case['status']=='passed' for case in cases),failed=sum(case['status']=='failed' for case in cases),filtered=sum(case['status']=='skipped' for case in cases),cases=[dict(name=case['fullName'],status=case['status'],failureHeads=[message.split('\n')[0] for message in case.get('failureMessages',[])]) for case in active]))
git=[]
for args in (['diff','--quiet'],['diff','--cached','--quiet']):
    process=subprocess.run(['git','--no-optional-locks',*args],cwd=checkout,env=dict(os.environ,GIT_OPTIONAL_LOCKS='0'),capture_output=True)
    git.append(dict(argv=args,exitCode=process.returncode,stdout=process.stdout.decode(),stderr=process.stderr.decode()))
result=dict(parity=parity,sealedEvidence=sealed,trackedReadOnlyControls=git,sourceHead=after['head'],sourceTree=after['tree'],finalFull61FixtureSha256=sha(final),runs=runs,limit='Public component/fake HTTP evidence only. C1 first reached no product oracle because health fixture404; root-admitted two-case correction is separate. Filtered cases are not passes.')
(root/'CLOSURE-AND-CASES.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(parity=parity,sourceHead=after['head'],fixtureSha256=sha(final),runs=[{k:v for k,v in run.items() if k!='cases'} for run in runs]),indent=2))
