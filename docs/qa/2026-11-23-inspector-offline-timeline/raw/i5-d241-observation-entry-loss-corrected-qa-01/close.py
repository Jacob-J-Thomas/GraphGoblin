import hashlib
import json
from pathlib import Path

directory = Path(__file__).parent
evidence = directory.parent
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(name):
    return json.loads((directory / name).read_text())


def save(name, value):
    with (directory / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def cases(result):
    return [case for suite in result['testResults'] for case in suite['assertionResults']]


fresh_selection = read('FRESH2-SELECTION.json')
full_selection = read('FULL63-SELECTION.json')
assert fresh_selection == {'actualCases': 63, 'passed': 2, 'failed': 0, 'filteredOrPending': 61, 'todo': 0,
                          'expectedCases': 63, 'expectedSelected': 2, 'expectedFiltered': 61, 'patternUsed': True, 'processExit': 0}
assert full_selection == {'actualCases': 63, 'passed': 62, 'failed': 1, 'filteredOrPending': 0, 'todo': 0,
                         'expectedCases': 63, 'expectedSelected': 63, 'expectedFiltered': 0, 'patternUsed': False, 'processExit': 1}
phase = read('PHASE-RECEIPT.json')
assert phase['stageReached'] == 'full63' and phase['afterMatchesRootBinding']
assert [item['exitCode'] for item in phase['commands']] == [0, 0, 0, 0, 0, 0, 1, 0]
for command in phase['commands']:
    assert sha(Path(command['stdout']).read_bytes()) == command['stdoutSha256']
    assert sha(Path(command['stderr']).read_bytes()) == command['stderrSha256']
before, after = read('before.json'), read('after.json')
assert before == after
assert before['head'] == 'd8bc84937363bbde1d24b561efdcd9e8601a48a7'
assert before['tree'] == 'e94fb9c910696baddd7278992ed716af4ca747d0'
assert before['indexSha256'] == 'e7886ea3bde09994b9940a53b9436d421a4d17ddbb6ffba729dcd18aef98978e'
assert before['stagedEntriesSha256'] == '8273f0659ebdd0ebf4f30338655faee55e28c3ae22de817332edafa389c92a50'
assert not before['commonIndexExists']
modules_before, modules_after = read('02-before-modules.stdout.log'), read('08-after-modules.stdout.log')
assert modules_before['node'] == modules_after['node'] and modules_before['selected'] == modules_after['selected']
binding = read('ROOT-BINDING.executed.json')
assert modules_before['selected'] == binding['selectedModules']
fresh, full = cases(read('06-fresh2.json')), cases(read('07-full63.json'))
old_packet = evidence / 'i5-d241-observation-entry-loss-independent-qa-01'
old_cases = cases(json.loads((old_packet / 'old/06-replacement2.json').read_text()))
assert [case['fullName'] for case in fresh] == [case['fullName'] for case in full] == [case['fullName'] for case in old_cases]
active_fresh = [case for case in fresh if case['status'] in ['passed', 'failed']]
assert len(active_fresh) == 2 and all(case['status'] == 'passed' for case in active_fresh)
failed = [case for case in full if case['status'] == 'failed']
assert len(failed) == 1 and 'accepted cross-tab storage event' in failed[0]['title']
assert len(failed[0]['failureMessages']) == 1
assert "text: '', visible: false" in failed[0]['failureMessages'][0]
assert all(case['status'] == 'passed' for case in full[:61])
component_path = 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'
component = (root / component_path).read_bytes()
assert sha(component) == '8a344821db18ec25fa7cf2219c07721acf4eddae0d109b8eb3a412ca58aa6c2b'
assert component == (old_packet / 'executed.component.tsx').read_bytes()
assert sha(component[:60996]) == '00c1cd923039959bf92a20d80e0f1c7791031dd99419700eff957e07a9847975'
assert sha(component[:35518]) == 'd0eb5cabb5f047d745a547b866b52397ebcca31d7f4143e47e05ac185609f8fe'
with (directory / 'executed.component.tsx').open('xb') as stream:
    stream.write(component)
assert before['overlays']['apps/web/e2e/independent-416-listener.qa.spec.ts'] == '6ed24b1b26ba63b1ab245100e3a4a01c078b8baa4b069d336bb4c3716ceacca5'
for path, expected in after['overlays'].items():
    assert sha((root / path).read_bytes()) == expected
preserved = []
for packet in [old_packet, evidence / 'i5-d241-observation-entry-loss-corrected-preparation-01',
               evidence / 'i5-d241-observation-entry-loss-corrected-preparation-02',
               evidence / 'i5-d241-residual-corrected-qa-rebind-01']:
    manifest = json.loads((packet / 'MANIFEST.json').read_text())
    for item in manifest['members']:
        data = (packet / item['path']).read_bytes()
        assert len(data) == item['bytes'] and sha(data) == item['sha256']
    preserved.append({'packet': str(packet), 'verifiedMembers': len(manifest['members']),
                      'manifestSha256': sha((packet / 'MANIFEST.json').read_bytes())})
save('CLOSURE.json', {
    'fresh2': fresh_selection, 'full63': full_selection, 'phaseExit': 1,
    'fresh2Cases': [{'name': case['fullName'], 'status': case['status'],
                    'reachedOldPosts': 0, 'newFreshPostIncrement': 1, 'oldErrorNotSent': True,
                    'capturedVisibleNotSent': True, 'freshFailureSeq': 3} for case in active_fresh],
    'full63FailedCaseVerbatim': failed[0],
    'full63FailedCaseReach': {'allPreconditionsAndFreshPositiveReached': True,
        'oldPostCount': 0, 'newFreshPostIncrement': 1, 'freshFailureSeq': 3, 'oldErrorNotSent': True,
        'capturedNotSentText': '', 'capturedNotSentVisible': False,
        'onlyFailure': 'Captured pre-positive feedback visibility/text; no wrong POST or old mutation error mismatch.',
        'visibilityQualification': 'One snapshot taken after old mutation settled and button enabled. No separate bounded wait for feedback was in this exact fixture; eventual visibility versus permanent loss is not distinguished.'},
    'original61AllPassedInFull63': True, 'all63NamesAndOrderUnchanged': True,
    'allStaticCommandsExit0': True, 'beforeAfterSourceIndexCohortsOverlaysEqual': True,
    'selectedNodeModuleEntriesEqual': True, 'commonIndexAbsent': True,
    'root19InputCount': len(after['rootInstallInputs19']), 'independent18InputCount': len(after['independentInputs18']),
    'metadataCount': len(after['metadata']), 'overlayPins': after['overlays'],
    'executedHead': after['head'], 'executedTree': after['tree'], 'rawIndexSha256': after['indexSha256'],
    'stagedEntriesSha256': after['stagedEntriesSha256'], 'original61And49PrefixesUnchanged': True,
    'preservedSeals': preserved, 'wrapperObservedSession': 4322, 'wrapperObservedExit': 1,
    'actualBehaviorInvocations': 2, 'fresh2AndFull63SeparateWorkers': True,
    'noFixtureAssertionTimingOrSourceAdjustment': True, 'noRetry': True,
    'heavySlotReleased': 'Direct root/helper messages after terminal readback.',
    'scope': 'Controlled public component/FakeApi evidence; no native browser, second tab process, provider, real principal or global network-absence claim.'
})
print(json.dumps({'fresh2': fresh_selection, 'full63': full_selection,
                  'onlyFullFailure': failed[0]['fullName'], 'sourceModulesAndOverlaysStable': True}, indent=2))
