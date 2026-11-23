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
prep = evidence / 'i5-d241-session-feedback-rebind-preparation-01'
runner_prep = evidence / 'i5-d241-session-feedback-corrected-preparation-01'
environment = dict(os.environ, GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pin(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': sha(data)}


def save(name, value):
    with (directory / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def write(name, data):
    with (directory / name).open('xb') as stream:
        stream.write(data)


def git(*arguments):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(root), *arguments], env=environment)


def snapshot():
    index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip()).resolve()
    common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip()).resolve()
    assert (common / 'worktrees') in index.parents and not (common / 'index').exists()
    result = {
        'source': {
            'head': git('rev-parse', 'HEAD').decode().strip(), 'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
            'indexSha256': sha(index.read_bytes()), 'indexPath': str(index),
            'stagedEntriesSha256': sha(git('ls-files', '--stage', '-z')),
            'commonIndexExists': (common / 'index').exists(),
            'status': git('status', '--porcelain=v1', '--untracked-files=all', '-z').decode().split('\0')[:-1],
            'selectedSources': {path: sha((root / path).read_bytes()) for path in target_binding['source']['selectedSources']},
        },
        'rootInstallInputs19': {path: pin(root / path) for path in plan['root19InputReference']},
        'independentInputs18': {path: sha((root / path).read_bytes()) for path in plan['independent18InputReference']},
        'metadata': {path: sha((root / path).read_bytes()) for path in plan['metadataReference']},
        'overlays': {path: sha((root / path).read_bytes()) for path in plan['preserveRawFiveOverlaysBeforeAfter']},
        'protectedCore': {path: pin(root / path) for path in plan['protectedCore']},
        'protectedConfigs': {path: pin(root / path) for path in config_paths},
        'selectedModuleFiles': {},
    }
    for module in plan['selectedModulesReference']:
        entry = Path(module['entry'])
        actual = {'entrySha256': sha(entry.read_bytes()), 'physicalEntry': str(entry.resolve())}
        assert actual['entrySha256'] == module['entrySha256'], module['name']
        assert actual['physicalEntry'].casefold() == str(Path(module['realEntry']).resolve()).casefold()
        if 'manifest' in module:
            actual['manifestSha256'] = sha(Path(module['manifest']).read_bytes())
            assert actual['manifestSha256'] == module['manifestSha256'], module['name']
        result['selectedModuleFiles'][module['name']] = actual
    assert sha(Path(plan['runtimeReference']['node']['path']).read_bytes()) == plan['runtimeReference']['node']['sha256']
    for path_key, hash_key in [('pnpmLauncher', 'launcherSha256'), ('pnpmExecutable', 'executableSha256'), ('packagePath', 'packageSha256')]:
        assert sha(Path(plan['runtimeReference']['pnpm'][path_key]).read_bytes()) == plan['runtimeReference']['pnpm'][hash_key]
    assert not git('diff', '--exit-code', '--no-ext-diff', '--no-textconv')
    assert not git('diff', '--cached', '--exit-code', '--no-ext-diff', '--no-textconv')
    result['trackedAndStagedDiffExit'] = 0
    return result


try:
    admission_path = prep / 'ROOT-FF-ADMISSION.json'
    assert sha(admission_path.read_bytes()) == '30ffcb7435a6330c5239ccc33fb9ee761347a386d3cf2868128c26b0e783a085'
    admission = json.loads(admission_path.read_text())
    assert admission['ffAdmitted'] and not admission['executionAdmitted']
    assert sha((prep / 'FF-PLAN.json').read_bytes()) == admission['planSha256']
    plan = json.loads((prep / 'FF-PLAN.json').read_text())
    target_binding = json.loads((prep / 'ROOT-BINDING.target.unarmed.json').read_text())
    freeze_path = Path(plan['freezePath'])
    assert sha(freeze_path.read_bytes()) == plan['freezeSha256']
    freeze = json.loads(freeze_path.read_text())
    assert freeze['source'] == admission['source'] == plan['targetSource']
    assert Path(git('rev-parse', '--show-toplevel').decode().strip()).resolve() == root.resolve()
    assert git('rev-list', '--parents', '-n', '1', freeze['source']['head']).decode().strip().split() == [freeze['source']['head'], plan['currentHead']]
    assert git('show', '-s', '--format=%T', freeze['source']['head']).decode().strip() == freeze['source']['tree']
    changed = git('diff', '--name-only', '--no-renames', '-z', plan['currentHead'], freeze['source']['head']).decode().split('\0')[:-1]
    assert changed == plan['exactAllowedDeltaPaths'] == freeze['exactDeltaFromPriorFreeze']
    config_paths = git('ls-files', '-z', '--', *plan['protectedConfigPaths']).decode().split('\0')[:-1]
    protected_paths = list(dict.fromkeys([*config_paths, *plan['protectedCore'], *plan['root19InputReference'], *plan['independent18InputReference']]))
    assert not git('diff', '--exit-code', '--no-ext-diff', '--no-textconv', plan['currentHead'], freeze['source']['head'], '--', *protected_paths)
    assert not git('ls-tree', '-r', '--name-only', freeze['source']['head'], '--', *plan['preserveRawFiveOverlaysBeforeAfter']).strip()
    before = snapshot()
    baseline = json.loads((evidence / 'i5-d241-feedback-render-diagnostic-qa-03/after.json').read_text())
    for key in ['head', 'tree', 'indexSha256', 'stagedEntriesSha256', 'commonIndexExists', 'status']:
        assert before['source'][key] == baseline[key], key
    assert before['source']['selectedSources'] == baseline['selectedSources']
    for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays']:
        assert before[group] == baseline[group], group
    assert before['protectedCore'] == freeze['protectedCore']
    save('before-d8.json', before)
    write('index.before.raw', Path(before['source']['indexPath']).read_bytes())
    copies = directory / 'overlays-before'
    copies.mkdir(exist_ok=False)
    for path, digest in before['overlays'].items():
        copy = copies / Path(path).name
        with copy.open('xb') as stream:
            stream.write((root / path).read_bytes())
        assert sha(copy.read_bytes()) == digest
    write('source-six-paths.diff', git('diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', plan['currentHead'], freeze['source']['head']))
    started = datetime.now(timezone.utc).isoformat()
    with (directory / 'ff-only.stdout.log').open('xb') as stdout, (directory / 'ff-only.stderr.log').open('xb') as stderr:
        result = subprocess.run(plan['plannedGitArgv'], env=environment, stdout=stdout, stderr=stderr, check=False)
    save('FF-ONLY.receipt.json', {'argv': plan['plannedGitArgv'], 'startedUtc': started, 'finishedUtc': datetime.now(timezone.utc).isoformat(),
        'exitCode': result.returncode, 'stdout': pin(directory / 'ff-only.stdout.log'), 'stderr': pin(directory / 'ff-only.stderr.log'),
        'admissionPath': str(admission_path), 'admissionSha256': sha(admission_path.read_bytes())})
    assert result.returncode == 0
    after = snapshot()
    save('after-a0.json', after)
    write('index.after.raw', Path(after['source']['indexPath']).read_bytes())
    assert after['source']['head'] == freeze['source']['head'] and after['source']['tree'] == freeze['source']['tree']
    assert after['source']['status'] == before['source']['status']
    for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays', 'protectedCore', 'protectedConfigs', 'selectedModuleFiles']:
        assert after[group] == before[group], group
    for path, expected in freeze['files'].items():
        assert pin(root / path) == expected, path
    assert after['source']['selectedSources'] == target_binding['source']['selectedSources']
    for path, expected in after['overlays'].items():
        assert (root / path).read_bytes() == (copies / Path(path).name).read_bytes()
    target_binding['source'] = {key: after['source'][key] for key in target_binding['source']}
    assert target_binding['executionAdmitted'] is False and target_binding['rootAdmission'] == {'path': None, 'sha256': None}
    save('ROOT-BINDING.unarmed.json', target_binding)
    receipt = {'oldHead': before['source']['head'], 'newHead': after['source']['head'], 'newTree': after['source']['tree'],
        'oldIndexSha256': before['source']['indexSha256'], 'newIndexSha256': after['source']['indexSha256'],
        'newStagedEntriesSha256': after['source']['stagedEntriesSha256'], 'exactSixPathDeltaVerified': changed,
        'protectedCoreConfigDependencyGitDeltaEmpty': True, 'allFiveOverlayBytesUnchanged': True,
        'b3NotReapplied': True, 'protectedConfigsRecorded': len(config_paths),
        'root19Independent18MetadataModulesCoreConfigsUnchanged': True, 'commonIndexAbsent': True,
        'trackedAndStagedDiffExit': 0, 'rawIndexCopiesPreserved': True,
        'unarmedBindingSha256': sha((directory / 'ROOT-BINDING.unarmed.json').read_bytes()),
        'runnerSha256': plan['runnerSha256'], 'testsBuildBrowserRun': False, 'executionAdmitted': False, 'nextRead': False}
    save('REBIND.json', receipt)
    print(json.dumps(receipt, indent=2))
except Exception:
    with (directory / 'FAILURE.txt').open('x', encoding='utf-8') as stream:
        stream.write(traceback.format_exc())
    raise
