import hashlib,json,pathlib
root=pathlib.Path(__file__).parent
def read(name):return json.loads((root/name).read_text(encoding='utf-8-sig'))
before,after=read('before.json'),read('after.json');mb,ma=read('before.modules.json'),read('after.modules.json');binding=read('EXECUTION-BINDING.json');tests=read('13-component-49.json')
assertions=[case for result in tests['testResults'] for case in result['assertionResults']]
parity={key:before[key]==after[key] for key in ('head','tree','indexSha256','stagedEntriesSha256','commonIndexExists','status','dependencyInputs','metadata','selectedSources')}
parity.update(commonIndexAbsent=not before['commonIndexExists'] and not after['commonIndexExists'],selectedModulesAndNodeUnchanged=mb['node']==ma['node'] and mb['selected']==ma['selected'],finalOverlaysMatchExecuted=binding['overlays']==after['overlays'])
prep=root.parent;manifest=json.loads((prep/'PREPARATION-MANIFEST.json').read_text());parity['sealedPreparationMembersUnchanged']=all(hashlib.sha256((prep/item['path']).read_bytes()).hexdigest()==item['sha256'] for item in manifest['members'])
result=dict(parity=parity,testSummary=dict(success=tests['success'],actualCases=len(assertions),statuses={status:sum(case['status']==status for case in assertions) for status in sorted(set(case['status'] for case in assertions))},numTotalTests=tests['numTotalTests'],numPassedTests=tests['numPassedTests'],numFailedTests=tests['numFailedTests'],numPendingTests=tests['numPendingTests']),limits='Component/fake HTTP only; selected source/dependency identity, no browser/API listener or exhaustive install claim.')
(root/'PARITY-AND-RESULT.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,indent=2))
