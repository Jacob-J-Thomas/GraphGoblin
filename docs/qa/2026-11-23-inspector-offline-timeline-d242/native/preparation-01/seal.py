import hashlib
import json
from pathlib import Path

out = Path(__file__).parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


old = json.loads((out / 'OLD-ROOT-BINDING.template.json').read_bytes())
corrected = json.loads((out / 'CORRECTED-ROOT-BINDING.template.json').read_bytes())
assert old['executionAdmitted'] is False and old['selection'] == 'repro'
assert old['source']['head'] == 'f64287619b499c14601e11bce3d1c6b5414b6227'
assert corrected['executionAdmitted'] is False and corrected['selection'] == 'all' and corrected['source']['head'] is None
assert old['preparationManifestSha256'] is None and old['rootAdmission']['source'] is None
members = []
for file in sorted(out.iterdir()):
    if file.is_file() and file.name != 'MANIFEST.json':
        raw = file.read_bytes()
        members.append({'path': file.name, 'bytes': len(raw), 'sha256': sha(raw)})
with (out / 'MANIFEST.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump({'scope': 'UNARMED D242 native old-f642 repro4 and prospective corrected10; no runtime execution', 'members': members}, stream, indent=2)
    stream.write('\n')
for item in members:
    raw = (out / item['path']).read_bytes()
    assert len(raw) == item['bytes'] and sha(raw) == item['sha256']
print(json.dumps({'members': len(members), 'manifestSha256': sha((out / 'MANIFEST.json').read_bytes()),
    'nativeRunnerSha256': sha((out / 'native.cjs').read_bytes()), 'wrapperSha256': sha((out / 'run-native.ps1').read_bytes()),
    'oldBindingSha256': sha((out / 'OLD-ROOT-BINDING.template.json').read_bytes()), 'executionAdmitted': False}))
