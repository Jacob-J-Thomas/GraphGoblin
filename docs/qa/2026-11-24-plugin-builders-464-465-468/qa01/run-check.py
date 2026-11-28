"""Exact, read-only-source #464/#465/#468 QA commands with raw receipts outside the checkout."""

import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

sys.dont_write_bytecode = True
from importlib import import_module

QA = Path(__file__).resolve().parent
BUNDLE = QA.parent
BASE = BUNDLE.parent
sys.path.insert(0, str(BASE / 'scope-preparation-01'))
shared = import_module('prepare-scope')
source_tools = import_module('run-implementation')
WORKTREE = Path('G:/ggq/gg-fu-plugin-builders-20261124/GraphGoblin').resolve()
BASH = Path('C:/Program Files/Git/bin/bash.exe')
MANIFEST = BUNDLE / 'review-02/CANDIDATE-MANIFEST.json'
PATCH = BUNDLE / 'review-02/CANDIDATE.patch'
PATCH_SHA = 'd1e99a060d475bd9de483c46df4e3ddfb95a498e59675ee2b2900c63595a65c9'

NATIVE_DRIVER = QA / 'native-plugin-checks.mjs'
CHECKS = {
    'build': 'pnpm build --filter=@graphgoblin/plugin-codex --filter=@graphgoblin/plugin-claude --force',
    'codex': 'pnpm --filter @graphgoblin/plugin-codex test src/plugin.test.ts --reporter=verbose',
    'claude': 'pnpm --filter @graphgoblin/plugin-claude test src/plugin.test.ts --reporter=verbose',
    'writer': 'pnpm --filter @graphgoblin/tooling test plugin-output.test.mjs --reporter=verbose',
    'native': 'node ' + NATIVE_DRIVER.as_posix(),
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def environment():
    env = shared.subscription_environment()
    env.update(
        GIT_OPTIONAL_LOCKS='0',
        GIT_TERMINAL_PROMPT='0',
        CLAUDE_CODE_GIT_BASH_PATH=str(BASH),
    )
    return env


def git(env, *args):
    result = subprocess.run(
        ['git', '--no-pager', '--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', *args],
        cwd=WORKTREE, env=env, check=True, capture_output=True, timeout=30,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    return result.stdout.decode('utf-8').strip('\r\n')


def snapshot(env):
    manifest = shared.read_json(MANIFEST)
    if Path(manifest['repository']).resolve() != WORKTREE:
        raise RuntimeError('WRONG_FROZEN_WORKTREE')
    expected = {item['path']: item['sha256'] for item in manifest['sourceFiles']}
    untracked_expected = sorted(item['path'] for item in manifest['sourceFiles'] if item.get('untracked'))
    data = {
        'head': git(env, 'rev-parse', 'HEAD'),
        'branch': git(env, 'branch', '--show-current'),
        'patchSha256': sha(PATCH),
        'manifestSha256': sha(MANIFEST),
        'indexSha256': sha(Path(git(env, 'rev-parse', '--path-format=absolute', '--git-path', 'index'))),
        'stagedPaths': sorted(source_tools.named_paths(git(env, 'diff', '--cached', '--name-only', '-z'))),
        'untrackedPaths': sorted(source_tools.named_paths(git(env, 'ls-files', '--others', '--exclude-standard', '-z'))),
        'changedFilesSha256': {
            name: sha(WORKTREE / name)
            for name in source_tools.named_paths(git(env, 'diff', '--name-only', '--no-renames', '-z', 'HEAD'))
        },
        'nativeDriverSha256': sha(NATIVE_DRIVER),
    }
    if (
        data['head'] != manifest['headSha']
        or data['branch'] != manifest['branch']
        or data['patchSha256'] != manifest['patchSha256']
        or data['patchSha256'] != PATCH_SHA
        or data['stagedPaths']
        or data['untrackedPaths'] != untracked_expected
        or data['changedFilesSha256'] != expected
    ):
        raise RuntimeError('FROZEN_WORKTREE_IDENTITY_MISMATCH')
    return data


def execute(command, env):
    return subprocess.run(
        [str(BASH), '--noprofile', '--norc', '-c', command],
        cwd=WORKTREE,
        env=env,
        capture_output=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )


def safe_summary(output, mode, succeeded):
    text = output.decode('utf-8', errors='replace')
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    text = re.sub(r'\bgg_[A-Za-z0-9_-]{16,}\b', '[disposable-key]', text)
    text = re.sub(r'(?im)^.*(?:api[-_ ]key|authorization)[^\r\n]*(?:=|:\s*Bearer\s+)[^\r\n]*$', '[redacted fixture credential line]', text)
    if succeeded and mode != 'native':
        lines = [
            line.strip()
            for line in text.splitlines()
            if re.search(r'(?:\bTest Files\b|\bTests\b|\bTasks:|\bCached:|\bTime:|✓|↑|↓|All matched files|Checking formatting)', line)
        ]
        return '\n'.join(lines[-65:])
    return '\n'.join(text.splitlines()[-75:])


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in CHECKS:
        raise SystemExit('Use one of: ' + ', '.join(CHECKS))
    mode = sys.argv[1]
    expected = shared.read_json(QA / 'FROZEN-BEFORE.json')
    env = environment()
    if snapshot(env) != expected:
        raise RuntimeError('BEFORE_CHECK_SNAPSHOT_MISMATCH')
    if mode == 'native':
        build = shared.read_json(QA / 'BUILD-RESULT.json')
        if build['exitCode'] != 0 or not build['sourceUnchanged'] or build['patchSha256'] != PATCH_SHA:
            raise RuntimeError('QA_BUILD_REQUIRED')
    receipt_path = QA / f'{mode.upper()}-RESULT.json'
    stdout_path = QA / f'{mode}.stdout.log'
    stderr_path = QA / f'{mode}.stderr.log'
    started = shared.utc_now()
    with stdout_path.open('xb') as stdout, stderr_path.open('xb') as stderr:
        result = execute(CHECKS[mode], env)
        stdout.write(result.stdout)
        stderr.write(result.stderr)
    try:
        unchanged = snapshot(env) == expected
    except (OSError, RuntimeError, subprocess.SubprocessError):
        unchanged = False
    status = {
        'mode': mode, 'command': CHECKS[mode], 'workingDirectory': WORKTREE.as_posix(),
        'startedAt': started, 'finishedAt': shared.utc_now(), 'exitCode': result.returncode,
        'patchSha256': PATCH_SHA, 'sourceUnchanged': unchanged,
        'stdout': {'file': stdout_path.name, 'bytes': len(result.stdout), 'sha256': sha(stdout_path)},
        'stderr': {'file': stderr_path.name, 'bytes': len(result.stderr), 'sha256': sha(stderr_path)},
    }
    shared.save_json(receipt_path, status)
    print(json.dumps(status, indent=2, ensure_ascii=True))
    summary = safe_summary(result.stdout + b'\n' + result.stderr, mode, result.returncode == 0)
    if summary:
        print(summary.encode('ascii', errors='backslashreplace').decode('ascii'))
    return result.returncode if unchanged else 2


if __name__ == '__main__':
    sys.exit(main())

