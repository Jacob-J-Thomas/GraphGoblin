"""Read immutable CI evidence and Git objects; write only this new diagnosis packet."""
import collections
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

OUT = Path(__file__).resolve().parent
E = OUT.parent
REPO = Path('G:/ggq/gg-i4-486-delivery/GraphGoblin')
HEAD = '29e165e14fdda138300ba2a34585ddd47268b475'
MAIN = 'a60843a9050b3a203726db84f6abf1f45b8bc694'
env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')

def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args], env=env)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def write(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=True, indent=2) + '\n', encoding='utf8')

def read_trace(name):
    return [json.loads(line) for line in (OUT / 'trace' / name).read_text(encoding='utf8').splitlines()]

ranges = {
    'apps/web/e2e/pwa.spec.ts': [(536,553),(590,628)],
    'apps/web/e2e/pwa-helpers.ts': [(77,101),(103,148),(150,203)],
    'apps/web/e2e/fixtures.ts': [(108,115)],
    'apps/web/e2e/server.ts': [(212,232),(339,351)],
    'apps/web/src/e2e-support/worker.ts': [(1,4)],
    'apps/web/public/chat-update-worker.js': [(19,50),(52,97),(99,155),(157,200),(202,231)],
    'apps/web/src/pwa/chat-update-guard.ts': [(133,184),(186,235)],
    'apps/web/src/pwa/register.ts': [(44,102)],
    'apps/web/src/pwa/store.ts': [(34,76)],
    'apps/web/src/pwa/UpdateToast.tsx': [(26,46)],
    'apps/web/src/pwa/chat-update-lock.ts': [(1,39)],
    'apps/web/vite.config.ts': [(89,105)],
    'apps/web/playwright.config.ts': [(17,48)],
}
paths = list(ranges) + ['pnpm-lock.yaml', 'package.json', '.github/workflows/ci.yml',
                         'apps/web/src/pwa/chat-update-worker.test.ts',
                         'apps/web/src/pwa/chat-update-guard.test.ts',
                         'apps/web/src/pwa/register.test.ts']
bindings = []
excerpts = []
for path in paths:
    row = {'path': path}
    for label, rev in [('integrated',HEAD),('targetMain',MAIN)]:
        raw = git('show', f'{rev}:{path}')
        row[label] = {'commit':rev, 'blob':git('rev-parse',f'{rev}:{path}').decode().strip(),
                      'sha256':sha(raw), 'bytes':len(raw),
                      'treeEntry':git('ls-tree',rev,'--',path).decode().strip()}
    row['exactBlobAndModeIdentity'] = row['integrated']['treeEntry'] == row['targetMain']['treeEntry']
    if path in ranges:
        raw = git('show',f'{HEAD}:{path}')
        lines = raw.decode('utf8').splitlines()
        excerpts.append({'path':path,'commit':HEAD,'blob':row['integrated']['blob'],
                         'ranges':[{'start':start,'end':end,'lines':[{'line':i,'text':lines[i-1]}
                                    for i in range(start,min(end,len(lines))+1)]} for start,end in ranges[path]]})
    bindings.append(row)
history = {}
for path in ['apps/web/e2e/pwa.spec.ts','apps/web/public/chat-update-worker.js',
             'apps/web/src/pwa/chat-update-guard.ts','apps/web/src/pwa/register.ts',
             'apps/web/e2e/server.ts','apps/web/playwright.config.ts']:
    history[path] = git('log','-1','--format=%H %aI %s',MAIN,'--',path).decode().strip()
write('source-binding.json', {
    'integratedCommit':HEAD,'integratedTree':git('rev-parse',HEAD+'^{tree}').decode().strip(),
    'targetMainCommit':MAIN,'targetMainTree':git('rev-parse',MAIN+'^{tree}').decode().strip(),
    'webTreeIntegrated':git('rev-parse',HEAD+':apps/web').decode().strip(),
    'webTreeTargetMain':git('rev-parse',MAIN+':apps/web').decode().strip(),
    'webLockRootAndWorkflowDiff':git('diff','--name-only',MAIN,HEAD,'--','apps/web','pnpm-lock.yaml','package.json','.github/workflows').decode(),
    'files':bindings,'lastTargetMainChange':history,
    'limit':'Blob identity proves this integration did not change these inputs. It does not prove the browser behavior passes on main, nor exclude indirect backend/timing/environment influences.'})
write('source-excerpts.json',excerpts)

t = read_trace('test.trace')
b = read_trace('2-trace.trace')
starts = {x['callId']:x for x in t if x['type']=='before'}
ends = {x['callId']:x for x in t if x['type']=='after'}
ids = ['hook@1','pw:api@57','expect@60','expect@61','expect@65','expect@67','expect@70',
       'pw:api@71','expect@72','expect@73','expect@74','pw:api@75','pw:api@76',
       'expect@77','expect@78','expect@79','pw:api@82','expect@83','pw:api@86',
       'pw:api@87','hook@88','fixture@89','pw:api@92','pw:api@93']
timeline = []
for call in ids:
    start = starts[call]; end = ends.get(call,{})
    timeline.append({'callId':call,'title':start.get('title'),'startMs':start['startTime'],
                     'endMs':end.get('endTime'),'durationMs':round(end['endTime']-start['startTime'],3) if 'endTime' in end else None,
                     'sinceBeforeHooksMs':round(start['startTime']-starts['hook@1']['startTime'],3),
                     'error':end.get('error'),'location':start.get('stack')})
evaluations=[]
browser_starts={x['callId']:x for x in b if x['type']=='before'}
for x in b:
    if x['type']=='after' and x['callId'] in ['call@43500','call@43531','call@43533','call@43537','call@43548','call@43550','call@43555']:
        evaluations.append({'callId':x['callId'],'stepId':browser_starts[x['callId']].get('stepId'),
                            'endMs':x['endTime'],'result':x.get('result')})
screens=[{k:x.get(k) for k in ['file','pageId','timestamp','frameSwapWallTime','width','height']}
         for x in b if x['type']=='screencast-frame']
click=next(x['time'] for x in b if x['type']=='log' and x.get('callId')=='call@43560' and x.get('message','').strip()=='click action done')
write('trace-timeline.json',{'timeBasis':'Retained Playwright monotonic milliseconds; runner-side and browser API completion bookkeeping can differ by tens of milliseconds.',
                            'steps':timeline,'evaluations':evaluations,'screens':screens,
                            'secondPhysicalClickDoneMs':click,'lastScreenAfterClickMs':round(screens[-1]['timestamp']-click,3),
                            'browserEventMethodCounts':dict(collections.Counter(x.get('method') for x in b if x['type']=='event')),
                            'limits':['No retained MessagePort replies or PREPARE/ABORT/COMMIT stream.','No post-second-click worker state/controller/held-and-pending-lock snapshot.','Second APPLY message-count assertion at pwa.spec.ts:622 was never reached.']})

network=[]
worker_bodies=[]
for name in ['0-trace.network','1-trace.network','2-trace.network']:
    for x in read_trace(name):
        s=x.get('snapshot',{}); req=s.get('request',{}); response=s.get('response',{});url=req.get('url','')
        if '/worker/' in url or '/app/sw.js' in url or 'chat-update-worker.js' in url:
            content=response.get('content',{})
            row={'trace':name,'monotonicMs':s.get('_monotonicTime'),'startedDateTime':s.get('startedDateTime'),
                 'method':req.get('method'),'url':url,'status':response.get('status'),'durationMs':s.get('time'),
                 'bodyFile':content.get('_file')}
            if content.get('_file'):
                raw=(OUT/'trace'/content['_file']).read_bytes()
                row['bodyBytes']=len(raw);row['bodySha256']=sha(raw)
                if 'chat-update-worker.js' in url:
                    row['exactSourceGitBlobBytes']=raw==git('show',HEAD+':apps/web/public/chat-update-worker.js')
                    worker_bodies.append(row)
            network.append(row)
write('network-boundary.json',{'requests':network,'allCapturedHelperBodiesExactSource':all(x['exactSourceGitBlobBytes'] for x in worker_bodies),
                              'resetRequestInNetwork':any('/worker/reset' in x['url'] for x in network),
                              'limits':'Only selected URLs/response body bindings retained here; no credential headers copied. Absence of reset network entry agrees with disposed APIRequestContext rejection before dispatch.'})

source_copies=[]
for file in sorted((OUT/'trace'/'src').glob('*')):
    data=file.read_bytes();matches=[]
    for path in paths:
        if data==git('show',HEAD+':'+path):matches.append(path)
    source_copies.append({'traceSource':str(file.relative_to(OUT)),'bytes':len(data),'sha256':sha(data),'exactGitSourceMatches':matches})

inputs=[]
for path in [E/'i4-553-browser-failure-29e-01'/'artifact.zip',
             E/'i4-553-browser-failure-29e-01'/'artifact.json',
             E/'i4-553-browser-failure-29e-01'/'zip-members.json',
             *[E/'i4-553-head29e-targeta608-ci'/x for x in ['run.json','jobs.json','browser.log','merge.json','head.json']]]:
    if path.is_file():
        raw=path.read_bytes();inputs.append({'path':str(path),'bytes':len(raw),'sha256':sha(raw)})
write('input-provenance.json',{'capturedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                              'inputs':inputs,'traceSourceCopies':source_copies,
                              'immutableSourceReadback':{'head':git('rev-parse','HEAD').decode().strip(),'statusPorcelain':git('status','--porcelain=v1').decode()},
                              'productExecutionCount':0,'ciReruns':0,
                              'scope':'Static retained-evidence/Git-object analysis only. No browser, product process, tests, builds, installs, provider calls, Git writes or owner-store access.'})
print(json.dumps({'bindings':len(bindings),'allFileBindingsExact':all(x['exactBlobAndModeIdentity'] for x in bindings),
                  'allCapturedWorkerBodiesExactSource':all(x['exactSourceGitBlobBytes'] for x in worker_bodies),
                  'lastScreenAfterSecondClickMs':round(screens[-1]['timestamp']-click,3),'traceSourceCopies':source_copies},ensure_ascii=True))
