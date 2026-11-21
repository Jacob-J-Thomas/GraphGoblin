"""Read/hash-only bindings shared by the D212 dispatcher and external candidate helper."""
from pathlib import Path, PurePosixPath
from hashlib import sha256
from zipfile import ZipFile
import datetime, json, os, re, subprocess

OUT=Path(__file__).resolve().parent
E=OUT.parent
Q=Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents')
REPO=Path('G:/ggq/gg-i4-486-delivery/GraphGoblin')
REVIEW=E/'i4-486-d209-d211-fable-review-02'
CI=E/'i4-553-head29e-targeta608-ci'
NATIVE=E/'i4-553-head29e-targeta608-ci-windows'
DIAG=E/'i4-553-browser-diagnosis-01'
READBACK=E/'i4-553-browser-root-readback-01'
STATIC=E/'i4-486-d209-doc-independent-01'
HEAD='29e165e14fdda138300ba2a34585ddd47268b475'
TREE='d50fb576f1ef4498cb30e52521198575d6d0ebd4'
TARGET='a60843a9050b3a203726db84f6abf1f45b8bc694'
MERGE='20363bc9beff94e33623307fffed52cd9d509796'
RUN=44934348117
RESET=1795294800
D212='13d6b1574501b1db92c09af0f24b416e2cc1e2554c58c75438eb5de7e1f9ba30'
NODE=Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe')
RUNNER=Path('C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/claude-bounded-runner.mjs')
ENV={**os.environ,'GIT_OPTIONAL_LOCKS':'0','PATH':str(NODE.parent)+os.pathsep+os.environ['PATH']}
PATTERNS=[('github_token',rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,})'),('provider_key',rb'sk-(?:proj-)?[A-Za-z0-9_-]{32,}'),('aws_access_key',rb'AKIA[A-Z0-9]{16}'),('private_key',rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),('generated_token',rb'(?<![A-Za-z0-9_-])gg_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])'),('literal_bearer',rb'(?i)Bearer\s+([A-Za-z0-9_.-]{20,})')]

def require(ok,message):
    if not ok: raise ValueError(message)

def read(p): return json.loads(Path(p).read_bytes())

def record(p,**extra):
    p=Path(p).resolve();require(p.is_file(),'Missing original: '+str(p));h=sha256()
    with p.open('rb') as f:
        while chunk:=f.read(1024*1024): h.update(chunk)
    return {'source':str(p),'bytes':p.stat().st_size,'sha256':h.hexdigest(),**extra}

def verify(x):
    y=record(x['source']);require(y['bytes']==x['bytes'] and y['sha256']==x['sha256'],'Original changed: '+x['source'])

def files(root):
    result=[]
    for p in sorted(Path(root).rglob('*')):
        require(not p.is_symlink(),'Symlink not admitted: '+str(p))
        if p.is_file(): result.append(p)
    return result

def safe(name):
    p=PurePosixPath(name)
    require(name and not p.is_absolute() and '..' not in p.parts and ':' not in name and '\\' not in name,'Unsafe relative member')
    return p.as_posix()

def write_new(p,value):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    raw=value if isinstance(value,bytes) else (json.dumps(value,indent=2,ensure_ascii=False)+'\n').encode()
    with p.open('xb') as f:f.write(raw)

def git(*args): return subprocess.check_output(['git',*args],cwd=REPO,env=ENV,stderr=subprocess.PIPE)

def source_state():
    require(git('rev-parse','HEAD').decode().strip()==HEAD and git('rev-parse','HEAD^{tree}').decode().strip()==TREE,'Frozen head/tree changed')
    require(not git('status','--porcelain=v1','-z','--untracked-files=all'),'Delivery must remain clean')
    index=Path(git('rev-parse','--path-format=absolute','--git-path','index').decode().strip())
    return {'head':HEAD,'tree':TREE,'index':record(index),'stageSha256':sha256(git('ls-files','--stage','-z')).hexdigest(),'clean':True}

def relative_seal(root,name,expected_hash,count,key):
    seal=Path(root)/name
    require(record(seal)['sha256']==expected_hash,'Seal digest differs: '+str(seal))
    members=read(seal)[key];require(len(members)==count,'Seal member count differs')
    names=[]
    for item in members:
        name=safe(item['path']);names.append(name);actual=record(Path(root)/name)
        require(actual['bytes']==item['bytes'] and actual['sha256']==item['sha256'],'Seal member differs: '+name)
    require(len(set(names))==count and {p.relative_to(root).as_posix() for p in files(root)}==set(names)|{seal.relative_to(root).as_posix()},'Sealed physical membership differs')
    return members

def evidence_bindings(inventory):
    require(record(Q/'decision-212.md')['sha256']==D212,'D212 authority bytes changed')
    current=source_state();require(current==inventory['sourceSnapshot'],'Frozen source/index binding changed')
    for item in inventory['allExistingInputFiles']: verify(item)
    for root in inventory['completeExistingRoots']:
        require({p.relative_to(Path(root['source'])).as_posix() for p in files(root['source'])}==set(root['relativeFiles']),'Complete immutable packet membership changed')
    static=relative_seal(STATIC,'SHA256SUMS.json','90dba86c467d078249a88ace0ede22e3a82e9e314f0d6c7d7151cedcf47facff',13,'files')
    require(read(STATIC/'completion.json')['verdict']=='PASS_BOUNDED_STATIC_D209_AND_D211','Independent static QA disposition differs')
    diagnosis=relative_seal(DIAG,'SHA256SUMS.json','430913442d6b5b3725e6e4c2d39bd6071c0cd7d6a9dbb8cc3d0af4d31fdda2fb',87,'members')
    require(record(DIAG/'REPORT.md')['sha256']=='cf9455e5c77f97af47d33a4b714650e6574e666e917c0cfe9c1df02434de18f6','Diagnosis report differs')
    rb=read(READBACK/'verification.json');comment=read(READBACK/'partial-ci-comment.original.json')
    require(rb['diagnosisMembersVerified']==87 and rb['diagnosisSealSHA256']=='430913442d6b5b3725e6e4c2d39bd6071c0cd7d6a9dbb8cc3d0af4d31fdda2fb' and rb['rootCause']=='unresolved' and rb['ordinaryCI']=='failure' and rb['partialCommentExactBody'] is True,'Root diagnosis/readback qualification differs')
    require(comment['id']==7067634339 and sha256(comment['body'].encode()).hexdigest()==rb['partialReportSHA256']==record(E/'i4-553-partial-job-verification-01/REPORT.md')['sha256'],'Partial public report body differs')
    run,head,merge,pr,jobs=read(CI/'run.json'),read(CI/'head.json'),read(CI/'merge.json'),read(CI/'pr.json'),read(CI/'jobs.json')['jobs']
    require(not (CI/'verified.json').exists(),'Failed overall CI must never acquire a passing verified.json')
    require(run['id']==RUN and run['head_sha']==HEAD and run['run_attempt']==1 and run['status']=='completed' and run['conclusion']=='failure','Failed first-attempt CI binding differs')
    require(head['sha']==HEAD and head['tree']['sha']==TREE and merge['sha']==MERGE and merge['tree']['sha']==TREE and [p['sha'] for p in merge['parents']]==[TARGET,HEAD] and pr['head']['sha']==HEAD and pr['base']['sha']==TARGET,'Source/target/synthetic merge binding differs')
    require(len(jobs)==6 and len({j['name'] for j in jobs})==6,'Expected exactly six CI jobs')
    expected={'Repository checks','Windows launcher','Coverage','Template image','Gates'}
    require({j['name'] for j in jobs if j['conclusion']=='success'}==expected,'Expected exact five successful jobs')
    browser=next(j for j in jobs if j['name']=='Browser');require(browser['conclusion']=='failure','Browser failure must remain explicit')
    for job in jobs:
        require(job['run_id']==RUN and job['run_attempt']==1 and job['head_sha']==HEAD and job['status']=='completed','Job source/attempt differs')
        failures=[s['name'] for s in job['steps'] if s['conclusion'] in ['failure','cancelled']]
        require(failures==(['Functional browser suite (no retries)'] if job['name']=='Browser' else []),'Job failure scope differs')
    partial=read(CI/'partial-ci-native-binding.json');native=read(NATIVE/'verified.json')
    require(partial['wholeCiConclusion']=='failure' and partial['windowsConclusion']=='success' and partial['head']==HEAD and partial['target']==TARGET and partial['testedMerge']==MERGE and partial['testedTree']==TREE,'Partial CI binding differs')
    require(native['run']==RUN and native['head']==HEAD and native['base']==TARGET and native['merge']==MERGE and native['sourceTree']==TREE and native['wholeCiConclusion']=='failure' and native['scope']=='successful native Windows job from failed overall CI' and native['canonicalReplay'] is True and native['records']==338,'Native partial canonical receipt differs')
    require(read(NATIVE/'replay/replay-results.json')['cases'][0]['exactResultReplay'] is True,'Canonical native replay missing')
    archive=record(NATIVE/'archive.zip');require(archive['bytes']==native['bytes'] and archive['sha256']==native['digest'],'Native ZIP differs')
    require(native['digest'] in (CI/'windows-launcher.log').read_text(encoding='utf-8-sig'),'Native ZIP/log binding differs')
    with ZipFile(NATIVE/'archive.zip') as z:
        require(z.testzip() is None and set(z.namelist())==set(native['files']),'Native corpus layout differs')
        for name,digest in native['files'].items(): require(sha256(z.read(name)).hexdigest()==digest==record(NATIVE/'corpus'/name)['sha256'],'Native corpus digest differs')
    spec=read(REVIEW/'spec.json')
    require(spec=={'model':'claude-fable-5-2','effort':'xhigh','cwd':REPO.as_posix(),'prompt':(REVIEW/'BRIEF.md').as_posix(),'outputDir':(REVIEW/'provider').as_posix(),'readOnly':True},'Actual Fable specification differs')
    return {'source':current,'authority':'D212','authoritySha256':D212,'boundedStaticOnly':True,'staticQAMembers':len(static),'diagnosisMembers':len(diagnosis),'rootCause':'unresolved','run':RUN,'wholeCiConclusion':'failure','windowsConclusion':'success','successfulJobs':5,'failedJobs':1,'nativeCanonicalRecords':338,'finalAllSuccessCIRequired':True,'finalNativeAndAstra3Required':True}

def scan(copies):
    hits=[]
    for item in copies:
        raw=Path(item['source']).read_bytes()
        for name,pattern in PATTERNS:
            for match in re.finditer(pattern,raw): hits.append({'source':item['source'],'archivePath':item['archivePath'],'pattern':name,'offset':match.start(),'candidateSha256':sha256(match.group()).hexdigest()})
    return hits
