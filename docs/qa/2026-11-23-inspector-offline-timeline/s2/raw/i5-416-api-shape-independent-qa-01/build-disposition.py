import hashlib, json, pathlib, statistics
root = pathlib.Path(__file__).parent
def load(name): return json.loads((root/name).read_text(encoding='utf-8-sig'))
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
before, first, after = (load(name) for name in ('before.state.json','after-first.state.json','after.state.json'))
modules_before, modules_after = load('before.modules.json'), load('after.modules.json')
result = load('attempt-02/RESULT.json')
fixed = root/'attempt-02/executed-fixture.ts'
old = (root/'executed-fixture.ts').read_text()
new = fixed.read_text()
old_line = 'assert.equal(queryClient.getQueryData(queryKey), body);'
new_line = 'assert.deepEqual(queryClient.getQueryData(queryKey), exactBody);'
delta_exact = old.replace(old_line, new_line) == new and old.count(old_line) == 1
parity = {
    'headTreeIndexStagedStatusStable': all(before[k] == first[k] == after[k] for k in ('head','tree','indexSha256','stagedEntriesSha256','status')),
    'commonIndexAbsentThroughout': not any(s['commonIndexExists'] for s in (before,first,after)),
    'all1768MaterializedTrackedFilesUnchanged': before['materializedTracked'] == first['materializedTracked'] == after['materializedTracked'],
    'trackedFileCount': after['materializedTrackedCount'], 'descriptorCount':after['descriptorCount'],
    'omittedCount':after['omittedCount'],'omittedOnlyDocsQa':all(s['omittedOnlyDocsQa'] for s in (before,first,after)),
    'nonQaOmissions':after['nonQaOmissions'],
    'packageLockAndPnpmMetadataStable':before['metadata'] == first['metadata'] == after['metadata'],
    'selectedResolvedModulesAndNodeStable':all(modules_before[k] == modules_after[k] for k in ('node','selected','files')),
    'oldQaOverlaysUnchanged':all(before['overlays'][p] == first['overlays'][p] == after['overlays'][p] for p in before['overlays'] if p.endswith('.test.tsx')),
    'namedAssertionDeltaOnlyBetweenExecutedVersions':delta_exact,
    'initialExecutedSha256':sha(root/'executed-fixture.ts'),'correctedExecutedSha256':sha(fixed),
    'finalOverlayMatchesExecuted':after['overlays']['apps/web/e2e/independent-416-api-shape.qa.ts'] == sha(fixed),
    'limitation':'Sparse docs/qa omissions and selected dependency identities are explicit; no whole-installation identity claim.'
}
(root/'PARITY.json').write_text(json.dumps(parity,indent=2)+'\n')
summary = []
for item in result['timings']:
    measured = [s for s in item['samples'] if s['phase'] == 'measured']
    row = {'label':item['label'],'warmups':3,'measuredCount':len(measured)}
    for phase in ('jsonMs','schemaMs'):
        values = [s[phase] for s in measured]
        row[phase] = {'min':min(values),'median':statistics.median(values),'max':max(values)}
    summary.append(row)
(root/'TIMING-SUMMARY.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({'parity':parity,'observations':result['observations'],'largeControlledResult':result['largeControlledResult'],'timings':summary,'closure':load('attempt-02/CLOSURE.json')},indent=2))
