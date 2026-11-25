"""Run the frozen evidence tests and read their actual disposable artifacts."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

QA = Path(__file__).resolve().parent
WORKTREE = Path('G:/ggq/gg-fu-evidence-20261124/GraphGoblin')
NODE = Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64')
PNPM = Path('C:/nvm4w/nodejs/pnpm.cmd')
SAFE_ENV_KEYS = set('systemroot windir comspec path pathext processor_architecture number_of_processors'.split())
CHECKS = {
    'maintained': ['--filter', '@graphgoblin/tooling', 'test:coverage',
                   'scripts/windows-launcher-evidence.test.mjs',
                   '--coverage.include=scripts/windows-launcher-evidence.mjs'],
    'cancel': ['--filter', '@graphgoblin/tooling', 'test',
               'scripts/windows-launcher-evidence.test.mjs', '-t', '#534'],
    'totals': ['--filter', '@graphgoblin/tooling', 'test',
               'scripts/windows-launcher-evidence.test.mjs', '-t', '#539'],
}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def json_file(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def run(cmd, env, cwd=WORKTREE, timeout=65):
    return subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, timeout=timeout,
                          creationflags=subprocess.CREATE_NO_WINDOW)

def common_result(result_path):
    directory = result_path.parent
    result = json_file(result_path)
    observations = directory / 'observations.ndjson'
    records = [json.loads(line) for line in observations.read_bytes().splitlines()]
    manifest = directory / 'manifest.json'
    assert result['evidenceId'] == json_file(manifest)['evidenceId']
    assert result['observations']['closed'] and result['observations']['state'] == 'valid'
    assert result['observations']['records'] == len(records)
    assert result['observations']['bytes'] == observations.stat().st_size
    assert result['uploaded'] == ['manifest.json', 'result.json', 'observations.ndjson']
    core = dict(
        status=result['status'], native=result['steps']['native'], missing=result['missing'],
        observations=result['observations'], cases=result['cases'], uploaded=result['uploaded'],
        files={file.name: {'path': file.relative_to(QA).as_posix(), 'sha256': sha(file)}
               for file in (manifest, result_path, observations)},
    )
    return core, records

def cancel_readback(result_paths, fixture, env):
    assert len(result_paths) == 1
    result_path, = result_paths
    core, records = common_result(result_path)
    assert core['status'] == 'native-failed' and core['native'] == 'failure'
    def key(record):
        return f"{record['case']}:{record['subtest']}"
    starts = [r for r in records if r['type'] == 'case-start']
    ends = {key(r): r for r in records if r['type'] == 'case-end'}
    assert len(starts) == len(ends) == core['observations']['byType']['case-end'] == 12
    assert set(ends) == {key(r) for r in starts}
    assert sum(r['type'] == 'recorder-closed' for r in records) == 1
    assert core['observations']['rejected'] == 0
    core['ends'] = [
        [case, r['seq'], r['result'], r['failureKind'], r['failedSubtests']]
        for case, r in ends.items()
    ]
    core['cleanup'] = [
        [key(r), r['seq'], r['action'], r['result'], r['seq'] > ends[key(r)]['seq'],
         r['seq'] > ends[r["case"] + ":0"]['seq']]
        for r in records if r['type'] == 'cleanup'
    ]
    core['children'] = [
        [key(r), r['seq'], r['mode'], r['exitCode'], r['stderrBytes']]
        for r in records if r['type'] == 'child'
    ]
    native, = fixture.glob('*/evidence-cancellation.acceptance.mjs')
    # Re-execute the maintained child directly without an evidence directory to capture real TAP.
    # The maintained Vitest control reruns both modes and asserts identical case-level TAP outcomes.
    tap = run([str(PNPM), 'exec', 'node', '--test', str(native)], env)
    (QA / 'CANCEL-NODE-TAP.log').write_bytes(tap.stdout)
    out = tap.stdout.decode('utf-8')
    assert tap.returncode == 1
    stats = dict(re.findall(r'^# (tests|pass|fail|cancelled) (\d+)\s*$', out, re.M))
    assert stats == {'tests': '12', 'pass': '3', 'fail': '5', 'cancelled': '4'}
    cases = re.findall(r'^\s*(?:ok|not ok) \d+ - (.+)$', out, re.M)
    failure_types = re.findall(r"^\s*failureType: '([^']+)'", out, re.M)
    core['nativeRunner'] = {
        'command': 'pnpm exec node --test <maintained disposable child file>',
        'evidenceEnabled': False, 'exitCode': tap.returncode,
        'counts': stats, 'tapCases': cases, 'failureTypesInTapOrder': failure_types,
        'fixturePath': native.relative_to(QA).as_posix(), 'fixtureSha256': sha(native),
        'tapPath': 'CANCEL-NODE-TAP.log', 'tapSha256': sha(QA / 'CANCEL-NODE-TAP.log'),
    }
    return core

def totals_readback(result_paths):
    assert len(result_paths) == 10
    variants = []
    for path in result_paths:
        core, records = common_result(path)
        rows = [r for r in records if r['type'] == 'contention' and r['trial'] == 1]
        receipts = [{k: v for k, v in r.items() if k not in ('at', 'seq')}
                    for r in records if r.get('trial') == 1 and r['type'] != 'contention']
        assert len(rows) == 1 and len(receipts) == 7
        row, = rows
        fields = [row[key] for key in ('contenders', 'acquired', 'refused', 'other')]
        assert fields[0] == sum(fields[1:])
        variants.append(dict(
            totals=fields, totalsRows=1, receipts=len(receipts),
            receiptFieldsSha256=hashlib.sha256(json.dumps(receipts, sort_keys=True).encode()).hexdigest(),
            status=core['status'], native=core['native'], missing=core['missing'],
            rejected=core['observations']['rejected'], uploaded=core['uploaded'], files=core['files'],
        ))
    expected = {
        ((5, 1, 4, 0), 'success', 'complete', ()),
        ((5, 1, 4, 0), 'success', 'incomplete', ('records-rejected',)),
    }
    for fields in ((6, 1, 5, 0), (5, 2, 3, 0), (5, 1, 3, 1), (5, 0, 4, 1)):
        expected.add((fields, 'success', 'incomplete', ('contention-trials',)))
        expected.add((fields, 'failure', 'native-failed', ('contention-trials',)))
    observed = {(tuple(row['totals']), row['native'], row['status'], tuple(row['missing']))
                for row in variants}
    assert observed == expected
    assert len({row['receiptFieldsSha256'] for row in variants}) == 1
    return sorted(variants, key=lambda r: (r['totals'], r['status']))

def main(mode):
    fixture = QA / ('fixture-' + mode)
    fixture.mkdir(exist_ok=False)
    env = {key: value for key, value in os.environ.items() if key.casefold() in SAFE_ENV_KEYS}
    env.update(PATH=str(NODE) + ';' + env.get('PATH', ''), TEMP=str(fixture), TMP=str(fixture),
               NO_COLOR='1', GIT_OPTIONAL_LOCKS='0', GIT_TERMINAL_PROMPT='0')
    node = run([str(NODE / 'node.exe'), '--version'], env).stdout.decode().strip()
    assert node == 'v22.23.4', node
    command = [str(PNPM), *CHECKS[mode]]
    completed = run(command, env)
    log = QA / (mode.upper() + '.log')
    log.write_bytes(completed.stdout + completed.stderr)
    out = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', log.read_bytes().decode('utf-8', errors='replace'))
    expected_count = 43 if mode == 'maintained' else 1
    assert completed.returncode == 0, f'{mode} exited {completed.returncode}; see {log.name}'
    assert re.search(r'\bTests\s+' + str(expected_count) + r' passed\b', out), log.name
    receipt = dict(node=node, command=['pnpm.cmd', *CHECKS[mode]], exitCode=completed.returncode,
                   testsPassed=expected_count, log=log.name, logSha256=sha(log))
    result_paths = sorted(fixture.glob('*/windows-launcher-evidence-*/result.json'))
    if mode == 'cancel':
        receipt['artifact'] = cancel_readback(result_paths, fixture, env)
    if mode == 'totals':
        receipt['artifacts'] = totals_readback(result_paths)
    if mode == 'maintained':
        percentages = dict(re.findall(r'^(Statements|Branches|Functions|Lines)\s*:\s*([\d.]+)%', out, re.M))
        assert len(percentages) == 4, 'coverage summary missing'
        receipt['moduleCoverage'] = {field.lower(): float(percent) for field, percent in percentages.items()}
    name = mode.upper() + '-RESULT.json'
    (QA / name).write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    # The provider sees behavioral receipts without hundreds of disposable filesystem paths.
    if mode == 'cancel':
        receipt['artifact'].pop('files')
    if mode == 'totals':
        for row in receipt['artifacts']:
            row.pop('files')
    print(json.dumps({'receipt': name, **receipt}, indent=2))

if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in CHECKS:
        sys.exit('Expected exactly one named check: maintained, cancel or totals')
    main(sys.argv[1])

