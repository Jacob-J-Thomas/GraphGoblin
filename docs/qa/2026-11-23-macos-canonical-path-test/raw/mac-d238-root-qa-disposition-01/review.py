from pathlib import Path
import datetime, hashlib, json

E = Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
Q = E / 'mac-d238-canonical-test-independent-qa-01'
W = Path('G:/ggq/gg-mac-d238-alias-qa/GraphGoblin')
OUT = Path(__file__).resolve().parent
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(name): return json.loads((Q / name).read_bytes())
assert sha(Q/'MANIFEST.json') == '68fc943e30e6ada688110df131f4d31f65fb195af38a61c356d40ecdacce1c88'
assert sha(Q/'REPORT.md') == 'f76cce9a7ac2bc42f68c2e555c5be4090dd0f264a0a858b2e8714ce3f8be430f'
members = read('MANIFEST.json')['members']
assert len(members) == 70
for m in members:
    p = Q / m['path']
    assert p.is_relative_to(Q) and p.stat().st_size == m['bytes'] and sha(p) == m['sha256'], m['path']
for p in Q.glob('*.receipt.json'):
    receipt = json.loads(p.read_bytes())
    for stream in ['stdout','stderr']:
        assert sha(Path(receipt[stream])) == receipt[stream+'Sha256'], p.name
expected = [('10-parent-negative',0,0,0,1837),('11-parent-negative',1,0,1,20),('12-corrected-positive',0,1,0,20)]
active_name = 'built API entry and startup failures refuses a shared database in one line and leaves its existing owner serving'
for label, code, passed, failed, skipped in expected:
    result = read(label+'.json'); receipt = read(label+'.receipt.json')
    assert receipt['exitCode'] == code
    assert (result['numPassedTests'],result['numFailedTests'],result['numPendingTests']) == (passed,failed,skipped)
    active = [a for suite in result['testResults'] for a in suite.get('assertionResults',[]) if a['status'] not in ['pending','skipped','todo']]
    assert len(active) == passed + failed
    if active:
        assert active[0]['fullName'] == active_name
        if failed:
            assert len(active[0]['failureMessages']) == 1 and ':239:32' in active[0]['failureMessages'][0]
for name in ['parent-negative.worker.json','corrected-positive.worker.json']:
    r = read(name)
    assert r['allChildrenClosed'] and r['allFixtureDirectoriesAbsent']
    assert r['workerControlled']['tmpdir'] != r['workerControlled']['realpath']
    assert r['workerBefore'] == r['workerRestored']
    assert r['entrySha256'] == r['originalEntrySha256'] == '77340d74ad07bebe5875984fee0c92cbeac57afff13585a9bbe7fb3ab62c219c'
    assert len(r['children']) == 3 and len(r['fixtureDirectories']) == 2
    for child in r['children']:
        assert child['close'] and child['environmentDelta'] == {'name':'GG_OLLAMA_ENABLED','before':None,'after':'false'}
    assert r['networkPacketTrace'] is False
cleanup = read('CLEANUP.json')
assert all(cleanup[k] for k in ['aliasAbsent','targetAbsent','rootAbsent','nonrecursiveJunctionRemoval','bothWorkerClosuresVerified'])
before = read('before.state.json'); after = read('after.state.json')
assert before['trackedFiles'] == after['trackedFiles']
assert before['orderedStagedEntries'] == after['orderedStagedEntries']
assert before['skipWorktreeEntries'] == after['skipWorktreeEntries']
assert before['indexSha256'] == after['indexSha256'] == sha(Path(after['indexPath']))
assert before['commonIndexExists'] is False and after['commonIndexExists'] is False
assert not Path('G:/ggq/gg-delivery-next-independent/GraphGoblin/.git/index').exists()
qualification = read('PARITY-QUALIFICATION.json')
assert qualification['allDecodedOmissionsAreDocsQa'] and not qualification['nativeMissingNonQaPaths'] and not qualification['nativeNonQaHashDrift']
paths = (Q/'GIT-PATHS.z').read_bytes().decode('utf-8').split('\0')
paths = [p for p in paths if p]
non_qa = [p for p in paths if not p.startswith('docs/qa/')]
assert len(paths) == 42519 and len(non_qa) == 1838
baseline = {r['path']:r for r in before['trackedFiles']}
for path in non_qa:
    assert sha(W/path) == baseline[path]['sha256'], path
assert all(c['allEqual'] for c in qualification['criticalSource'])
disposition = {
    'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope': 'Accept independent Windows alias causal comparison and admit evidence publication/fresh corrected CI; no general PR or native acceptance.',
    'head':'b7a7bbd83b3ae542f07e432d65ba04483493b57f',
    'manifestSha256':sha(Q/'MANIFEST.json'), 'reportSha256':sha(Q/'REPORT.md'),
    'membersRehashed':70, 'rawReceiptStreamsVerified':True,
    'fullReportReadByRoot':True, 'originalNegativeStderrAndPositiveStdoutReadByRoot':True,
    'initialZeroActiveRunnerSelectionFailurePreserved':True,
    'exactOldNegativeAndCorrectedPositiveVerified':True,
    'materializedNonQaFilesIndependentlyRehashed':1838,
    'originalFalseRawLabelFlagAndFiveQuotedQaPathQualificationPreserved':True,
    'rawIndexAndTrackedBaselineUnchanged':True, 'commonIndexAbsent':True,
    'sixChildClosuresFourFixtureAbsencesAndJunctionCleanupVerified':True,
    'd239OnePropertyEnvironmentControlDisclosed':True,
    'networkPacketCapture':False, 'earlierAuthorDiscoveryTrafficAbsenceEstablished':False,
    'nativeDarwinOrGuiAcceptance':False, 'generalReviewScanConsumed':False,
    'remaining':['Actual Claude opposite-family critique','Corrected-head seven-job CI and artifact verification','Device-local Mac GUI evidence','Reserved independent final audit','Signed merge','Owner acceptance'],
}
(OUT/'DISPOSITION.json').write_text(json.dumps(disposition,indent=2)+'\n',encoding='utf-8')
files = [{'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(OUT.iterdir()) if p.is_file() and p.name!='MANIFEST.json']
(OUT/'MANIFEST.json').write_text(json.dumps({'files':files},indent=2)+'\n',encoding='utf-8')
print(json.dumps(disposition,indent=2))
