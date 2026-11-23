import difflib
import hashlib
import json
from pathlib import Path

directory = Path(__file__).parent
evidence = directory.parent
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
first = evidence / 'i5-416-420-ui-independent-qa-01/corrected-component-execution-01'
second = evidence / 'i5-416-420-ui-independent-qa-01/corrected-component-execution-02'
old_prep = evidence / 'i5-416-420-corrected-component-execution-preparation-01'
new_prep = evidence / 'i5-416-420-corrected-component-execution-preparation-02'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_text())


def save(name, value):
    with (directory / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def verify_manifest(path):
    value = read(path / 'MANIFEST.json')
    for member in value['members']:
        data = (path / member['path']).read_bytes()
        assert len(data) == member['bytes'] and sha(data) == member['sha256'], member['path']
    return {'path': str(path / 'MANIFEST.json'), 'sha256': sha((path / 'MANIFEST.json').read_bytes()),
            'verifiedMembers': len(value['members'])}


first_seal = verify_manifest(first)
old_seal = verify_manifest(old_prep)
new_seal = verify_manifest(new_prep)
selection = read(second / 'ACTUAL-SELECTION.json')
assert selection == {'actualCases': 61, 'passed': 61, 'failed': 0, 'filteredOrPending': 0,
                     'todo': 0, 'expectedCases': 61, 'patternUsed': False, 'processExit': 0}
phase = read(second / 'PHASE-RECEIPT.json')
assert phase['stageReached'] == 'completed' and phase['failure'] is None and phase['afterMatchesRootBinding']
assert len(phase['commands']) == 7 and all(item['exitCode'] == 0 for item in phase['commands'])
for item in phase['commands']:
    assert sha(Path(item['stdout']).read_bytes()) == item['stdoutSha256']
    assert sha(Path(item['stderr']).read_bytes()) == item['stderrSha256']
before = read(second / 'before.json')
after = read(second / 'after.json')
assert before == after
assert before['head'] == 'd71fbe81a3bff5ea3c9cb672fa470a16c0d4a881'
assert before['tree'] == '57e4fb60972870657bb0ee04ae01d21bcc4fe777'
assert before['indexSha256'] == '7f02b502da1dd6aad9cb753d0aedd0362b94518dfb858c67fcb58cbcc381bea5'
assert before['stagedEntriesSha256'] == '225ba88f0c072e15c84ca6ad353dd432877341567b5f6efb77589bf52b0af39b'
assert not before['commonIndexExists']
module_before = read(second / '02-before-modules.stdout.log')
module_after = read(second / '07-after-modules.stdout.log')
assert module_before['node'] == module_after['node']
assert module_before['selected'] == module_after['selected']
binding = read(directory / 'ROOT-BINDING.admitted.json')
assert module_before['selected'] == binding['selectedModules']
first_result = read(first / '06-full61.json')
second_result = read(second / '06-full61.json')
names = lambda result: [case['fullName'] for suite in result['testResults'] for case in suite['assertionResults']]
assert names(first_result) == names(second_result) and len(names(second_result)) == 61
component = (root / 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx').read_bytes()
assert component == (directory / 'component.corrected.tsx').read_bytes()
assert sha(component) == '00c1cd923039959bf92a20d80e0f1c7791031dd99419700eff957e07a9847975'
assert sha(component[:35518]) == 'd0eb5cabb5f047d745a547b866b52397ebcca31d7f4143e47e05ac185609f8fe'
with (second / 'executed.component.tsx').open('xb') as stream:
    stream.write(component)
old_runner = (old_prep / 'run-corrected-component.ps1').read_bytes()
new_runner = (new_prep / 'run-corrected-component.ps1').read_bytes()
old_token = b"$taskEvidence = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-420-ui-independent-qa-01/corrected-component-execution-01'"
new_token = old_token.replace(b'execution-01', b'execution-02')
assert old_runner.replace(old_token, new_token) == new_runner
with (directory / 'runner.diff').open('x', encoding='utf-8', newline='\n') as stream:
    stream.write(''.join(difflib.unified_diff(old_runner.decode().splitlines(keepends=True),
        new_runner.decode().splitlines(keepends=True), fromfile='sealed-prep01/runner.ps1', tofile='prep02/runner.ps1')))
old_binding = read(first / 'ROOT-BINDING.executed.json')
new_binding = read(second / 'ROOT-BINDING.executed.json')
changed = []


def diff_values(left, right, path=''):
    if isinstance(left, dict) and isinstance(right, dict):
        assert set(left) == set(right)
        for key in left:
            diff_values(left[key], right[key], path + '/' + key)
    elif left != right:
        changed.append({'path': path, 'before': left, 'after': right})


diff_values(old_binding, new_binding)
assert {item['path'] for item in changed} == {
    '/executionDirectory', '/overlays/apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx',
    '/rootAdmission/path', '/rootAdmission/sha256', '/preparationManifestSha256'}
for path, expected in after['overlays'].items():
    assert sha((root / path).read_bytes()) == expected
save('CLOSURE.json', {
    'actualSelection': selection, 'allSevenCommandsExit0': True, 'beforeAfterPinsEqual': True,
    'selectedModuleNodeAndEntriesEqual': True, 'all61CaseNamesAndOrderUnchanged': True,
    'root19Cohort': len(after['rootInstallInputs19']), 'independent18Cohort': len(after['independentInputs18']),
    'metadataFiles': len(after['metadata']), 'overlayFiles': len(after['overlays']),
    'original49PrefixUnchanged': True, 'sourceHead': after['head'], 'sourceTree': after['tree'],
    'indexSha256': after['indexSha256'], 'stagedEntriesSha256': after['stagedEntriesSha256'],
    'commonIndexAbsent': True, 'trackedAndStagedDiffExit': after['trackedAndStagedDiffExit'],
    'firstPhaseSeal': first_seal, 'oldPreparationSeal': old_seal, 'newPreparationSeal': new_seal,
    'bindingOnlyChanges': changed, 'runtimeRunnerOnlyDirectoryLiteralChanged': True,
    'testStderrBytes': (second / '06-full61.stderr.log').stat().st_size,
    'typecheckStderrVerbatim': (second / '03-web-typecheck.stderr.log').read_text(),
    'wrapperObservedSession': 21857, 'wrapperObservedExit': 0,
    'heavySlotReleased': 'Explicit direct message to root and i5_next_helper_independent_sol after command/closure termination.',
    'scope': 'Public component/FakeApi regression QA at d71fbe; no native/browser/provider/runtime acceptance, no general review scan.'
})
print(json.dumps({'actualSelection': selection, 'sourceAndModulesStable': True,
                  'firstPhaseSeal': first_seal, 'newPreparationSeal': new_seal,
                  'bindingChanges': [item['path'] for item in changed]}, indent=2))
