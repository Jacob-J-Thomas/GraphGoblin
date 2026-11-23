from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess

E = Path(__file__).resolve().parent.parent
P = E / 'i5-d242-b2-native-qa-preparation-03'
def pin(path):
    data = path.read_bytes()
    return {'source': str(path), 'bytes': len(data), 'sha256': sha256(data).hexdigest()}
def verify(ref):
    assert pin(Path(ref['source'])) == ref, ref['source']
def load(path):
    return json.loads(path.read_text(encoding='utf-8'))
def save(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')

seals = []
for suffix, wanted in (
    ('01', '5a3cbeb29bf7f3a53962e64e0138024313ca8bec2f29e7b465077c0dae90e7c5'),
    ('02', '3a0ee9a899ad10de51c8fa4630124c4bdd0005890ffe99c1c8a6613373856ae8'),
    ('03', '717d855b5a5b03f02a2e588d306e8c13b9bd9436764925a81f95ef6898db117e'),
):
    folder = E / ('i5-d242-b2-native-qa-preparation-' + suffix)
    manifest = folder / 'MANIFEST.json'
    assert pin(manifest)['sha256'] == wanted
    members = load(manifest)['members']
    for item in members:
        verify({'source': str(folder / item['path']), 'bytes': item['bytes'], 'sha256': item['sha256']})
    seals.append({'manifest': pin(manifest), 'verifiedMembers': len(members)})
b = load(P / 'OLD-ROOT-BINDING.template.json')
assert b['executionAdmitted'] is False and b['selection'] == 'repro'
assert b['source']['head'] == 'f64287619b499c14601e11bce3d1c6b5414b6227'
assert not Path(b['outputDirectory']).exists()
for ref in b['protectedInputs']:
    verify(ref)
for role in ('node', 'pnpm', 'projectPackage', 'testEntry', 'playwrightEntry', 'contractsEntry'):
    verify(b['runtime'][role])
verify(b['fixture'])
verify(b['build']['manifest'])
verify(b['build']['shippingEquivalence'])
manifest = load(Path(b['build']['manifest']['source']))
dist = Path(b['build']['dist'])
actual = {path.relative_to(dist).as_posix() for path in dist.rglob('*') if path.is_file()}
assert actual == set(manifest['webDist']) and len(actual) == 28
for name, wanted in manifest['webDist'].items():
    assert {key: pin(dist / name)[key] for key in ('bytes', 'sha256')} == wanted
equivalence = load(Path(b['build']['shippingEquivalence']['source']))
assert equivalence['requestedSource'] == b['source'] and equivalence['buildSource'] == manifest['source']
env = {key: value for key, value in os.environ.items() if not key.upper().startswith('GIT_')}
env.update(GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1')
git = ['C:/Program Files/Git/cmd/git.exe', '--no-optional-locks', '-C', 'G:/ggq/gg-i5-offline-ui-qa/GraphGoblin']
trees = subprocess.check_output(git + ['rev-parse', b['source']['head'] + ':apps/web', manifest['source']['head'] + ':apps/web'], env=env).decode().splitlines()
assert len(trees) == 2 and trees[0] == trees[1]
admission = {
    'utc': datetime.now(timezone.utc).isoformat(), 'executionAdmitted': True, 'head': b['source']['head'],
    'selection': 'repro', 'caseCount': 4, 'expectedOutcome': 'Known negative witness; retain actual results without product acceptance',
    'readCompletePlanWrapperAndNativeFixture': True, 'locatorCorrectionReviewed': True,
    'sealsVerified': seals, 'buildFilesVerified': len(actual), 'appsWebTrees': trees,
    'sourceTier': 'Retained a0 built distribution, apps/web tree byte-equivalent to published f642',
    'actualAuthorRunsInDifferentCheckout': True, 'authorSourceReadOrChanged': False,
    'apiBoundary': 'All intercepted, no backend/listener/server-side effects',
    'singleNativeExecutionNoRetries': True, 'uiQaIndexAndOverlaysRemainProtected': True,
}
admission_path = P / 'ROOT-OLD-ADMISSION.json'
save(admission_path, admission)
b.update(executionAdmitted=True, preparationManifestSha256=pin(P / 'MANIFEST.json')['sha256'], rootAdmission=pin(admission_path),
         authority='Root admitted one finite old-f642 repro4 on preserved build; all actual results retained. Corrected10 remains unarmed.')
binding_path = P / 'OLD-ROOT-BINDING.admitted.json'
save(binding_path, b)
print(json.dumps({'admission': pin(admission_path), 'binding': pin(binding_path)}))
