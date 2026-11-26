"""B6 #561 unfiltered verification wrapper (claude-window-verification-03).

Runs named stages of a plan (the frozen VERIFICATION-CONTRACT.json `checks`, or a later plan with the
same shape) one at a time. Each stage writes complete raw stdout/stderr to files opened before process
creation, runs inside an owned Windows Job (kill-on-close) with the stage deadline, records the raw
exit code, the separate <=2 s owned-Job settlement, parsed vitest/turbo totals and the source state
before and after. Stops on the first non-pass. No pipes, no filtering, no retries.

Usage: python run-verification.py <plan.json> <output-root> <stage> [<stage> ...]
"""
from pathlib import Path
from importlib import util
import datetime, hashlib, json, os, re, shutil, subprocess, sys, time

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
TOKEN = b'B6-561-OWNED-STAGE\n'
NODE = Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe')
WORKTREE = Path('G:/ggq/gg-fu-api-client-561-20261124/GraphGoblin')
PROFILE_PARENT = Path('G:/ggq/tmp/b6-561')
CANDIDATE = [
    'CHANGELOG.md', 'docs/07-api-and-streaming.md',
    'packages/api-client/src/body.test.ts', 'packages/api-client/src/body.ts',
    'packages/api-client/src/client.ts', 'packages/api-client/src/errors.test.ts',
    'packages/api-client/src/errors.ts', 'packages/api-client/src/resources.ts',
]
SAFE_PROGRAM_FILES = {
    'ProgramFiles': 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    'ProgramW6432': 'C:\\Program Files',
}
GG_ENV = {'GG_OLLAMA_ENABLED': 'false', 'GG_OLLAMA_URL': 'http://127.0.0.1:1'}


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def need(ok, label):
    if not ok:
        raise RuntimeError(label)


def save(path, value):
    with Path(path).open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(value, handle, indent=2, ensure_ascii=True)
        handle.write('\n')


def git(*args):
    return subprocess.check_output(
        ['git', '--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', *args],
        cwd=WORKTREE, creationflags=subprocess.CREATE_NO_WINDOW).decode('utf-8', 'replace')


def source_state():
    return {
        'head': git('rev-parse', 'HEAD').strip(),
        'tree': git('rev-parse', 'HEAD^{tree}').strip(),
        'branch': git('branch', '--show-current').strip(),
        'statusPorcelain': git('status', '--porcelain=v1', '--untracked-files=all'),
        'candidateSha256': {rel: (sha(WORKTREE / rel) if (WORKTREE / rel).is_file() else None) for rel in CANDIDATE},
    }


def environment(profile):
    """Mirror of the reviewed verification-561-02 constructor: nonsecret OS variables, owned profile,
    pinned Node first on PATH, exactly one of each ProgramFiles root, Ollama disabled."""
    names = {'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'OS', 'PROCESSOR_ARCHITECTURE',
             'NUMBER_OF_PROCESSORS', 'PROGRAMDATA', 'PUBLIC', 'PATH'}
    env = {k: v for k, v in os.environ.items() if k.upper() in names}
    for key, safe in SAFE_PROGRAM_FILES.items():
        values = [v for k, v in os.environ.items() if k.upper() == key.upper()]
        need(values == [safe], 'PROGRAM_FILES_ENV_UNEXPECTED: ' + key + ' ' + repr(values))
        env[key] = safe
    for folder in ['home', 'roaming', 'local', 'temp']:
        (profile / folder).mkdir(parents=True, exist_ok=False)
    env.update(GG_ENV)
    env.update(PATH=str(NODE.parent) + os.pathsep + env.get('PATH', ''), USERPROFILE=str(profile / 'home'),
               HOME=str(profile / 'home'), APPDATA=str(profile / 'roaming'), LOCALAPPDATA=str(profile / 'local'),
               TEMP=str(profile / 'temp'), TMP=str(profile / 'temp'), CI='true', NO_COLOR='1', LIVE='0',
               GIT_OPTIONAL_LOCKS='0', GIT_TERMINAL_PROMPT='0', GG_E2E_BROWSER_CHANNEL='msedge')
    return env


def env_readback(env):
    keys = sorted(env)
    return {
        'keys': keys,
        'programFiles': {k: env.get(k) for k in SAFE_PROGRAM_FILES},
        'programFilesCaseVariants': {k: [n for n in keys if n.upper() == k.upper()] for k in SAFE_PROGRAM_FILES},
        'gg': {k: env[k] for k in keys if k.upper().startswith('GG_')},
        'absentProviderKeys': [k for k in ['GG_CODEX_BINARY', 'GG_CLAUDE_BINARY', 'ANTHROPIC_API_KEY',
                                           'OPENAI_API_KEY', 'NODE_OPTIONS'] if k not in env],
        'pathFirstComponent': env['PATH'].split(os.pathsep)[0],
        'temp': env['TEMP'],
    }


def parsed(raw):
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', raw.decode('utf-8', 'replace'))
    result = {}
    for name, label in [('files', 'Test Files'), ('tests', 'Tests')]:
        found = re.findall(r'^\s*' + label + r'\s+(\d+) passed\s*\((\d+)\)\s*$', text, re.M)
        result[name] = {'passed': int(found[0][0]), 'total': int(found[0][1])} if len(found) == 1 else None
        result[name + 'SummaryLines'] = re.findall(r'^\s*' + label + r'\s+.*$', text, re.M)
    result['passedTestLines'] = len(re.findall(r'^\s*\u2713', text, re.M))
    result['failedTestLines'] = len(re.findall(r'^\s*[\u00d7\u2717]', text, re.M))
    result['buildTasks'] = re.findall(r'Tasks:\s+(\d+) successful,\s+(\d+) total', text)
    result['cached'] = re.findall(r'Cached:\s+(\d+) cached', text)
    return result


def child(plan_path, stage):
    plan = json.loads(Path(plan_path).read_bytes())
    need(stage in plan['checks'], 'UNKNOWN_CHECK')
    need(sys.stdin.buffer.readline() == TOKEN, 'OWNED_JOB_ATTACH_TOKEN_REQUIRED')
    cmd = Path(os.environ.get('SystemRoot') or os.environ['SYSTEMROOT']) / 'System32/cmd.exe'
    pnpm = shutil.which('pnpm.cmd')
    need(pnpm, 'PNPM_CMD_MISSING')
    args = [pnpm, *plan['checks'][stage]['argv']]
    command = '"' + str(cmd) + '" /d /s /c "' + subprocess.list2cmdline(args) + '"'
    return subprocess.run(command, executable=str(cmd), cwd=str(WORKTREE), stdin=subprocess.DEVNULL).returncode


def execute(plan_path, plan, stage, root, env):
    entry = plan['checks'][stage]
    out = root / stage
    out.mkdir(exist_ok=False)
    spec = util.spec_from_file_location('b6_owned_process', HERE / 'owned_process.py')
    owned = util.module_from_spec(spec)
    spec.loader.exec_module(owned)
    job = owned.OwnedJob()
    process = None
    attached = timed = False
    settle = failure = None
    before = source_state()
    start = time.monotonic()
    started_utc = utc()
    try:
        with (out / 'stdout.log').open('xb') as stdout, (out / 'stderr.log').open('xb') as stderr:
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--child', str(plan_path), stage],
                                       cwd=str(WORKTREE), env=env, stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
                                       creationflags=subprocess.CREATE_NO_WINDOW)
            job.attach(process)
            attached = True
            save(out / 'PROCESS.json', {'pid': process.pid, 'argv': ['pnpm', *entry['argv']],
                                        'deadlineSeconds': entry['timeoutSeconds'],
                                        'postExitSettlementAllowanceSeconds': 2, 'startedUtc': started_utc})
            try:
                process.communicate(TOKEN, timeout=entry['timeoutSeconds'])
            except subprocess.TimeoutExpired:
                timed = True
            if not timed and process.poll() is not None:
                settle = owned.await_quiescence(job.handle, 2.0)
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        failure = str(error)
    finally:
        if process is not None and not attached and process.poll() is None:
            process.kill()
        job.close()
        if process is not None:
            process.wait(timeout=15)
    elapsed = time.monotonic() - start
    raw = (out / 'stdout.log').read_bytes() if (out / 'stdout.log').is_file() else b''
    counts = parsed(raw)
    semantic = True
    if entry.get('expectedFiles'):
        semantic = bool(counts['files'] == {'passed': entry['expectedFiles'], 'total': entry['expectedFiles']}
                        and counts['tests'] and counts['tests']['passed'] == counts['tests']['total']
                        and counts['tests']['passed'] >= entry.get('minimumTests', entry.get('expectedTests', 1)))
        if entry.get('expectedTests'):
            semantic = semantic and counts['tests'] == {'passed': entry['expectedTests'], 'total': entry['expectedTests']}
    if entry.get('forcedFullBuild'):
        semantic = bool(len(counts['buildTasks']) == 1 and counts['buildTasks'][0][0] == counts['buildTasks'][0][1]
                        and len(counts['cached']) == 1 and counts['cached'][0] == '0')
    after = source_state()
    passed = bool(process is not None and process.returncode == 0 and attached and not timed and not failure
                  and settle and settle.get('quiescent') and settle.get('observationReliable')
                  and settle.get('lastActiveProcesses') == 0 and semantic and after == before)
    receipt = {
        'stage': stage, 'argv': ['pnpm', *entry['argv']], 'deadlineSeconds': entry['timeoutSeconds'],
        'exitCode': process.returncode if process else None, 'timedOut': timed, 'jobAttached': attached,
        'ownedJobSettlement': settle, 'forcedOwnedJobSettlement': not bool(settle and settle.get('quiescent')),
        'failure': failure, 'counts': counts, 'semanticSummaryComplete': semantic,
        'sourceBefore': before, 'sourceAfter': after, 'sourceUnchanged': after == before, 'passed': passed,
        'elapsedSeconds': round(elapsed, 3), 'startedUtc': started_utc, 'finishedUtc': utc(),
        'raw': {n: {'bytes': (out / n).stat().st_size, 'sha256': sha(out / n)}
                for n in ['stdout.log', 'stderr.log'] if (out / n).is_file()},
    }
    save(out / 'PROCESS-EXIT.json', receipt)
    return receipt


def run(plan_path, root, stages):
    plan_path = Path(plan_path).resolve()
    plan = json.loads(plan_path.read_bytes())
    for stage in stages:
        need(stage in plan['checks'], 'UNKNOWN_CHECK: ' + stage)
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    need(not (root / 'RESULT.json').exists() and not any((root / s).exists() for s in stages), 'ONE_ATTEMPT_ONLY')
    profile = PROFILE_PARENT / ('profile-' + root.name)
    env = environment(profile)
    version = subprocess.run([str(NODE), '--version'], env=env, capture_output=True, timeout=15,
                             creationflags=subprocess.CREATE_NO_WINDOW)
    (root / 'runtime.stdout.log').write_bytes(version.stdout)
    (root / 'runtime.stderr.log').write_bytes(version.stderr)
    need(version.returncode == 0 and version.stdout.strip() == b'v22.23.4', 'PINNED_NODE_REQUIRED')
    before = source_state()
    result = {'plan': str(plan_path), 'planSha256': sha(plan_path), 'wrapperSha256': sha(Path(__file__).resolve()),
              'ownedHelperSha256': sha(HERE / 'owned_process.py'), 'requestedStages': stages,
              'profile': str(profile), 'environment': env_readback(env), 'nodeVersion': version.stdout.decode().strip(),
              'sourceBefore': before, 'stages': {}, 'startedUtc': utc(), 'passed': False}
    try:
        for stage in stages:
            receipt = execute(plan_path, plan, stage, root, env)
            result['stages'][stage] = receipt
            if not receipt['passed']:
                break
        result['passed'] = len(result['stages']) == len(stages) and all(r['passed'] for r in result['stages'].values())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        result['failure'] = str(error)
    finally:
        result.update(sourceAfter=source_state(), finishedUtc=utc())
        result['sourceUnchanged'] = result['sourceAfter'] == before
        result['passed'] = result['passed'] and result['sourceUnchanged']
        save(root / 'RESULT.json', result)
    print(json.dumps({'passed': result['passed'],
                      'stageVerdicts': {k: {'passed': v['passed'], 'exit': v['exitCode'], 'timedOut': v['timedOut'],
                                            'elapsed': v['elapsedSeconds']} for k, v in result['stages'].items()},
                      'resultSha256': sha(root / 'RESULT.json')}, ensure_ascii=True))
    return int(not result['passed'])


if __name__ == '__main__':
    try:
        if len(sys.argv) == 4 and sys.argv[1] == '--child':
            raise SystemExit(child(sys.argv[2], sys.argv[3]))
        need(len(sys.argv) >= 4, 'USAGE: run-verification.py <plan.json> <output-root> <stage> [...]')
        raise SystemExit(run(sys.argv[1], sys.argv[2], sys.argv[3:]))
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
