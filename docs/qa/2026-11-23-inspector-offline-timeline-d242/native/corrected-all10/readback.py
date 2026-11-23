import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
E = ROOT.parent
NATIVE = ROOT / 'native'
PREP = E / 'i5-d242-b2-native-qa-preparation-03'
OLD = E / 'i5-d242-b2-native-old-f642-execution-02'

def read(p):
    return json.loads(Path(p).read_text(encoding='utf-8-sig'))

def pin(p):
    data = Path(p).read_bytes()
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

def ref(p):
    return {'source': str(p), **pin(p)}

def check(r):
    assert pin(r['source']) == {k: r[k] for k in ('bytes', 'sha256')}, r['source']

def save(name, data):
    with (ROOT / name).open('x', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

def copy(source, name):
    target = ROOT / name
    assert not target.exists()
    shutil.copyfile(source, target)
    assert pin(source) == pin(target)
    return {'original': ref(source), 'retained': ref(target)}

b = read(ROOT / 'ROOT-BINDING.executed.json')
receipt = read(ROOT / 'COMMAND.receipt.json')
results = read(NATIVE / 'RESULTS.json')
old = read(OLD / 'native/RESULTS.json')
old_binding = read(OLD / 'ROOT-BINDING.executed.json')
assert receipt['exitCode'] == 0 and receipt['startOrCaptureFailure'] is None
assert pin(ROOT / 'native.stderr.log')['bytes'] == 0
assert receipt['rootBindingSha256'] == pin(ROOT / 'ROOT-BINDING.executed.json')['sha256']
assert receipt['stdoutSha256'] == pin(ROOT / 'native.stdout.log')['sha256']
assert receipt['stderrSha256'] == pin(ROOT / 'native.stderr.log')['sha256']
assert b['selection'] == results['selection'] == 'all'
assert b['source'] == results['source'] == receipt['source']
assert results['source']['head'] == '20a69d9b53910a5ede81088e9ff67680f348ce68'
assert results['source']['tree'] == '8be5890a170f2a51af49467e1f71e88839bef28b'
assert results['passed'] == results['expectedCases'] == len(results['cases']) == 10
assert results['failed'] == 0 and results['browserCloseResolved'] is True
assert results['protectedInputsAndDistributionUnchanged'] is True
assert pin(PREP / 'MANIFEST.json')['sha256'] == b['preparationManifestSha256'] == old_binding['preparationManifestSha256'] == '717d855b5a5b03f02a2e588d306e8c13b9bd9436764925a81f95ef6898db117e'
assert b['fixture'] == old_binding['fixture']
for m in read(PREP / 'MANIFEST.json')['members']:
    check({'source': str(PREP / m['path']), 'bytes': m['bytes'], 'sha256': m['sha256']})
for key in ('rootAdmission', 'fixture'):
    check(b[key])
for r in b['build'].values():
    if isinstance(r, dict):
        check(r)
before = read(NATIVE / 'PROTECTED-BEFORE.json')
after = read(NATIVE / 'PROTECTED-AFTER.json')
assert before == after and len(before) == 54
for path, expected in after.items():
    assert pin(path) == expected, path
stdout = [json.loads(line) for line in (ROOT / 'native.stdout.log').read_text().splitlines() if line.strip()]
assert len(stdout) == 10 and all(c['state'] == 'passed' and not c['failedCriteria'] for c in stdout)
summaries, comparisons = [], []
body_sha = '42746fd515431608f0d3c4a5dc537b9d1625b8905356f48595f263828d955ae0'
for i, c in enumerate(results['cases']):
    assert c['number'] == i + 1 and c['state'] == 'passed'
    assert all(x['passed'] is True for x in c['checks'])
    assert not c.get('error') and not c.get('cleanupError') and not c.get('caseDeadlineReached') and not c.get('finalScreenshotError')
    assert c['cleanupCloseResolved'] is True and c['onlyInterceptedDispatchNoServerEffects'] is True
    assert c['unknown'] == []
    individual = read(NATIVE / (f"{i+1:02d}-{c['action']}-{c['mode']}.json"))
    assert individual == c
    pre = [p for p in c['posts'] if p['phase'] == 'before-original-settlement']
    deliberate = [p for p in c['posts'] if p['phase'] == 'after-original-settlement']
    assert len(pre) == 1
    assert len(deliberate) == (1 if c['mode'] == 'failure' else 0)
    expected_body = {'observedSeq': 6, 'retryUncertainScript': True} if c['action'] == 'script' else {'runIds': [c['runA']], 'action': 'mark', 'token': 'a' * 64, 'confirmed': True}
    assert all(p['body'] == expected_body for p in c['posts'])
    if i < 8:
        steps = {s['name']: s['facts'] for s in c['steps']}
        for name in ('matching-new-generation-read-held', 'same-finalized-body-requalified'):
            s = steps[name]
            assert s['url'] == c['sourceSameRoute'] and s['online'] is True
            assert s['oldHeaderConnected'] is False and s['oldHeadingConnected'] is False
            assert s['removedHeaderRecords'] == s['removedHeadingRecords'] == 1
            assert any(x == {'sameStorage': True, 'oldA': True, 'newB': True} for x in s['storageEvents'])
        pre_reads = [r for r in c['runReads'] if r['phase'] == 'before-original-settlement' and r['id'] == c['runA']]
        assert [r['generation'] for r in pre_reads] == ['A', 'A', 'B']
        assert [r['held'] for r in pre_reads] == [False, False, True]
        assert all(r['bodySha256'] == body_sha for r in pre_reads)
    else:
        s = c['steps'][0]
        assert s['name'] == 'native-dismissed-readonly-preview'
        assert s['facts']['oldHeaderConnected'] is True and s['facts']['oldHeadingConnected'] is True
        assert s['facts']['storageEvents'] == []
        assert len(c['previews']) == 2
        buttons = s['facts']['dialogs'][0]['buttons']
        assert any(x['label'] == 'Saving…' and x['disabled'] for x in buttons)
    feedback = next((x['facts'] for x in c['checks'] if x['name'] == 'late action failure visible within original two-second budget'), None)
    summaries.append({'case': c['number'], 'action': c['action'], 'mode': c['mode'], 'passedCriteria': [x['name'] for x in c['checks']], 'preSettlementPosts': len(pre), 'laterDeliberatePosts': len(deliberate), 'requestBodies': [p['body'] for p in c['posts']], 'feedback': feedback, 'steps': [s['name'] for s in c['steps']], 'unknownRoutes': c['unknown'], 'contextCloseResolved': c['cleanupCloseResolved']})
    if i < 4:
        o = old['cases'][i]
        assert (o['action'], o['mode']) == (c['action'], c['mode'])
        assert [x['name'] for x in o['checks']] == [x['name'] for x in c['checks']]
        old_pre_reads = [r for r in o['runReads'] if r['phase'] == 'before-original-settlement' and r['id'] == o['runA']]
        assert old_pre_reads == pre_reads
        comparisons.append({'case': c['number'], 'action': c['action'], 'mode': c['mode'], 'oldState': o['state'], 'correctedState': c['state'], 'oldFailedCriteria': [x['name'] for x in o['checks'] if not x['passed']], 'sameExpectedCorrectCriteriaAndPreSettlementReadSchedule': True, 'oldPreSettlementPosts': sum(p['phase'] == 'before-original-settlement' for p in o['posts']), 'correctedPreSettlementPosts': len(pre), 'oldLateFeedback': next((x['facts'] for x in o['checks'] if x['name'] == 'late action failure visible within original two-second budget'), None), 'correctedLateFeedback': feedback})
retained = [copy(PREP / 'native.cjs', 'executed.native.cjs'), copy(PREP / 'run-native.ps1', 'executed.run-native.ps1'), copy(PREP / 'MANIFEST.json', 'executed.preparation.MANIFEST.json'), copy(b['rootAdmission']['source'], 'executed.root-admission.json'), copy(b['fixture']['source'], 'executed.API-FIXTURE.json'), copy(b['build']['manifest']['source'], 'executed.BUILD-MANIFEST.json'), copy(b['build']['shippingEquivalence']['source'], 'executed.SHIPPING-EQUIVALENCE.json')]
visual_names = ['01-script-guard-guard-attempt.png', '03-script-failure-late-error.png', '04-deletion-failure-late-error.png', '05-script-success-ordinary-success.png', '06-deletion-success-ordinary-success.png', '09-deletion-dismiss-failure-native-dismissed-readonly-preview.png', '09-deletion-dismiss-failure-late-error.png', '01-script-guard-matching-new-generation-read-held.png', '07-script-isolation-failure-new-visit-to-original-run.png']
save('SEMANTIC-READBACK.json', {
    'scope': 'Independent post-execution evidence readback, not a new browser run or source review',
    'rootReportedSession': 10352,
    'rootReportedTerminalExit': 0,
    'actualCommandReceiptExit': receipt['exitCode'],
    'startUtc': receipt['startUtc'], 'endUtc': receipt['endUtc'],
    'source': results['source'], 'browser': results['browser'], 'node': results['node'],
    'cases': 10, 'passed': 10, 'failed': 0, 'fixtureErrors': 0,
    'expectedCorrectCriteriaPassed': sum(len(c['checks']) for c in results['cases']),
    'caseSummaries': summaries, 'originalFourComparison': comparisons,
    'originalNativeFixtureAndAllExpectedCorrectAssertionsUnchanged': True,
    'oldNegativeManifest': ref(OLD / 'MANIFEST.json'),
    'firstPreBrowserFailureRetainedSeparately': str(E / 'i5-d242-b2-native-old-f642-execution-01'),
    'protectedCount': len(before), 'protectedInputCount': len(b['protectedInputs']), 'distributionCount': len(read(b['build']['manifest']['source'])['webDist']),
    'beforeAfterAndPostClosureRehashEqual': True,
    'retainedProvenanceCopies': retained,
    'visuallyInspectedCorrectedPngs': [ref(NATIVE / n) for n in visual_names],
    'visuallyRecheckedOldNegativePngs': [ref(OLD / ('native/' + n)) for n in ('03-script-failure-late-error.png', '04-deletion-failure-late-error.png')],
    'visualQualification': 'Dismissal late-error image keeps the replacement native dialog open; the backdrop dims and dialog partly covers the page-level uncertainty text. The exact text locator visibility and retained dialog identity passed. The remount failure-case page-level uncertainty screenshot is unobscured.',
    'browserCloseResolved': True, 'allTenContextClosesResolved': True,
    'closureLimit': 'Root reported wrapper session terminal exit0; actual pnpm receipt agrees. Browser/context close promises resolved in native records. No independent operating-system descendant census or universal network-absence claim.',
    'temporaryDiagnostics': 'Entire task-owned temp/ retained and excluded from selected evidence manifest; no cleanup or source/runtime writes by this readback.',
    'scopeLimit': 'Every app/API response intercepted at inspector.invalid; native browser dispatch/DOM and actual context offline/online plus synthetic second-tab localStorage event. No backend listener, provider, real server principal, duplicate server effect, whole-app acceptance or waiver of the separate strict G1 failure.'
})
print(json.dumps({'passed': 10, 'criteria': sum(len(c['checks']) for c in results['cases']), 'protected': len(before), 'pngs': len(list(NATIVE.glob('*.png'))), 'semanticReadback': pin(ROOT / 'SEMANTIC-READBACK.json')}))
