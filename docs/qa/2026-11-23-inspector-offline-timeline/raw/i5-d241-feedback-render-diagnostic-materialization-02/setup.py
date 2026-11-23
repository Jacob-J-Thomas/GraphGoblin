import difflib
import hashlib
import json
import os
from pathlib import Path
import subprocess

directory = Path(__file__).parent
evidence = directory.parent
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
first = evidence / 'i5-d241-feedback-render-diagnostic-qa-01'
prep1 = evidence / 'i5-d241-feedback-render-diagnostic-preparation-01'
prep2 = evidence / 'i5-d241-feedback-render-diagnostic-preparation-02'
component = 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def write(path, data):
    with path.open('xb') as stream:
        stream.write(data)


def verify(path, digest):
    assert sha((path / 'MANIFEST.json').read_bytes()) == digest
    members = json.loads((path / 'MANIFEST.json').read_text())['members']
    for member in members:
        data = (path / member['path']).read_bytes()
        assert len(data) == member['bytes'] and sha(data) == member['sha256']
    return len(members)


def git(*args):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(root), *args],
        env=dict(os.environ, GIT_OPTIONAL_LOCKS='0'))


first_count = verify(first, 'b41b593b1bb2287cea16ac6f05ba33748e0dce97e06ff1b6ab16cc1ced1ac164')
prep_count = verify(prep1, '108d3abf0bbb206f86bdefe0b9a0111d039e75785b78843315ca8e78d4f65c1e')
binding = json.loads((prep1 / 'ROOT-BINDING.admitted.json').read_text())
assert sha((prep1 / 'ROOT-BINDING.admitted.json').read_bytes()) == '617afdf27271f1331f0a460920297602b1ad9efa74f4751f9c89bfc562726780'
for field, command in [('head', ['rev-parse', 'HEAD']), ('tree', ['rev-parse', 'HEAD^{tree}'])]:
    assert git(*command).decode().strip() == binding['source'][field]
index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
assert sha(index.read_bytes()) == binding['source']['indexSha256']
assert sha(git('ls-files', '--stage', '-z')) == binding['source']['stagedEntriesSha256']
assert not (common / 'index').exists()
for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays', 'selectedSources']:
    values = binding['source'][group] if group == 'selectedSources' else binding[group]
    for path, expected in values.items():
        data = (root / path).read_bytes()
        assert (sha(data) == expected if isinstance(expected, str) else {'bytes': len(data), 'sha256': sha(data)} == expected), path
before = (root / component).read_bytes()
assert sha(before) == 'b2a6c41a7e0aa9936619cc2d5156ff7bea5d4b54f25eca3902212da445bcb950'
old = b'immediate?: { text: string; visible: boolean; diagnostic?: string };'
new = b'immediate?: { text: string; visible: boolean; diagnostic: string | undefined };'
assert before.count(old) == 1
corrected = before.replace(old, new)
assert sha(corrected) == 'ed2577e25352efeacf962b77b05c39778cb906b5ac3875905c988cb8a575089c' and len(corrected) == 76934
assert corrected.replace(new, old) == before and corrected[:60996] == before[:60996]
write(directory / 'type-only.diff', ''.join(difflib.unified_diff(before.decode().splitlines(keepends=True),
    corrected.decode().splitlines(keepends=True), fromfile='sealed-b2a/component.tsx', tofile='type-corrected-ed257/component.tsx')).encode())
admission = {
    'origin': '/root message to /root/i5_final_inspector_qa',
    'rootMessageVerbatim': "Root read actual TS2375 streams and exact b2 bytes. Admit ONLY `immediate?: { text: string; visible: boolean; diagnostic?: string };` → `immediate?: { text: string; visible: boolean; diagnostic: string | undefined };`. Root computed exact result SHAed2577e25352efeacf962b77b05c39778cb906b5ac3875905c988cb8a575089c,76934B; original61prefix unchanged. Preserve/seal first static failure and exact b2. Prepare successor02 with only this type correction, output directory02 and matching overlay/binding pins; no runtime/oracle/wait changes. You may materialize exact ed257, derive admitted successor binding referencing this root disposition, and run the SAME static plus single full63 once after verifying no other runner/code delta. Record literal diff and hashes before run; sole heavy slot re-admitted. No behavioral test ran in attempt01, no automatic behavioral retry authorized. Root will read derivative/actualresult. This is the concrete bounded type fix, no further approval cycle needed.",
    'firstAttemptBehaviorInvocations': 0, 'onlyTypeCorrectionAdmitted': True,
    'expectedFixtureSha256': sha(corrected), 'oneFull63ProgramAdmitted': True,
}
save(directory / 'ROOT-ADMISSION.json', admission)
prep2.mkdir(exist_ok=False)
runner = (prep1 / 'run-diagnostic.ps1').read_bytes()
old_output = b'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d241-feedback-render-diagnostic-qa-01'
new_output = old_output[:-2] + b'02'
assert runner.count(old_output) == 1
successor = runner.replace(old_output, new_output)
assert successor.replace(new_output, old_output) == runner
write(prep2 / 'run-diagnostic.ps1', successor)
write(prep2 / 'module-boundary.cjs', (prep1 / 'module-boundary.cjs').read_bytes())
write(prep2 / 'component.diagnostic.proposed.tsx', corrected)
write(directory / 'runner.delta.diff', ''.join(difflib.unified_diff(runner.decode().splitlines(keepends=True),
    successor.decode().splitlines(keepends=True), fromfile='sealed-prep01/runner.ps1', tofile='successor02/runner.ps1')).encode())
template = json.loads((prep1 / 'ROOT-BINDING.template.json').read_text())
template['executionDirectory'] = template['executionDirectory'][:-2] + '02'
template['overlays'][component] = sha(corrected)
save(prep2 / 'ROOT-BINDING.template.json', template)
write(prep2 / 'REPORT.md', (
    'Exact root-admitted type correction only: immediate diagnostic field explicitly allows undefined. '
    'No runtime/DOM observation/oracle/wait or original-prefix change. Runner differs only output directory01-to02; module resolver unchanged. '
    'First static failure remains sealed with zero behavioral invocations. Root admitted this one successor static+full63 program; no automatic retry.\n').encode())
save(prep2 / 'MANIFEST.json', {'scope': 'Exact root-admitted type-only successor and owned output directory change',
    'members': [{'path': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())} for path in sorted(prep2.iterdir()) if path.is_file()]})
binding['executionDirectory'] = template['executionDirectory']
binding['overlays'][component] = sha(corrected)
binding['rootAdmission'] = {'path': str(directory / 'ROOT-ADMISSION.json'), 'sha256': sha((directory / 'ROOT-ADMISSION.json').read_bytes())}
binding['preparationManifestSha256'] = sha((prep2 / 'MANIFEST.json').read_bytes())
save(directory / 'ROOT-BINDING.admitted.json', binding)
(root / component).write_bytes(corrected)
for path, expected in binding['overlays'].items():
    assert sha((root / path).read_bytes()) == expected
assert sha(index.read_bytes()) == binding['source']['indexSha256']
assert not git('diff', '--exit-code', '--no-ext-diff', '--no-textconv')
assert not git('diff', '--cached', '--exit-code', '--no-ext-diff', '--no-textconv')
receipt = {
    'verifiedFirstStaticFailureMembers': first_count, 'verifiedFirstPrepMembers': prep_count,
    'beforeFixtureSha256': sha(before), 'installedFixtureSha256': sha(corrected), 'installedBytes': len(corrected),
    'onlyTypeAnnotationChanged': True, 'original61PrefixUnchanged': True,
    'runtimeOracleWaitChanges': False, 'runnerOnlyOutputDirectoryChanged': True,
    'runnerSha256': sha(successor), 'otherFourOverlaysSourceIndexCohortsUnchanged': True,
    'bindingSha256': sha((directory / 'ROOT-BINDING.admitted.json').read_bytes()),
    'oneBehavioralProgramAdmitted': True, 'behaviorExecutedDuringSetup': False,
}
save(directory / 'MATERIALIZATION.json', receipt)
print(json.dumps(receipt, indent=2))
