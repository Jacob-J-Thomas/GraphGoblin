import hashlib
import json
from pathlib import Path

out = Path(__file__).parent
previous = out.parent / 'i5-d242-b2-native-qa-preparation-02'


def sha(data):
    return hashlib.sha256(data).hexdigest()


preflight = json.loads((out / 'dependency-import.receipt.json').read_bytes())
assert preflight['exitCode'] == 0 and preflight['startOrCaptureFailure'] is None
assert sha((out / 'dependency-import.stdout.log').read_bytes()) == preflight['stdoutSha256']
assert sha((out / 'dependency-import.stderr.log').read_bytes()) == preflight['stderrSha256']
assert (out / 'dependency-import.stderr.log').stat().st_size == 0
result = json.loads((out / 'dependency-import.stdout.log').read_bytes())
for key in ['exactFixtureRunSnapshotValid', 'reboundRunSnapshotValid', 'generatedRunningSnapshotValid',
            'generatedRunningRecordValid', 'originalAndReboundRunRecordsValid', 'plannedDeletionBodiesValid']:
    assert result[key] is True
assert result['browserOrProductCasesStarted'] == 0 and result['semanticProjectionChanged'] is False
assert sha((previous / 'MANIFEST.json').read_bytes()) == '3a0ee9a899ad10de51c8fa4630124c4bdd0005890ffe99c1c8a6613373856ae8'
for item in json.loads((previous / 'MANIFEST.json').read_bytes())['members']:
    raw = (previous / item['path']).read_bytes()
    assert len(raw) == item['bytes'] and sha(raw) == item['sha256']
members = []
for file in sorted(out.rglob('*')):
    if file.is_file() and file.name != 'MANIFEST.json':
        raw = file.read_bytes()
        members.append({'path': file.relative_to(out).as_posix(), 'bytes': len(raw), 'sha256': sha(raw)})
with (out / 'MANIFEST.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump({'scope': 'UNARMED D242 successor03; narrow ESM contracts loader repair; one pure import/schema preflight passed, no browser cases', 'members': members}, stream, indent=2)
    stream.write('\n')
for item in members:
    raw = (out / item['path']).read_bytes()
    assert len(raw) == item['bytes'] and sha(raw) == item['sha256']
print(json.dumps({'members': len(members), 'manifestSha256': sha((out / 'MANIFEST.json').read_bytes()),
    'nativeRunnerSha256': sha((out / 'native.cjs').read_bytes()),
    'wrapperSha256': sha((out / 'run-native.ps1').read_bytes()),
    'oldBindingSha256': sha((out / 'OLD-ROOT-BINDING.template.json').read_bytes()),
    'importSchemaPreflightExit': 0, 'browserCasesStarted': 0, 'runtimeAdmitted': False}))
