from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess

P = Path(__file__).resolve().parent
W = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
GIT = 'C:/Program Files/Git/cmd/git.exe'
OLD = P.parent / 'i5-d241-observation-entry-loss-corrected-qa-01'

def digest(p):
    return sha256(p.read_bytes()).hexdigest()

def git(*args):
    return subprocess.check_output([GIT, '--no-optional-locks', '-C', str(W), *args], env=os.environ | {'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_LAZY_FETCH': '1'})

def verify_manifest(folder, expected):
    manifest = folder / 'MANIFEST.json'
    assert digest(manifest) == expected
    entries = json.loads(manifest.read_text())['members']
    for item in entries:
        path = (folder / item['path']).resolve()
        assert path.is_relative_to(folder.resolve())
        assert path.stat().st_size == item['bytes'] and digest(path) == item['sha256'], item['path']
    return len(entries)

def save(name, data):
    with (P / name).open('x', encoding='utf-8', newline='\n') as out:
        json.dump(data, out, indent=2)
        out.write('\n')

manifest_sha = '108d3abf0bbb206f86bdefe0b9a0111d039e75785b78843315ca8e78d4f65c1e'
counts = [verify_manifest(P, manifest_sha), verify_manifest(OLD, '30b81bcb6650719af05444374324d98e472d670c18cd03af5e56fa4935bea00d')]
assert counts == [14, 47]
assert digest(P / 'ROOT-BINDING.unarmed.json') == '0d4ccf48e441304b6b4ae226df6559c95436f19fffbf82ed6953d79dd88ca6a4'
b = json.loads((P / 'ROOT-BINDING.unarmed.json').read_text())
s = b['source']
assert git('rev-parse', 'HEAD').decode().strip() == s['head']
assert git('rev-parse', 'HEAD^{tree}').decode().strip() == s['tree']
assert git('status', '--porcelain=v1', '--untracked-files=all').decode().splitlines() == s['status']
assert sha256(git('ls-files', '--stage', '-z')).hexdigest() == s['stagedEntriesSha256']
index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
assert digest(index) == s['indexSha256'] and not os.path.lexists(common / 'index')
for rel, expected in s['selectedSources'].items():
    assert digest(W / rel) == expected, rel
old_binding = json.loads((OLD / 'ROOT-BINDING.executed.json').read_text())
for rel, expected in old_binding['overlays'].items():
    assert digest(W / rel) == expected, rel
assert b['rootInstallInputs19'] == old_binding['rootInstallInputs19']
assert b['independentInputs18'] == old_binding['independentInputs18']
assert b['metadata'] == old_binding['metadata']
assert b['selectedModules'] == old_binding['selectedModules']
assert b['runtime'] == old_binding['runtime']
base = (P / 'base63.component.tsx').read_bytes()
proposed = (P / 'component.diagnostic.proposed.tsx').read_bytes()
assert base[:60996] == proposed[:60996]
assert sha256(base).hexdigest() == '8a344821db18ec25fa7cf2219c07721acf4eddae0d109b8eb3a412ca58aa6c2b'
assert sha256(proposed).hexdigest() == 'b2a6c41a7e0aa9936619cc2d5156ff7bea5d4b54f25eca3902212da445bcb950'
assert not Path(b['executionDirectory']).exists()
admission = {
    'admittedUtc': datetime.now(timezone.utc).isoformat(),
    'rootRead': ['REPORT.md', 'fixture.diagnostic.diff', 'runner.delta.diff', 'prepare-runner.py', 'ROOT-BINDING.unarmed.json'],
    'verifiedManifestMembers': sum(counts), 'preparationManifestSha256': manifest_sha,
    'head': s['head'], 'tree': s['tree'], 'indexSha256': s['indexSha256'],
    'scope': 'Materialize only the exact independent diagnostic overlay, then one static phase and one unfiltered63 invocation. Sole heavy slot assigned to QA until closure.',
    'qualification': 'Original immediate capture and strict assertion remain. Default wait and read-only DOM witnesses diagnose render timing versus unmount; neither explanation is presumed. Original result remains failed. No product change, retry, private state, deadline increase or acceptance relaxation.',
    'hypotheses': ['React notification/render lag after public mutation settlement', 'Run section remount after credential receipt replacement with earlier browser-loss history'],
    'declined': ['Relabel original strict failure as a pass', 'Change product before distinguishing causes', 'Reset browser-loss state or loosen HTTP/feedback assertions'],
    'runnerSha256': digest(P / 'run-diagnostic.ps1'),
    'diagnosticOverlaySha256': sha256(proposed).hexdigest(),
    'materializedByRoot': False,
}
save('ROOT-ADMISSION.json', admission)
b['rootAdmission'] = {'path': str(P / 'ROOT-ADMISSION.json'), 'sha256': digest(P / 'ROOT-ADMISSION.json')}
b['preparationManifestSha256'] = manifest_sha
b['executionAdmitted'] = True
b['rootInstructions'] = admission['scope'] + ' ' + admission['qualification']
save('ROOT-BINDING.admitted.json', b)
print(json.dumps({'binding': str(P / 'ROOT-BINDING.admitted.json'), 'sha256': digest(P / 'ROOT-BINDING.admitted.json'), 'membersVerified': sum(counts), 'productChanged': False, 'fixtureMaterialized': False}))
