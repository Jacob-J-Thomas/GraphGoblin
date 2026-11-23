import hashlib
import json
import os
from pathlib import Path
import subprocess
import traceback

directory = Path(__file__).parent
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
prep = directory.parent.parent / 'i5-416-420-geometry-collection-preparation-02'
baseline = json.loads((prep / 'BINDING.json').read_text(encoding='utf-8'))['pins']
helper_path = 'apps/web/e2e/independent-420-geometry.ts'
original_sha = '8964fa8e3b2945814ada8bc8d6c0316338ffc68d1ee1600f063524c370a826c5'
proposed_sha = '2baa8bebcc6ecab903604ba76fb0b5bad5e728434d823b008f44347392dc828e'
manifest_sha = '83ae610734eabdda4714e2ae3683505ceec3d308b695ecd3f595ea0c4ceb90fc'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(name, value):
    path = directory / name
    assert not path.exists(), f'Refusing to overwrite {path}'
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def git(*arguments):
    result = subprocess.run(
        ['git', '--no-optional-locks', *arguments], cwd=root,
        env=dict(os.environ, GIT_OPTIONAL_LOCKS='0'), capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(json.dumps({'gitArgv': arguments, 'exit': result.returncode,
                                       'stdout': result.stdout.decode(), 'stderr': result.stderr.decode()}))
    return result.stdout


def pins():
    index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
    common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
    result = {
        'head': git('rev-parse', 'HEAD').decode().strip(),
        'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
        'indexSha256': sha(index.read_bytes()),
        'stagedEntriesSha256': sha(git('ls-files', '--stage', '-z')),
        'commonIndexExists': (common / 'index').exists(),
        'status': git('status', '--porcelain=v1', '--untracked-files=all', '-z').decode().split('\0')[:-1],
    }
    for group in ['dependencyInputs', 'metadata', 'selectedSources', 'overlays']:
        result[group] = {path: sha((root / path).read_bytes()) for path in baseline[group]}
    result['trackedDiffOutput'] = git('diff', '--exit-code', '--no-ext-diff').decode()
    result['stagedDiffOutput'] = git('diff', '--cached', '--exit-code', '--no-ext-diff').decode()
    return result


try:
    manifest_bytes = (prep / 'MANIFEST.json').read_bytes()
    assert sha(manifest_bytes) == manifest_sha
    members = json.loads(manifest_bytes)['members']
    for member in members:
        data = (prep / member['path']).read_bytes()
        assert len(data) == member['bytes'] and sha(data) == member['sha256'], member['path']
    assert sha((prep / 'independent-420-geometry.original.ts').read_bytes()) == original_sha
    proposed = (prep / 'independent-420-geometry.proposed.ts').read_bytes()
    assert sha(proposed) == proposed_sha
    before = pins()
    for key, value in baseline.items():
        assert before[key] == value, key
    assert not git('ls-files', '--', helper_path).strip(), 'Helper unexpectedly tracked'
    assert before['overlays'][helper_path] == original_sha
    assert before['overlays']['apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'] == (
        '4bf07f6fb1e26725dbc08247534eb364231a50564010f048bcc51bdb1101daa6')
    save('before.json', before)
    original_copy = directory / 'geometry.before.ts'
    assert not original_copy.exists()
    original_copy.write_bytes((root / helper_path).read_bytes())
    assert sha(original_copy.read_bytes()) == original_sha
    (root / helper_path).write_bytes(proposed)
    after = pins()
    save('after.json', after)
    expected = json.loads(json.dumps(before))
    expected['overlays'][helper_path] = proposed_sha
    assert after == expected, 'Unexpected state delta after helper copy'
    receipt = {
        'authority': 'Root admitted only geometry helper materialization from exact proposed2baa8beb; no execution.',
        'preparationManifestSha256': manifest_sha, 'verifiedPreparationMembers': len(members),
        'destination': str(root / helper_path),
        'originalSha256': original_sha, 'installedSha256': sha((root / helper_path).read_bytes()),
        'preservedOriginalCopy': str(original_copy),
        'otherFourOverlaysUnchanged': True, 'selectedSourcesDependenciesMetadataUnchanged': True,
        'headTreeRawIndexStagedEntriesAndStatusUnchanged': True, 'commonIndexAbsent': True,
        'trackedAndStagedDiffExit': 0,
        'onlyDelta': helper_path, 'testsBuildBrowserRun': False, 'nextRead': False,
        'staticTypedChecksDeferredUntilCorrectedSourceAdmission': True,
        'formalReviewBookkeepingAcknowledged': 'Upcoming targeted correction review is pass2; fresh MAX reserved pass3.',
    }
    save('RECEIPT.json', receipt)
    print(json.dumps(receipt, indent=2))
except Exception:
    failure = traceback.format_exc()
    if not (directory / 'FAILURE.txt').exists():
        (directory / 'FAILURE.txt').write_text(failure, encoding='utf-8')
    raise
