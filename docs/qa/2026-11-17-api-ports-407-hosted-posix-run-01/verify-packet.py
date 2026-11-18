from datetime import datetime
from hashlib import sha256
from pathlib import Path, PurePosixPath
import json
import re
import stat
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent
RUN = 44251885185
ATTEMPT = 1
HEAD = '4579dc3b0de022da9aa90e86f7d2abfb4953214e'
PLATFORMS = {
    'macos': (134624282000, 14403264273, 'failure', 'darwin', 'macos-26-arm64'),
    'ubuntu': (134624282304, 14404516645, 'success', 'linux', 'ubuntu-26.04'),
}
SUITES = {
    'maintained': (13, ['testing/api-port.test.ts']),
    'witness': (2, ['qa407-posix/owner.test.ts', 'qa407-posix/peer.test.ts']),
}
PHASES = (
    'owner-start', 'peer-start', 'generation-held', 'generation-refused',
    'generation-released', 'generation-next-held', 'stale-release-checked',
    'generation-next-released', 'wildcard-ready', 'wildcard-checked',
    'api-reserved', 'api-unbound-refused', 'api-first-ready', 'api-first-refused',
    'api-stopped', 'api-stopped-refused', 'api-restarted', 'api-restart-refused',
    'api-settled', 'api-reacquired',
)
ZIP_MEMBERS = {
    'source.json', 'build.json', 'maintained.log', 'maintained.json',
    'maintained.exit.json', 'witness.log', 'witness.json', 'witness.exit.json',
    'ports-maintained-before.json', 'ports-maintained-after.json',
    'ports-witness-before.json', 'ports-witness-after.json',
}

def read(name):
    return json.loads((ROOT / name).read_bytes())

def receipt(raw):
    return {'bytes': len(raw), 'sha256': sha256(raw).hexdigest()}

def fnv64(value):
    digest = 14695981039346656037
    for byte in value.encode('utf-16-le'):
        digest = ((digest ^ byte) * 1099511628211) & 0xffffffffffffffff
    return format(digest, '016x')

def duration(start, end):
    if start is None or end is None:
        return None
    parse = datetime.fromisoformat
    return (parse(end) - parse(start)).total_seconds()

expected = read('expected-source-binding.json')
candidate, base, branch = (expected[key] for key in ('candidate', 'base', 'branch'))
overlay = {}
for line in (ROOT / 'prepared-packet-manifest.sha256').read_text(encoding='utf-8').splitlines():
    digest, path = line.split('  ', 1)
    if path.startswith('.github/'):
        overlay[path] = digest
assert len(overlay) == 7
connector = read('github-connector-readback.json')
compare = connector['compare']
assert compare['base'] == candidate and compare['head'] == HEAD
assert (compare['status'], compare['ahead'], compare['behind'], compare['totalCommits']) == ('ahead', 1, 0, 1)
assert [item['path'] for item in compare['files']] == sorted(overlay)
assert {item['status'] for item in compare['files']} == {'added'}

for filename in ('github-run.json', 'github-run-attempt1.json'):
    run = read(filename)
    assert (run['id'], run['run_attempt'], run['head_sha'], run['head_branch']) == (RUN, ATTEMPT, HEAD, branch)
    assert (run['event'], run['status'], run['conclusion']) == ('push', 'completed', 'failure')
head_obj, candidate_obj, base_obj = [read(f'github-{item}-commit.json') for item in ('qa', 'candidate', 'base')]
assert (head_obj['sha'], candidate_obj['sha'], base_obj['sha']) == (HEAD, candidate, base)
assert [p['sha'] for p in head_obj['parents']] == [candidate]
assert [p['sha'] for p in candidate_obj['parents']] == [base]
assert len({item['tree']['sha'] for item in (head_obj, candidate_obj, base_obj)}) == 3

job_pages = read('github-jobs-pages.json')
artifact_pages = read('github-artifact-pages.json')
assert all(page['total_count'] == 2 for page in job_pages + artifact_pages)
jobs = {x['id']: x for page in job_pages for x in page['jobs']}
artifacts = {x['id']: x for page in artifact_pages for x in page['artifacts']}
assert len(jobs) == len(artifacts) == 2
assert {x['id']: x for x in connector['artifacts']} == {
    artifact_id: {key: value for key, value in item.items() if key != 'node_id'}
    for artifact_id, item in artifacts.items()
}
assert {x['id'] for x in connector['jobs']} == set(jobs)

def read_suite(zipped, suite, is_mac):
    total, files = SUITES[suite]
    report = json.loads(zipped.read(suite + '.json'))
    exits = json.loads(zipped.read(suite + '.exit.json'))
    tests = []
    for row in report['testResults']:
        name = row['name'].split('/src/', 1)[1]
        for test in row['assertionResults']:
            tests.append({
                'file': name,
                'title': test['title'],
                'status': test['status'],
                'durationMs': test.get('duration'),
                'failureMessages': test.get('failureMessages', []),
            })
    assert sorted(row['name'].split('/src/', 1)[1] for row in report['testResults']) == files
    assert len(tests) == total == report['numTotalTests']
    failed = [test for test in tests if test['status'] == 'failed']
    passed = [test for test in tests if test['status'] == 'passed']
    assert len(failed) == (2 if is_mac and suite == 'maintained' else int(is_mac))
    assert len(passed) + len(failed) == total
    assert (report['numPassedTests'], report['numFailedTests']) == (len(passed), len(failed))
    assert report['numPendingTests'] == 0 == report['numTodoTests']
    assert report['success'] == (not failed)
    assert exits == {'vitestCommandExit': int(is_mac), 'teeExit': 0, 'postflightExit': 0}
    if suite == 'maintained':
        listener_title = 'preserves an existing {} listener and refuses its otherwise unreserved port'
        listeners = {host: next(t for t in tests if t['title'] == listener_title.format(host))
                     for host in ('127.0.0.1', '0.0.0.0', '::')}
        assert listeners['127.0.0.1']['status'] == 'passed'
        if is_mac:
            assert failed == [listeners['0.0.0.0'], listeners['::']]
            assert 'promise resolved "18487" instead of rejecting' in failed[0]['failureMessages'][0]
            assert 'promise resolved "18477" instead of rejecting' in failed[1]['failureMessages'][0]
    elif is_mac:
        assert len(failed) == 1 and failed[0]['file'] == 'qa407-posix/peer.test.ts'
        assert "expected 'granted' to be 'refused'" in failed[0]['failureMessages'][0]
    return {'total': total, 'passed': len(passed), 'failed': len(failed), 'skipped': 0, 'exit': exits, 'cases': tests}

def phases_from(log):
    records = [json.loads(m.group(1)) for m in re.finditer(r'GG407 (\{[^\r\n]+\})', log)]
    phases = {record['phase']: record for record in records}
    assert len(records) == len(phases) == len(PHASES)
    assert set(phases) == set(PHASES)
    return phases

result = {
    'runId': RUN, 'attempt': ATTEMPT, 'conclusion': 'failure', 'branch': branch,
    'qaHead': HEAD, 'qaTree': head_obj['tree']['sha'], 'candidate': candidate,
    'candidateTree': candidate_obj['tree']['sha'], 'base': base, 'baseTree': base_obj['tree']['sha'],
    'platforms': {},
}
for label, (job_id, artifact_id, conclusion, platform, image) in PLATFORMS.items():
    is_mac = label == 'macos'
    job, artifact = jobs[job_id], artifacts[artifact_id]
    assert (job['run_id'], job['run_attempt'], job['head_sha']) == (RUN, ATTEMPT, HEAD)
    assert (job['conclusion'], job['status'], job['labels']) == (conclusion, 'completed', [label + '-latest'])
    connector_job = next(j for j in connector['jobs'] if j['id'] == job_id)
    assert all(connector_job[key] == job[key] for key in ('id', 'name', 'status', 'conclusion', 'run_id'))
    steps = [{key: s[key] for key in ('name', 'status', 'conclusion', 'number')} for s in job['steps']]
    assert steps == connector['platforms'][label]['steps']
    failure_steps = {s['name'] for s in steps if s['conclusion'] == 'failure'}
    assert failure_steps == ({'Maintained API port tests', 'Two-worker native lease and API witness'} if is_mac else set())
    for s in ('Frozen install', 'Build candidate', 'Upload selected evidence'):
        assert next(step['conclusion'] for step in steps if step['name'] == s) == 'success'

    archive = ROOT / f'{label}-{artifact_id}.zip'
    archive_bytes = receipt(archive.read_bytes())
    assert artifact['digest'] == 'sha256:' + archive_bytes['sha256']
    assert artifact['size_in_bytes'] == archive_bytes['bytes']
    assert artifact['name'] == f'gg407-posix-{label}-latest-{RUN}-{ATTEMPT}'
    assert not artifact['expired']
    assert artifact['workflow_run']['id'] == RUN
    assert artifact['workflow_run']['head_sha'] == HEAD
    assert artifact['workflow_run']['head_branch'] == branch
    assert connector['platforms'][label]['download']['artifactId'] == artifact_id

    log_filename = f'{label}.raw.log'
    raw_log = (ROOT / log_filename).read_bytes()
    log = raw_log.decode('utf-8')
    assert fnv64(log) == connector['platforms'][label]['decodedLog']['fnv64Utf16LE']
    assert re.search(r'git log -1 --format=%H\r?\n[^\r\n]* ' + HEAD + r'\r?\n', log)
    assert f'Image: {image}' in log
    assert f'Artifact {artifact["name"]} has been successfully uploaded! Final size is {archive_bytes["bytes"]} bytes. Artifact ID is {artifact_id}' in log
    assert f'SHA256 digest of uploaded artifact zip is {archive_bytes["sha256"]}' in log

    with ZipFile(archive) as zipped:
        assert zipped.testzip() is None
        assert set(zipped.namelist()) == ZIP_MEMBERS and len(zipped.namelist()) == len(ZIP_MEMBERS)
        members = {}
        for info in zipped.infolist():
            assert not info.is_dir() and not stat.S_ISLNK(info.external_attr >> 16)
            assert len(PurePosixPath(info.filename).parts) == 1 and '\\' not in info.filename
            data = zipped.read(info.filename)
            assert not re.search(rb'\bgg_[A-Za-z0-9_-]{20,}\b', data)
            members[info.filename] = receipt(data)

        source = json.loads(zipped.read('source.json'))
        assert (source['head'], source['genealogy'], source['candidateGenealogy']) == (HEAD, [HEAD, candidate], [candidate, base])
        assert (source['headTree'], source['candidateTree']) == (head_obj['tree']['sha'], candidate_obj['tree']['sha'])
        assert (source['runId'], source['attempt'], source['ref']) == (str(RUN), str(ATTEMPT), 'refs/heads/' + branch)
        assert source['sources'] == expected['frozenSources']
        assert {x['path']: x['sha256'] for x in source['overlay']} == overlay
        assert source['diff'] == ['A\t' + path for path in sorted(overlay)]
        assert source['runner']['platform'] == platform
        assert ('Version: ' + source['runner']['imageVersion']) in log
        assert source['node'].startswith('v22.')

        build = json.loads(zipped.read('build.json'))
        assert build['head'] == HEAD
        assert build['hash'] == [
            expected['historicalWindowsBuild'],
            {'path': 'pnpm-lock.yaml', 'sha256': '3fda48ff6e5a65af5a280ede5364ea23ae21fb32c068e3e1cf8835c12a0916df'},
        ]

        suites = {suite: read_suite(zipped, suite, is_mac) for suite in SUITES}
        ports = {}
        for suite in SUITES:
            for time in ('before', 'after'):
                key = suite + '-' + time
                control = json.loads(zipped.read(f'ports-{key}.json'))
                assert control['range'] == {'start': 18470, 'end': 18489}
                assert control['observations'] == [
                    {'host': host, 'port': port, 'bound': True}
                    for port in range(18470, 18490) for host in ('127.0.0.1', '0.0.0.0', '::')
                ]
                assert control['knownResidue'] == [] and control['entryCount'] == 0
                ports[key] = {'bindsPassed': len(control['observations']), 'root': control['temporaryRoot'], 'temporaryEntries': control['entryCount']}

        phases = phases_from(zipped.read('witness.log').decode('utf-8'))
        assert phases == phases_from(log)
        owner_pid, peer_pid = (phases[worker + '-start']['workerPid'] for worker in ('owner', 'peer'))
        assert owner_pid != peer_pid
        assert phases['owner-start']['root'] == phases['peer-start']['root']
        assert phases['owner-start']['root'].startswith(ports['witness-before']['root'] + '/gg-api-ports-')
        assert phases['wildcard-ready']['port'] == 18471
        collision = phases['wildcard-checked']
        assert (collision['nativeBind'], collision['reservation'], collision['foreignAnswered']) == (
            ('bind-succeeded', 'granted', True) if is_mac else ('EADDRINUSE', 'refused', True)
        )
        for name, bound in (('api-unbound-refused', False), ('api-first-refused', True),
                            ('api-stopped-refused', False), ('api-restart-refused', True)):
            assert (phases[name]['bound'], phases[name]['lease'], phases[name]['workerPid']) == (bound, 'refused', peer_pid)
        child_pids = [phases[name]['childPid'] for name in ('api-first-ready', 'api-restarted')]
        assert len(set(child_pids)) == 2 and all(isinstance(pid, int) for pid in child_pids)
        settlement = phases['api-settled']
        assert settlement['closeObserved'] and not settlement['markerAtClose']
        assert phases['api-reacquired']['workerPid'] == peer_pid
        result['platforms'][label] = {
            'jobId': job_id, 'conclusion': conclusion, 'runtime': source['runner'] | {
                'hostedImage': image, 'node': source['node'], 'libuv': source['libuv'], 'pnpm': source['pnpm']
            },
            'elapsedSeconds': duration(job['started_at'], job['completed_at']),
            'steps': [s | {'durationSeconds': duration(s['started_at'], s['completed_at'])} for s in job['steps']],
            'artifactId': artifact_id, 'archive': {'filename': archive.name, **archive_bytes},
            'jobLog': {'filename': log_filename, **receipt(raw_log)},
            'members': members, 'build': build['hash'], 'suites': suites, 'ports': ports,
            'forkPids': {'owner': owner_pid, 'peer': peer_pid}, 'apiChildPids': child_pids, 'phases': phases,
        }

(ROOT / 'evidence.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({name: {
    'job': platform['jobId'], 'artifact': platform['artifactId'], 'cases': {
        suite: [record[key] for key in ('total', 'passed', 'failed', 'skipped')]
        for suite, record in platform['suites'].items()
    }, 'ports': sum(p['bindsPassed'] for p in platform['ports'].values()),
    'seconds': platform['elapsedSeconds'],
} for name, platform in result['platforms'].items()}))
