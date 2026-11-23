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


selection = read('DIAGNOSTIC63-SELECTION.json')
assert selection == {'actualCases': 63, 'passed': 62, 'failed': 1, 'filteredOrPending': 0, 'todo': 0,
                     'expectedCases': 63, 'expectedSelected': 63, 'expectedFiltered': 0, 'patternUsed': False, 'processExit': 1}
phase = read('PHASE-RECEIPT.json')
assert phase['afterMatchesRootBinding'] and phase['stageReached'] == 'diagnostic63'
assert [item['exitCode'] for item in phase['commands']] == [0, 0, 0, 0, 0, 1, 0]
for item in phase['commands']:
    assert sha(Path(item['stdout']).read_bytes()) == item['stdoutSha256']
    assert sha(Path(item['stderr']).read_bytes()) == item['stderrSha256']
before, after = read('before.json'), read('after.json')
assert before == after and before['head'] == 'd8bc84937363bbde1d24b561efdcd9e8601a48a7'
assert before['tree'] == 'e94fb9c910696baddd7278992ed716af4ca747d0'
assert before['indexSha256'] == 'e7886ea3bde09994b9940a53b9436d421a4d17ddbb6ffba729dcd18aef98978e'
assert not before['commonIndexExists']
module_before, module_after = read('02-before-modules.stdout.log'), read('07-after-modules.stdout.log')
assert module_before['node'] == module_after['node'] and module_before['selected'] == module_after['selected']
result = read('06-diagnostic63.json')
cases = [case for suite in result['testResults'] for case in suite['assertionResults']]
failed = [case for case in cases if case['status'] == 'failed']
assert len(cases) == 63 and len(failed) == 1 and len(failed[0]['failureMessages']) == 1
assert 'accepted cross-tab storage event' in failed[0]['title']
assert "text: '', visible: false" in failed[0]['failureMessages'][0]
raw_records = read('DOM-DIAGNOSTICS.raw.json')
summary = read('DOM-DIAGNOSTICS.summary.json')
control, event = summary
assert control['replacement'] == 'public remove/recreate control'
assert control['immediateVisible'] and control['settledVisible'] and control['postCountAtCleanup'] == 1
assert event['replacement'] == 'accepted cross-tab storage event'
assert event['immediateText'] == '' and not event['immediateVisible']
assert event['settledText'] == '' and not event['settledVisible']
assert event['existingDefaultWaitForMs'] == 5000 and event['waitObservedMs'] >= 5000
assert event['removedOriginalButtonRecords'] == 1 and event['removedOriginalHeaderRecords'] == 1
assert event['postCountAtCleanup'] == 1 and event['postBodies'] == [{'nodeId': 'worker', 'failureSeq': 3}]
samples = {item['stage']: item for item in event['stagedSamples']}
assert samples['before-key-rotation']['originalButtonConnected'] and samples['before-key-rotation']['originalHeaderConnected']
assert not samples['after-storage-event']['originalButtonConnected'] and not samples['after-storage-event']['originalHeaderConnected']
assert not samples['after-storage-event']['currentButtonPresent'] and not samples['after-storage-event']['runHeadingPresent']
assert samples['before-old-choice-release']['currentButtonPresent'] and not samples['before-old-choice-release']['currentButtonIsOriginal']
assert not event['domSamplesLimitFlag'] and not control['domSamplesLimitFlag']
component_path = 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'
actual = (root / component_path).read_bytes()
assert sha(actual) == '55a0c5a29f8f7dc6de1045d3d4858d790fdca548385237684ec3bbb5c6f31c3a'
with (directory / 'executed.component.55a.tsx').open('xb') as stream:
    stream.write(actual)
original_packet = evidence / 'i5-d241-observation-entry-loss-corrected-qa-01'
original = (original_packet / 'executed.component.tsx').read_bytes()
assert sha(original) == '8a344821db18ec25fa7cf2219c07721acf4eddae0d109b8eb3a412ca58aa6c2b'
with (directory / 'original.component.8a.tsx').open('xb') as stream:
    stream.write(original)
assert actual[:60996] == original[:60996]
assert sha(actual[:60996]) == '00c1cd923039959bf92a20d80e0f1c7791031dd99419700eff957e07a9847975'
assert sha(actual[:35518]) == 'd0eb5cabb5f047d745a547b866b52397ebcca31d7f4143e47e05ac185609f8fe'
for path, expected in after['overlays'].items():
    assert sha((root / path).read_bytes()) == expected
preserved = []
for packet in [original_packet, evidence / 'i5-d241-feedback-render-diagnostic-qa-01',
               evidence / 'i5-d241-feedback-render-diagnostic-qa-02',
               evidence / 'i5-d241-feedback-render-diagnostic-preparation-01',
               evidence / 'i5-d241-feedback-render-diagnostic-preparation-02',
               evidence / 'i5-d241-feedback-render-diagnostic-preparation-03']:
    manifest = json.loads((packet / 'MANIFEST.json').read_text())
    for item in manifest['members']:
        data = (packet / item['path']).read_bytes()
        assert len(data) == item['bytes'] and sha(data) == item['sha256']
    preserved.append({'packet': str(packet), 'verifiedMembers': len(manifest['members']), 'manifestSha256': sha((packet / 'MANIFEST.json').read_bytes())})
save('CLOSURE.json', {
    'selection': selection, 'actualDiagnosticBehaviorInvocations': 1, 'earlierTwoAttemptsBehaviorInvocations': 0,
    'onlyFailedCaseVerbatim': failed[0], 'rootDisposition': 'Genuine same-run session-action feedback ownership loss on run-section remount; not test render lag; no fixture relaxation.',
    'directDomFacts': {'buttonRemovedRecords': 1, 'headerRemovedRecords': 1, 'replacementBeforeOldChoiceRelease': True,
        'immediateAndSettledFeedbackAbsent': True, 'configuredWaitMs': 5000, 'observedWaitMs': event['waitObservedMs'],
        'oldPosts': 0, 'freshPosts': 1, 'freshBody': {'nodeId': 'worker', 'failureSeq': 3}},
    'causalLimits': 'Actual DOM removal/replacement and no feedback during this configured5s window; no React-private hook/state inspection, forever-absence claim, real browser/principal or healthy/no-loss #562 test.',
    'controlSameOriginalDomNodesAtRecordedStages': True, 'controlObserverNotInstalled': True,
    'sourceIndexCohortsOverlaysBeforeAfterEqual': True, 'selectedNodeModulesEqual': True,
    'root19Count': len(after['rootInstallInputs19']), 'independent18Count': len(after['independentInputs18']),
    'metadataCount': len(after['metadata']), 'currentFiveOverlayPins': after['overlays'],
    'sourceHead': after['head'], 'sourceTree': after['tree'], 'rawIndexSha256': after['indexSha256'],
    'stagedEntriesSha256': after['stagedEntriesSha256'], 'commonIndexAbsent': True,
    'literal61And49PrefixesPreserved': True, 'preservedSeals': preserved,
    'wrapperSession': 47193, 'wrapperObservedExit': 1, 'heavySlotReleasedAndHelperBuildHeld': True,
    'noRetryOrFixtureRelaxation': True, 'furtherExecutionAdmitted': False,
})
print(json.dumps({'selection': selection, 'waitMs': event['waitObservedMs'], 'buttonAndHeaderRemoved': True,
                  'replacementBeforeOldRelease': True, 'feedbackStillAbsent': True, 'postCount': event['postCountAtCleanup'],
                  'sourceModulesAndOverlaysStable': True}, indent=2))
