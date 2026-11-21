"""Verify retained successful jobs from failed CI, without rerunning product work."""
from pathlib import Path, PurePosixPath
from hashlib import sha256
from zipfile import ZipFile
from io import BytesIO
import argparse, datetime, json, os, re, stat, subprocess, sys, urllib.request

OUT = Path(__file__).resolve().parent
E = OUT.parent
CI = E / 'i4-553-head29e-targeta608-ci'
NATIVE = E / 'i4-553-head29e-targeta608-ci-windows'
Q = Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents')
REPO = Path('G:/ggq/gg-i4-486-delivery/GraphGoblin')
MINI = E / 'i4-486-doc-correction-archive-preparation-01'
NODE = Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe')
HEAD = '29e165e14fdda138300ba2a34585ddd47268b475'
BASE = 'a60843a9050b3a203726db84f6abf1f45b8bc694'
MERGE = '20363bc9beff94e33623307fffed52cd9d509796'
TREE = 'd50fb576f1ef4498cb30e52521198575d6d0ebd4'
RUN = 44934348117
ENV = {**os.environ, 'GIT_OPTIONAL_LOCKS':'0', 'PATH':str(NODE.parent)+os.pathsep+os.environ['PATH']}

def require(ok, why):
    if not ok: raise ValueError(why)

def read(p): return json.loads(Path(p).read_bytes())

def write(p, obj):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    raw = obj if isinstance(obj, bytes) else (json.dumps(obj, indent=2, ensure_ascii=False)+'\n').encode()
    with p.open('xb') as f: f.write(raw)

def record(p):
    p=Path(p).resolve(); raw=p.read_bytes()
    return {'path':str(p), 'bytes':len(raw), 'sha256':sha256(raw).hexdigest()}

def git(*args): return subprocess.check_output(['git',*args],cwd=REPO,env=ENV)

def state():
    require(git('rev-parse','HEAD').decode().strip()==HEAD, 'Source head moved')
    require(git('rev-parse','HEAD^{tree}').decode().strip()==TREE, 'Source tree differs')
    require(not git('status','--porcelain=v1','-z','--untracked-files=all'), 'Source worktree dirty')
    index=Path(git('rev-parse','--path-format=absolute','--git-path','index').decode().strip())
    return {'head':HEAD,'tree':TREE,'clean':True,'index':record(index),'stageSha256':sha256(git('ls-files','--stage','-z')).hexdigest()}

def preserved():
    before=read(OUT/'before.json')
    require(state()==before['source'], 'Source/index changed during verification')
    for item in before['originalFiles']:
        require(record(item['path'])==item, 'Original bytes changed: '+item['path'])
    require(not (CI/'verified.json').exists(), 'Overall failed CI must not have verified.json')
    return before

def lines(name):
    text=(CI/name).read_text(encoding='utf-8-sig')
    text=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    return [(n,re.sub(r'^\S+Z\s+','',s)) for n,s in enumerate(text.splitlines(),1)]

def binding():
    return {'run':RUN,'attempt':1,'head':HEAD,'target':BASE,'testedMerge':MERGE,'testedTree':TREE,
            'wholeCiConclusion':'failure','windowsConclusion':'success',
            'scope':'Successful jobs only from failed overall CI; no browser or whole-CI acceptance'}

def prepare(url):
    require(OUT.name=='i4-553-partial-job-verification-01' and E==Path('G:/ggq/delivery-evidence/2026-11-17-five-intents'), 'Wrong external output')
    require(not NATIVE.exists() and not (CI/'verified.json').exists(), 'Native destination exists or invalid whole-CI receipt exists')
    originals=[record(p) for root in [CI, MINI] for p in sorted(root.rglob('*')) if p.is_file()]
    originals += [record(Q/'verify-integrated-native.py'),record(Q/'pr508-marker-independent-qa/replay-archives.mjs'),
                  record(REPO/'tooling/scripts/windows-launcher-evidence.mjs'),record(REPO/'.github/workflows/ci.yml'),
                  record(E/'dispatch-486-doc-correction-review-01.py')]
    write(OUT/'before.json', {'source':state(),'originalFiles':originals,'createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
    run, merge, head, pr, jobs=read(CI/'run.json'),read(CI/'merge.json'),read(CI/'head.json'),read(CI/'pr.json'),read(CI/'jobs.json')['jobs']
    require(run['id']==RUN and run['run_attempt']==1 and run['status']=='completed' and run['conclusion']=='failure' and run['head_sha']==HEAD and run['event']=='pull_request','Wrong failed first CI run')
    require(merge['sha']==MERGE and merge['tree']['sha']==TREE and [x['sha'] for x in merge['parents']]==[BASE,HEAD], 'Synthetic merge binding differs')
    require(head['sha']==HEAD and head['tree']['sha']==TREE and pr['head']['sha']==HEAD and pr['base']['sha']==BASE and pr['number']==553,'PR/head/base binding differs')
    require(len(jobs)==6 and len({x['name'] for x in jobs})==6,'Expected six jobs')
    successful=['Repository checks','Windows launcher','Coverage','Template image','Gates']
    require({x['name'] for x in jobs if x['conclusion']=='success'}==set(successful), 'Successful jobs differ')
    require(next(x for x in jobs if x['name']=='Browser')['conclusion']=='failure','Browser failure must remain visible')
    for job in jobs:
        require(job['run_id']==RUN and job['run_attempt']==1 and job['head_sha']==HEAD and job['status']=='completed','Job binding differs')
        if job['name'] in successful:
            require(not [x for x in job['steps'] if x['conclusion'] in ('failure','cancelled')], 'Failed step in successful job')
    artifacts=read(OUT/'artifacts-api.json')
    for artifact in artifacts['artifacts']:
        require(artifact['workflow_run']['id']==RUN and artifact['workflow_run']['head_sha']==HEAD, 'Artifact run binding differs')
    if (CI/'artifacts.json').exists(): require(read(CI/'artifacts.json')['artifacts']==artifacts['artifacts'],'Existing artifact list differs')
    else: write(CI/'artifacts.json',artifacts)
    write(CI/'partial-ci-native-binding.json',binding())
    coverage=next(a for a in artifacts['artifacts'] if a['name']=='coverage')
    require(coverage['id']==14719603748 and coverage['size_in_bytes']==22523 and not coverage['expired'],'Unexpected coverage artifact')
    with urllib.request.urlopen(url, timeout=60) as response: raw=response.read(2*1024*1024+1)
    digest=sha256(raw).hexdigest()
    require(len(raw)==coverage['size_in_bytes'] and coverage['digest']=='sha256:'+digest,'Coverage archive digest/size differs')
    log=lines('coverage.log')
    require(any('SHA256 digest of uploaded artifact zip is '+digest in s for n,s in log),'Coverage digest not bound to upload log')
    require(any('Artifact ID is '+str(coverage['id']) in s for n,s in log),'Coverage ID not bound to upload log')
    require(any('Coverage step: success; package summaries retained: 13' in s for n,s in log),'Coverage status/count differs')
    write(OUT/'coverage.zip',raw)
    summaries=[]
    with ZipFile(BytesIO(raw)) as z:
        require(z.testzip() is None,'Corrupt coverage ZIP')
        members=z.infolist()
        require(len(members)==13 and len({i.filename for i in members})==13,'Expected 13 unique coverage summaries')
        for item in members:
            path=PurePosixPath(item.filename)
            require(not item.is_dir() and not stat.S_ISLNK(item.external_attr>>16) and '..' not in path.parts and not path.is_absolute(),'Unsafe coverage ZIP member')
            require(re.fullmatch(r'(?:(?:packages|apps)/[^/]+|tooling)/coverage/coverage-summary\.json',item.filename) is not None and item.file_size<2*1024*1024,'Unexpected summary path/size')
            content=z.read(item); summary=json.loads(content); totals=summary['total']
            for kind in ['lines','branches','statements','functions']:
                require(all(isinstance(totals[kind][k],(int,float)) for k in ['total','covered','pct']),'Nonnumeric coverage')
                require(0<=totals[kind]['covered']<=totals[kind]['total'] and 0<=totals[kind]['pct']<=100,'Invalid coverage range')
            require(totals['lines']['pct']>=90 and totals['branches']['pct']>=90,'Coverage below existing line/branch threshold')
            write(OUT/'coverage'/item.filename,content)
            summaries.append({'member':item.filename,'bytes':len(content),'sha256':sha256(content).hexdigest(),'total':totals})
    coverage_counts=[]
    for n,s in log:
        match=re.fullmatch(r'\s*Tests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?\s*\((\d+)\)\s*',s)
        if match:
            passed,skipped,total=int(match[1]),int(match[2] or 0),int(match[3]);require(passed+skipped==total,'Coverage test counts differ')
            coverage_counts.append({'line':n,'passed':passed,'skipped':skipped,'total':total,'raw':s})
    require(len(coverage_counts)==13,'Expected 13 package test-count summaries')
    write(OUT/'numeric-coverage.json', {'scope':'Successful Coverage job only; whole CI failed','run':RUN,'artifact':coverage,'rawZip':record(OUT/'coverage.zip'),'uploadLog':record(CI/'coverage.log'),'summaries':summaries,'testCounts':coverage_counts,'aggregate':{k:sum(x[k] for x in coverage_counts) for k in ['passed','skipped','total']}})
    windows=lines('windows-launcher.log')
    for s in ['# tests 27','# pass 27','# fail 0','# skipped 0']: require(any(t==s for n,t in windows),'Native count missing: '+s)
    audit=lines('repository-checks.log')
    require(any('20 vulnerabilities found' in s for n,s in audit) and any('Severity: 7 low | 13 moderate' in s for n,s in audit),'Audit observation differs')
    write(OUT/'successful-job-facts.json', {**binding(),'jobs':jobs,'nativeCounts':{'passed':27,'failed':0,'skipped':0},'audit':{'total':20,'low':7,'moderate':13,'high':0,'critical':0,'gate':'pnpm audit --audit-level=high succeeded; not zero vulnerabilities'},'coverageSummaryCount':13,'browser':{'conclusion':'failure','passed':487,'skipped':1,'failed':1,'test':'e2e/pwa.spec.ts:536','failure':'timeout','artifactNotDownloadedAgain':14720031919}})
    preserved()
    print(json.dumps({'status':'PARTIAL_INPUTS_VERIFIED_READY_FOR_RETAINED_NATIVE_REPLAY','coverageSummaries':13,'coverageAggregate':read(OUT/'numeric-coverage.json')['aggregate'],'wholeCiConclusion':'failure'}))

def native():
    preserved()
    version=subprocess.check_output([str(NODE),'--version'],env=ENV).decode().strip()
    require(version=='v22.23.4', 'Wrong explicit Node runtime')
    command=[sys.executable,'-B',str(Q/'verify-integrated-native.py'),str(CI),str(REPO),str(NODE),'--native-only-from-failed-ci']
    write(OUT/'native-replay-command.json', {'argv':command,'node':record(NODE),'nodeVersion':version,'PATHFirst':str(NODE.parent),'scope':'Canonical replay of downloaded CI evidence only; no new native acceptance execution'})
    result=subprocess.run(command,env=ENV,capture_output=True)
    write(OUT/'native-replay.stdout',result.stdout);write(OUT/'native-replay.stderr',result.stderr)
    write(OUT/'native-replay-exit.json',{'code':result.returncode})
    require(result.returncode==0,'Canonical native artifact verification failed; retain all outputs')
    receipt=read(NATIVE/'verified.json')
    require(receipt['wholeCiConclusion']=='failure' and receipt['scope']=='successful native Windows job from failed overall CI' and receipt['head']==HEAD and receipt['base']==BASE and receipt['merge']==MERGE and receipt['sourceTree']==TREE and receipt['canonicalReplay'] is True and receipt['records']==338,'Native partial scope/source differs')
    preserved()
    print(json.dumps({'status':'SUCCESSFUL_NATIVE_JOB_ARTIFACT_CANONICALLY_REPLAYED_FROM_FAILED_CI','receipt':record(NATIVE/'verified.json')}))

def finish():
    before=preserved();facts=read(OUT/'successful-job-facts.json');numeric=read(OUT/'numeric-coverage.json');native=read(NATIVE/'verified.json')
    require(native['canonicalReplay'] is True and native['wholeCiConclusion']=='failure','Missing explicitly partial canonical replay')
    section=None; tap={};wait=[];webhook=None
    for n,s in lines('repository-checks.log'):
        group=re.fullmatch(r'##\[group\]Run pnpm (test:[a-z-]+)',s)
        if group: section=group[1]
        match=re.fullmatch(r'# (tests|pass|fail|skipped) (\d+)',s)
        if match and section: tap.setdefault(section,{})[match[1]]={'value':int(match[2]),'line':n}
        if section=='test:wait-restart' and s.startswith('{'):
            item=json.loads(s)
            if 'inputIdentity' in item: wait.append({'line':n,'observation':item})
        if section=='test:webhook-retry' and s.startswith('{'):
            item=json.loads(s)
            if 'matrix' in item: webhook={'line':n,'observation':item}
    expected={'test:reset':1,'test:recovery-process':1,'test:chat-restart':1,'test:prompt-restart':6,'test:upgrade':2}
    require(set(tap)==set(expected),'Unexpected retained repository TAP summaries')
    for name,count in expected.items():
        require({key:value['value'] for key,value in tap[name].items()}=={'tests':count,'pass':count,'fail':0,'skipped':0},'Repository count differs: '+name)
    require({x['observation']['poll'] for x in wait}=={50,1000} and len(wait)==2 and all(x['observation']['inputIdentity'] for x in wait),'Wait restart retained summaries differ')
    require(webhook is not None and len(webhook['observation']['matrix'])==5 and len(webhook['observation']['drain'])==2 and webhook['observation']['failureRequests']==5 and webhook['observation']['crashRequests']==2,'Webhook retained summary differs')
    templates=[]
    for n,s in lines('template-image.log'):
        if s.startswith('{'):
            item=json.loads(s)
            if 'template' in item: templates.append({'line':n,'observation':item})
    require({x['observation']['template'] for x in templates}=={'implementation','qa','review','starter'} and len(templates)==4,'Template image retained output differs')
    repository_observations={'scope':'Retained successful-job log observations, no newly executed acceptance','repositoryLog':record(CI/'repository-checks.log'),'tapCounts':tap,'waitRestart':wait,'webhookRetry':webhook,'templateLog':record(CI/'template-image.log'),'templates':templates}
    write(OUT/'repository-log-observations.json',repository_observations)
    summary={**binding(),'status':'EXPLICIT_PARTIAL_SUCCESSFUL_JOBS_ONLY','successfulJobCount':5,'failedJobCount':1,'numericCoverage':{'summaries':13,'aggregate':numeric['aggregate'],'rawZip':record(OUT/'coverage.zip'),'record':record(OUT/'numeric-coverage.json')},'native':{'testsPassed':27,'observations':338,'canonicalReplay':True,'receipt':record(NATIVE/'verified.json')},'audit':facts['audit'],'browser':facts['browser'],'originalInputsAndMiniarchiveUnchanged':True,'sourceAndIndexUnchanged':True,'overallVerifiedReceiptCreated':False,'actualFableDispatcherStillBlocked':True,'newProductTestsBuildInstallNativeAcceptanceProviderOrCIRequest':False}
    summary['repositoryAndTemplateLogObservations']=record(OUT/'repository-log-observations.json')
    write(CI/'partial-successful-jobs.json',summary)
    write(OUT/'REPORT.json',summary)
    text=f'''# Successful jobs from failed CI 44934348117\n\nThis is explicitly partial evidence. The overall first CI attempt failed its Browser job; five other jobs succeeded. Head {HEAD}, target {BASE}, synthetic merge {MERGE} and tree {TREE} match the retained metadata.\n\nCoverage: all 13 numeric summaries meet the existing 90% line and branch gates. Their exact ZIP is bound to GitHub metadata and the raw upload log. The package summaries record {numeric['aggregate']['passed']} passed and {numeric['aggregate']['skipped']} skipped tests; skips remain skips. The audit reports 20 findings: 7 low and 13 moderate. The high-level audit gate succeeded; there is no zero-vulnerability claim.\n\nThe genuine Windows job passed 27 tests. Its artifact ZIP digest, exact three-member corpus and source/run/attempt bindings verify. Node v22.23.4 canonically replayed the retained 338 observations and reproduced the final evidence result exactly. This replays evidence; it runs no new launcher acceptance suite. The sibling Windows verified.json explicitly says the overall CI failed.\n\nBrowser remains 487 passed, 1 skipped and 1 failed, with the pwa.spec.ts:536 timeout. The existing browser artifact was not downloaded again. No overall verified.json was created. The D209 Fable dispatcher still requires all CI jobs green and remains blocked. This packet neither accepts the browser failure nor waives final CI.\n\nOriginal collection bytes, the miniarchive preparation and the clean source/index remain unchanged. No source writes, install, build, product test, provider call or CI rerun occurred. Root owns diagnosis and gate decisions.\n'''
    text+='\n| Retained coverage summary | Lines | Branches |\n| --- | ---: | ---: |\n'
    for item in numeric['summaries']:
        text+=f"| {item['member']} | {item['total']['lines']['pct']}% | {item['total']['branches']['pct']}% |\n"
    text+='\nThe retained Repository checks log has reset 1, recovery 1, Chat restart 1, prompt restart 6 and upgrade 2 passing TAP cases; wait restart records both 50 ms and 1000 ms polling, and webhook retry records five matrix paths plus two drain phases. These counts describe the original CI execution. The image log records all four shipped templates. Exact line mappings and original log hashes are in repository-log-observations.json.\n'
    write(OUT/'REPORT.md',text.encode())
    write(OUT/'preservation.json', {'before':before['source'],'after':state(),'originalFilesVerified':len(before['originalFiles']),'allOriginalBytesUnchanged':True,'ciAdditionsOnly':['artifacts.json','partial-ci-native-binding.json','partial-successful-jobs.json'],'wholeCiVerifiedAbsent':not (CI/'verified.json').exists()})
    allfiles=[record(p) for root in [OUT,NATIVE] for p in sorted(root.rglob('*')) if p.is_file()]
    allfiles += [record(CI/x) for x in ['artifacts.json','partial-ci-native-binding.json','partial-successful-jobs.json']]
    write(OUT/'SHA256SUMS.json', {'scope':'Partial verification packet plus exact sibling native replay files and three new CI metadata additions; no whole-CI acceptance','files':allfiles})
    print(json.dumps({'report':record(OUT/'REPORT.md'),'reportJson':record(OUT/'REPORT.json'),'seal':record(OUT/'SHA256SUMS.json'),'filesBound':len(allfiles),'wholeCiConclusion':'failure'}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('stage',choices=['prepare','native','finish']);parser.add_argument('--coverage-url')
    args=parser.parse_args()
    try:
        if args.stage=='prepare': prepare(args.coverage_url)
        elif args.stage=='native': native()
        else: finish()
    except Exception as error:
        print(json.dumps({'status':'STOPPED','reason':str(error),'wholeCiConclusion':'failure','noWholeCiAcceptance':True}),file=sys.stderr);raise
