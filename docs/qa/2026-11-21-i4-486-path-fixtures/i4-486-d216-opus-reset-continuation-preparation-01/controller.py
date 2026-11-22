"""One session-owned reset continuation; no model, account or overage fallback."""
from pathlib import Path
import argparse, datetime, hashlib, json, os, shutil, subprocess, sys, time, traceback

PREP = Path(__file__).resolve().parent
E = PREP.parent
OLD = E / 'i4-486-d216-independent-01'
QA = Path('G:/ggq/gg-i4-486-d216-qa/GraphGoblin')
COMMON = Path('G:/ggq/gg-delivery-next-independent/GraphGoblin')
HEAD = 'e630bb83679bdb055bdd90d2b30e25fbf60571ac'
TREE = '0713eef9779a14e68b8ca0461f784538ba116c9f'
PARENT = '6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08'
RESET = 1795417200
OLD_SEAL = '439bb296ad757dfe59ee4dc61962c05269178cb92c6230c1a3c96b4d753a3394'
TEST = 'packages/infrastructure/src/fs/fs.test.ts'
NODE = Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe')
RUNNER = Path('C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/claude-bounded-runner.mjs')
GIT = ['git', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '--no-optional-locks']

def need(ok, message):
    if not ok:
        raise ValueError(message)

def read(p):
    return json.loads(Path(p).read_bytes())

def digest(p):
    h = hashlib.sha256()
    with Path(p).open('rb') as f:
        for part in iter(lambda: f.read(1024 * 1024), b''):
            h.update(part)
    return h.hexdigest()

def record(p):
    p = Path(p).resolve()
    return {'source': str(p), 'bytes': p.stat().st_size, 'sha256': digest(p)}

def new(p, obj):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = obj if isinstance(obj, bytes) else (json.dumps(obj, indent=2) + '\n').encode()
    with p.open('xb') as f:
        f.write(data)

def inside(p, root):
    return Path(p).resolve().is_relative_to(Path(root).resolve())

def verify_seal(root, seal):
    members = read(seal)['files']
    seen = set()
    for item in members:
        p = root / item['path']
        need(inside(p, root) and item['path'] not in seen, 'Unsafe/duplicate manifest member')
        seen.add(item['path'])
        need(p.is_file() and p.stat().st_size == item['bytes'] and digest(p) == item['sha256'], 'Manifest member changed: ' + item['path'])
    return len(members)

def env_for(c):
    scratch = Path(c['scratch'])
    return {**os.environ, 'PATH': str(NODE.parent) + os.pathsep + os.environ['PATH'],
        'TEMP': str(scratch / 'process-temp'), 'TMP': str(scratch / 'process-temp'),
        'NODE_COMPILE_CACHE': str(scratch / 'node-compile-cache'),
        'npm_config_cache': str(scratch / 'npm-cache'),
        'GIT_OPTIONAL_LOCKS': '0', 'PNPM_DISABLE_SELF_UPDATE_CHECK': '1',
        'TURBO_TELEMETRY_DISABLED': '1', 'npm_config_offline': 'true',
        'npm_config_verify_deps_before_run': 'false',
        'npm_config_manage_package_manager_versions': 'false'}

def small(argv, cwd, env):
    result = subprocess.run(argv, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    need(result.returncode == 0, 'Read-only preflight command failed')
    need(len(result.stdout) <= 65536 and len(result.stderr) <= 65536, 'Unexpected large preflight result')
    return result.stdout

def git_file(args, cwd, env, stem):
    stem = Path(stem)
    with stem.with_suffix('.stdout').open('xb') as out, stem.with_suffix('.stderr').open('xb') as err:
        r = subprocess.run(GIT + args, cwd=cwd, env=env, stdout=out, stderr=err)
    new(stem.with_suffix('.json'), {'argv': GIT + args, 'cwd': str(cwd), 'exit': r.returncode})
    need(r.returncode == 0, 'Read-only Git check failed: ' + stem.name)
    return stem.with_suffix('.stdout')

def snapshot(c, evidence):
    evidence.mkdir(parents=True, exist_ok=False)
    env = env_for(c)
    def g(*args):
        return small(GIT + list(args), QA, env).decode().strip()
    status = git_file(['status', '--porcelain=v1', '-z', '--untracked-files=all'], QA, env, evidence / 'status')
    staged = git_file(['ls-files', '--stage', '-z'], QA, env, evidence / 'tracked-index')
    index = Path(g('rev-parse', '--path-format=absolute', '--git-path', 'index'))
    sparse = Path(g('rev-parse', '--path-format=absolute', '--git-path', 'info/sparse-checkout'))
    state = {'head': g('rev-parse', 'HEAD'), 'tree': g('rev-parse', 'HEAD^{tree}'),
        'parent': g('rev-parse', 'HEAD^'), 'status': status.read_bytes().decode(),
        'index': record(index), 'trackedIndexSha256': digest(staged),
        'fixture': record(QA / TEST), 'lock': record(QA / 'pnpm-lock.yaml')}
    return state, record(sparse)

def common_state(c):
    idx = COMMON / '.git/index'
    return {'head': small(GIT + ['rev-parse', 'HEAD'], COMMON, env_for(c)).decode().strip(),
        'index': record(idx) if idx.exists() else None,
        'topLevelNames': sorted(p.name for p in COMMON.iterdir())}

def config(path):
    c = read(path)
    template = read(PREP / 'config.template.json')
    need(set(c) == set(template), 'Unexpected config fields')
    need({k: v for k, v in c.items() if k != 'rootExecutionAuthorized'} == {k: v for k, v in template.items() if k != 'rootExecutionAuthorized'}, 'Root config changed a frozen scope/guard field')
    need(type(c['rootExecutionAuthorized']) is bool, 'Root authorization must be literal boolean')
    need(c['resetEpoch'] == RESET and c['model'] == 'claude-opus-5-5' and c['effort'] == 'xhigh', 'Wrong time/model')
    need(str(Path(c['attempt']).resolve()) == str((E / 'i4-486-d216-independent-02').resolve()), 'Wrong new attempt destination')
    for key in ['attempt', 'controllerEvidence', 'scratch']:
        need(Path(c[key]).drive.upper() == 'G:' and inside(c[key], 'G:/ggq'), 'Output must remain on G')
    need(not Path(c['attempt']).exists(), 'Attempt02 exists: no overwrite/redispatch')
    need(not Path(c['controllerEvidence']).exists(), 'Controller session exists: no duplicate controller')
    return c

def inputs(c, evidence, require_preparation_seal):
    need(digest(OLD / 'ORCHESTRATION-SHA256SUMS.json') == OLD_SEAL, 'Original quota seal changed')
    need(verify_seal(OLD, OLD / 'ORCHESTRATION-SHA256SUMS.json') == 42, 'Wrong quota packet membership')
    prep_members = verify_seal(PREP, PREP / 'SHA256SUMS.json') if require_preparation_seal else None
    for item in c['inputBindings']:
        need(record(item['source']) == item, 'Bound input changed')
    attempt = Path(c['attempt'])
    need(read(PREP / 'spec.template.json') == {'model': c['model'], 'effort': c['effort'],
        'cwd': str(QA), 'prompt': str(attempt / 'BRIEF.md'),
        'outputDir': str(attempt / 'provider'), 'readOnly': False}, 'Frozen actual spec inputs changed')
    b = read(OLD / 'source-binding.json')
    a = read(b['rootAdmission']['source'])
    need(a['head'] == HEAD and a['tree'] == TREE and a['parent'] == PARENT and a['targetedReviewAndSeparateQaAdmitted'] is True and a['oneTestFileOnly'] is True and a['generalScansConsumed'] == 3, 'Wrong current source/scope admission')
    need(record(b['rootAdmission']['source']) == b['rootAdmission'], 'Original admission bytes changed')
    need(not (COMMON / '.git/objects/info/alternates').exists(), 'Independent Git store now has alternates')
    need(common_state(c) == read(OLD / 'setup-admission.json')['commonBefore'], 'Independent common main changed')
    state, sparse = snapshot(c, evidence)
    need(state == b['sourceBeforeQA'], 'Frozen QA source/index/fixture/lock drifted')
    need(sparse == c['sparseBinding'], 'Sparse pattern bytes changed')
    need(record(QA / 'node_modules/.modules.yaml') == b['dependencyMetadata'], 'Installed dependency metadata changed')
    need(not (QA / 'docs/qa').exists(), 'Unexpected old archive materialization')
    changed = small(GIT + ['diff-tree', '--no-commit-id', '--name-only', '-r', HEAD], QA, env_for(c)).decode().splitlines()
    need(changed == [TEST], 'Source scope is no longer the single test fixture')
    need(small([str(NODE), '--version'], QA, env_for(c)).decode().strip() == 'v22.23.4', 'Wrong Node runtime')
    return {'checkedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': state, 'sparse': sparse, 'originalQuotaMembersVerified': 42,
        'preparationMembersVerified': prep_members, 'rootAdmission': b['rootAdmission'],
        'providerCalls': 0, 'sourceOrIndexWrites': 0}

def seal(root, name):
    members = [{'path': str(p.relative_to(root)).replace('\\', '/'), 'bytes': p.stat().st_size,
        'sha256': digest(p)} for p in sorted(root.rglob('*')) if p.is_file() and p != root / name]
    new(root / name, {'selfExcluded': name, 'files': members})
    need(verify_seal(root, root / name) == len(members), 'Closed seal failed')
    return record(root / name)

def close_provider(c, attempt, code, timed_out):
    errors = []
    evidence = attempt / 'orchestration-source-after'
    try:
        after = inputs(c, evidence, True)
    except Exception as error:
        after = None
        errors.append('Source/old-input restoration check: ' + str(error))
    provider = attempt / 'provider'
    terminal = None
    provider_ok = False
    qa_seal = None
    try:
        events = [json.loads(line) for line in (provider / 'events.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
        results = [e for e in events if e.get('type') == 'result']
        need(len(results) == 1, 'Expected one raw provider terminal')
        terminal = read(provider / 'result.json')
        need(results[0] == terminal, 'Raw/result terminal mismatch')
        need((provider / 'provider-final-message.md').read_bytes() == terminal.get('result', '').encode(), 'Final provider message mismatch')
        models = {e['message'].get('model') for e in events if e.get('type') == 'assistant' and e['message'].get('model') != '<synthetic>'}
        need(read(provider / 'launch.json')['model'] == c['model'] and read(provider / 'launch.json')['effort'] == c['effort'], 'Wrong provider launch model/effort')
        need(code == 0 and read(provider / 'exit.json')['code'] == 0 and terminal.get('is_error') is False and terminal.get('terminal_reason') == 'completed', 'Provider did not complete normally')
        need(set(terminal.get('modelUsage', {})) == {c['model']} and models == {c['model']}, 'Actual inference model mismatch/missing')
        need((attempt / 'REPORT.md').is_file(), 'Actual QA report missing')
        qa_seal_path = attempt / 'qa/SHA256SUMS.json'
        n = verify_seal(attempt, qa_seal_path)
        need(any(i['path'] == 'REPORT.md' for i in read(qa_seal_path)['files']), 'QA report not covered by QA seal')
        qa_seal = {**record(qa_seal_path), 'membersVerified': n}
        provider_ok = True
    except Exception as error:
        errors.append('Provider/report protocol check: ' + str(error))
    status = 'ACTUAL_QA_REPORT_PENDING_ROOT_REVIEW' if provider_ok and after and not timed_out else 'BLOCKED_NO_ACCEPTED_QA'
    outcome = {'status': status, 'head': HEAD, 'tree': TREE, 'parent': PARENT,
        'wrapperExit': code, 'timedOutAndOwnedTreeTerminated': timed_out,
        'providerInvocations': 1, 'automaticRetries': 0, 'modelOrAccountSubstitution': False,
        'requestedModel': c['model'], 'effort': c['effort'], 'terminal': terminal,
        'sourceAfterVerified': after is not None, 'sourceReadback': after, 'qaSeal': qa_seal,
        'report': record(attempt / 'REPORT.md') if (attempt / 'REPORT.md').is_file() else None,
        'errors': errors, 'rootReviewPrivacyPublicationAdmission': False,
        'capClosureOrFinalCiNativeMergeClaimed': False,
        'cleanupQualification': 'See actual QA report and exact source readback. A forced timeout may interrupt fixture restoration/native cleanup; do not reuse or auto-retry a drifted checkout.'}
    new(attempt / 'ORCHESTRATION-READBACK.json', outcome)
    new(attempt / 'OUTCOME.md', (status + '\n\nOne actual reset attempt only. Provider terminal, actual report if any, source restoration and raw records are bound in ORCHESTRATION-READBACK.json. No root acceptance, final CI/native, cap closure, publication or merge approval is inferred.\n').encode())
    return outcome, seal(attempt, 'ORCHESTRATION-SHA256SUMS.json')

def run(c, config_path):
    need(c['rootExecutionAuthorized'] is True, 'Root execution admission remains false')
    need(time.time() <= c['latestLaunchEpoch'], 'Launch deadline expired')
    control = Path(c['controllerEvidence'])
    control.mkdir(parents=True, exist_ok=False)
    admitted_config = record(config_path)
    new(control / 'SESSION.json', {'pid': os.getpid(), 'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'config': admitted_config, 'preparationSeal': record(PREP / 'SHA256SUMS.json'),
        'resetEpoch': RESET, 'attempt': c['attempt'], 'providerInvocations': 0})
    attempt = Path(c['attempt'])
    launched = False
    try:
        new(control / 'startup-preflight.json', inputs(c, control / 'startup-git', True))
        deadline = time.monotonic() + max(0, RESET - time.time()) + 600
        print(json.dumps({'status': 'WAITING_FOR_EXACT_RESET', 'resetEpoch': RESET, 'session': str(control)}), flush=True)
        while time.time() < RESET:
            need(time.monotonic() < deadline, 'Clock drift exceeded bounded waiting deadline')
            time.sleep(min(60.0, max(0.1, RESET - time.time())))
        need(RESET <= time.time() <= c['latestLaunchEpoch'], 'Actual reset/launch window not satisfied')
        need(record(config_path) == admitted_config, 'Root execution config changed while waiting; stop without dispatch')
        need(not attempt.exists(), 'Attempt02 created while controller waited; refuse duplicate')
        new(control / 'reset-preflight.json', inputs(c, control / 'reset-git', True))
        attempt.mkdir(exist_ok=False)
        for name in ['baseline-fs.test.ts', 'candidate-fs.test.ts', 'prior-harness-bindings.json']:
            new(attempt / name, (OLD / name).read_bytes())
        for p in sorted((OLD / 'reference-tools').iterdir()):
            if p.is_file():
                new(attempt / 'reference-tools' / p.name, p.read_bytes())
        new(attempt / 'BRIEF.md', (PREP / 'BRIEF.attempt02.md').read_bytes())
        binding = read(OLD / 'source-binding.json')
        binding.update({'status': 'RESET_ATTEMPT02_ACTUAL_SOURCE_BOUND',
            'baselineFixture': record(attempt / 'baseline-fs.test.ts'),
            'correctedFixture': record(attempt / 'candidate-fs.test.ts'),
            'TEMP': str(Path(c['scratch']) / 'process-temp'), 'TMP': str(Path(c['scratch']) / 'process-temp'),
            'nodeCompileCache': str(Path(c['scratch']) / 'node-compile-cache'),
            'priorQuotaPacketSeal': record(OLD / 'ORCHESTRATION-SHA256SUMS.json'),
            'resetSourceReadback': record(control / 'reset-preflight.json')})
        new(attempt / 'source-binding.json', binding)
        new(attempt / 'spec.json', (PREP / 'spec.template.json').read_bytes())
        for part in ['process-temp', 'node-compile-cache', 'npm-cache']:
            (Path(c['scratch']) / part).mkdir(parents=True, exist_ok=True)
        need(RESET <= time.time() <= c['latestLaunchEpoch'], 'Provider launch must remain inside the exact reset/deadline window')
        argv = [str(NODE), str(RUNNER), str(attempt / 'spec.json')]
        with (attempt / 'dispatch.stdout').open('xb') as out, (attempt / 'dispatch.stderr').open('xb') as err:
            child = subprocess.Popen(argv, cwd=QA, env=env_for(c), stdout=out, stderr=err,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            launched = True
            new(attempt / 'dispatch-start.json', {'argv': argv, 'runnerPid': child.pid,
                'startedEpoch': time.time(), 'resetEpoch': RESET, 'sourceHead': HEAD, 'tree': TREE,
                'controllerSession': str(control), 'providerInvocations': 1, 'maximumProviderSeconds': c['maximumProviderSeconds']})
            timed_out = False
            try:
                code = child.wait(timeout=c['maximumProviderSeconds'])
            except subprocess.TimeoutExpired:
                timed_out = True
                with (attempt / 'timeout-taskkill.stdout').open('xb') as ko, (attempt / 'timeout-taskkill.stderr').open('xb') as ke:
                    kill = subprocess.run([str(Path(os.environ['SystemRoot']) / 'System32/taskkill.exe'), '/PID', str(child.pid), '/T', '/F'], stdout=ko, stderr=ke)
                new(attempt / 'timeout-taskkill.json', {'ownedRunnerPid': child.pid, 'exit': kill.returncode,
                    'qualification': 'Only this owned runner tree; cleanup/restoration may be incomplete.'})
                try:
                    code = child.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    raise RuntimeError('Owned runner did not close; leave packet UNSEALED for root supervision')
        new(attempt / 'dispatch-exit.json', {'code': code, 'finishedEpoch': time.time(), 'timedOut': timed_out, 'providerInvocations': 1})
        outcome, packet_seal = close_provider(c, attempt, code, timed_out)
        new(control / 'OUTCOME.json', {'attemptOutcome': record(attempt / 'ORCHESTRATION-READBACK.json'), 'attemptSeal': packet_seal, 'status': outcome['status']})
        controller_seal = seal(control, 'SHA256SUMS.json')
        print(json.dumps({'status': outcome['status'], 'attemptSeal': packet_seal, 'controllerSeal': controller_seal}), flush=True)
        return 0 if outcome['status'] == 'ACTUAL_QA_REPORT_PENDING_ROOT_REVIEW' else 1
    except Exception as error:
        new(control / 'STOP.json', {'status': 'STOPPED_NO_AUTOMATIC_RETRY', 'error': str(error),
            'providerLaunched': launched, 'traceback': traceback.format_exc(),
            'sourceOrCleanupMayRequireRootInspection': launched})
        if not launched:
            seal(control, 'SHA256SUMS.json')
        print(json.dumps({'status': 'STOPPED_NO_AUTOMATIC_RETRY', 'error': str(error), 'providerLaunched': launched}), flush=True)
        return 1

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['validate', 'check-dispatch-time', 'run'])
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--validation-evidence', type=Path)
    args = parser.parse_args()
    c = config(args.config)
    if args.mode == 'check-dispatch-time':
        if time.time() < RESET:
            print(json.dumps({'status': 'REFUSED_BEFORE_RESET', 'actualEpoch': time.time(), 'resetEpoch': RESET, 'providerCalls': 0}))
            return 23
        print(json.dumps({'status': 'RESET_TIME_REACHED_ONLY_NO_PROVIDER_CALLED', 'actualEpoch': time.time(), 'providerCalls': 0}))
        return 0
    if args.mode == 'validate':
        need(args.validation_evidence is not None and inside(args.validation_evidence, PREP), 'Offline validation evidence must use a new preparation subdirectory')
        result = inputs(c, args.validation_evidence, (PREP / 'SHA256SUMS.json').exists())
        print(json.dumps({'status': 'OFFLINE_VALIDATION_PASS_NO_PROVIDER', 'checks': result, 'rootExecutionAuthorized': c['rootExecutionAuthorized'], 'actualEpoch': time.time(), 'providerCalls': 0}))
        return 0
    return run(c, args.config)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'status': 'REFUSED', 'error': str(error), 'providerCalls': 0}))
        sys.exit(2)
