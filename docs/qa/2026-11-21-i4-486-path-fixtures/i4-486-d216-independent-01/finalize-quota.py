"""Close this single quota-failed provider attempt without inventing a QA verdict."""
from pathlib import Path
import datetime, hashlib, json, runpy

OUT = Path(__file__).resolve().parent
ns = runpy.run_path(str(OUT / 'setup-orchestration.py'), run_name='sealed_setup_helpers')
read, record, new, require = (ns[k] for k in ['read', 'record', 'new', 'require'])
binding = read(OUT / 'source-binding.json')
before = binding['sourceBeforeQA']
after = ns['snapshot']()
require(before == after, 'Source/index/fixture/lock changed during quota attempt')
require(record(ns['QA'] / 'node_modules/.modules.yaml') == binding['dependencyMetadata'], 'Installed dependency metadata changed')
require(ns['common_state']() == read(OUT / 'setup-admission.json')['commonBefore'], 'Independent common main changed')
require(record(binding['rootAdmission']['source']) == binding['rootAdmission'], 'Root source admission changed')
events = [json.loads(line) for line in (OUT / 'provider/events.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
terminals = [e for e in events if e.get('type') == 'result']
require(len(terminals) == 1, 'Expected exactly one terminal')
terminal = terminals[0]
result = read(OUT / 'provider/result.json')
require(terminal == result, 'Saved result differs from raw terminal')
require(result['is_error'] is True and result['terminal_reason'] == 'api_error' and result['api_error'] == 'usage_limit_reached' and result['api_error_status'] == 429, 'Not the observed quota result')
require(not result['modelUsage'], 'Quota attempt unexpectedly has actual model usage')
require(read(OUT / 'provider/exit.json')['code'] == 1 and read(OUT / 'dispatch-exit.json')['code'] == 1, 'Expected exact nonzero provider and wrapper exit')
require((OUT / 'provider/provider-final-message.md').read_bytes() == result['result'].encode(), 'Provider final message is not byte exact')
launch = read(OUT / 'provider/launch.json')
require(launch['model'] == 'claude-opus-5-5' and launch['effort'] == 'xhigh', 'Wrong requested provider binding')
tool_calls = [c for e in events if e.get('type') == 'assistant' for c in e.get('message', {}).get('content', []) if c.get('type') == 'tool_use']
require(not tool_calls, 'Provider unexpectedly executed tools')
rates = [e['rate_limit_info'] for e in events if e.get('type') == 'rate_limit_event']
require(len(rates) == 1 and rates[0]['rateLimitType'] == 'seven_day' and rates[0]['resetsAt'] == 1795417200, 'Unexpected quota/reset')
rate = rates[0]
require(rate['isUsingOverage'] is False, 'Overage unexpectedly used')
utc = datetime.datetime.fromtimestamp(rate['resetsAt'], datetime.timezone.utc).isoformat()
prior = read(OUT / 'prior-harness-bindings.json')
checkpoint = {
    'status': 'BLOCKED_WEEKLY_QUOTA_NO_QA_VERDICT',
    'head': binding['head'], 'tree': binding['tree'], 'parent': binding['parent'],
    'sourceBefore': before, 'sourceAfter': after,
    'sourceIndexLockFixtureAndDependencyMetadataUnchanged': True,
    'commonMainWorktreeAndIndexUnchanged': True,
    'rootAdmission': binding['rootAdmission'],
    'requestedModel': launch['model'], 'requestedEffort': launch['effort'],
    'actualModelUsage': result['modelUsage'],
    'assistantModels': sorted({e['message'].get('model') for e in events if e.get('type') == 'assistant'}),
    'sessionId': result['session_id'], 'providerInvocations': 1,
    'providerExit': 1, 'wrapperExit': 1, 'terminalCount': 1,
    'isError': True, 'terminalReason': result['terminal_reason'],
    'apiError': result['api_error'], 'apiStatus': result['api_error_status'],
    'rawSubtype': result['subtype'],
    'subtypeQualification': 'The literal success subtype does not override is_error=true, api_error, empty modelUsage or nonzero exit.',
    'rateLimit': rate, 'resetEpoch': rate['resetsAt'], 'resetUtc': utc,
    'resetProviderText': result['result'],
    'providerToolCalls': 0, 'qaTestsExecuted': 0, 'qaVerdict': None,
    'criteria': {k: 'NOT EXECUTED' for k in ['uppercaseOldNew', 'genuine8dot3OldNew', 'ordinaryFile', 'junctionTempFixedTemplate', 'crossDriveAdapterAndEngine']},
    'noAutomaticRetryOrSubstitution': True, 'noPaidOverage': True,
    'remaining': 'Actual independent e630 native matrix remains pending. Any reset continuation must use a fresh provider output/attempt packet and preserve this complete failure.',
    'generalScansConsumed': 3, 'capReset': False, 'mergeApproval': False,
    'providerRecords': [record(p) for p in sorted((OUT / 'provider').iterdir()) if p.is_file()],
    'priorHarnessBindings': record(OUT / 'prior-harness-bindings.json'),
    'noNewNativeOrCFixtureCreatedByProvider': True,
    'old6dePacketAndCheckout': 'Preserved; not relabeled or changed by this e630 attempt.',
}
new(OUT / 'ORCHESTRATION-READBACK.json', checkpoint)
report = f'''# D216 independent QA attempt 01: blocked by weekly quota

No e630 QA verdict exists from this attempt. The requested actual Claude Opus 5.5/xhigh process stopped before executing tools or tests.

The new detached sparse checkout is bound to `{binding['head']}`, tree `{binding['tree']}`, direct parent `{binding['parent']}`. The single offline frozen install passed under Node v22.23.4 and pnpm 12.8.1 from the G store. Source, index, lockfile, candidate fixture and dependency metadata match their pre-QA bindings exactly; the independent common main worktree/index is unchanged. The old 6de QA checkout and sealed packet remain separate.

The actual provider session `{result['session_id']}` returned one terminal with `is_error=true`, `terminal_reason=api_error`, HTTP 429 and `api_error=usage_limit_reached`. Both provider and wrapper exited 1. The terminal's literal `subtype=success` is an instrument field, not successful QA: `modelUsage` is empty and the sole assistant message uses `<synthetic>`. Requested model and launch effort are preserved, but no actual model inference or QA execution is claimed. The provider final message matches the terminal result byte for byte.

The provider states: {result['result']}

The raw seven-day limit reset is `{rate['resetsAt']}` ({utc}; November 23, 2026 at 01:00 America/Chicago). Overage was not used. No retry, model substitution, paid overage or account configuration change occurred.

All planned uppercase, genuine 8.3, ordinary, junction and cross-drive criteria are NOT EXECUTED on e630. There are zero provider tool calls and zero QA tests. The earlier 6de criterion pass does not establish the e630 fix. Actual independent QA, final CI/native, the existing three-scan cap disposition and merge admission remain separate outstanding gates.

Complete raw launch/events/terminal/message/exit records, setup commands, source binding and the unchanged-source readback are retained here. Parent TEMP/cache/logs stayed on G; the blocked provider created no native alias or tiny C fixture. The prepared observer reference retains `realpathSync.native`; it was not executed. The prior session's qualified C overflow copies remain preserved and are not silently deleted.

A later admitted reset continuation must create a fresh attempt/provider output directory, bind this exact source again, and preserve this packet. This report records an orchestration failure, not an independent product review or approval.
'''
new(OUT / 'REPORT.md', report.encode())
members = [{'path': str(p.relative_to(OUT)).replace('\\', '/'), 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(OUT.rglob('*')) if p.is_file() and p.name != 'ORCHESTRATION-SHA256SUMS.json']
new(OUT / 'ORCHESTRATION-SHA256SUMS.json', {'status': 'SEALED_QUOTA_FAILURE_NO_QA_VERDICT', 'selfExcluded': 'ORCHESTRATION-SHA256SUMS.json', 'files': members})
for item in members:
    actual = record(OUT / item['path'])
    require(actual['bytes'] == item['bytes'] and actual['sha256'] == item['sha256'], 'Final seal mismatch')
print(json.dumps({'status': checkpoint['status'], 'members': len(members), 'report': record(OUT / 'REPORT.md'), 'readback': record(OUT / 'ORCHESTRATION-READBACK.json'), 'seal': record(OUT / 'ORCHESTRATION-SHA256SUMS.json'), 'resetUtc': utc}))
