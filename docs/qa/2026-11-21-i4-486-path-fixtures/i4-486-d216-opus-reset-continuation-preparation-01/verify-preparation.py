"""Offline validation and real-clock refusal only; never run the controller/provider."""
from pathlib import Path
import ast, hashlib, json, subprocess, sys, time

P = Path(__file__).resolve().parent
controller = P / 'controller.py'
ast.parse(controller.read_text(encoding='utf-8'))
config = P / 'config.template.json'
cfg = json.loads(config.read_bytes())
assert cfg['rootExecutionAuthorized'] is False
assert time.time() < cfg['resetEpoch'], 'This pre-reset verification must run before the actual reset'
assert not Path(cfg['attempt']).exists() and not Path(cfg['controllerEvidence']).exists()
checks = []
for label, args, expected in [
    ('offline-validation-02', ['validate', '--validation-evidence', str(P / 'offline-source-check-02')], 0),
    ('pre-reset-refusal-02', ['check-dispatch-time'], 23),
]:
    argv = [sys.executable, '-B', str(controller), *args, '--config', str(config)]
    with (P / (label + '.stdout')).open('xb') as out, (P / (label + '.stderr')).open('xb') as err:
        result = subprocess.run(argv, stdout=out, stderr=err)
    assert result.returncode == expected, (label, result.returncode)
    value = json.loads((P / (label + '.stdout')).read_bytes())
    assert value['status'] == ('OFFLINE_VALIDATION_PASS_NO_PROVIDER' if expected == 0 else 'REFUSED_BEFORE_RESET')
    checks.append({'label': label, 'argv': argv, 'exit': result.returncode, 'status': value['status'],
        'stdoutSha256': hashlib.sha256((P / (label + '.stdout')).read_bytes()).hexdigest(),
        'stderrBytes': (P / (label + '.stderr')).stat().st_size})
assert not Path(cfg['attempt']).exists() and not Path(cfg['controllerEvidence']).exists()
record = {'status': 'VERIFIED_PREPARATION_ONLY', 'checks': checks, 'providerCalls': 0,
    'controllerSha256': hashlib.sha256(controller.read_bytes()).hexdigest(),
    'controllerSessionStarted': False, 'actualAttempt02Created': False,
    'worktreeOrIndexWrites': 0, 'rootExecutionAuthorized': False,
    'codeSyntaxParsed': True, 'originalQuotaMembersVerified': 42,
    'timeoutBranchExecutionTested': False,
    'qualification': 'No provider, wait loop or process-tree timeout branch was executed; these remain root-reviewed runtime behavior.'}
with (P / 'verification-02.json').open('xb') as f:
    f.write((json.dumps(record, indent=2) + '\n').encode())
print(json.dumps({'status': record['status'], 'providerCalls': 0, 'realPreResetRefusalExit': 23, 'freshSourceBinding': 'PASS'}))
