"""Read-only independent #419 artifact and Git audit. Writes only beside this script."""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

OUT = Path(__file__).resolve().parent
EXT = OUT.parent
REPO = Path(r'C:\Users\98jak\.codex\worktrees\gg-20261115-runtime\GraphGoblin')
TARGET = '98692c8a8c7b519e8c83e585e026d595cedc0550'
SOURCE = '7b7932f89b038a4635183b6adbc5fefa6df4fa6f'
HEAD = '497acaa602959bc828e8f1e90f2dce0a576a3492'
MERGE = '387322e7f7d2b2f4a48c149aeaea2fc4f3001996'
ACTIVE = ['apps/api/src/routes/runs.ts', 'apps/api/src/run-history.ts',
          'apps/api/src/routes/thread-disconnect.test.ts',
          'docs/07-api-and-streaming.md', 'CHANGELOG.md']
env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
commands = []

def sha(data):
    return hashlib.sha256(data).hexdigest()

def file_sha(path):
    return sha(Path(path).read_bytes())

def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

def git(*args):
    r = subprocess.run(['git', *args], cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    commands.append({'argv': ['git', *args], 'exitCode': r.returncode,
                     'stdoutBytes': len(r.stdout), 'stdoutSha256': sha(r.stdout),
                     'stderr': r.stderr.decode('utf-8', errors='replace')})
    if r.returncode:
        raise RuntimeError(commands[-1])
    return r.stdout

receipt = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': str(REPO)}
receipt['identities'] = {
    ref: {'commit': git('rev-parse', ref).decode().strip(),
          'tree': git('rev-parse', ref + '^{tree}').decode().strip(),
          'parents': git('show', '-s', '--format=%P', ref).decode().strip().split()}
    for ref in [TARGET, SOURCE, HEAD, MERGE]
}
assert receipt['identities'][SOURCE]['parents'] == [TARGET]
assert receipt['identities'][HEAD]['parents'] == [SOURCE]
assert receipt['identities'][MERGE]['parents'] == [TARGET, HEAD]
assert receipt['identities'][MERGE]['tree'] == receipt['identities'][HEAD]['tree']
assert git('rev-parse', 'HEAD').decode().strip() == HEAD
assert not git('status', '--porcelain=v2', '--untracked-files=all')
changes = git('diff', '--name-status', TARGET, HEAD).decode().splitlines()
publication = git('diff', '--name-only', SOURCE, HEAD).decode().splitlines()
assert all(p.startswith('docs/qa/') or p == 'docs/delivery/2026-11-13-four-intents-register.md' for p in publication)
source_paths = git('diff', '--name-only', TARGET, SOURCE).decode().splitlines()
assert sorted(source_paths) == sorted(ACTIVE)
receipt['diff'] = {'effectivePaths': source_paths, 'publicationOnlyPaths': publication,
                   'allChanges': changes, 'count': len(changes)}
patch = git('diff', '--no-ext-diff', '--no-textconv', TARGET, HEAD, '--', *ACTIVE)
(OUT / 'effective-source.diff').write_bytes(patch)
git('diff', '--check', TARGET, SOURCE)
git('diff', '--check', TARGET, HEAD, '--', '.', ':(exclude)docs/qa/**')
receipt['sourceBlobs'] = []
accepted_source = read_json(EXT / 'runtime-419-source-root-acceptance.json')
for path in ACTIVE:
    digests = {r: sha(git('show', f'{r}:{path}')) for r in [SOURCE, HEAD, MERGE]}
    digests['worktree'] = file_sha(REPO / path)
    expected = next(f['sha256'] for f in accepted_source['files'] if f['path'] == path)
    assert set(digests.values()) == {expected}, (path, digests, expected)
    receipt['sourceBlobs'].append({'path': path, 'sha256': expected, 'identicalAt': list(digests)})

qa = REPO / 'docs/qa'
packet_paths = [qa / ('2026-11-15-history-disconnect-' + x) for x in ['baseline', 'implementation', 'candidate']]
packet_paths += [qa / ('2026-11-15-terminal-wait-' + x) for x in ['current-ci', 'opus-review', 'completion']]
packet_paths += [EXT / 'proposed/docs/qa/2026-11-15-history-disconnect-current-ci']
receipt['packets'] = []
for packet in packet_paths:
    seal = packet / 'SHA256SUMS.txt'
    checks = []
    for line in seal.read_text(encoding='utf-8-sig').splitlines():
        if not line.strip():
            continue
        digest, name = re.split(r'\s+', line, maxsplit=1)
        name = name.lstrip('*')
        actual = file_sha(packet / name)
        assert actual == digest.lower(), (packet.name, name, actual, digest)
        checks.append(name)
    copies = []
    derived = []
    mapping_path = packet / 'source-copy-map.json'
    mapping = read_json(mapping_path)
    source_root = Path(mapping.get('sourceRoot', str(EXT)))
    rows = mapping.get('files', [])
    if isinstance(rows, dict):
        rows = list(rows.values())
    for row in rows:
        if not isinstance(row, dict) or not row.get('sourcePath'):
            continue
        source = Path(row['sourcePath'])
        if not source.is_absolute():
            source = source_root / source
        dest = packet / row['path']
        expected = row['sha256'].lower()
        assert file_sha(dest) == expected, (str(dest), 'copy mismatch')
        if row['kind'] == 'authored derived identity comparison':
            # The map explicitly identifies this one as a rewritten summary, not a raw copy.
            assert packet.name == '2026-11-15-terminal-wait-current-ci'
            original, authored = read_json(source), read_json(dest)
            assert original['runId'] == authored['runId']
            assert original['retryAttempt'] == authored['runAttempt']
            assert len(original['jobs']) == len(authored['jobs']) == 3
            for old, new in zip(original['jobs'], authored['jobs']):
                for key in ['name', 'attempt2JobId', 'status', 'conclusion', 'startedAtUtc', 'completedAtUtc']:
                    assert old[key] == new[key]
                for a, b in [('originalJobId', 'attempt1JobId'), ('logChars', 'decodedLogCharacters'),
                             ('decodedLogSha256', 'attempt1LogSha256'), ('textIdenticalToAttempt1', 'decodedLogTextEqual')]:
                    assert old[a] == new[b]
                assert file_sha(dest.parent / new['attempt1LogPath']) == new['attempt1LogSha256']
            assert dest.stat().st_size == row['bytes']
            derived.append({'path': row['path'], 'source': str(source), 'sourceSha256': file_sha(source),
                            'derivedSha256': expected, 'result': 'all three job identities/times/logs agree'})
            continue
        assert file_sha(source) == expected, (str(source), 'original mismatch')
        if 'bytes' in row:
            assert source.stat().st_size == dest.stat().st_size == row['bytes']
        copies.append({'path': row['path'], 'original': str(source), 'sha256': expected})
    receipt['packets'].append({'path': str(packet), 'manifestSha256': file_sha(seal),
                              'manifestRows': len(checks), 'mappedCopies': len(copies),
                              'files': checks, 'copies': copies, 'derived': derived})

baseline_path = packet_paths[0] / 'native-harness/evidence-baseline-first/summary.json'
candidate_path = packet_paths[2] / 'native/evidence-candidate-first/summary.json'
base, cand = read_json(baseline_path), read_json(candidate_path)
assert file_sha(baseline_path) == '935f6a4abce16e9633f7342fb35d4bc1ca7e73f8b5c1f0c2f9defae1f989ca3c'
assert file_sha(candidate_path) == 'bb651598360f7b2395d2fa700dd923c68c71270eb2d426841472185a06f71b3b'
assert list(base['cases']) == list(cand['cases'])
native = {'baseline': str(baseline_path), 'candidate': str(candidate_path),
          'baselineSha256': file_sha(baseline_path), 'candidateSha256': file_sha(candidate_path),
          'closes': [], 'positives': [], 'negatives': [], 'listenerSettlements': {},
          'history': {}, 'cleanup': {}, 'bindings': {}}
for phase, s in [('baseline', base), ('candidate', cand)]:
    assert s['result'] == 'assertions-met'
    settled = []
    for name, case in s['cases'].items():
        for snapshot in case['listenerSnapshots']:
            if snapshot['at'] == 'handler-settled':
                assert all(row['added'] == 0 for row in snapshot['observed']), (phase, name)
                settled.append(name)
    native['listenerSettlements'][phase] = settled
    native['history'][phase] = s['history']
    assert all(v['beforeReadSha256'] == v['afterReadSha256'] for v in s['history'].values())
    native['cleanup'][phase] = s['cleanup']
    assert s['cleanup']['empty'] and not s['cleanup']['remainingStoreFiles']
    assert s['cleanup']['sockets'] == {'clients': 0, 'server': 0}
    assert s['cleanup']['remainingListener'] is None
    assert s['cleanup']['probe']['exit']['code'] == s['cleanup']['probe']['close']['code'] == 0
    native['bindings'][phase] = s['bindings']
for name, c in cand['cases'].items():
    b = base['cases'][name]
    if name.startswith('closed-'):
        close = next(t for t in c['trace'] if t['event'] == 'response-close')
        assert close['responseFinished'] is False and close['responseDestroyed'] and close['socketDestroyed']
        assert len(close['active']) <= 1
        later = [o for o in c['operations'] if o['afterClose']]
        assert later == c['writesAfterClose'] == c['attemptedSendsAfterClose'] == c['errors'] == []
        assert not any(t['event'] == 'response-finish' for t in c['trace'])
        assert not any(t['event'] == 'operation-entered' and t['step'] > close['step'] for t in c['trace'])
        barrier = next(t for t in c['trace'] if t['event'] == 'barrier-entered')
        release = next(t for t in c['trace'] if t['event'] == 'barrier-released')
        settled = next(t for t in c['trace'] if t['event'] == 'handler-settled')
        assert barrier['step'] < close['step'] < release['step'] < settled['step']
        if close['active']:
            stage = close['active'][0]
            assert any(t['event'] == 'sqlite-returned' and t['stage'] == stage and t['step'] < barrier['step'] for t in c['trace'])
        if name == 'closed-at-yield':
            scheduled = next(t for t in c['trace'] if t['event'] == 'replay-yield-scheduled')
            callback = next(t for t in c['trace'] if t['event'] == 'replay-yield-callback')
            assert scheduled['step'] < callback['step'] < barrier['step']
        native['closes'].append({'name': name, 'stage': c['stageReached'], 'activeAtClose': close['active'],
            'baselineCallsAfterClose': [o['stage'] for o in b['operations'] if o['afterClose']],
            'candidateCallsAfterClose': later, 'candidateOperations': c['operations'],
            'baselineWritesAfterClose': b['writesAfterClose'], 'baselineSendsAfterClose': b['attemptedSendsAfterClose'],
            'baselineErrors': b['errors'], 'responsiveness': c.get('responsiveness'),
            'candidateTrace': c['trace']})
    elif name in cand['positives']:
        b_wire, c_wire = base['positives'][name], cand['positives'][name]
        assert b_wire == c_wire
        for wire in [b_wire, c_wire]:
            assert sha(base64.b64decode(wire['bodyBase64'])) == wire['bodySha256']
        native['positives'].append({'name': name, 'status': c_wire['status'],
            'contentType': c_wire['contentType'], 'bodySha256': c_wire['bodySha256'],
            'operations': c['operations'], 'bytes': len(base64.b64decode(c_wire['bodyBase64']))})
    else:
        b_body = json.loads(base64.b64decode(b['response']['bodyBase64']))
        c_body = json.loads(base64.b64decode(c['response']['bodyBase64']))
        assert b['response']['status'] == c['response']['status']
        assert b_body['code'] == c_body['code']
        assert b['operations'] == c['operations']
        native['negatives'].append({'name': name, 'status': c['response']['status'],
            'code': c_body['code'], 'operations': c['operations'], 'bodyEqual': b['response'] == c['response']})
assert len(native['closes']) == 8 and len(native['positives']) == 11 and len(native['negatives']) == 10
save('native-comparison.json', native)
receipt['native'] = {'closes': 8, 'positives': 11, 'negatives': 10,
                     'settlements': {p: len(v) for p, v in native['listenerSettlements'].items()}}

coverage = read_json(EXT / 'runtime-490-second-coverage-root-readback.json')
archive = Path(coverage['zipPath'])
assert file_sha(archive) == coverage['zipSha256']
members = []
with zipfile.ZipFile(archive) as z:
    assert sorted(z.namelist()) == sorted(m['path'] for m in coverage['members'])
    for row in coverage['members']:
        raw = z.read(row['path'])
        assert len(raw) == row['bytes'] and sha(raw) == row['sha256']
        summary = json.loads(raw)
        totals = summary['total']
        assert totals['lines']['pct'] == row['lines'] >= 90
        assert totals['branches']['pct'] == row['branches'] >= 90
        members.append({'path': row['path'], 'sha256': sha(raw), 'total': totals})
receipt['coverage'] = {'archive': str(archive), 'sha256': file_sha(archive), 'members': members}
root_ci = read_json(EXT / 'runtime-490-ci-root-acceptance.json')
for row in root_ci['inputs']:
    p = EXT / row['path']
    assert p.stat().st_size == row['bytes'] and file_sha(p) == row['sha256']
receipt['rootCIInputsVerified'] = root_ci['inputs']

# Current built bytes may be compared with the accepted candidate binding; the baseline
# outputs and both historical full indices are deliberately not recaptured from this head.
binding = read_json(packet_paths[2] / 'build/build-binding.json')
assert binding['head'] == SOURCE and binding['actualMain'] == TARGET
output_bad = [p for p, digest in binding['outputFiles'].items() if file_sha(REPO / p) != digest]
dep_bad = [p for p, digest in binding['dependencyFiles'].items() if file_sha(REPO / p) != digest]
assert not output_bad and not dep_bad, (output_bad, dep_bad)
assert file_sha(binding['nodePath']) == binding['nodeSha256']
source_nonqa = {p: h for p, h in binding['sourceFiles'].items()
                if not p.startswith('docs/qa/') and p != 'docs/delivery/2026-11-13-four-intents-register.md'}
nonqa_bad = [p for p, digest in source_nonqa.items() if file_sha(REPO / p) != digest]
assert not nonqa_bad, nonqa_bad
receipt['candidateBinding'] = {'sha256': file_sha(packet_paths[2] / 'build/build-binding.json'),
    'head': binding['head'], 'tree': binding['tree'], 'historicalIndexSha256': binding['indexSha256'],
    'sourceFilesRecorded': len(binding['sourceFiles']), 'sourceNonQAVerified': len(source_nonqa),
    'outputFilesVerified': len(binding['outputFiles']), 'outputRoots': binding['outputRoots'],
    'dependencyFilesVerified': len(binding['dependencyFiles']), 'nodeSha256': binding['nodeSha256'],
    'qualification': 'Current output/dependency/non-QA hashes verified. Full historical index and baseline outputs not compared to the publication checkout.'}
receipt['commands'] = commands
receipt['result'] = 'all asserted offline checks passed'
save('artifact-verification.json', receipt)
print(json.dumps({'result': receipt['result'], 'changes': len(changes), 'sourcePaths': len(ACTIVE),
    'packetCounts': [{'packet': Path(p['path']).name, 'manifestRows': p['manifestRows'],
                      'copies': p['mappedCopies']} for p in receipt['packets']],
    'native': receipt['native'], 'coverageGroups': len(members), 'candidateBinding': receipt['candidateBinding']}, indent=2))
