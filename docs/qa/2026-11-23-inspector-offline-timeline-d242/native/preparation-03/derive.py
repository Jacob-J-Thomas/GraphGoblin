import difflib
import hashlib
import json
from pathlib import Path

out = Path(__file__).parent
e = out.parent
previous = e / 'i5-d242-b2-native-qa-preparation-02'
failed = e / 'i5-d242-b2-native-old-f642-execution-01'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(name, value):
    with (out / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


manifest = json.loads((previous / 'MANIFEST.json').read_bytes())
assert sha((previous / 'MANIFEST.json').read_bytes()) == '3a0ee9a899ad10de51c8fa4630124c4bdd0005890ffe99c1c8a6613373856ae8'
for item in manifest['members']:
    raw = (previous / item['path']).read_bytes()
    assert len(raw) == item['bytes'] and sha(raw) == item['sha256']
raw = (previous / 'native.cjs').read_bytes()
assert sha(raw) == '26cd36b7ed9cc8c6edc2a6c0fd1aba6c1c66911d4ccc590fced3b281ddd2954a'
text = raw.decode()
changes = [
    ("const { createRequire } = require('node:module');\n", "const { createRequire } = require('node:module');\nconst { pathToFileURL } = require('node:url');\n"),
    ("  assert(samePath(project.resolve('@graphgoblin/contracts'), b.runtime.contractsEntry.source));\n", ''),
    ("  const { RunRecordSchema, RunSnapshotSchema, DeletionSelectionSchema, DeletionConfirmationSchema } = project('@graphgoblin/contracts');\n",
     "  const { RunRecordSchema, RunSnapshotSchema, DeletionSelectionSchema, DeletionConfirmationSchema } = await import(pathToFileURL(b.runtime.contractsEntry.source).href);\n"),
]
for before, after in changes:
    assert text.count(before) == 1
    text = text.replace(before, after, 1)
derived = text.encode()
with (out / 'native.cjs').open('xb') as stream:
    stream.write(derived)
with (out / 'run-native.ps1').open('xb') as stream:
    stream.write((previous / 'run-native.ps1').read_bytes())
with (out / 'loader.diff').open('x', encoding='utf-8', newline='\n') as stream:
    stream.writelines(difflib.unified_diff(raw.decode().splitlines(True), text.splitlines(True),
        fromfile='sealed-preparation02/native.cjs', tofile='preparation03/native.cjs'))
for name in ['OLD-ROOT-BINDING.template.json', 'CORRECTED-ROOT-BINDING.template.json']:
    value = json.loads((previous / name).read_bytes())
    assert value['executionAdmitted'] is False and value['rootAdmission']['source'] is None
    if name.startswith('OLD-'):
        value['outputDirectory'] = str(e / 'i5-d242-b2-native-old-f642-execution-02')
        value['nativeDirectory'] = str(e / 'i5-d242-b2-native-old-f642-execution-02/native')
    save(name, value)
receipt = json.loads((failed / 'COMMAND.receipt.json').read_bytes())
assert receipt['exitCode'] == 1 and receipt['startOrCaptureFailure'] is None
stderr = (failed / 'native.stderr.log').read_text()
assert 'ERR_PACKAGE_PATH_NOT_EXPORTED' in stderr and 'native.cjs:56:27' in stderr
assert sorted(p.name for p in (failed / 'native').iterdir()) == ['ARGUMENTS.json']
for source, dest in [('native.stderr.log', 'FIRST-FAILURE.stderr.log'),
                     ('COMMAND.receipt.json', 'FIRST-FAILURE.command.receipt.json'),
                     ('native/ARGUMENTS.json', 'FIRST-FAILURE.ARGUMENTS.json')]:
    with (out / dest).open('xb') as stream:
        stream.write((failed / source).read_bytes())
inventory = []
for p in sorted(failed.rglob('*')):
    if p.is_file():
        data = p.read_bytes()
        inventory.append({'source': str(p), 'bytes': len(data), 'sha256': sha(data)})
save('FAILED-EXECUTION-01.json', {'scope': 'Actual first loader refusal, before browser launch or cases; originals untouched',
    'observedExit': 1, 'browserCasesStarted': 0, 'error': 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    'cause': 'CommonJS export resolution was inappropriate for the import-only public contracts package.',
    'files': inventory})
save('DERIVATION.json', {'originalPreparationManifestSha256': sha((previous / 'MANIFEST.json').read_bytes()),
    'original11MembersVerifiedUnchanged': True, 'originalRunnerSha256': sha(raw), 'newRunnerSha256': sha(derived),
    'onlyNativeDelta': 'node:url pathToFileURL plus dynamic ESM import of exact-pinned public contracts dist/index.js; remove only its inappropriate CJS export resolution.',
    'playwrightCjsAndAllCaseLogicAssertionsTimeoutsUnchanged': True,
    'schemaValidationAndSemanticProjectionsUnchanged': True, 'wrapperBytesUnchanged': True,
    'oldOutput': str(e / 'i5-d242-b2-native-old-f642-execution-02'),
    'correctedFutureOutputUnchanged': str(e / 'i5-d242-b2-native-corrected-execution-01'),
    'oldRepro': 4, 'correctedAll': 10, 'actualBrowserAdmission': False})
print(json.dumps({'nativeRunnerSha256': sha(derived), 'original02Unchanged': True, 'failed01Retained': True,
                  'browserCasesStarted': 0, 'runtimeAdmitted': False}))
