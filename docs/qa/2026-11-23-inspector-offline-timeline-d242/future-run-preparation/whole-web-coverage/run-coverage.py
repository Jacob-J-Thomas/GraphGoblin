from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

W = Path(r'G:/ggq/gg-i5-offline-inspector/GraphGoblin')
E = Path(r'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d242-b2-web-coverage-01')
BINDING = E / 'BINDING.json'  # Root creates only after exact-source admission; template is unarmed.
NODE = Path(os.environ['USERPROFILE']) / '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64'
ENV = os.environ | {'PATH': str(NODE) + os.pathsep + os.environ['PATH']}
GIT_ENV = ENV | {'GIT_NO_LAZY_FETCH': '1', 'GIT_OPTIONAL_LOCKS': '0'}
CORE = ('apps/web/src/api/queries.ts', 'apps/web/src/runs/inspector-read-provenance.ts',
        'apps/web/src/runs/inspector-read-provenance.test.ts')


def utc():
    return datetime.now(timezone.utc).isoformat()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def pin(path):
    blob = path.read_bytes()
    return {'bytes': len(blob), 'sha256': sha256(blob).hexdigest()}


def write(name, data):
    with (E / name).open('x', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')


def git(*args):
    return subprocess.check_output(
        ['git', '--no-optional-locks', *args], cwd=W, env=GIT_ENV
    ).decode('utf-8').strip()


def state(paths):
    index = (W / git('rev-parse', '--git-path', 'index')).resolve()
    common = (W / git('rev-parse', '--git-common-dir')).resolve()
    return {'head': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}'),
            'status': git('status', '--porcelain=v1', '--untracked-files=all'),
            'sourceFiles': {path: pin(W / path) for path in paths},
            'core': {path: pin(W / path) for path in CORE},
            'indexPath': str(index), 'index': pin(index),
            'commonIndexPresent': (common / 'index').exists(),
            'lock': pin(W / 'pnpm-lock.yaml'), 'modules': pin(W / 'node_modules/.modules.yaml'),
            'virtualStoreLock': pin(W / 'node_modules/.pnpm/lock.yaml')}


def artifacts():
    base = W / 'apps/web/coverage'
    return {name: {'path': str(base / name), 'modifiedNs': (base / name).stat().st_mtime_ns,
                   **pin(base / name)} for name in ('coverage-summary.json', 'coverage-final.json')
            if (base / name).is_file()}


def main():
    binding = read(BINDING)
    assert binding['launchAdmitted'] is True
    HEAD, TREE = binding['head'], binding['tree']
    assert all(isinstance(value, str) and len(value) == 40
               and all(char in '0123456789abcdef' for char in value) for value in (HEAD, TREE))
    receipt_pins = {}
    for role in ('freeze', 'rootFocusedChecks', 'independentQaClosure', 'buildClosure'):
        receipt = binding[role]
        assert isinstance(receipt['path'], str) and Path(receipt['path']).is_absolute()
        assert isinstance(receipt['sha256'], str) and len(receipt['sha256']) == 64
        assert all(char in '0123456789abcdef' for char in receipt['sha256'])
        actual = pin(Path(receipt['path']))
        assert actual['sha256'] == receipt['sha256']
        receipt_pins[role] = {'path': receipt['path'], **actual}
    FREEZE = Path(binding['freeze']['path'])
    FROZEN_SHA = binding['freeze']['sha256']
    assert pin(FREEZE)['sha256'] == FROZEN_SHA
    freeze = read(FREEZE)
    corrected = read(Path(binding['rootFocusedChecks']['path']))
    pre = state(corrected['authors'])
    assert pre['head'] == HEAD and pre['tree'] == TREE and not pre['status']
    assert pre['sourceFiles'] == corrected['authors']
    assert not pre['commonIndexPresent']
    assert all(pre[role] == corrected['controls'][role] for role in ('core', 'lock', 'modules', 'virtualStoreLock'))
    old_artifacts = artifacts()
    write('BEFORE.json', pre | {'freeze': pin(FREEZE), 'binding': pin(BINDING),
                              'admittedReceiptPins': receipt_pins, 'existingCoverageArtifacts': old_artifacts})
    node = shutil.which('node.exe', path=ENV['PATH'])
    pnpm = shutil.which('pnpm.cmd', path=ENV['PATH'])
    assert node and Path(node).resolve() == (NODE / 'node.exe').resolve() and pnpm
    cmd = os.environ['COMSPEC']
    nv = subprocess.check_output([node, '--version'], cwd=W, env=ENV).decode().strip()
    pv = subprocess.check_output([cmd, '/d', '/s', '/c', 'pnpm.cmd --version'], cwd=W, env=ENV).decode().strip()
    assert nv == 'v22.23.4' and pv == '12.8.1'
    report = E / 'vitest-results.json'
    args = ['pnpm.cmd', '--filter', '@graphgoblin/web', 'test:coverage', '--retry=0',
            '--reporter=verbose', '--reporter=json', '--outputFile.json=' + report.as_posix()]
    command = [cmd, '/d', '/s', '/c', subprocess.list2cmdline(args)]
    started = utc()
    started_ns = time.time_ns()
    write('LAUNCH.json', {'argv': command, 'pnpmArgv': args, 'cwd': str(W), 'node': nv,
                          'pnpm': pv, 'startedUtc': started, 'nodePath': node, 'pnpmPath': pnpm})
    print('Whole-web coverage launched', started, flush=True)
    with (E / 'vitest.stdout').open('xb') as stdout, (E / 'vitest.stderr').open('xb') as stderr:
        result = subprocess.run(command, env=ENV, cwd=W, stdout=stdout, stderr=stderr, check=False)
    write('COMMAND.json', {'argv': command, 'pnpmArgv': args, 'cwd': str(W), 'node': nv, 'pnpm': pv,
                           'startedUtc': started, 'finishedUtc': utc(), 'exit': result.returncode,
                           'stdout': pin(E / 'vitest.stdout'), 'stderr': pin(E / 'vitest.stderr'),
                           'report': pin(report) if report.is_file() else None})
    post = state(corrected['authors'])
    generated = artifacts()
    fresh = {}
    for name, artifact in generated.items():
        if artifact['modifiedNs'] >= started_ns:
            out = E / name
            with out.open('xb') as file:
                file.write(Path(artifact['path']).read_bytes())
            assert pin(out) == {key: artifact[key] for key in ('bytes', 'sha256')}
            fresh[name] = artifact
    write('AFTER.json', post | {'freshCoverageArtifacts': fresh})
    summary = {'exit': result.returncode, 'sourceAndControlsUnchanged': pre == post,
               'freshCoverageFiles': list(fresh), 'jsonReporterPresent': report.is_file()}
    if report.is_file():
        data = read(report)
        statuses = ('passed', 'failed', 'pending', 'skipped', 'todo')
        summary['files'] = len(data.get('testResults', []))
        cases = [case for suite in data.get('testResults', []) for case in suite.get('assertionResults', [])]
        summary['caseCounts'] = {status: sum(case['status'] == status for case in cases) for status in statuses}
        summary['reporterCounts'] = {k: v for k,v in data.items() if k.startswith('num') or k == 'success'}
        summary['failures'] = [{'file': suite['name'], 'name': case['fullName'], 'messages': case.get('failureMessages', [])}
                               for suite in data.get('testResults', []) for case in suite.get('assertionResults', [])
                               if case['status'] == 'failed']
    if 'coverage-summary.json' in fresh:
        summary['coverage'] = read(E / 'coverage-summary.json')['total']
    write('RESULT.json', summary)
    print('Exit', result.returncode, 'source and controls unchanged', pre == post, 'files', summary.get('files'),
          'cases', summary.get('caseCounts'), 'coverage', summary.get('coverage'), flush=True)
    return result.returncode or (0 if pre == post else 1)


if __name__ == '__main__':
    sys.exit(main())
