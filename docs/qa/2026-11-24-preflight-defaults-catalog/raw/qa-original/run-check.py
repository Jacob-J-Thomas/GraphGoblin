"""Exact read-only-source QA commands for the frozen #545/#546 candidate."""

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
WORKTREE = Path('G:/ggq/gg-fu-preflight-20261124/GraphGoblin').resolve()
BASH = Path('C:/Program Files/Git/bin/bash.exe')
MANIFEST = BUNDLE / 'review-01/source-manifest.json'
PATCH = BUNDLE / 'review-01/patch.diff'
PATCH_SHA = '9d58186982ab043a02ad810953ec58fe609a03e69756555a7cdd0c9ff22dffaa'
HEAD = 'd2df8600c2c8574bec420947de686b936910b245'
BRANCH = 'codex/gg-fu-preflight-20261124'
BASELINE = BUNDLE / 'BASELINE-PUBLIC-ENTRY.json'
NATIVE = QA / 'reproduce-candidate-public-entry.mjs'
BUILT = ('apps/api/dist/main.js', 'apps/api/dist/serve.js',
         'apps/api/dist/preflight.js', 'apps/api/dist/container.js',
         'packages/infrastructure/dist/sqlite/settings.js',
         'packages/domain/dist/model-resolution.js')
CHECKS = {
    'build': 'pnpm build --filter=@graphgoblin/api --force',
    'native': f'node --expose-gc {NATIVE.as_posix()} {WORKTREE.as_posix()} {QA.as_posix()} CANDIDATE-PUBLIC-ENTRY.json',
    'focused': 'pnpm --filter @graphgoblin/api test src/preflight-catalog.test.ts src/preflight.test.ts src/preflight-ollama.test.ts',
    'diff': 'git --no-pager diff --check',
}
DEADLINES = {'build': 240, 'native': 175, 'focused': 120, 'diff': 30}


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
    return source_tools.git(WORKTREE, env, *args)


def snapshot(env):
    expected = {item['path']: item['sha256'] for item in shared.read_json(MANIFEST)}
    data = {
        'head': git(env, 'rev-parse', 'HEAD'),
        'branch': git(env, 'branch', '--show-current'),
        'patchSha256': sha(PATCH),
        'manifestSha256': sha(MANIFEST),
        'baselineSha256': sha(BASELINE),
        'nativeScriptSha256': sha(NATIVE),
        'indexSha256': sha(Path(git(env, 'rev-parse', '--path-format=absolute', '--git-path', 'index'))),
        'stagedPaths': sorted(source_tools.named_paths(git(env, 'diff', '--cached', '--name-only', '-z'))),
        'untrackedPaths': sorted(source_tools.named_paths(git(env, 'ls-files', '--others', '--exclude-standard', '-z'))),
        'changedFilesSha256': source_tools.worktree_changes(WORKTREE, env),
    }
    if (
        data['head'] != HEAD or data['branch'] != BRANCH or data['patchSha256'] != PATCH_SHA
        or data['stagedPaths'] or data['untrackedPaths'] or data['changedFilesSha256'] != expected
    ):
        raise RuntimeError('FROZEN_WORKTREE_IDENTITY_MISMATCH')
    return data


def built_artifacts():
    return {name: sha(WORKTREE / name) for name in BUILT}


def execute(command, env, timeout=30):
    return subprocess.run(
        [str(BASH), '--noprofile', '--norc', '-c', command],
        cwd=WORKTREE, env=env, capture_output=True, timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )


def public_entry_summary():
    baseline = {r['name']: r for r in shared.read_json(BASELINE)}
    candidate_path = QA / 'CANDIDATE-PUBLIC-ENTRY.json'
    candidate = {r['name']: r for r in shared.read_json(candidate_path)}
    expected = {
        'migrated-none': (1, 'FAIL', 'EFFORT_UNSUPPORTED', 1),
        'migrated-low': (0, 'ok', 'supports effort low', 0),
        'migrated-omitted': (0, 'WARN', 'effort is not set', 0),
        'pending-disabled': (0, 'WARN', 'in the model catalog but disabled', None),
        'pending-stored-only': (0, 'ok', 'in the model catalog and supports effort low', 0),
        'pending-missing-seed': (0, 'ok', 'in the model catalog and supports effort medium', 0),
        'pending-stored-effort': (1, 'FAIL', 'EFFORT_UNSUPPORTED', 1),
        'missing': (0, 'ok', 'default catalog seeded on first start', 0),
        'unsupported': (1, 'WARN', 'not checked until the database is current and readable', 1),
        'unreadable': (1, 'WARN', 'not checked until the database is current and readable', 1),
    }
    if set(candidate) != set(expected):
        raise RuntimeError('PUBLIC_ENTRY_SCENARIO_SET_MISMATCH')
    summary = {}
    for name, row in candidate.items():
        old = baseline.get(name, {})
        preflight = row['preflight']
        startup = row.get('startup', {})
        before, after = row['before'], row['after']
        code, status, detail, start_exit = expected[name]
        model = re.search(r'^\s*(ok|WARN|FAIL)\s+Default model\s+(.+)$', preflight['stdout'], re.M)
        database = re.search(r'^\s*(ok|WARN|FAIL)\s+Database\s+(.+)$', preflight['stdout'], re.M)
        codex = re.search(r'^\s*ok\s+Harness codex\s+(.+)$', preflight['stdout'], re.M)
        if not model or not database or not codex:
            raise RuntimeError(f'MISSING_PHYSICAL_CHECK_LINES {name}')
        if (preflight['code'], model[1], startup.get('code')) != (code, status, start_exit) or detail not in model[2]:
            raise RuntimeError(f'PUBLIC_RESULT_MISMATCH {name}: {model[0]!r}')
        if start_exit == 0 and not startup.get('listened'):
            raise RuntimeError(f'EXPECTED_LISTENING {name}')
        if name in ('migrated-none', 'pending-stored-effort') and 'EFFORT_UNSUPPORTED' not in startup['stderr']:
            raise RuntimeError(f'EXPECTED_STARTUP_EFFORT_REFUSAL {name}')
        if name == 'unsupported' and ('format 3' not in database[2] or database[1] != 'FAIL'):
            raise RuntimeError('EXPECTED_UNSUPPORTED_REFUSAL')
        if name == 'unreadable' and ('SQLITE_NOTADB' not in database[2] or database[1] != 'FAIL'):
            raise RuntimeError('EXPECTED_UNREADABLE_REFUSAL')
        if name.startswith('pending-') and (
            '3 migration(s) pending' not in database[2] or database[1] != 'WARN'
            or before.get('-wal', {}).get('size', 0) <= 0
        ):
            raise RuntimeError(f'EXPECTED_REAL_MIGRATION_PREFIX_AND_WAL {name}')
        wal_preserved = (
            after.get('-wal') == before['-wal'] if '-wal' in before
            else after.get('-wal', {}).get('size', 0) == 0
        )
        if before.get('db') != after.get('db') or not wal_preserved:
            raise RuntimeError(f'DB_WAL_BYTES_CHANGED {name}')
        old_model = re.search(r'^\s*(ok|WARN|FAIL)\s+Default model\s+(.+)$',
                              old.get('preflight', {}).get('stdout', ''), re.M)
        summary[name] = {
            'baselinePreflightExit': old.get('preflight', {}).get('code'),
            'baselineModelCheck': old_model[0].strip() if old_model else None,
            'preflightExit': preflight['code'], 'startupExit': startup.get('code'),
            'listened': startup.get('listened', False),
            'database': database[0].strip(), 'model': model[0].strip(),
            'codexReadiness': codex[0].strip(),
            'existingWalBytes': before.get('-wal', {}).get('size'),
            'databaseBytesPreserved': True, 'existingWalBytesPreservedOrNewWalEmpty': True,
        }
    shared.save_json(QA / 'PUBLIC-ENTRY-COMPARISON.json', summary)
    return {'file': candidate_path.name, 'sha256': sha(candidate_path), 'scenarios': summary}


def safe_summary(output, mode, succeeded):
    text = output.decode('utf-8', errors='replace')
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    if succeeded and mode in ('build', 'focused', 'diff'):
        lines = [
            line.strip() for line in text.splitlines()
            if re.search(r'(?:(?<!\w)Test Files\b|\bTests\b|\bTasks:|\bCached:|\bTime:|✓)', line)
        ]
        return '\n'.join(lines[-24:])
    return '\n'.join(text.splitlines()[-35:])


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
        if (
            build['exitCode'] != 0 or not build['sourceUnchanged']
            or build['patchSha256'] != PATCH_SHA or build['builtArtifacts'] != built_artifacts()
        ):
            raise RuntimeError('QA_FROZEN_BUILD_REQUIRED')
    stdout_path, stderr_path = QA / f'{mode}.stdout.log', QA / f'{mode}.stderr.log'
    started = shared.utc_now()
    with stdout_path.open('xb') as stdout, stderr_path.open('xb') as stderr:
        result = execute(CHECKS[mode], env, DEADLINES[mode])
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
    if result.returncode == 0 and mode in ('build', 'native'):
        status['builtArtifacts'] = built_artifacts()
    if result.returncode == 0 and mode == 'native':
        try:
            status['comparison'] = public_entry_summary()
        except (AssertionError, KeyError, OSError, RuntimeError, ValueError) as error:
            status['exitCode'] = 3
            status['comparisonError'] = str(error)
    shared.save_json(QA / f'{mode.upper()}-RESULT.json', status)
    print(json.dumps(status, indent=2, ensure_ascii=True))
    if mode != 'native' or status['exitCode']:
        summary = safe_summary(result.stdout + b'\n' + result.stderr, mode, status['exitCode'] == 0)
        if summary:
            print(summary.encode('ascii', errors='backslashreplace').decode('ascii'))
    return status['exitCode'] if unchanged else 2


if __name__ == '__main__':
    sys.exit(main())
