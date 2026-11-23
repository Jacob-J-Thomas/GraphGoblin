from datetime import datetime, timezone
import difflib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import traceback

directory = Path(__file__).parent
evidence = directory.parent
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
old_packet = evidence / 'i5-d241-observation-entry-loss-independent-qa-01'
old_binding = json.loads((old_packet / 'ROOT-BINDING.admitted.json').read_text())
prep1 = evidence / 'i5-d241-observation-entry-loss-corrected-preparation-01'
prep2 = evidence / 'i5-d241-observation-entry-loss-corrected-preparation-02'
freeze_path = evidence / 'i5-d241-residual-corrected-freeze-01/FREEZE.json'
accept_path = evidence / 'i5-416-420-baseline-g1-preparation-01/B3-FIXTURE-ACCEPTANCE-BINDING.json'
disposition = evidence / 'i5-416-420-native-failure-followup-preparation-01/ROOT-DISPOSITION.md'
old_head = '2231400e7986f349376d7c19ebd62ae71f7708a4'
new_head = 'd8bc84937363bbde1d24b561efdcd9e8601a48a7'
new_tree = 'e94fb9c910696baddd7278992ed716af4ca747d0'
listener_path = 'apps/web/e2e/independent-416-listener.qa.spec.ts'
component_path = 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'
environment = dict(os.environ, GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pin(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': sha(data)}


def save(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def write(path, data):
    with path.open('xb') as stream:
        stream.write(data)


def git(*arguments):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(root), *arguments], env=environment)


def snapshot():
    index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
    common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
    result = {
        'source': {
            'head': git('rev-parse', 'HEAD').decode().strip(), 'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
            'indexSha256': sha(index.read_bytes()), 'indexPath': str(index),
            'stagedEntriesSha256': sha(git('ls-files', '--stage', '-z')),
            'commonIndexExists': (common / 'index').exists(),
            'status': git('status', '--porcelain=v1', '--untracked-files=all', '-z').decode().split('\0')[:-1],
            'selectedSources': {path: sha((root / path).read_bytes()) for path in source_paths},
        },
        'rootInstallInputs19': {path: pin(root / path) for path in old_binding['rootInstallInputs19']},
        'independentInputs18': {path: sha((root / path).read_bytes()) for path in old_binding['independentInputs18']},
        'metadata': {path: sha((root / path).read_bytes()) for path in old_binding['metadata']},
        'overlays': {path: sha((root / path).read_bytes()) for path in old_binding['overlays']},
        'protectedCore': {path: pin(root / path) for path in freeze['protectedCore']},
        'selectedModuleFiles': {},
    }
    for module in old_binding['selectedModules']:
        entry = Path(module['entry'])
        actual = {'entrySha256': sha(entry.read_bytes()), 'physicalEntry': str(entry.resolve())}
        assert actual['entrySha256'] == module['entrySha256'], module['name']
        assert actual['physicalEntry'].casefold() == str(Path(module['realEntry']).resolve()).casefold()
        if 'manifest' in module:
            actual['manifestSha256'] = sha(Path(module['manifest']).read_bytes())
            assert actual['manifestSha256'] == module['manifestSha256'], module['name']
        result['selectedModuleFiles'][module['name']] = actual
    assert sha(Path(old_binding['runtime']['node']['path']).read_bytes()) == old_binding['runtime']['node']['sha256']
    for path_key, hash_key in [('pnpmLauncher', 'launcherSha256'), ('pnpmExecutable', 'executableSha256'), ('packagePath', 'packageSha256')]:
        assert sha(Path(old_binding['runtime']['pnpm'][path_key]).read_bytes()) == old_binding['runtime']['pnpm'][hash_key]
    assert not git('diff', '--exit-code', '--no-ext-diff', '--no-textconv')
    assert not git('diff', '--cached', '--exit-code', '--no-ext-diff', '--no-textconv')
    result['trackedAndStagedDiffExit'] = 0
    return result


try:
    assert sha(freeze_path.read_bytes()) == '24b361c15b8d64d9090d8c1420ee84dd6f01c075e91cb9a0b1b46e3fc26317bf'
    freeze = json.loads(freeze_path.read_text())
    assert freeze['source'] == {'head': new_head, 'tree': new_tree, 'parents': [old_head]}
    assert sha(accept_path.read_bytes()) == '31678cf11c361b6e3b1cf59736764926f412138e4b8e29012b999b8bdc67db51'
    assert sha(disposition.read_bytes()) == '5d2712c2714dc7a5e4f9d65a0c921dd10192c09df4d3db52c6e4554e879451e0'
    accept = json.loads(accept_path.read_text())
    proposal = Path(accept['proposed']['path']).read_bytes()
    assert {'bytes': len(proposal), 'sha256': sha(proposal)} == {key: accept['proposed'][key] for key in ['bytes', 'sha256']}
    assert sha(proposal) == '6ed24b1b26ba63b1ab245100e3a4a01c078b8baa4b069d336bb4c3716ceacca5'
    source_paths = list(dict.fromkeys([*old_binding['source']['selectedSources'], *freeze['files'], *freeze['protectedCore'], 'apps/web/tsconfig.json']))
    assert git('rev-list', '--parents', '-n', '1', new_head).decode().strip().split() == [new_head, old_head]
    assert git('show', '-s', '--format=%T', new_head).decode().strip() == new_tree
    assert git('diff', '--name-only', '--no-renames', '-z', old_head, new_head).decode().split('\0')[:-1] == freeze['exactDeltaFromPriorFreeze']
    before = snapshot()
    for key, expected in old_binding['source'].items():
        if key != 'selectedSources':
            assert before['source'][key] == expected, key
    for path, expected in old_binding['source']['selectedSources'].items():
        assert before['source']['selectedSources'][path] == expected, path
    for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays']:
        assert before[group] == old_binding[group], group
    assert before['source']['head'] == old_head and not before['source']['commonIndexExists']
    assert before['protectedCore'] == freeze['protectedCore']
    save(directory / 'before-223.json', before)
    copies = directory / 'overlays-before'
    copies.mkdir(exist_ok=False)
    for path, digest in before['overlays'].items():
        write(copies / Path(path).name, (root / path).read_bytes())
        assert sha((copies / Path(path).name).read_bytes()) == digest
    listener_before = (root / listener_path).read_bytes()
    assert sha(listener_before) == accept['expectedCurrentSha256']
    lines = proposal.decode().splitlines(keepends=True)
    additions = ['  const controlledTerminalAt = run.startedAt ?? run.createdAt;\n',
                 '      finishedAt: controlledTerminalAt,\n', '      finalizedAt: controlledTerminalAt,\n']
    normalized_before = listener_before.decode().replace('\r\n', '\n')
    normalized_proposal = proposal.decode().replace('\r\n', '\n')
    restored = normalized_proposal
    for addition in additions:
        assert restored.count(addition) == 1
        restored = restored.replace(addition, '')
    assert restored == normalized_before, 'B3 delta exceeds the exact three additions'
    write(directory / 'listener.proposed.ts', proposal)
    write(directory / 'B3-exact.diff', ''.join(difflib.unified_diff(normalized_before.splitlines(keepends=True),
          normalized_proposal.splitlines(keepends=True), fromfile='original581e/listener.ts', tofile='approved6ed/listener.ts')).encode())
    original_native = evidence / 'i5-416-420-browser12-execution-01'
    native_refs = {name: pin(original_native / name) for name in ['REPORT.md', 'browser-results.json']}
    save(directory / 'ORIGINAL-NATIVE-FAILURE-REFERENCES.json', {'packet': str(original_native), 'files': native_refs, 'modified': False})
    command = ['git', '--no-optional-locks', '-C', str(root), 'merge', '--ff-only', new_head]
    started = datetime.now(timezone.utc).isoformat()
    with (directory / 'ff-only.stdout.log').open('xb') as stdout, (directory / 'ff-only.stderr.log').open('xb') as stderr:
        result = subprocess.run(command, env=environment, stdout=stdout, stderr=stderr, check=False)
    save(directory / 'FF-ONLY.receipt.json', {'argv': command, 'startedUtc': started, 'finishedUtc': datetime.now(timezone.utc).isoformat(),
         'exitCode': result.returncode, 'stdout': pin(directory / 'ff-only.stdout.log'), 'stderr': pin(directory / 'ff-only.stderr.log')})
    assert result.returncode == 0
    after_ff = snapshot()
    save(directory / 'after-FF-d8-before-B3.json', after_ff)
    assert after_ff['source']['head'] == new_head and after_ff['source']['tree'] == new_tree
    for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays', 'protectedCore', 'selectedModuleFiles']:
        assert after_ff[group] == before[group], group
    for path, expected in freeze['files'].items():
        assert pin(root / path) == expected, path
    (root / listener_path).write_bytes(proposal)
    after = snapshot()
    save(directory / 'after-d8-and-approved-B3.json', after)
    assert after['source'] == after_ff['source']
    for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'protectedCore', 'selectedModuleFiles']:
        assert after[group] == before[group], group
    assert after['overlays'] == {**before['overlays'], listener_path: sha(proposal)}
    assert after['overlays'][component_path] == '8a344821db18ec25fa7cf2219c07721acf4eddae0d109b8eb3a412ca58aa6c2b'
    assert 'e2e' in json.loads((root / 'apps/web/tsconfig.json').read_text())['include']
    assert sha((prep1 / 'MANIFEST.json').read_bytes()) == '518ceb1c122388483cdbcf7bf5ad31ed0e9b30fcb5214f40ec0572435f7d858d'
    prep_members = json.loads((prep1 / 'MANIFEST.json').read_text())['members']
    for member in prep_members:
        assert pin(prep1 / member['path']) == {'bytes': member['bytes'], 'sha256': member['sha256']}
    prep2.mkdir(exist_ok=False)
    for name in ['run-corrected.ps1', 'module-boundary.cjs']:
        write(prep2 / name, (prep1 / name).read_bytes())
    assert sha((prep2 / 'run-corrected.ps1').read_bytes()) == 'd2b07274b7ee52f7a0ace866e81af44294b4497dd180e1fe17cb975f01615206'
    template = json.loads((prep1 / 'ROOT-BINDING.template.json').read_text())
    template['overlays'][listener_path] = sha(proposal)
    save(prep2 / 'ROOT-BINDING.template.json', template)
    write(prep2 / 'REPORT.md', (
        'Exact reviewed runnerd2b072 and module resolver copied byte-for-byte. Only its companion unarmed template listener pin changes581e to approved6ed. '
        'The full web typecheck includes e2e via apps/web/tsconfig.json, binding the new B3 source. No execution or rebind authority is granted. '
        'Original corrected-preparation01 remains immutable. Candidate/source binding is held in i5-d241-residual-corrected-qa-rebind-01.\n').encode())
    save(prep2 / 'MANIFEST.json', {'scope': 'Same reviewed runner/module; companion template admits exact B3 hash only',
        'members': [{'path': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())} for path in sorted(prep2.iterdir()) if path.is_file()]})
    binding = json.loads(json.dumps(template))
    binding['source'] = {key: after['source'][key] for key in template['source']}
    binding['overlays'] = after['overlays']
    binding['preparationManifestSha256'] = sha((prep2 / 'MANIFEST.json').read_bytes())
    assert not binding['executionAdmitted'] and binding['rootAdmission'] == {'path': None, 'sha256': None}
    save(directory / 'ROOT-BINDING.unarmed.json', binding)
    receipt = {'oldHead': old_head, 'newHead': new_head, 'newTree': new_tree,
        'oldIndexSha256': before['source']['indexSha256'], 'newIndexSha256': after['source']['indexSha256'],
        'newStagedEntriesSha256': after['source']['stagedEntriesSha256'],
        'onlyOverlayDelta': {listener_path: {'before': before['overlays'][listener_path], 'after': after['overlays'][listener_path]}},
        'componentAll63Unchanged': True, 'allOtherFourOverlaysPreserved': True,
        'root19Independent18MetadataModulesAndProtectedCorePreserved': True,
        'commonIndexAbsent': True, 'trackedAndStagedDiffExit': 0, 'fullTypecheckIncludesB3ThroughE2eInclude': True,
        'reviewedRunnerSha256': sha((prep2 / 'run-corrected.ps1').read_bytes()),
        'preparedCompanionManifestSha256': sha((prep2 / 'MANIFEST.json').read_bytes()),
        'unarmedBindingSha256': sha((directory / 'ROOT-BINDING.unarmed.json').read_bytes()),
        'originalFailureReferencesUnchanged': all(pin(original_native / name) == value for name, value in native_refs.items()),
        'testsBuildBrowserRun': False, 'nextRead': False, 'executionAdmitted': False}
    save(directory / 'REBIND.json', receipt)
    print(json.dumps(receipt, indent=2))
except Exception:
    with (directory / 'FAILURE.txt').open('x', encoding='utf-8') as stream:
        stream.write(traceback.format_exc())
    raise
