import hashlib
import json
from pathlib import Path

out = Path(__file__).parent
first = out.parent / 'i5-d242-b2-native-qa-preparation-01'


def sha(data):
    return hashlib.sha256(data).hexdigest()


audit = json.loads((out / 'AUDIT-LOCATOR-CHECK.json').read_bytes())
expected = next(row for row in json.loads((first / 'INPUTS.json').read_bytes())['inputs']
                if Path(row['source']).name == 'sent-action.cjs')
assert audit['sha256'] == expected['sha256'] and audit['bytes'] == expected['bytes']
assert sha((out / 'run-native.ps1').read_bytes()) == '3cc0a553b3453cd43c491aec8302a5660f2238b2429453b667ee90ae3283a9da'
assert sha((first / 'MANIFEST.json').read_bytes()) == '5a3cbeb29bf7f3a53962e64e0138024313ca8bec2f29e7b465077c0dae90e7c5'
for item in json.loads((first / 'MANIFEST.json').read_bytes())['members']:
    raw = (first / item['path']).read_bytes()
    assert len(raw) == item['bytes'] and sha(raw) == item['sha256']
members = []
for file in sorted(out.iterdir()):
    if file.is_file() and file.name != 'MANIFEST.json':
        raw = file.read_bytes()
        members.append({'path': file.name, 'bytes': len(raw), 'sha256': sha(raw)})
with (out / 'MANIFEST.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump({'scope': 'UNARMED D242 successor02; deletion visible-text locator correction only; old repro4/corrected10 unchanged', 'members': members}, stream, indent=2)
    stream.write('\n')
for item in members:
    raw = (out / item['path']).read_bytes()
    assert len(raw) == item['bytes'] and sha(raw) == item['sha256']
print(json.dumps({'members': len(members), 'manifestSha256': sha((out / 'MANIFEST.json').read_bytes()),
    'nativeRunnerSha256': sha((out / 'native.cjs').read_bytes()),
    'oldBindingSha256': sha((out / 'OLD-ROOT-BINDING.template.json').read_bytes()),
    'original14MembersUnchanged': True, 'runtimeAdmitted': False}))
