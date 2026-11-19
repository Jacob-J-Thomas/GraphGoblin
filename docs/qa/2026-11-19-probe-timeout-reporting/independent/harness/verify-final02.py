from hashlib import sha256
from pathlib import Path
import json

root = Path(__file__).resolve().parent
expected = '70f06fa3abb5a13b5d525799b2c675c6564f2483aa082708f0bcbc3e321edcfb'
def load(path): return json.loads(path.read_bytes())
def digest(path): return sha256(path.read_bytes()).hexdigest()
def events(path): return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line]
def first(values, name): return next(value for value in values if value['event'] == name)
bindings = load(root / 'final02-source-binding.json')
assert len(bindings) == 1 and bindings[0]['sourceSha256'] == expected
assert digest(Path(bindings[0]['sourcePath'])) == expected
names = ['midbody-original', 'midbody-distinct', 'pre-direct', 'pre-lifecycle', 'helper-double-fault', 'maintained-suite']
rows = []
for mode in names:
    name = f'final02-{mode}-01'
    directory = root / name
    summary = load(directory / 'driver-summary.json')
    receipt = load(directory / 'command-receipt.json')
    report = load(directory / 'vitest.json')
    input_directory = Path(summary['input'])
    meta = load(input_directory / 'meta.json')
    assert summary['sourceSha256'] == meta['sourceSha256'] == expected
    assert digest(input_directory / 'case.test.ts') == meta['generatedSha256']
    assert not any(key in (input_directory / 'vitest.config.mjs').read_text() for key in ('testTimeout', 'hookTimeout', 'retry'))
    assert not summary['watchdogFired'] and not receipt['externalDeadlineReached']
    assert summary['unhandled'] == [] and receipt['ownedFakeProcessesAfterRun'] == []
    assert receipt['runnerTempExistsBeforeExternalCleanup'] and not receipt['runnerTempExistsAfterExternalCleanup']
    assert receipt['actualExit'] == (0 if mode == 'maintained-suite' else 1)
    row = {
        'run': name, 'mode': mode, 'sourceSha256': expected, 'actualExit': receipt['actualExit'],
        'endReason': summary['endReason'], 'publicCancelRequests': summary['cancelRequests'],
        'passed': summary['passed'], 'failed': summary['failed'], 'reportedPending': summary['skipped'],
        'selectedAssertions': summary['assertions'], 'input': summary['input'],
        'generatedSha256': meta['generatedSha256'], 'configSha256': digest(input_directory / 'vitest.config.mjs'),
        'runnerTempAfterClose': summary['runnerTempAfterClose'],
        'ownedFakeProcessesAfterRun': receipt['ownedFakeProcessesAfterRun'],
    }
    if mode.startswith('midbody-'):
        values = events(directory / 'events.jsonl')
        imported = first(values, 'real-importActual-resolved')
        aborted = first(values, 'actual-outer-abort')
        released = first(values, 'released-import-result')
        successor = first(values, 'successor-first-observation')
        messages = report['testResults'][0]['assertionResults'][0]['failureMessages']
        assert summary['cancelRequests'] == 0 and summary['endReason'] == 'failed'
        assert summary['passed'] == summary['failed'] == 1 and summary['assertions'][1]['status'] == 'passed'
        assert imported['elapsedMs'] < aborted['elapsedMs'] and not imported['outerAborted']
        assert aborted['elapsedMs'] >= 4900 and released['elapsedMs'] - aborted['elapsedMs'] >= 650
        assert released['sameReasonObject'] and released['outerAborted'] and released['innerAborted']
        assert successor['outerFinished'] and successor['localMockRestoredOrNotInstalled']
        assert successor['rootsCreated'] == successor['childrenCreated'] == successor['livingOwnedChildren'] == 0
        assert successor['rootsStillPresent'] == [] and successor['envRestored'] and successor['rmImplementationRestored'] and successor['runnerEntriesUnchanged']
        assert summary['runnerTempAfterClose']['entries'] == [] and receipt['runnerTempEntriesBeforeExternalCleanup'] == []
        if mode == 'midbody-original':
            assert summary['assertions'][0]['failureHeads'] == ['Error: Test timed out in 5000ms.'] and len(messages) == 1
            assert successor['faultMockInstalled'] and successor['localMockRestored']
        else:
            distinct = first(values, 'distinct-error-created')
            assert distinct['sameObject'] is False and distinct['sameMessage'] and distinct['sameStack']
            assert len(messages) == 2 and messages[0] == messages[1]
            assert summary['assertions'][0]['failureHeads'] == ['Error: Test timed out in 5000ms.'] * 2
            assert not successor['faultMockInstalled']
            row['identityDiscriminator'] = distinct
        row.update({'importResolvedAtMs': imported['elapsedMs'], 'importAwaitMs': imported['actualImportDurationMs'], 'outerAbortAtMs': aborted['elapsedMs'], 'heldResultReleasedAtMs': released['elapsedMs'], 'successor': successor, 'fullFailureStringsIdentical': len(messages) == 2 and messages[0] == messages[1]})
    elif mode == 'helper-double-fault':
        values = events(directory / 'helper-events.jsonl')
        successor = first(values, 'successor-start')
        assert summary['passed'] == summary['failed'] == 1 and summary['assertions'][1]['status'] == 'passed'
        assert summary['assertions'][0]['failureHeads'] == ['Error: Test timed out in 5000ms.', 'Error: QA466_LATE_BODY_FAILURE', 'Error: QA466_ROOT_REMOVE_FAILURE']
        assert successor['bodySettled'] and successor['probeRmCompleted'] and successor['rootRmObserved']
        assert not successor['priorProbeExists'] and successor['priorRootExists'] and successor['tempMatchesOriginal'] and not successor['nativeChildPresent']
        assert len(summary['runnerTempAfterClose']['entries']) == len(receipt['runnerTempEntriesBeforeExternalCleanup']) == 1
        row['successor'] = successor
    else:
        values = events(directory / 'events.jsonl')
        final = first(values, 'final-worker-observation')
        assert final['rootsStillPresent'] == [] and final['envRestored'] and final['livingOwnedChildren'] == final['nativeOwnedChildren'] == []
        assert final['runnerEntriesAtHook'] == final['runnerEntriesAtBeforeEach']
        assert summary['runnerTempAfterClose']['entries'] == [] and receipt['runnerTempEntriesBeforeExternalCleanup'] == []
        if mode.startswith('pre-'):
            past = first(values, 'beforeEach-leave-with-past-abort')
            assert past['signalAborted'] and 'TestRunAbortError' in past['reason']
            assert summary['cancelRequests'] == 1 and summary['endReason'] == 'interrupted'
            assert summary['passed'] == summary['failed'] == 0 and summary['assertions'][0]['status'] == 'skipped'
            assert summary['assertions'][0]['failureHeads'] == [] and final['rootsCreated'] == [] and final['childrenCreated'] == 0
        else:
            assert summary['passed'] == 14 and summary['failed'] == summary['skipped'] == 0
            assert summary['cancelRequests'] == 0 and summary['endReason'] == 'passed'
            previous = load(root.parent / 'pr505-midbody-dedup-independent-qa/candidate01-maintained-suite-01/driver-summary.json')
            assert {item['title'] for item in previous['assertions']}.issubset({item['title'] for item in summary['assertions']})
            assert all(item['status'] == 'passed' for item in summary['assertions'])
        row['workerFinalSnapshot'] = final
    rows.append(row)
prior_seals = []
for directory, expected_manifest, count in [
    (root.parent / 'pr505-preaborted-independent-qa/public', '35325151cf1be66cc97b5561af2515ef52f85173a4c34c119a3a4011a6ce9735', 176),
    (root.parent / 'pr505-midbody-timeout-note', 'd4bdb3a0d1d8af68d1dac8c1e9193ae79c7dccd863ee71231b262559584d762f', 34),
    (root.parent / 'pr505-midbody-dedup-independent-qa/public', '85de63d2e2787a92e7c066a80e5507ceffb8c4c7f4152a1bed993a57550f040f', 78),
]:
    manifest = directory / 'MANIFEST.sha256'
    assert digest(manifest) == expected_manifest
    lines = manifest.read_text().splitlines()
    assert len(lines) == count
    for line in lines:
        expected_hash, relative = line.split('  ', 1)
        assert digest(directory / relative) == expected_hash
    prior_seals.append({'manifestSha256': expected_manifest, 'payloadFilesVerifiedUnchanged': count})
baseline = load(root / 'baseline-binding.json')
for item in baseline['files']:
    path = Path(baseline['sourceRoot']) / item['path']
    assert digest(path) == item['sha256'] and path.stat().st_size == item['bytes']
result = {
    'verdict': 'PASS on the exact frozen candidate: suppress only the original abort reason; preserve distinct equal-text errors, late/cleanup failures and genuine F2 skips',
    'candidateSourceSha256': expected, 'candidateBaseCommit': bindings[0]['baseCommit'], 'candidateSnapshot': bindings[0]['coordinatorSnapshot'],
    'runCount': len(rows), 'priorSealsVerifiedUnchanged': prior_seals,
    'immutableProductionExportFilesVerified': len(baseline['files']),
    'driverSha256': digest(root / 'run-case.mjs'), 'nativeRunnerSha256': digest(root / 'run-native.ps1'),
    'midbodyGeneratorSha256': digest(root / 'generate-midbody.mjs'), 'selectedGeneratorSha256': digest(root / 'generate-selected.mjs'),
    'runs': rows,
}
(root / 'final02-verified.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: result[key] for key in ('verdict', 'candidateSourceSha256', 'runCount', 'immutableProductionExportFilesVerified', 'priorSealsVerifiedUnchanged')}, indent=2))
