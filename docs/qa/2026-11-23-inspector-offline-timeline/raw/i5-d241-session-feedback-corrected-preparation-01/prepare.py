import difflib
import hashlib
import json
from pathlib import Path

directory = Path(__file__).parent
evidence = directory.parent
diagnostic = evidence / 'i5-d241-feedback-render-diagnostic-qa-03'
reviewed = evidence / 'i5-d241-observation-entry-loss-corrected-preparation-02'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(name, data):
    with (directory / name).open('xb') as stream:
        stream.write(data)


def save(name, value):
    write(name, (json.dumps(value, indent=2) + '\n').encode())


assert sha((diagnostic / 'MANIFEST.json').read_bytes()) == '745ff32e330c85d8bdbad1d202c952486404189327c4d7e22cfaa0468e7f2058'
members = json.loads((diagnostic / 'MANIFEST.json').read_text())['members']
for member in members:
    data = (diagnostic / member['path']).read_bytes()
    assert len(data) == member['bytes'] and sha(data) == member['sha256']
fixture = (diagnostic / 'executed.component.55a.tsx').read_bytes()
assert sha(fixture) == '55a0c5a29f8f7dc6de1045d3d4858d790fdca548385237684ec3bbb5c6f31c3a'
binding = json.loads((diagnostic / 'ROOT-BINDING.executed.json').read_text())
save('ACTUAL-D8-REFERENCE.json', {
    'actualHead': binding['source']['head'], 'actualTree': binding['source']['tree'],
    'actualIndexSha256': binding['source']['indexSha256'],
    'diagnosticPacket': str(diagnostic), 'diagnosticManifestSha256': sha((diagnostic / 'MANIFEST.json').read_bytes()),
    'verifiedMembers': len(members), 'fixtureSha256': sha(fixture),
    'actualDiagnosticResult': json.loads((diagnostic / 'DIAGNOSTIC63-SELECTION.json').read_text()),
    'note': 'Historical baseline only; no corrected source result is claimed.'
})
original_runner = (reviewed / 'run-corrected.ps1').read_bytes()
assert sha(original_runner) == 'd2b07274b7ee52f7a0ace866e81af44294b4497dd180e1fe17cb975f01615206'
old_output = b'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d241-observation-entry-loss-corrected-qa-01'
new_output = b'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d241-session-feedback-corrected-qa-01'
assert original_runner.count(old_output) == 1
runner = original_runner.replace(old_output, new_output)
assert runner.replace(new_output, old_output) == original_runner
write('run-corrected.ps1', runner)
write('module-boundary.cjs', (reviewed / 'module-boundary.cjs').read_bytes())
write('runner.delta.diff', ''.join(difflib.unified_diff(original_runner.decode().splitlines(keepends=True),
    runner.decode().splitlines(keepends=True), fromfile='reviewed-d2b072/runner.ps1', tofile='unarmed-session-feedback/runner.ps1')).encode())
for key in ['head', 'tree', 'indexSha256', 'stagedEntriesSha256']:
    binding['source'][key] = None
binding['rootAdmission'] = {'path': None, 'sha256': None}
binding['preparationManifestSha256'] = None
binding['executionAdmitted'] = False
binding['executionDirectory'] = str(evidence / 'i5-d241-session-feedback-corrected-qa-01')
binding['selection'] = {
    'file': 'src/runs/RunInspectorPage.independent-416.qa.test.tsx',
    'fresh2': {'total': 63, 'selected': 2, 'filtered': 61, 'testNamePattern': 'B1 residual: observation replacement after surfaced loss'},
    'full63': {'total': 63, 'selected': 63, 'filtered': 0, 'testNamePattern': None},
    'maxWorkers': 1, 'retry': 0, 'testTimeoutMs': 20000, 'hookTimeoutMs': 20000,
    'existingDefaultWaitForMs': 5000, 'sameExactFixtureForBoth': sha(fixture),
}
binding['rootInstructions'] = 'UNARMED. Await root immutable session-feedback source freeze and rebind. Root supplies future head/tree/index/staged and corrected selected-source hashes, exact admission/preparation-manifest SHA, executionAdmitted=true. Exact55 fixture for fresh2 then conditional full63; strict original immediate assertions retained, no private counter reset. No Git/FF/materialization/build/browser authority.'
save('ROOT-BINDING.template.json', binding)
reporting = {
    'sameFixtureSha256': sha(fixture), 'fixtureEditPrepared': False,
    'fresh2RequiredBeforeFull63': True, 'separateWorkers': True, 'full63NotSubstituteForFresh2': True,
    'readExistingDiagnosticFieldsPerVariantPerPhase': [
        'before-old-choice-release.currentButtonPresent',
        'before-old-choice-release.currentButtonIsOriginal',
        'before-old-choice-release.currentButtonDisabled',
        'before-old-choice-release.originalButtonConnected',
        'before-old-choice-release.originalHeaderConnected',
        'removedOriginalButtonRecords', 'removedOriginalHeaderRecords',
        'feedbackObservation.immediate.text/visible', 'feedbackObservation.settled.text/visible',
        'postCountAtCleanup', 'postBodies'],
    'ownershipEvidence': 'Report the actual captured replacement-button disabled state before old-choice release beside original removal/replacement, oldPOST0, visible NotSent and newPOST1. Do not silently turn this diagnostic field into a new assertion or substitute it for the existing assertions.',
    'originalImmediateCaptureAndStrictAssertionUnchanged': True,
    'rootD8ActualComparison': {'eventReplacementDisabledBeforeOldRelease': False,
        'oldPosts': 0, 'visibleNotSentImmediateAndAfterDefaultWait': False, 'freshPosts': 1},
    'stderrMarker': 'B1_FEEDBACK_DIAGNOSTIC ',
    'limits': 'Public DOM/FakeApi/storage-handler evidence; no React-private state, native second-tab/process/principal proof or healthy/no-loss #562 expansion.',
}
save('REPORTING-PLAN.json', reporting)
print(json.dumps({'unarmed': True, 'runnerSha256': sha(runner), 'sameExactFixture': sha(fixture),
                  'futureHead': None, 'futureIndex': None, 'verifiedDiagnosticMembers': len(members),
                  'newAssertionAdded': False}, indent=2))
