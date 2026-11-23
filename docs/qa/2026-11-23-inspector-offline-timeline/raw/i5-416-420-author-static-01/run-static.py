from datetime import datetime, timezone
import difflib
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

W = Path(r'G:/ggq/gg-i5-offline-inspector/GraphGoblin').resolve(strict=True)
E = Path(r'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-420-author-static-01').resolve(strict=True)
H = E.parent / 'i5-416-420-claude-author-harvest-01'
S = E.parent / 'i5-d240-actual-max-ui-author-01' / 'source-after.json'
NODE_DIR = Path(os.environ['USERPROFILE']) / '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64'
ENV = os.environ | {'PATH': str(NODE_DIR) + os.pathsep + os.environ['PATH']}
CMD = os.environ['COMSPEC']
HARVEST_SHA = 'c5b8877db9fbd80bb0c48b7efac6edbad133d0c8d89a342e8cd36c9e1e846cfd'


def now():
    return datetime.now(timezone.utc).isoformat()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(blob):
    return {'bytes': len(blob), 'sha256': sha256(blob).hexdigest()}


def pin(path):
    return digest(path.read_bytes())


def write(file, data):
    with (E / file).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def run(label, argv):
    stdout_path = E / f'{label}.stdout'
    stderr_path = E / f'{label}.stderr'
    start = now()
    with stdout_path.open('xb') as stdout, stderr_path.open('xb') as stderr:
        result = subprocess.run(argv, cwd=W, env=ENV, stdout=stdout, stderr=stderr, check=False)
    receipt = {'cwd': str(W), 'argv': argv, 'startedUtc': start, 'finishedUtc': now(),
               'exit': result.returncode, 'stdout': pin(stdout_path), 'stderr': pin(stderr_path)}
    write(f'{label}.json', receipt)
    print(label, result.returncode, flush=True)
    return result.returncode


def pnpm(label, *argv):
    assert all(re.fullmatch(r'[-a-zA-Z0-9@._/]+', arg) for arg in argv)
    return run(label, [CMD, '/d', '/s', '/c', ' '.join(('pnpm.cmd', *argv))])


def controls(snapshot):
    state = {name: pin(Path(snapshot[name]['source'])) for name in ('index', 'lock', 'modules')}
    state['virtualStoreLock'] = pin(W / 'node_modules/.pnpm/lock.yaml')
    state['core'] = {name: pin(W / name) for name in snapshot['core']}
    index = Path(snapshot['index']['source'])
    state['commonIndexPresent'] = (index.parent.parent.parent / 'index').exists()
    state['sourceAfter'] = pin(S)
    return state


def main():
    assert pin(H / 'HARVEST.json')['sha256'] == HARVEST_SHA
    harvest = read(H / 'HARVEST.json')
    assert harvest['coreAndSourceControlsUnchanged']
    source = read(S)
    snapshot = source['snapshot']
    assert source['sourceAndControlsVerified']
    assert harvest['base'] == snapshot['source']
    files = harvest['changedPaths']
    sources = list(files)
    ts_files = [path for path in sources if path.endswith(('.ts', '.tsx'))]
    assert len(sources) == 15 and len(ts_files) == 13 and not set(sources) & snapshot['core'].keys()
    assert all((W / name).resolve(strict=True) == W / name for name in sources)
    before_blobs = {name: (W / name).read_bytes() for name in sources}
    before = {name: digest(blob) for name, blob in before_blobs.items()}
    for name, record in files.items():
        retained = Path(record['retained']['source'])
        assert retained == H / 'raw-source' / name
        assert before[name] == pin(retained) == {key: record['original'][key] for key in ('bytes', 'sha256')}
        assert Path(record['original']['source']) == W / name
    before_controls = controls(snapshot)
    for role in ('index', 'lock', 'modules'):
        assert before_controls[role] == {key: snapshot[role][key] for key in ('bytes', 'sha256')}
    for name, record in snapshot['core'].items():
        assert before_controls['core'][name] == {key: record[key] for key in ('bytes', 'sha256')}
    assert not before_controls['commonIndexPresent']
    write('BEFORE.json', {'harvestSha256': HARVEST_SHA, 'sourceFromAuthorClosure': snapshot['source'],
                          'authors': before, 'controls': before_controls, 'eslintPaths': ts_files})

    node = shutil.which('node.exe', path=ENV['PATH'])
    pnpm_path = shutil.which('pnpm.cmd', path=ENV['PATH'])
    assert node and pnpm_path and Path(node).resolve() == (NODE_DIR / 'node.exe').resolve()
    write('RUNTIME.json', {'nodePath': node, 'pnpmPath': pnpm_path})
    assert run('00-node', [node, '--version']) == 0
    assert pnpm('00-pnpm', '--version') == 0
    assert (E / '00-node.stdout').read_text(encoding='utf-8').strip() == 'v22.23.4'
    assert (E / '00-pnpm.stdout').read_text(encoding='utf-8').strip() == '12.8.1'

    typecheck = pnpm('01-typecheck', '--filter', '@graphgoblin/web', 'run', 'typecheck')
    lint = pnpm('02-eslint', 'exec', 'eslint', *ts_files)
    format_check = pnpm('03-prettier-check', 'exec', 'prettier', '--check', *sources)
    after_first = {name: pin(W / name) for name in sources}
    after_first_controls = controls(snapshot)
    write('AFTER-FIRST.json', {'authors': after_first, 'controls': after_first_controls})
    assert before == after_first and before_controls == after_first_controls

    formatting = None
    recheck = None
    if typecheck == lint == 0 and format_check == 1:
        warnings = (E / '03-prettier-check.stderr').read_text(encoding='utf-8')
        if '[error]' not in warnings and 'Code style issues found' in warnings:
            formatting = pnpm('04-prettier-write', 'exec', 'prettier', '--write', *sources)
            recheck = pnpm('05-prettier-recheck', 'exec', 'prettier', '--check', *sources)

    after_blobs = {name: (W / name).read_bytes() for name in sources}
    after = {name: digest(blob) for name, blob in after_blobs.items()}
    after_controls = controls(snapshot)
    changed = [name for name in sources if before[name] != after[name]]
    if changed:
        with (E / 'format.delta.patch').open('x', encoding='utf-8', newline='\n') as delta:
            for name in changed:
                delta.writelines(difflib.unified_diff(
                    before_blobs[name].decode('utf-8').splitlines(keepends=True),
                    after_blobs[name].decode('utf-8').splitlines(keepends=True),
                    fromfile=f'a/{name}', tofile=f'b/{name}'
                ))
    write('AFTER.json', {'authors': after, 'controls': after_controls})
    ok = (typecheck == lint == 0 and before_controls == after_controls and
          (format_check == 0 or formatting == recheck == 0))
    write('RESULT.json', {'webTypecheckExit': typecheck, 'scopedEslintExit': lint,
                          'firstPrettierCheckExit': format_check, 'prettierWriteExit': formatting,
                          'prettierRecheckExit': recheck, 'formatChangedPaths': changed,
                          'beforeAndAfterControlsMatch': before_controls == after_controls,
                          'firstStaticSuiteHadNoSourceChanges': before == after_first,
                          'staticAccepted': ok})
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
