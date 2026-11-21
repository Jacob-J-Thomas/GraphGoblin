import collections
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

P=Path(__file__).resolve().parent
R=Path('G:/ggq/gg-i4-553-browser-diagnostic/GraphGoblin')
BASE='29e165e14fdda138300ba2a34585ddd47268b475'
def write(name,data):
    (P/name).write_text(json.dumps(data,ensure_ascii=True,indent=2)+'\n',encoding='utf8')
def git(*args):return subprocess.check_output(['git','-C',str(R),*args])
def flatten(suite):
    out=[]
    for spec in suite.get('specs',[]):
        for test in spec.get('tests',[]):
            for result in test.get('results',[]):
                out.append({'title':spec['title'],'file':spec.get('file'),'line':spec.get('line'),
                            'project':test.get('projectName'),'status':result.get('status'),
                            'durationMs':result.get('duration'),'workerIndex':result.get('workerIndex'),
                            'parallelIndex':result.get('parallelIndex'),'retry':result.get('retry'),
                            'startTime':result.get('startTime'),'errors':result.get('errors'),
                            'attachments':result.get('attachments')})
    for child in suite.get('suites',[]):out+=flatten(child)
    return out

summary={'baseCommit':BASE,'baseTree':git('rev-parse',BASE+'^{tree}').decode().strip(),
         'originalCiRun':44934348117,'originalCiDisposition':'FAILED_UNCHANGED',
         'platformLimit':'Windows instrumented local observations; original failure Linux CI. Same Edge version/channel does not establish equivalence.',
         'installCommandAttempts':2,'buildCommandAttempts':2,'diagnosticInvocations':2,'testRecords':[],
         'attempts':[]}
for attempt in ['isolated','sequence']:
    directory=P/'attempts'/attempt
    report=json.loads((directory/'results.json').read_text(encoding='utf8'))
    results=[]
    for suite in report['suites']:results+=flatten(suite)
    events=[json.loads(line) for line in (directory/'events.jsonl').read_text(encoding='utf8').splitlines()]
    target_start=next(x for x in events if x['kind']=='test-start' and 'unresolved voice upload' in x['details']['title'])
    target=[x for x in events if x['nodePid']==target_start['nodePid']]
    protocol=[x for x in target if x['kind']=='protocol']
    sends=[x for x in protocol if x['details'].get('stage')=='apply-send']
    transactions=[]
    for send in sends:
        key=send['details']['attempt']
        rows=[x for x in protocol if x['details'].get('attempt')==key]
        transactions.append({'attempt':key,'pageSend':send,'events':rows,
                             'workerReplies':[x for x in rows if x['details'].get('stage')=='apply-reply'],
                             'workerReceived':any(x['details'].get('stage')=='apply-received' for x in rows),
                             'pageResults':[x for x in rows if x['details'].get('stage')=='apply-result']})
    target_summary={'attempt':attempt,'targetNodePid':target_start['nodePid'],'transactions':transactions,
                    'targetStageCounts':dict(collections.Counter(x['details'].get('realm','')+':'+x['details'].get('stage','') for x in protocol)),
                    'targetPageStates':[x for x in target if x['kind']=='page-state'],
                    'targetLifecycle':[x for x in target if x['kind'] in ['worker-versions','worker-registrations','main-frame-navigation','page-closed']],
                    'firstBodyErrors':[x for x in target if x['kind']=='first-body-error'],
                    'cleanupErrors':[x for x in target if x['kind']=='cleanup-error'],
                    'observerErrors':[x for x in events if x['kind'] in ['sample-error','cdp-observer-error','instrumentation-parse-error']],
                    'testEndRecords':[x for x in events if x['kind']=='test-end']}
    write('attempts/'+attempt+'/target-protocol-summary.json',target_summary)
    for row in results:row['invocation']=attempt
    summary['testRecords']+=results
    summary['attempts'].append({'name':attempt,'stats':report['stats'],'testCount':len(results),
                                'resultCount':dict(collections.Counter(x['status'] for x in results)),
                                'targetNodePid':target_start['nodePid'],'protocolRecords':len(protocol),
                                'applyTransactions':len(transactions),'firstBodyErrors':len(target_summary['firstBodyErrors']),
                                'cleanupErrors':len(target_summary['cleanupErrors']),
                                'observerErrors':len(target_summary['observerErrors'])})
summary['localTestRecordCounts']=dict(collections.Counter(x['status'] for x in summary['testRecords']))
summary['targetResultRecords']=[{k:x[k] for k in ['invocation','status','durationMs','workerIndex','retry']} for x in summary['testRecords'] if 'unresolved voice upload' in x['title']]
summary['interpretation']='Original missed-reload mechanism not reproduced. Sequence had a different offline-banner failure before target; replacement worker breaks intended same-worker predecessor comparison. Neither flakiness nor a pristine product defect is established.'
write('outcomes.json',summary)

# Prove the exact target block is recoverable by removing only disclosed diagnostic catch/logging.
base=git('show',BASE+':apps/web/e2e/pwa.spec.ts').decode('utf8')
current=(R/'apps/web/e2e/pwa.spec.ts').read_text(encoding='utf8')
def target(source):
    start=source.index("test('another tab’s unresolved voice upload vetoes")
    end=source.index("test('a legacy active worker",start)
    return source[start:end]
diagnostic_cleanup="""  } catch (error) {
    diagnosticFailure('first-body-error', error);
    throw error;
  } finally {
    if (!dirty.isClosed()) await dirty.close();
    try { await control(request, '/worker/reset'); }
    catch (error) { diagnosticFailure('cleanup-error', error); throw error; }
  }"""
original_cleanup="""  } finally {
    if (!dirty.isClosed()) await dirty.close();
    await control(request, '/worker/reset');
  }"""
restored=target(current).replace(diagnostic_cleanup,original_cleanup)
assert restored==target(base)
binding=json.loads((P/'diagnostic-files.json').read_text(encoding='utf8'))
for row in binding['files']:
    source=R/row['path'];data=source.read_bytes();row['diagnosticSha256']=hashlib.sha256(data).hexdigest()
    copy=P/'diagnostic-source'/row['path'];copy.parent.mkdir(parents=True,exist_ok=True);copy.write_bytes(data)
(P/'diagnostic.patch').write_bytes(git('diff','--binary'))
binding.update(patchSha256=hashlib.sha256((P/'diagnostic.patch').read_bytes()).hexdigest(),
               note='Tracked diagnostic changes in patch; the new test observer helper is separately preserved in diagnostic-source and this manifest.')
write('diagnostic-files.json',binding)
write('oracle-and-provenance.json',{
    'head':git('rev-parse','HEAD').decode().strip(),'branch':git('branch','--show-current').decode().strip(),
    'statusPorcelain':git('status','--porcelain=v1').decode(),'indexDiff':git('diff','--cached','--name-only').decode(),
    'targetBlockExactAfterOnlyDiagnosticCatchRemoval':restored==target(base),
    'targetBlockBaseSha256':hashlib.sha256(target(base).encode()).hexdigest(),
    'playwrightConfigExactBase':(R/'apps/web/playwright.config.ts').read_bytes()==git('show',BASE+':apps/web/playwright.config.ts'),
    'lockfileExactBase':(R/'pnpm-lock.yaml').read_bytes()==git('show',BASE+':pnpm-lock.yaml'),
    'sourceChanges':'Only the six disclosed diagnostic files; no commit or index mutation.',
    'firstBodyErrorPath':'Exact target catch logs then rethrows before finally; reset catch logs then rethrows. Error branches not exercised because target passed both attempts.',
    'observerReach':['Production worker: console logging; scoped lock snapshots at APPLY and exclusive grant; activation event observer.',
                     'Page guard and PWA registration: console logging around existing protocol/lease/result/reload operations.',
                     'Test observer: console listener, ServiceWorker CDP sessions/version updates, one-second read-only registration/locks/status-text samples.',
                     'Test spec: before/after observer hooks; target first-body/cleanup error recording without swallowing.',
                     'Global setup: child/server PID logging only.'],
    'observerLimit':'No explicit online/offline setter, fetch, storage or UI mutation added by instrumentation. Extra CDP sessions, read calls and console/logging can change timing or browser behavior; offline-banner failure is instrumented evidence, not a proven pristine defect.'})

print(json.dumps({'testCounts':summary['localTestRecordCounts'],'targetResults':summary['targetResultRecords'],
                  'attempts':summary['attempts'],'targetOracleExact':True},ensure_ascii=True))
