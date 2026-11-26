"""Prepared native-only QA. Original five check receipts, source and index stay immutable."""
from pathlib import Path
from importlib import util
import hashlib
import json
import os
import subprocess
import sys

sys.dont_write_bytecode = True
QA = Path(__file__).resolve().parent
BUNDLE = QA.parent
OLD_QA = QA.parents[1] / 'plugin-builders-464-465-468/independent-qa-01'
definition = util.spec_from_file_location('original_plugin_check', OLD_QA / 'run-check.py')
original = util.module_from_spec(definition)
definition.loader.exec_module(original)
shared = original.shared
WORKTREE, MANIFEST, PATCH, PATCH_SHA = original.WORKTREE, original.MANIFEST, original.PATCH, original.PATCH_SHA
NATIVE_DRIVER = QA / 'native-plugin-checks.mjs'
CHECKS = {'native': 'node ' + NATIVE_DRIVER.as_posix()}
sha = original.sha
environment = original.environment
execute = original.execute


def verify_preparation():
    seal = shared.read_json(QA / 'PREPARATION-SEAL.json')
    for path, digest in seal['files'].items():
        if sha(QA / path) != digest:
            raise RuntimeError('PREPARATION_CHANGED: ' + path)


def snapshot(env):
    expected = shared.read_json(QA / 'BINDINGS.json')
    observed = original.snapshot(env)
    if observed != expected['originalFrozen']:
        raise RuntimeError('ORIGINAL_SOURCE_FREEZE_CHANGED')
    for name, digest in expected['originalQaFiles'].items():
        if sha(OLD_QA / name) != digest:
            raise RuntimeError('ORIGINAL_QA_BYTES_CHANGED: ' + name)
    for path, digest in expected['currentSourceAndRuntimeFiles'].items():
        if sha(Path(path)) != digest:
            raise RuntimeError('SOURCE_OR_BUILT_RUNTIME_CHANGED: ' + path)
    build = shared.read_json(OLD_QA / 'BUILD-RESULT.json')
    if build['exitCode'] != 0 or not build['sourceUnchanged'] or build['patchSha256'] != PATCH_SHA:
        raise RuntimeError('ORIGINAL_FORCED_BUILD_NOT_REUSABLE')
    return {**observed, 'originalNativeDriverSha256': observed['nativeDriverSha256'],
            'bindingSha256': sha(QA / 'BINDINGS.json'),
            'nativeDriverSha256': sha(NATIVE_DRIVER), 'preloadSha256': sha(QA / 'mcp-trace-preload.mjs')}


def main():
    if sys.argv[1:] != ['native']:
        raise SystemExit('Only the native mode is admitted; no build or unit replay.')
    verify_preparation()
    if not (QA / 'CLAUDE-LAUNCH.json').is_file():
        raise RuntimeError('WAIT_APPROVED_FRESH_ACTUAL_CLAUDE_QA')
    env = environment()
    expected = shared.read_json(QA / 'FROZEN-BEFORE.json')
    if snapshot(env) != expected:
        raise RuntimeError('FROZEN_SOURCE_BINDING_MISMATCH')
    if (QA / 'NATIVE-RESULT.json').exists():
        raise RuntimeError('ONE_NATIVE_ATTEMPT_ONLY')
    started = shared.utc_now()
    timed_out = False
    controller_error = None
    code = None
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
        unchanged = False
        controller_error = str(error)
    status = {'mode': 'native', 'command': CHECKS['native'], 'workingDirectory': WORKTREE.as_posix(),
              'startedAt': started, 'finishedAt': shared.utc_now(), 'exitCode': code,
              'timedOut': timed_out, 'controllerError': controller_error,
              'sourceUnchanged': unchanged, 'patchSha256': PATCH_SHA,
              'stdout': {'file': 'native.stdout.log', 'bytes': (QA / 'native.stdout.log').stat().st_size,
                         'sha256': sha(QA / 'native.stdout.log')},
              'stderr': {'file': 'native.stderr.log', 'bytes': (QA / 'native.stderr.log').stat().st_size,
                         'sha256': sha(QA / 'native.stderr.log')}}
    shared.save_json(QA / 'NATIVE-RESULT.json', status)
    print(json.dumps(status, indent=2, ensure_ascii=True), flush=True)
    report_path = QA / 'NATIVE-PLUGIN-RESULTS.json'
    if report_path.is_file():
        report = shared.read_json(report_path)
        # Full source streams already exist. This view keeps attribution and native tiers readable.
        protocol = report.get('mcpProtocol', {})
        view = {key: report.get(key) for key in ['nodeVersion', 'isolated', 'fixtureGatewayResponse',
                 'fixtureGatewayRequests', 'codex', 'claude', 'directResourceOracle']}
        view['mcpProtocol'] = {key: protocol.get(key) for key in ['sessions', 'toolsCallCount', 'postCount', 'totalReadonlyGets']}
        view['rawProtocolInventory'] = protocol.get('rawFiles')
        print(json.dumps(view, indent=2, ensure_ascii=True), flush=True)
    for name in ['build.stderr.log', 'codex.stderr.log', 'claude.stderr.log', 'writer.stderr.log']:
        print('REUSED ORIGINAL ' + name + ': ' + (OLD_QA / name).read_text(encoding='utf-8').strip(), flush=True)
    validation = QA / 'native-claude-validate.stdout.log'
    if validation.is_file():
        print('FULL CLAUDE STRICT VALIDATION (advice/nonblocking findings retained):', flush=True)
        print(validation.read_text(encoding='utf-8').encode('ascii', 'backslashreplace').decode('ascii'), flush=True)
    return code if unchanged and not timed_out else 2


if __name__ == '__main__':
    sys.exit(main())
