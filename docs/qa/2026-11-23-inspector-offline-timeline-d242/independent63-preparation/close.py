import hashlib
import json
from pathlib import Path

directory = Path(__file__).resolve().parent.parent / 'i5-d242-b2-independent63-execution-01'
evidence = directory.parent
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(name):
    return json.loads((directory / name).read_text(encoding='utf-8-sig'))


def save(name, value):
    with (directory / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


prep = Path(__file__).resolve().parent
certificate = json.loads((prep / 'ROOT-CLOSURE.json').read_bytes())
def verify_ref(ref):
    path = Path(ref['source'])
    data = path.read_bytes()
    assert len(data) == ref['bytes'] and sha(data) == ref['sha256']
    return path

assert certificate['wrapperObservedExit'] == 0 and certificate['heavySlotReleased'] is True
assert type(certificate['wrapperSession']) is int and certificate['wrapperSession'] > 0
rebind_dir = evidence / 'i5-d242-b2-independent63-rebind-01'
rebind_path = verify_ref(certificate['rebind'])
binding_path = verify_ref(certificate['admittedBinding'])
assert rebind_path == rebind_dir / 'REBIND.json' and binding_path == rebind_dir / 'ROOT-BINDING.admitted.json'
rebind = json.loads(rebind_path.read_bytes())
binding = json.loads(binding_path.read_bytes())
assert binding['executionAdmitted'] is True and read('ROOT-BINDING.executed.json') == binding
assert rebind['legacyDistributionPreserved'] and rebind['allFiveOverlaysUnchanged']
legacy = json.loads((rebind_dir / 'after.json').read_bytes())['distributions']
for inventory in legacy.values():
    base = Path(inventory['directory'])
    assert {p.relative_to(base).as_posix() for p in base.rglob('*') if p.is_file()} == set(inventory['files'])
    for name, expected in inventory['files'].items():
        verify_ref({'source':str(base / name), **expected})

fresh, full = read('FRESH2-SELECTION.json'), read('FULL63-SELECTION.json')
assert fresh == {'actualCases': 63, 'passed': 2, 'failed': 0, 'filteredOrPending': 61, 'todo': 0,
                 'expectedCases': 63, 'expectedSelected': 2, 'expectedFiltered': 61, 'patternUsed': True, 'processExit': 0}
assert full == {'actualCases': 63, 'passed': 63, 'failed': 0, 'filteredOrPending': 0, 'todo': 0,
                'expectedCases': 63, 'expectedSelected': 63, 'expectedFiltered': 0, 'patternUsed': False, 'processExit': 0}
phase = read('PHASE-RECEIPT.json')
assert phase['stageReached'] == 'completed' and phase['failure'] is None and phase['afterMatchesRootBinding']
assert phase['rootBindingSha256'] == certificate['admittedBinding']['sha256']
assert len(phase['commands']) == 8 and all(item['exitCode'] == 0 for item in phase['commands'])
for item in phase['commands']:
    assert item['shell'] is False
    assert sha(Path(item['stdout']).read_bytes()) == item['stdoutSha256']
    assert sha(Path(item['stderr']).read_bytes()) == item['stderrSha256']
    assert item['childEnvironmentControl'] == {'GG_OLLAMA_ENABLED': 'false', 'LIVE': 'absent'}
before, after = read('before.json'), read('after.json')
assert before == after and all(after[k] == v for k, v in binding['source'].items())
assert after['head'] == rebind['source']['head'] and after['tree'] == rebind['source']['tree']
assert after['indexSha256'] == rebind['afterIndex']['sha256'] == rebind['rawIndexAfter']['sha256']
assert after['stagedEntriesSha256'] == rebind['stagedEntriesSha256']
assert verify_ref(rebind['rawIndexBefore']).is_file() and verify_ref(rebind['rawIndexAfter']).is_file()
assert verify_ref(rebind['afterIndex']).is_file()
assert not after['commonIndexExists']
module_before, module_after = read('02-before-modules.stdout.log'), read('08-after-modules.stdout.log')
assert module_before['node'] == module_after['node'] and module_before['selected'] == module_after['selected']
old_packet = evidence / 'i5-d241-feedback-render-diagnostic-qa-03'
old_result = json.loads((old_packet / '06-diagnostic63.json').read_text(encoding='utf-8-sig'))


def cases(result):
    return [case for suite in result['testResults'] for case in suite['assertionResults']]


old_cases = cases(old_result)
fresh_cases, full_cases = cases(read('06-fresh2.json')), cases(read('07-full63.json'))
assert len(old_cases) == len(fresh_cases) == len(full_cases) == 63
assert [case['fullName'] for case in old_cases] == [case['fullName'] for case in fresh_cases] == [case['fullName'] for case in full_cases]
assert all(case['status'] == 'passed' for case in full_cases)
assert len([case for case in fresh_cases if case['status'] == 'passed']) == 2
summary = read('DOM-DIAGNOSTICS.summary.json')
assert len(summary) == 4
expected_text = 'Not sent: this view lost its connection to the run. Read the run again before retrying.'
for record in summary:
    assert record['immediateVisible'] and record['settledVisible']
    assert record['immediateText'] == record['settledText'] == expected_text
    assert record['defaultWaitForMs'] == 5000 and not record['sampleLimitFlag']
    assert record['postCountAtCleanup'] == 1 and record['postBodies'] == [{'nodeId': 'worker', 'failureSeq': 3}]
event = next(item for item in summary if item['phase'] == 'full63' and item['replacement'] == 'accepted cross-tab storage event')
assert event['removedOriginalButtonRecords'] == event['removedOriginalHeaderRecords'] == 1
assert event['beforeKeyRotation']['originalButtonConnected'] and event['beforeKeyRotation']['originalHeaderConnected']
assert not event['afterStorageEvent']['originalButtonConnected'] and not event['afterStorageEvent']['originalHeaderConnected']
assert not event['afterStorageEvent']['currentButtonPresent'] and not event['afterStorageEvent']['runHeadingPresent']
assert event['beforeOldChoiceRelease']['currentButtonPresent'] and not event['beforeOldChoiceRelease']['currentButtonIsOriginal']
component = root / 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'
actual = component.read_bytes()
assert sha(actual) == '55a0c5a29f8f7dc6de1045d3d4858d790fdca548385237684ec3bbb5c6f31c3a'
assert actual == (old_packet / 'executed.component.55a.tsx').read_bytes()
assert sha(actual[:60996]) == '00c1cd923039959bf92a20d80e0f1c7791031dd99419700eff957e07a9847975'
assert sha(actual[:35518]) == 'd0eb5cabb5f047d745a547b866b52397ebcca31d7f4143e47e05ac185609f8fe'
executed_copy = directory / 'executed.component.55a.tsx'
if executed_copy.exists():
    assert executed_copy.read_bytes() == actual
else:
    with executed_copy.open('xb') as stream:
        stream.write(actual)
for cohort in ['selectedSources', 'rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays']:
    for path, expected in after[cohort].items():
        data = (root / path).read_bytes()
        if isinstance(expected, dict):
            assert len(data) == expected['bytes'] and sha(data) == expected['sha256']
        else:
            assert sha(data) == expected
preserved = []
for name in ['i5-d241-feedback-render-diagnostic-qa-03', 'i5-d241-feedback-render-diagnostic-qa-01',
             'i5-d241-feedback-render-diagnostic-qa-02', 'i5-d241-observation-entry-loss-corrected-qa-01',
             'i5-d241-session-feedback-corrected-preparation-01', 'i5-d241-session-feedback-qa-rebind-01']:
    packet = evidence / name
    manifest = json.loads((packet / 'MANIFEST.json').read_text(encoding='utf-8-sig'))
    for item in manifest['members']:
        data = (packet / item['path']).read_bytes()
        assert len(data) == item['bytes'] and sha(data) == item['sha256']
    preserved.append({'packet': str(packet), 'verifiedMembers': len(manifest['members']),
                      'manifestSha256': sha((packet / 'MANIFEST.json').read_bytes())})
save('CLOSURE.json', {
    'freshSelection': fresh, 'fullSelection': full,
    'wrapperSession': certificate['wrapperSession'], 'wrapperObservedExit': 0, 'actualBehaviorInvocations': 2,
    'freshAndFullSeparateWorkers': True, 'allEightCommandsExit0': True,
    'sourceHead': after['head'], 'sourceTree': after['tree'], 'rawIndexSha256': after['indexSha256'],
    'stagedEntriesSha256': after['stagedEntriesSha256'], 'commonIndexAbsent': True,
    'sourceIndexCohortsOverlaysBeforeAfterEqual': True, 'selectedNodeModulesEqual': True,
    'root19Count': len(after['rootInstallInputs19']), 'independent18Count': len(after['independentInputs18']),
    'metadataCount': len(after['metadata']), 'selectedSourceCount': len(after['selectedSources']),
    'currentFiveOverlayPins': after['overlays'], 'literal61And49PrefixesAndAll63NamesPreserved': True,
    'strictOldChoicePost0ErrorNotSentAndImmediateVisibleFeedbackAssertionsPassed': True,
    'freshChoiceExactlyOnePostBody': {'nodeId': 'worker', 'failureSeq': 3},
    'capturedPendingDisabledBeforeOldRelease': [
        {'phase': item['phase'], 'replacement': item['replacement'],
         'currentButtonDisabled': item['beforeOldChoiceRelease']['currentButtonDisabled']}
        for item in summary],
    'pendingDisabledQualification': 'Read-only captured observation from unchanged diagnostic fixture; no new disabled-state assertion added to the product test.',
    'full63StorageEventDom': {'originalButtonRemovedRecords': 1, 'originalHeaderRemovedRecords': 1,
        'replacementButtonIsDifferent': True,
        'replacementButtonDisabledBeforeOldRelease': event['beforeOldChoiceRelease']['currentButtonDisabled'],
        'immediateFeedbackVisible': True, 'settledFeedbackVisible': True,
        'waitObservedMs': event['waitObservedMs'], 'existingDefaultWaitForMs': 5000},
    'preservedSeals': preserved, 'heavySlotReleased': True, 'bothPriorWebDistributionsRehashed': True,
    'noRetryFixtureTimingProductOrGitEdits': True,
    'scope': 'Controlled public component/FakeApi application StorageEvent and QueryClient controls; not native browser/second-tab/server-principal, full UI acceptance, #562 healthy/no-loss consent, or universal absence of network activity.',
})
print(json.dumps({'freshPassed': fresh['passed'], 'freshFiltered': fresh['filteredOrPending'],
                  'fullPassed': full['passed'], 'sourceStable': True,
                  'capturedReplacementDisabled': event['beforeOldChoiceRelease']['currentButtonDisabled'],
                  'preservedSeals': len(preserved)}, indent=2))
