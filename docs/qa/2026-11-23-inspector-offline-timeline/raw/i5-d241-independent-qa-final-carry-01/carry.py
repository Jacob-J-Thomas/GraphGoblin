from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import traceback

directory = Path(__file__).parent
evidence = directory.parent
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
executed = evidence / 'i5-416-420-ui-independent-qa-01/corrected-component-execution-02'
binding = json.loads((executed / 'ROOT-BINDING.executed.json').read_text())
old_head = 'd71fbe81a3bff5ea3c9cb672fa470a16c0d4a881'
new_head = '2231400e7986f349376d7c19ebd62ae71f7708a4'
new_tree = 'c20cdcad4bf3c91fcd7b84c81284c491479f7ed9'
allowed = ['CHANGELOG.md', 'apps/web/src/runs/RunInspectorPage.offline.test.tsx', 'docs/09-frontend-and-pwa.md']
freeze_path = evidence / 'i5-d241-final-correction-freeze-01/FREEZE.json'
freeze_sha = '69724e4c8b75454815957bfe1ac031ddf74fe22727e3dfbe02b36b44253546ae'
environment = dict(os.environ, GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(name, value):
    with (directory / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def write_bytes(name, data):
    with (directory / name).open('xb') as stream:
        stream.write(data)


def git(*arguments):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(root), *arguments], env=environment)


def file_pin(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': sha(data)}


def snapshot():
    index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
    common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
    result = {
        'source': {
            'head': git('rev-parse', 'HEAD').decode().strip(), 'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
            'indexPath': str(index), 'indexSha256': sha(index.read_bytes()),
            'stagedEntriesSha256': sha(git('ls-files', '--stage', '-z')),
            'commonIndexExists': (common / 'index').exists(),
            'status': git('status', '--porcelain=v1', '--untracked-files=all', '-z').decode().split('\0')[:-1],
            'selectedSources': {path: sha((root / path).read_bytes()) for path in binding['source']['selectedSources']},
        },
        'rootInstallInputs19': {path: file_pin(root / path) for path in binding['rootInstallInputs19']},
        'independentInputs18': {path: sha((root / path).read_bytes()) for path in binding['independentInputs18']},
        'metadata': {path: sha((root / path).read_bytes()) for path in binding['metadata']},
        'overlays': {path: sha((root / path).read_bytes()) for path in binding['overlays']},
        'protectedCore': {path: file_pin(root / path) for path in freeze['protectedCore']},
        'selectedModuleFiles': {},
    }
    for module in binding['selectedModules']:
        entry = Path(module['entry'])
        actual = {'entrySha256': sha(entry.read_bytes()), 'physicalEntry': str(entry.resolve())}
        assert actual['entrySha256'] == module['entrySha256'], module['name']
        assert actual['physicalEntry'].casefold() == str(Path(module['realEntry']).resolve()).casefold()
        if 'manifest' in module:
            actual['manifestSha256'] = sha(Path(module['manifest']).read_bytes())
            assert actual['manifestSha256'] == module['manifestSha256'], module['name']
        result['selectedModuleFiles'][module['name']] = actual
    assert sha(Path(binding['runtime']['node']['path']).read_bytes()) == binding['runtime']['node']['sha256']
    for path_key, hash_key in [('pnpmLauncher', 'launcherSha256'), ('pnpmExecutable', 'executableSha256'), ('packagePath', 'packageSha256')]:
        assert sha(Path(binding['runtime']['pnpm'][path_key]).read_bytes()) == binding['runtime']['pnpm'][hash_key]
    assert not git('diff', '--exit-code', '--no-ext-diff', '--no-textconv')
    assert not git('diff', '--cached', '--exit-code', '--no-ext-diff', '--no-textconv')
    result['trackedAndStagedDiffExit'] = 0
    return result


try:
    assert sha(freeze_path.read_bytes()) == freeze_sha
    freeze = json.loads(freeze_path.read_text())
    assert freeze['source'] == {'head': new_head, 'tree': new_tree, 'parents': [old_head]}
    assert git('rev-list', '--parents', '-n', '1', new_head).decode().strip().split() == [new_head, old_head]
    assert git('show', '-s', '--format=%T', new_head).decode().strip() == new_tree
    changed = git('diff', '--name-only', '--no-renames', '-z', old_head, new_head).decode().split('\0')[:-1]
    assert changed == allowed, changed
    raw_delta = git('diff', '--raw', '--no-renames', '-z', old_head, new_head)
    write_bytes('exact-three-paths.raw', raw_delta)
    write_bytes('exact-three-paths.diff', git('diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', old_head, new_head))
    assert not git('diff', '--exit-code', '--no-ext-diff', '--no-textconv', old_head, new_head, '--', '.',
                   *[':(exclude)' + path for path in allowed])
    actual_selection = json.loads((executed / 'ACTUAL-SELECTION.json').read_text())
    assert actual_selection['passed'] == 61 and actual_selection['failed'] == 0 and actual_selection['processExit'] == 0
    actual_manifest_path = executed / 'MANIFEST.json'
    assert sha(actual_manifest_path.read_bytes()) == '64ee0e1feb0df61ddb07476262943ac0327e5f6e9aee52d80a100d5f226d5392'
    actual_members = json.loads(actual_manifest_path.read_text())['members']
    for member in actual_members:
        assert file_pin(executed / member['path']) == {'bytes': member['bytes'], 'sha256': member['sha256']}, member['path']
    before = snapshot()
    for key, expected in binding['source'].items():
        assert before['source'][key] == expected, key
    assert before['source']['head'] == old_head and not before['source']['commonIndexExists']
    for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays']:
        assert before[group] == binding[group], group
    assert before['protectedCore'] == freeze['protectedCore']
    save('before-d71fbe.json', before)
    copies = directory / 'overlays-before'
    copies.mkdir(exist_ok=False)
    for path, expected in before['overlays'].items():
        copy = copies / Path(path).name
        with copy.open('xb') as stream:
            stream.write((root / path).read_bytes())
        assert sha(copy.read_bytes()) == expected
    command = ['git', '--no-optional-locks', '-C', str(root), 'merge', '--ff-only', new_head]
    started = datetime.now(timezone.utc).isoformat()
    with (directory / 'ff-only.stdout.log').open('xb') as stdout, (directory / 'ff-only.stderr.log').open('xb') as stderr:
        result = subprocess.run(command, env=environment, stdout=stdout, stderr=stderr, check=False)
    save('FF-ONLY.receipt.json', {'argv': command, 'startedUtc': started, 'finishedUtc': datetime.now(timezone.utc).isoformat(),
                                'exitCode': result.returncode, 'stdout': file_pin(directory / 'ff-only.stdout.log'),
                                'stderr': file_pin(directory / 'ff-only.stderr.log'),
                                'authority': 'Root-admitted UIQA-only d71fbe-to-2231400 --ff-only; no other Git mutation.'})
    assert result.returncode == 0, 'FF failed; preserve and stop'
    after = snapshot()
    save('after-2231400.json', after)
    assert after['source']['head'] == new_head and after['source']['tree'] == new_tree
    assert after['source']['status'] == before['source']['status'] and not after['source']['commonIndexExists']
    for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays', 'protectedCore', 'selectedModuleFiles']:
        assert after[group] == before[group], group
    selected_changes = [path for path in before['source']['selectedSources']
                        if before['source']['selectedSources'][path] != after['source']['selectedSources'][path]]
    assert sorted(selected_changes) == allowed
    for path, expected in freeze['files'].items():
        assert file_pin(root / path) == expected, path
    final_binding = {
        'schemaVersion': 1, 'purpose': 'Final source identity and product-equality carry only; no execution authority.',
        'executionAdmitted': False, 'buildExecutionAdmitted': False, 'browserExecutionAdmitted': False,
        'worktree': str(root), 'source': {key: after['source'][key] for key in binding['source']},
        'rootInstallInputs19': after['rootInstallInputs19'], 'independentInputs18': after['independentInputs18'],
        'metadata': after['metadata'], 'overlays': after['overlays'], 'selectedModules': binding['selectedModules'],
        'runtime': binding['runtime'], 'unchangedActualExecutionConditions': {
            'selection': binding['selection'], 'childEnvironmentControl': binding['childEnvironmentControl'],
            'scope': 'These were actual full61 conditions at d71fbe; no new execution is claimed at2231400.'},
        'carriedEvidence': {'actuallyExecutedHead': old_head, 'actuallyExecutedTree': binding['source']['tree'],
                            'result': actual_selection, 'manifestPath': str(actual_manifest_path),
                            'manifestSha256': sha(actual_manifest_path.read_bytes()),
                            'carryBasis': 'Exact commit delta is only two docs and one separate author test; all other tracked tree content, dependencies, independent fixtures, runtime/module identities and conditions equal.'},
    }
    save('FINAL-SOURCE-BINDING.unarmed.json', final_binding)
    receipt = {
        'actualExecutedHead': old_head, 'actualExecutedTree': binding['source']['tree'],
        'finalHead': new_head, 'finalTree': new_tree, 'exactDelta': changed,
        'allOtherTrackedTreeContentIdentical': True, 'noRuntimeOrConfigurationDelta': True,
        'beforeIndexSha256': before['source']['indexSha256'], 'afterIndexSha256': after['source']['indexSha256'],
        'beforeStagedEntriesSha256': before['source']['stagedEntriesSha256'], 'afterStagedEntriesSha256': after['source']['stagedEntriesSha256'],
        'intentionalIndexChange': 'Only exact root-admitted --ff-only source advance; no staging/unstaging.',
        'fiveOverlayBytesPreserved': True, 'root19Independent18MetadataAndModulesUnchanged': True,
        'threeProtectedCoreFilesUnchanged': True, 'fifteenFinalFreezePinsMatched': True,
        'commonIndexAbsent': True, 'trackedAndStagedDiffExit': 0,
        'verifiedExecutedEvidenceMembers': len(actual_members), 'carriedResult': actual_selection,
        'finalSourceBindingSha256': sha((directory / 'FINAL-SOURCE-BINDING.unarmed.json').read_bytes()),
        'testsRerun': False, 'buildOrBrowserOrProviderLaunched': False, 'nextRead': False,
    }
    save('CARRY.json', receipt)
    print(json.dumps(receipt, indent=2))
except Exception:
    with (directory / 'FAILURE.txt').open('x', encoding='utf-8') as stream:
        stream.write(traceback.format_exc())
    raise
