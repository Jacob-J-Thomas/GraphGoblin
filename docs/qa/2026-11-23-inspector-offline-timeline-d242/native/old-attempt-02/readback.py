import hashlib
import json
from pathlib import Path

out = Path(__file__).parent
native = out / 'native'
prep = out.parent / 'i5-d242-b2-native-qa-preparation-03'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def load(path):
    return json.loads(path.read_bytes())


def save(name, value):
    with (out / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


command = load(out / 'COMMAND.receipt.json')
binding = load(out / 'ROOT-BINDING.executed.json')
results = load(native / 'RESULTS.json')
assert command['exitCode'] == 1 and command['startOrCaptureFailure'] is None and command['shell'] is False
assert sha((out / 'native.stdout.log').read_bytes()) == command['stdoutSha256']
assert sha((out / 'native.stderr.log').read_bytes()) == command['stderrSha256']
assert sha((out / 'ROOT-BINDING.executed.json').read_bytes()) == command['rootBindingSha256']
assert results['source'] == binding['source'] == command['source']
assert results['source']['head'] == 'f64287619b499c14601e11bce3d1c6b5414b6227'
assert results['selection'] == command['selection'] == 'repro' and results['expectedCases'] == 4
assert results['passed'] == 0 and results['failed'] == 4 and len(results['cases']) == 4
assert results['browser'] == '158.0.4370.33' and results['node'] == 'v22.23.4'
assert results['browserCloseResolved'] is True and results['protectedInputsAndDistributionUnchanged'] is True
before, after = load(native / 'PROTECTED-BEFORE.json'), load(native / 'PROTECTED-AFTER.json')
assert before == after and len(before) == 43
for ref in binding['protectedInputs']:
    assert before[ref['source']] == {key: ref[key] for key in ['bytes', 'sha256']}
manifest = load(Path(binding['build']['manifest']['source']))
assert len(manifest['webDist']) == 28
for name, wanted in manifest['webDist'].items():
    assert before[str(Path(binding['build']['dist']) / name)] == wanted
stdout = [json.loads(line) for line in (out / 'native.stdout.log').read_text().splitlines() if line.strip()]
assert len(stdout) == 4 and all(row['state'] == 'failed' for row in stdout)
assert 'Native expected-correct criteria failed; preserve first results, no automatic retry' in (out / 'native.stderr.log').read_text()
fixture = load(Path(binding['fixture']['source']))
body = fixture['responses'][fixture['runPath']]
body_hash = sha(json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode())
assert body_hash == '42746fd515431608f0d3c4a5dc537b9d1625b8905356f48595f263828d955ae0'
rows = []
for number, case in enumerate(results['cases'], 1):
    assert case == load(native / f"{number:02d}-{case['action']}-{case['mode']}.json")
    assert case['state'] == 'failed' and not case.get('error') and not case.get('caseDeadlineReached')
    assert case['cleanupCloseResolved'] is True and not case.get('cleanupError') and not case.get('finalScreenshotError')
    assert case['unknown'] == [] and case['onlyInterceptedDispatchNoServerEffects'] is True
    assert case['sourceSameRoute'] == 'https://inspector.invalid/app' + fixture['runPath']
    stages = {item['name']: item['facts'] for item in case['steps']}
    for stage in ['matching-new-generation-read-held', 'same-finalized-body-requalified']:
        facts = stages[stage]
        assert facts['url'] == case['sourceSameRoute'] and facts['online'] is True
        assert facts['oldHeaderConnected'] is False and facts['oldHeadingConnected'] is False
        assert facts['removedHeaderRecords'] == facts['removedHeadingRecords'] == 1
        assert facts['storageEvents'] == [{'sameStorage': True, 'oldA': True, 'newB': True}]
    original_reads = [read for read in case['runReads'] if read['phase'] == 'before-original-settlement']
    assert len(original_reads) == 3 and [read['generation'] for read in original_reads] == ['A', 'A', 'B']
    assert [read['held'] for read in original_reads] == [False, False, True]
    assert all(read['bodySha256'] == body_hash for read in original_reads)
    posts_before = [post for post in case['posts'] if post['phase'] == 'before-original-settlement']
    posts_after = [post for post in case['posts'] if post['phase'] == 'after-original-settlement']
    checks = {item['name']: item for item in case['checks']}
    if case['mode'] == 'guard':
        assert len(posts_before) == 2 and len(posts_after) == 0
        assert not checks['replacement launcher is disabled while original command pending']['passed']
        assert not checks['replacement dispatches no second confirmation']['passed']
        assert case['requestFailures'] == 2
        feedback = 'not selected; two requestfailed events came from cleanup aborts'
    else:
        assert len(posts_before) == 1 and len(posts_after) == 1 and case['requestFailures'] == 1
        assert not checks['replacement control retains pending guard']['passed']
        assert not checks['late action failure visible within original two-second budget']['passed']
        assert checks['one original POST before new deliberate choice']['passed']
        assert checks['fresh deliberate action sends exactly once after first settlement']['passed']
        assert checks['all API/page routes explicitly handled']['passed']
        feedback = 'not observed within 2000ms; original requestfailed event observed'
    if case['action'] == 'script':
        assert all(post['body'] == {'observedSeq': 6, 'retryUncertainScript': True} for post in case['posts'])
    else:
        assert all(post['body'] == {'runIds': [body['id']], 'action': 'mark', 'token': 'a' * 64, 'confirmed': True}
                   for post in case['posts'])
    assert stdout[number - 1]['failedCriteria'] == [item['name'] for item in case['checks'] if not item['passed']]
    rows.append({'case': number, 'action': case['action'], 'mode': case['mode'], 'state': case['state'],
        'preSettlementPosts': len(posts_before), 'freshDeliberatePostsAfterFirstSettlement': len(posts_after),
        'lateFeedback': feedback, 'headerAndHeadingRemovedExactlyOnce': True, 'nativeStorageEventOldAToNewB': True,
        'samePreSettlementBodySha256': body_hash, 'failedCriteria': stdout[number - 1]['failedCriteria']})
assert len(list(native.glob('*.png'))) == 16
source_manifest = load(prep / 'MANIFEST.json')
assert sha((prep / 'MANIFEST.json').read_bytes()) == '717d855b5a5b03f02a2e588d306e8c13b9bd9436764925a81f95ef6898db117e'
for item in source_manifest['members']:
    raw = (prep / item['path']).read_bytes()
    assert len(raw) == item['bytes'] and sha(raw) == item['sha256']
assert sha((prep / 'native.cjs').read_bytes()) == '649cda5a64a5c4cc93c5f7eb8ff35ec0040032bf52e37739c4a7ff080d29fc30'
for source, destination in [('native.cjs', 'executed.native.cjs'), ('run-native.ps1', 'executed.run-native.ps1')]:
    with (out / destination).open('xb') as stream:
        stream.write((prep / source).read_bytes())
admission = Path(binding['rootAdmission']['source'])
assert admission.stat().st_size == binding['rootAdmission']['bytes'] and sha(admission.read_bytes()) == binding['rootAdmission']['sha256']
with (out / 'ROOT-ADMISSION.executed.json').open('xb') as stream:
    stream.write(admission.read_bytes())
previous_failure = out.parent / 'i5-d242-b2-native-old-f642-execution-01'
assert load(previous_failure / 'COMMAND.receipt.json')['exitCode'] == 1
assert 'ERR_PACKAGE_PATH_NOT_EXPORTED' in (previous_failure / 'native.stderr.log').read_text()
assert sorted(p.name for p in (previous_failure / 'native').iterdir()) == ['ARGUMENTS.json']
save('SEMANTIC-READBACK.json', {'scope': 'Independent readback of root-executed original negative native witness only',
    'rootReportedSession': 81991, 'rootReportedWrapperExit': 1, 'actualCommandReceiptExit': 1,
    'browserCases': 4, 'passed': 0, 'expectedCorrectBehaviorFailures': 4, 'fixtureErrors': 0,
    'caseResults': rows, 'fatalPreconditionsReached': ['actual navigator offline/online and last-observed transition',
        'original POST dispatched and held through recovery and same-body requalification',
        'actual second-tab StorageEvent plus new-generation GET', 'old header/heading removed and different visible elements recreated on identical route'],
    'preconditionEvidenceLimit': 'Some intermediate conditions are fatal assertions in the exact executed runner rather than separate serialized event records. Same-body/new-key/DOM facts are also in JSON; screenshots are bounded visual samples.',
    'protectedMapMembers': 43, 'distributionMembers': 28, 'sourceInputsBeforeAfterEqual': True,
    'allFourContextClosePromisesResolved': True, 'browserClosePromiseResolved': True,
    'closureLimit': 'Playwright close resolution, not an independent OS/account-wide process or descendant audit.',
    'reviewedScreenshots': ['native/03-script-failure-late-error.png', 'native/04-deletion-failure-late-error.png'],
    'screenshotsRetained': 16, 'actualApiResponsesFullyIntercepted': True,
    'serverSideDuplicatesEffectsDeletionOrPrincipalClaimed': False,
    'supplementCasesExecuted': 0, 'correctedCandidateAcceptance': False,
    'earlierExecution01': {'path': str(previous_failure), 'exit': 1, 'browserCases': 0, 'cause': 'Import-only package used through CJS resolution; separate pre-browser setup failure'},
    'tempIncidentalBrowserCacheExcludedFromSeal': True, 'noFixtureSourceBrowserOrTestRerun': True,
    'uiqaRebindHelperNotifiedRuntimeClosed': True, 'indexAdvanceAuthorityInferred': False})
print(json.dumps({'expectedCorrectFailures': 4, 'fixtureErrors': 0, 'bodySha256': body_hash,
                  'protectedMapEqual': True, 'freshPositiveDispatches': 2, 'browserCloseResolved': True}))
