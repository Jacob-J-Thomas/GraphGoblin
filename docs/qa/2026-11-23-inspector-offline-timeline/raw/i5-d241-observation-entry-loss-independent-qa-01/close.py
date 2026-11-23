import hashlib
import json
from pathlib import Path

directory = Path(__file__).parent
old = directory / 'old'
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_text())


def save(name, value):
    with (directory / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


selection = read(old / 'ACTUAL-SELECTION.json')
assert selection == {'actualCases': 63, 'passed': 0, 'failed': 2, 'filteredOrPending': 61,
                     'todo': 0, 'expectedCases': 63, 'expectedSelected': 2, 'expectedFiltered': 61,
                     'patternUsed': True, 'processExit': 1}
phase = read(old / 'PHASE-RECEIPT.json')
assert phase['stageReached'] == 'replacement2' and phase['afterMatchesRootBinding']
assert len(phase['commands']) == 7
assert [item['exitCode'] for item in phase['commands']] == [0, 0, 0, 0, 0, 1, 0]
for item in phase['commands']:
    assert sha(Path(item['stdout']).read_bytes()) == item['stdoutSha256']
    assert sha(Path(item['stderr']).read_bytes()) == item['stderrSha256']
before = read(old / 'before.json')
after = read(old / 'after.json')
assert before == after
assert before['head'] == '2231400e7986f349376d7c19ebd62ae71f7708a4'
assert before['tree'] == 'c20cdcad4bf3c91fcd7b84c81284c491479f7ed9'
assert before['indexSha256'] == '900e6314981cb0c7b04e6921e024f0db554d200f5d2e39c64f8a213656e8cddd'
assert not before['commonIndexExists']
module_before = read(old / '02-before-modules.stdout.log')
module_after = read(old / '07-after-modules.stdout.log')
assert module_before['node'] == module_after['node'] and module_before['selected'] == module_after['selected']
binding = read(directory / 'ROOT-BINDING.admitted.json')
assert module_before['selected'] == binding['selectedModules']
result = read(old / '06-replacement2.json')
cases = [case for suite in result['testResults'] for case in suite['assertionResults']]
active = [case for case in cases if case['status'] in ['passed', 'failed']]
assert len(cases) == 63 and len(active) == 2
expected_variants = ['public remove/recreate control', 'accepted cross-tab storage event']
reached = []
for case, variant in zip(active, expected_variants, strict=True):
    assert case['status'] == 'failed' and variant in case['title']
    messages = '\n'.join(case['failureMessages'])
    assert 'expected 1 to be +0' in messages
    assert "text: '', visible: false" in messages
    assert 'expected null to match object' in messages
    assert len(case['failureMessages']) == 3, len(case['failureMessages'])
    reached.append({
        'variant': variant, 'title': case['fullName'], 'caseStatus': 'failed',
        'failureMessages': case['failureMessages'],
        'allPreconditionsAndFreshPositiveReached': True,
        'oldPostCount': 1, 'freshPositivePostIncrement': 1, 'totalPostsAfterFreshChoice': 2,
        'freshBody': {'nodeId': 'worker', 'failureSeq': 3},
        'capturedOldError': None, 'capturedNotSentText': '', 'capturedNotSentVisible': False,
        'observationLossSurfacedBeforeReplacement': True, 'genuineEqualRecoveryRead': True,
        'sameParentQueryAndSuccessfulRunSamples': True, 'onlineAndReplayAvailable': True,
        'specificReplacementWitness': (
            'Public removed event, distinct replacement Query, same credential generation; same-tree rerender.'
            if variant.startswith('public') else
            'Mounted actual ApiKeyPanel storage listener, accepted syntheticB generation, actual observation and run GETs carryingB; no direct saveB/invalidation.'),
        'evidenceQualification': 'Counts/body/preconditions are established by the exact executed public-call-log assertions before the final three failures. The fixture did not export a separate per-call HTTP trace; the raw JSON preserves all failing observed values.'
    })
component = (root / 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx').read_bytes()
assert component == (directory / 'executed.component.tsx').read_bytes()
assert sha(component) == '8a344821db18ec25fa7cf2219c07721acf4eddae0d109b8eb3a412ca58aa6c2b'
base = (directory / 'base61.component.tsx').read_bytes()
assert component[:len(base)] == base and len(base) == 60996
assert sha(base) == '00c1cd923039959bf92a20d80e0f1c7791031dd99419700eff957e07a9847975'
assert sha(component[:35518]) == 'd0eb5cabb5f047d745a547b866b52397ebcca31d7f4143e47e05ac185609f8fe'
for path, expected in after['overlays'].items():
    assert sha((root / path).read_bytes()) == expected
preserved = []
for packet in [directory.parent / 'i5-d241-observation-entry-loss-preparation-01',
               directory.parent / 'i5-d241-observation-entry-loss-preparation-02', directory / 'mechanics']:
    members = read(packet / 'MANIFEST.json')['members']
    for item in members:
        data = (packet / item['path']).read_bytes()
        assert len(data) == item['bytes'] and sha(data) == item['sha256']
    preserved.append({'path': str(packet), 'members': len(members),
                      'manifestSha256': sha((packet / 'MANIFEST.json').read_bytes())})
save('CLOSURE-AND-REACHED.json', {
    'actualSelection': selection, 'reached': reached,
    'allStaticCommandsExit0': True, 'beforeAfterPinsEqual': True, 'moduleNodeAndEntriesEqual': True,
    'sourceHead': after['head'], 'sourceTree': after['tree'], 'rawIndexSha256': after['indexSha256'],
    'stagedEntriesSha256': after['stagedEntriesSha256'], 'commonIndexAbsent': True,
    'rootInstallCohort': len(after['rootInstallInputs19']), 'independentCohort': len(after['independentInputs18']),
    'metadataFiles': len(after['metadata']), 'overlays': after['overlays'],
    'base61LiteralPrefixUnchanged': True, 'original49PrefixUnchanged': True, 'preservedPreparations': preserved,
    'wrapperObservedSession': 28875, 'wrapperObservedExit': 1,
    'heavySlotReleased': 'Direct messages to root and helper after terminal behavior and read-only closure.',
    'behavioralInvocationCount': 1, 'noFixtureCorrectionOrRetry': True,
    'scope': 'Public component/FakeApi loss-and-replacement reproduction, including actual application handler under controlled StorageEvent; no native browser/server principal claim.'
})
print(json.dumps({'selection': selection, 'reachedVariants': [item['variant'] for item in reached],
                  'bothOldPosts': [item['oldPostCount'] for item in reached],
                  'bothFreshIncrements': [item['freshPositivePostIncrement'] for item in reached],
                  'sourceAndModulesStable': True}, indent=2))
