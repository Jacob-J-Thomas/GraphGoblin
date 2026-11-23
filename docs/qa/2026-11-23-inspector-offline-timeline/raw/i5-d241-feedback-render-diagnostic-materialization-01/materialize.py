import hashlib
import json
import os
from pathlib import Path
import subprocess

directory = Path(__file__).parent
evidence = directory.parent
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
prep = evidence / 'i5-d241-feedback-render-diagnostic-preparation-01'
component = 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*arguments):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(root), *arguments],
                                   env=dict(os.environ, GIT_OPTIONAL_LOCKS='0'))


binding_bytes = (prep / 'ROOT-BINDING.admitted.json').read_bytes()
assert sha(binding_bytes) == '617afdf27271f1331f0a460920297602b1ad9efa74f4751f9c89bfc562726780'
binding = json.loads(binding_bytes)
assert binding['executionAdmitted'] is True
assert sha((prep / 'MANIFEST.json').read_bytes()) == '108d3abf0bbb206f86bdefe0b9a0111d039e75785b78843315ca8e78d4f65c1e'
members = json.loads((prep / 'MANIFEST.json').read_text())['members']
for member in members:
    data = (prep / member['path']).read_bytes()
    assert len(data) == member['bytes'] and sha(data) == member['sha256'], member['path']
assert git('rev-parse', 'HEAD').decode().strip() == binding['source']['head']
assert git('rev-parse', 'HEAD^{tree}').decode().strip() == binding['source']['tree']
index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
assert sha(index.read_bytes()) == binding['source']['indexSha256']
assert sha(git('ls-files', '--stage', '-z')) == binding['source']['stagedEntriesSha256']
assert not (common / 'index').exists()
for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays', 'selectedSources']:
    values = binding['source'][group] if group == 'selectedSources' else binding[group]
    for path, expected in values.items():
        data = (root / path).read_bytes()
        if path == component:
            expected = '8a344821db18ec25fa7cf2219c07721acf4eddae0d109b8eb3a412ca58aa6c2b'
        assert (sha(data) == expected if isinstance(expected, str) else {'bytes': len(data), 'sha256': sha(data)} == expected), path
assert not git('diff', '--exit-code', '--no-ext-diff', '--no-textconv')
assert not git('diff', '--cached', '--exit-code', '--no-ext-diff', '--no-textconv')
before = (root / component).read_bytes()
assert before == (prep / 'base63.component.tsx').read_bytes()
with (directory / 'component.before8a.tsx').open('xb') as stream:
    stream.write(before)
proposal = (prep / 'component.diagnostic.proposed.tsx').read_bytes()
assert sha(proposal) == 'b2a6c41a7e0aa9936619cc2d5156ff7bea5d4b54f25eca3902212da445bcb950'
assert proposal[:60996] == before[:60996]
(root / component).write_bytes(proposal)
for path, expected in binding['overlays'].items():
    assert sha((root / path).read_bytes()) == expected, path
assert sha(index.read_bytes()) == binding['source']['indexSha256']
assert not git('diff', '--exit-code', '--no-ext-diff', '--no-textconv')
assert not git('diff', '--cached', '--exit-code', '--no-ext-diff', '--no-textconv')
receipt = {
    'candidateHead': binding['source']['head'], 'candidateTree': binding['source']['tree'],
    'rawIndexSha256': binding['source']['indexSha256'], 'oldComponentSha256': sha(before),
    'installedComponentSha256': sha(proposal), 'onlyCheckoutDelta': component,
    'original61PrefixUnchanged': True, 'originalImmediateStrictAssertionsRetained': True,
    'otherFourOverlaysAndSourceIndexCohortsUnchanged': True, 'commonIndexAbsent': True,
    'verifiedPreparationMembers': len(members), 'armedBindingSha256': sha(binding_bytes),
    'productTestsRunDuringMaterialization': False,
}
with (directory / 'MATERIALIZATION.json').open('x', encoding='utf-8') as stream:
    json.dump(receipt, stream, indent=2)
    stream.write('\n')
print(json.dumps(receipt, indent=2))
