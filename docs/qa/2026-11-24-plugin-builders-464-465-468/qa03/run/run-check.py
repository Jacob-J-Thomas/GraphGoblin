"""QA03 builtin-log alternative. Preparation checks do not launch a provider or app."""
from datetime import datetime, timezone
from importlib import util
from pathlib import Path
import json
import os
import subprocess
import sys

sys.dont_write_bytecode = True
QA = Path(__file__).resolve().parent
BASE = QA.parents[1]
OLD_QA = BASE / 'plugin-builders-464-465-468/independent-qa-01'
QA02 = BASE / 'plugin-native-diagnosis-01/native-only-qa-02'
definition = util.spec_from_file_location('original_plugin_check', OLD_QA / 'run-check.py')
original = util.module_from_spec(definition)
definition.loader.exec_module(original)
shared = original.shared
WORKTREE, PATCH_SHA = original.WORKTREE, original.PATCH_SHA
sha, environment, execute = original.sha, original.environment, original.execute
NATIVE_DRIVER = QA / 'native-plugin-logging.mjs'
CHECKS = {'native': 'node ' + NATIVE_DRIVER.as_posix()}
NOT_BEFORE = '2026-11-25T10:10:20Z'


def verify_preparation():
    seal = shared.read_json(QA / 'PREPARATION-SEAL.json')
    for path, digest in seal['files'].items():
        if sha(QA / path) != digest:
            raise RuntimeError('PREPARATION_CHANGED: ' + path)


def verify_admission(require_time=True):
    path = QA / 'ROOT-QA-ADMISSION.json'
    if not path.is_file():
        raise RuntimeError('WAIT_ROOT_FUP053_ADMISSION')
    admission = shared.read_json(path)
    if (admission.get('approved') is not True or admission.get('findingId') != 'FUP053'
            or admission.get('mechanism') != 'builtin-stderr-logging'
            or admission.get('contractSha256') != sha(QA / 'QA-CONTRACT.json')
            or admission.get('preparationSealSha256') != sha(QA / 'PREPARATION-SEAL.json')
            or admission.get('notBeforeUtc') != NOT_BEFORE):
        raise RuntimeError('ROOT_ADMISSION_BINDING_MISMATCH')
    if require_time and datetime.now(timezone.utc) < datetime.fromisoformat(NOT_BEFORE.replace('Z', '+00:00')):
        raise RuntimeError('WAIT_NATURAL_RESET_' + NOT_BEFORE)
    return admission


def snapshot(env):
    expected = shared.read_json(QA / 'BINDINGS.json')
    observed = original.snapshot(env)
    if observed != expected['originalFrozen']:
        raise RuntimeError('ORIGINAL_SOURCE_FREEZE_CHANGED')
    for folder, key in [(OLD_QA, 'qa01Files'), (QA02, 'qa02Files')]:
        for name, digest in expected[key].items():
            if sha(folder / name) != digest:
                raise RuntimeError('PRIOR_QA_BYTES_CHANGED: ' + str(folder / name))
    for path, digest in expected['currentSourceAndRuntimeFiles'].items():
        if sha(Path(path)) != digest:
            raise RuntimeError('SOURCE_OR_BUILT_RUNTIME_CHANGED: ' + path)
    for path, digest in expected['preparedDependencyFiles'].items():
        if sha(Path(path)) != digest:
            raise RuntimeError('READONLY_PREPARATION_DEPENDENCY_CHANGED: ' + path)
    for name in ['BUILD', 'CODEX', 'CLAUDE', 'WRITER']:
        receipt = shared.read_json(OLD_QA / (name + '-RESULT.json'))
        if receipt['exitCode'] != 0 or not receipt['sourceUnchanged'] or receipt['patchSha256'] != PATCH_SHA:
            raise RuntimeError('ORIGINAL_BUILD_UNIT_RECEIPT_NOT_REUSABLE: ' + name)
        for stream in ['stdout', 'stderr']:
            if sha(OLD_QA / receipt[stream]['file']) != receipt[stream]['sha256']:
                raise RuntimeError('ORIGINAL_STREAM_BINDING_CHANGED: ' + name + stream)
    if shared.read_json(OLD_QA / 'NATIVE-RESULT.json')['exitCode'] != 1:
        raise RuntimeError('QA01_FAIL_HISTORY_CHANGED')
    if shared.read_json(QA02 / 'NATIVE-RESULT.json')['exitCode'] != 1:
        raise RuntimeError('QA02_FAIL_HISTORY_CHANGED')
    return {**observed, 'bindingSha256': sha(QA / 'BINDINGS.json'),
            'nativeDriverSha256': sha(NATIVE_DRIVER), 'runtimeFileCount': len(expected['currentSourceAndRuntimeFiles']),
            'qa01FileCount': len(expected['qa01Files']), 'qa02FileCount': len(expected['qa02Files'])}


def main():
    verify_preparation()
    if sys.argv[1:] == ['--check-preparation']:
        observed = snapshot(environment())
        print(json.dumps({'preparedOnly': True, 'sourceAndRuntimeBindingsMatch': True,
                          'frozen': observed, 'admissionCreated': False, 'providerOrNativeInvoked': False},
                         indent=2, ensure_ascii=True))
        return 0
    if sys.argv[1:] == ['--check-admission']:
        verify_admission()
        return 0
    if sys.argv[1:] != ['native']:
        raise SystemExit('Only native, --check-preparation, or --check-admission is supported.')
    verify_admission()
    launch = shared.read_json(QA / 'CLAUDE-LAUNCH.json')
    if (launch.get('freshSession') is not True or launch.get('model') != shared.MODEL
            or launch.get('contractSha256') != sha(QA / 'QA-CONTRACT.json')
            or launch.get('preparationSealSha256') != sha(QA / 'PREPARATION-SEAL.json')):
        raise RuntimeError('WAIT_APPROVED_FRESH_ACTUAL_CLAUDE_QA')
    env = environment()
    expected = shared.read_json(QA / 'FROZEN-BEFORE.json')
    if snapshot(env) != expected:
        raise RuntimeError('FROZEN_SOURCE_BINDING_MISMATCH')
    if any((QA / name).exists() for name in ['NATIVE-RESULT.json', 'NATIVE-ATTEMPT.json', 'native.stdout.log', 'native.stderr.log']):
        raise RuntimeError('ONE_NATIVE_ATTEMPT_ONLY')
    started = shared.utc_now()
    with (QA / 'NATIVE-ATTEMPT.json').open('x', encoding='utf-8') as handle:
        json.dump({'startedAt': started, 'command': CHECKS['native'], 'controllerPid': os.getpid()}, handle)
    timed_out, controller_error, code = False, None, None
    with (QA / 'native.stdout.log').open('xb') as stdout, (QA / 'native.stderr.log').open('xb') as stderr:
        child = subprocess.Popen([str(original.BASH), '--noprofile', '--norc', '-c', CHECKS['native']],
                                 cwd=WORKTREE, env=env, stdout=stdout, stderr=stderr,
                                 creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            code = child.wait(timeout=480)
        except subprocess.TimeoutExpired:
            timed_out = True
            if child.poll() is None:
                with (QA / 'owned-timeout-stop.stdout.log').open('xb') as out, (QA / 'owned-timeout-stop.stderr.log').open('xb') as err:
                    subprocess.run([str(Path(os.environ['SystemRoot']) / 'System32/taskkill.exe'),
                                    '/PID', str(child.pid), '/T', '/F'], stdout=out, stderr=err,
                                   timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
            if child.poll() is None:
                child.terminate()
            code = child.wait(timeout=20)
    try:
        unchanged = snapshot(env) == expected
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        unchanged, controller_error = False, str(error)
    receipt = {'mode': 'native', 'command': CHECKS['native'], 'workingDirectory': WORKTREE.as_posix(),
               'startedAt': started, 'finishedAt': shared.utc_now(), 'exitCode': code, 'timedOut': timed_out,
               'controllerError': controller_error, 'sourceUnchanged': unchanged, 'patchSha256': PATCH_SHA,
               'bindingSha256': sha(QA / 'BINDINGS.json'), 'before': expected,
               'afterBindingVerified': unchanged}
    for stream in ['stdout', 'stderr']:
        path = QA / ('native.' + stream + '.log')
        receipt[stream] = {'file': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path)}
    shared.save_json(QA / 'NATIVE-RESULT.json', receipt)
    print(json.dumps(receipt, indent=2, ensure_ascii=True), flush=True)
    path = QA / 'NATIVE-PLUGIN-RESULTS.json'
    if path.is_file():
        result = shared.read_json(path)
        # These are the complete actual new observations, not a tail-only excerpt.
        print(json.dumps(result, indent=2, ensure_ascii=True), flush=True)
    else:
        print('MISSING_NATIVE_RESULT: retain full native stdout/stderr; FAIL.', flush=True)
    for name in ['native-codex-app-server.stderr.log', 'native-codex-app-server.stdout.log']:
        path = QA / name
        if path.is_file():
            print('FULL RAW DIAGNOSTIC ' + name + ' SHA256=' + sha(path), flush=True)
            print(path.read_bytes().decode('utf-8', errors='backslashreplace').encode('ascii', 'backslashreplace').decode('ascii'), flush=True)
    return code if unchanged and not timed_out else 2


if __name__ == '__main__':
    sys.exit(main())
