from hashlib import sha256
from pathlib import Path
import json

packet = Path(__file__).resolve().parent
baseline_sha = 'e211bfdc49b1a465e4b1b0d997f028005112d003282417c7286172f928e15e75'
corrected_sha = 'bf35aebd27666194aec20fd08c4168a16c452c7706f18353e6f1afee70f590d4'
modes = ['pre-direct', 'pre-lifecycle', 'flight-direct', 'flight-lifecycle', 'ordinary-error', 'timeout-direct', 'timeout-lifecycle', 'maintained-suite', 'helper-double-fault']
def load(path): return json.loads(path.read_bytes())
def events(path): return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line]
def first(values, event): return next(value for value in values if value['event'] == event)
def digest(path): return sha256(path.read_bytes()).hexdigest()
results = []
by_case = {}
driver_hash = digest(packet / 'run-case.mjs')
runner_hash = digest(packet / 'run-native.ps1')
for revision, source_sha in [('baseline', baseline_sha), ('corrected02', corrected_sha)]:
    for mode in modes:
        name = f'{revision}-{mode}-01'
        directory = packet / name
        summary = load(directory / 'driver-summary.json')
        receipt = load(directory / 'command-receipt.json')
        config_directory = Path(summary['input'])
        meta = load(config_directory / 'meta.json')
        assert summary['sourceSha256'] == meta['sourceSha256'] == source_sha
        assert digest(config_directory / 'case.test.ts') == meta['generatedSha256']
        assert digest(config_directory / 'vitest.config.mjs') == meta['configSha256']
        assert not any(value in (config_directory / 'vitest.config.mjs').read_text() for value in ('testTimeout', 'hookTimeout', 'retry'))
        assert not receipt['externalDeadlineReached'] and not summary['watchdogFired']
        assert summary['unhandled'] == [] and receipt['ownedFakeProcessesAfterRun'] == []
        assert receipt['runnerTempExistsBeforeExternalCleanup'] is True
        assert receipt['runnerTempExistsAfterExternalCleanup'] is False
        assert summary['runnerTempBeforeClose']['exists'] is True and summary['runnerTempAfterClose']['exists'] is True
        assert receipt['actualExit'] == (0 if mode == 'maintained-suite' else 1)
        row = {
            'run': name, 'revision': revision, 'mode': mode, 'sourceSha256': source_sha,
            'input': summary['input'], 'generatedSha256': meta['generatedSha256'], 'configSha256': meta['configSha256'],
            'driverSha256': driver_hash, 'nativeRunnerSha256': runner_hash,
            'actualProcessExit': receipt['actualExit'], 'vitestEndReason': summary['endReason'],
            'publicCancelRequests': summary['cancelRequests'], 'passed': summary['passed'], 'failed': summary['failed'],
            'reportedPendingCounter': summary['skipped'], 'selectedAssertions': summary['assertions'],
            'runnerTempExistsAfterVitestClose': summary['runnerTempAfterClose']['exists'],
            'runnerEntriesAfterVitestClose': summary['runnerTempAfterClose']['entries'],
            'runnerTempRemovedAfterObservation': not receipt['runnerTempExistsAfterExternalCleanup'],
        }
        if mode == 'helper-double-fault':
            helper_events = events(directory / 'helper-events.jsonl')
            successor = first(helper_events, 'successor-start')
            assert successor['bodySettled'] and successor['probeRmCompleted'] and successor['rootRmObserved']
            assert successor['priorProbeExists'] is False and successor['priorRootExists'] is True
            assert successor['tempMatchesOriginal'] and successor['nativeChildPresent'] is False
            assert len(summary['runnerTempAfterClose']['entries']) == len(receipt['runnerTempEntriesBeforeExternalCleanup']) == 1
            assert summary['assertions'][0]['failureHeads'] == ['Error: Test timed out in 5000ms.', 'Error: QA466_LATE_BODY_FAILURE', 'Error: QA466_ROOT_REMOVE_FAILURE']
            assert summary['assertions'][1]['status'] == 'passed'
            assert summary['cancelRequests'] == 0 and summary['endReason'] == 'failed'
            row['intentionalRetainedCaseRootBeforeExternalCleanup'] = summary['runnerTempAfterClose']['entries']
            row['successorSnapshot'] = successor
        else:
            worker_events = events(directory / 'events.jsonl')
            final = first(worker_events, 'final-worker-observation')
            assert final['rootsStillPresent'] == [] and final['envRestored']
            assert final['livingOwnedChildren'] == final['nativeOwnedChildren'] == []
            assert final['runnerTempExists'] and final['runnerEntriesAtHook'] == final['runnerEntriesAtBeforeEach']
            assert summary['runnerTempAfterClose']['entries'] == [] and receipt['runnerTempEntriesBeforeExternalCleanup'] == []
            assert set(final['runnerEntriesAtHook']).issubset(set(summary['runnerTempBeforeClose']['entries']))
            row.update({'caseRootsCreated': len(final['rootsCreated']), 'nativeChildrenCreated': final['childrenCreated'], 'workerFinalSnapshot': final})
            if mode.startswith('pre-'):
                past = first(worker_events, 'beforeEach-leave-with-past-abort')
                assert past['signalAborted'] and 'TestRunAbortError' in past['reason']
                assert summary['cancelRequests'] == 1 and summary['endReason'] == 'interrupted'
                if revision == 'corrected02':
                    assert summary['assertions'][0]['status'] == 'skipped' and summary['assertions'][0]['failureHeads'] == []
                    assert final['rootsCreated'] == [] and final['childrenCreated'] == 0
                    assert summary['passed'] == summary['failed'] == 0
                elif mode == 'pre-direct':
                    assert summary['assertions'][0]['status'] == 'failed'
                    assert len(summary['assertions'][0]['failureHeads']) == 2
                    assert len(set(summary['assertions'][0]['failureHeads'])) == 1
                    assert len(final['rootsCreated']) == 1 and final['childrenCreated'] == 0
                else:
                    assert summary['assertions'][0]['status'] == 'passed' and final['childrenCreated'] == 4
                    abort_index = next(i for i, item in enumerate(worker_events) if item['event'] == 'actual-enclosing-signal-abort')
                    assert all(i > abort_index for i, item in enumerate(worker_events) if item['event'] == 'owned-child-native-spawn')
                    assert first(worker_events, 'case-root-created')['signalAborted'] is False
            elif mode.startswith('flight-'):
                assert summary['cancelRequests'] == 1 and summary['endReason'] == 'interrupted'
                assert summary['assertions'][0]['status'] == 'failed' and len(summary['assertions'][0]['failureHeads']) == 1
                assert final['childrenCreated'] == 4
                marker = first(worker_events, 'cancel-request-marker')
                assert marker['nativePresent'] is True
                abort_index = next(i for i, item in enumerate(worker_events) if item['event'] == 'actual-enclosing-signal-abort')
                assert all(i < abort_index for i, item in enumerate(worker_events) if item['event'] == 'owned-child-native-spawn')
                assert all(i < abort_index for i, item in enumerate(worker_events) if item['event'] == 'owned-child-created')
                late_exit = next(item for i, item in enumerate(worker_events) if i > abort_index and item['event'] == 'owned-child-native-exit')
                assert late_exit['nativePresent'] is False and late_exit['signal'] == 'SIGTERM'
                assert first(worker_events, 'case-root-created')['signalAborted'] is False
            elif mode.startswith('timeout-'):
                assert summary['cancelRequests'] == 0 and summary['endReason'] == 'failed'
                assert summary['assertions'][0]['status'] == 'failed'
                heads = summary['assertions'][0]['failureHeads']
                assert len(heads) == 2 and heads[0] == 'Error: Test timed out in 5000ms.' and heads[1].startswith('AssertionError:')
                aborted = first(worker_events, 'actual-enclosing-signal-abort')
                released = first(worker_events, 'released-real-readdir')
                assert aborted['elapsedMs'] >= 4900 and released['elapsedMs'] - aborted['elapsedMs'] >= 650
            elif mode == 'ordinary-error':
                assert summary['cancelRequests'] == 0 and summary['endReason'] == 'failed'
                assert summary['assertions'][0]['failureHeads'] == ['Error: QA505_ORDINARY_BODY_FAILURE']
            else:
                assert summary['passed'] == (9 if revision == 'baseline' else 12)
                assert summary['failed'] == summary['skipped'] == 0 and summary['cancelRequests'] == 0
                assert all(item['status'] == 'passed' for item in summary['assertions'])
        by_case[(revision, mode)] = summary
        results.append(row)
for mode in ('flight-direct', 'flight-lifecycle', 'ordinary-error', 'timeout-direct', 'timeout-lifecycle', 'helper-double-fault'):
    assert by_case[('baseline', mode)]['assertions'] == by_case[('corrected02', mode)]['assertions']
baseline_titles = {item['title'] for item in by_case[('baseline', 'maintained-suite')]['assertions']}
corrected_titles = {item['title'] for item in by_case[('corrected02', 'maintained-suite')]['assertions']}
assert baseline_titles.issubset(corrected_titles)
binding = load(packet / 'baseline-binding.json')
for item in binding['files']:
    path = Path(binding['sourceRoot']) / item['path']
    assert path.stat().st_size == item['bytes'] and digest(path) == item['sha256']
assert binding['baselineLockSha256'] == binding['existingDependencyLockSha256']
corrected_source = Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/pr505-preaborted-source-02/probe-directory.test.ts')
assert digest(corrected_source) == corrected_sha
summary = {
    'verdict': 'PASS: both genuine pre-entry cases skip without work/errors; paired future-abort, ordinary/error and timeout behavior is preserved',
    'baselineCommit': binding['commit'], 'baselineTestSha256': baseline_sha, 'correctedTestSha256': corrected_sha,
    'correctedSourceSnapshot': str(corrected_source),
    'testingDocSha256ReportedByCoordinator': '772275e48299323f91a5bf8197ca08fd6df119658ed35568ab3e693ccca3f0b2',
    'verifiedPairedRuns': len(results), 'baselineExportFilesVerifiedUnchanged': len(binding['files']),
    'existingDependencyLockMatchesBaseline': True, 'vitestVersion': binding['vitestVersion'],
    'source01Executed': False, 'finalCandidateConfirmedByCoordinator': True,
    'harnessDigests': {'driver': driver_hash, 'nativeRunner': runner_hash, 'generator': digest(packet / 'generate-cases.mjs')},
    'runs': results,
}
(packet / 'verified-results.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: summary[key] for key in ('verdict', 'baselineCommit', 'baselineTestSha256', 'correctedTestSha256', 'verifiedPairedRuns', 'baselineExportFilesVerifiedUnchanged')}, indent=2))
