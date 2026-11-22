"""Root-authorized isolated setup/orchestration only; actual Opus executes QA."""
from pathlib import Path
from hashlib import sha256
import datetime,json,os,subprocess,sys

E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
OUT=Path(__file__).resolve().parent
PREP=E/'i4-486-d215-qa-preparation-01'
COMMON=Path('G:/ggq/gg-delivery-next-independent/GraphGoblin')
QA=Path('G:/ggq/gg-i4-486-d215-qa/GraphGoblin')
HEAD='6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08'
TREE='34b80f155c8434abc69fc72105ae7462fc460377'
BASE='b8126de18080b76b15cbbbbc00fd791030fec3e1'
TEST='packages/infrastructure/src/fs/fs.test.ts'
NODE=Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe')
SCRATCH=Path('G:/ggq/qa-scratch/i4-486-d215-independent-01')
TEMP=str(SCRATCH/'process-temp')
ENV={**os.environ,'GIT_OPTIONAL_LOCKS':'0','PATH':str(NODE.parent)+os.pathsep+os.environ['PATH'],'TEMP':TEMP,'TMP':TEMP,'NODE_COMPILE_CACHE':str(SCRATCH/'node-compile-cache'),'PNPM_DISABLE_SELF_UPDATE_CHECK':'1','TURBO_TELEMETRY_DISABLED':'1'}

def require(ok,why):
    if not ok:raise ValueError(why)
def read(p):return json.loads(Path(p).read_bytes())
def record(p):
    p=Path(p).resolve();b=p.read_bytes();return {'source':str(p),'bytes':len(b),'sha256':sha256(b).hexdigest()}
def new(p,obj):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    b=obj if isinstance(obj,bytes) else (json.dumps(obj,indent=2)+'\n').encode()
    with p.open('xb') as f:f.write(b)
def git(repo,*args):return subprocess.check_output(['git','-c','maintenance.auto=false','-c','gc.auto=0','--no-optional-locks',*args],cwd=repo,env=ENV,stderr=subprocess.PIPE)
def run_git(label,repo,*args):
    argv=['git','-c','maintenance.auto=false','-c','gc.auto=0','--no-optional-locks',*args]
    started=datetime.datetime.now(datetime.timezone.utc).isoformat();r=subprocess.run(argv,cwd=repo,env=ENV,capture_output=True)
    new(OUT/'setup'/f'{label}.stdout',r.stdout);new(OUT/'setup'/f'{label}.stderr',r.stderr)
    new(OUT/'setup'/f'{label}.json',{'argv':argv,'cwd':str(repo),'startedUtc':started,'endedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit':r.returncode})
    require(r.returncode==0,'Setup command failed: '+label)
def snapshot():
    index=Path(git(QA,'rev-parse','--path-format=absolute','--git-path','index').decode().strip())
    return {'head':git(QA,'rev-parse','HEAD').decode().strip(),'tree':git(QA,'rev-parse','HEAD^{tree}').decode().strip(),'parent':git(QA,'rev-parse','HEAD^').decode().strip(),'status':git(QA,'status','--porcelain=v1','-z','--untracked-files=all').decode(),'index':record(index),'trackedIndexSha256':sha256(git(QA,'ls-files','--stage','-z')).hexdigest(),'fixture':record(QA/TEST),'lock':record(QA/'pnpm-lock.yaml')}
def common_state():
    index=COMMON/'.git/index'
    return {'head':git(COMMON,'rev-parse','HEAD').decode().strip(),'index':record(index) if index.exists() else None,'topLevelNames':sorted(p.name for p in COMMON.iterdir())}

def prepare():
    require(not QA.exists(),'QA destination already exists')
    require(str(QA.resolve()).startswith('G:\\ggq\\gg-i4-486-d215-qa\\'),'Unexpected resolved QA path')
    seal=read(PREP/'SHA256SUMS.json');require(len(seal['files'])==6,'Expected six preparation members')
    for item in seal['files']:
        actual=record(PREP/item['path']);require(actual['sha256']==item['sha256'] and actual['bytes']==item['bytes'],'Preparation member changed')
    admission=E/'i4-486-d215-root-admission-01/candidate-qa-admission.json';a=read(admission)
    require(a['qaAdmitted'] is True and a['head']==HEAD and a['tree']==TREE and a['parent']==BASE and a['testOnly'] is True,'Wrong root source admission')
    require(git(COMMON,'rev-parse',HEAD+'^{tree}').decode().strip()==TREE and git(COMMON,'show','-s','--format=%P',HEAD).decode().strip()==BASE,'Wrong immutable commit identity')
    require(git(COMMON,'diff-tree','--no-commit-id','--name-only','-r',HEAD).decode().splitlines()==[TEST],'Candidate must change only the fs test file')
    require(not (COMMON/'.git/objects/info/alternates').exists(),'Independent G repo has alternates')
    initial_common=common_state();require(initial_common['topLevelNames']==['.git'],'Common main worktree is not no-checkout')
    SCRATCH.mkdir(parents=True,exist_ok=False);Path(TEMP).mkdir()
    new(OUT/'setup-admission.json',{'rootAdmission':record(admission),'preparationSeal':record(PREP/'SHA256SUMS.json'),'preparationMembersVerified':6,'commonBefore':initial_common,'head':HEAD,'tree':TREE,'parent':BASE,'onlyChangedPath':TEST,'allOtherTrackedProductionAndDependencyEntriesIdenticalToParent':True,'TEMP':TEMP,'TMP':TEMP,'testOrProviderExecutedBySetup':False})
    new(OUT/'baseline-fs.test.ts',git(COMMON,'show',BASE+':'+TEST));new(OUT/'candidate-fs.test.ts',git(COMMON,'show',HEAD+':'+TEST))
    run_git('01-worktree-no-checkout',COMMON,'worktree','add','--detach','--no-checkout',str(QA),HEAD)
    run_git('02-noncone-sparse',QA,'sparse-checkout','set','--no-cone','/*','!/docs/qa/')
    run_git('03-populate-source-only',QA,'read-tree','-mu','HEAD')
    require(not (QA/'docs/qa').exists() and (QA/'docs/README.md').is_file() and (QA/TEST).is_file(),'Sparse source/QA omission precondition failed')
    before=snapshot();require(before['head']==HEAD and before['tree']==TREE and not before['status'],'New QA checkout is dirty or wrong')
    require(before['fixture']['sha256']==record(OUT/'candidate-fs.test.ts')['sha256'],'Candidate fixture differs from immutable Git')
    require(common_state()==initial_common,'Independent common main worktree/index changed')
    new(OUT/'source-before-install.json',before)
    print(json.dumps({'status':'SOURCE_ONLY_DETACHED_QA_CREATED_INSTALL_PENDING','head':HEAD,'tree':TREE,'physicalDocsQaAbsent':True,'sourceFiles':sum(p.is_file() for p in QA.rglob('*')),'TEMP':TEMP}))

def bind_after_install():
    install=read(OUT/'setup/install-exit.json');require(install['code']==0,'Offline install failed; no retry/fallback admitted')
    before=read(OUT/'source-before-install.json');after=snapshot();require(after==before,'Source/index/lock changed during setup install')
    require((QA/'node_modules/.modules.yaml').is_file(),'Independent node_modules missing')
    dependencies=record(QA/'node_modules/.modules.yaml')
    require(common_state()==read(OUT/'setup-admission.json')['commonBefore'],'Common main source/index changed')
    binding={'status':'ACTUAL_SOURCE_AND_INDEPENDENT_SETUP_BOUND_FOR_ROOT_ADMITTED_QA','head':HEAD,'tree':TREE,'parent':BASE,'worktree':str(QA),'commonGitDirectory':str((COMMON/'.git').resolve()),'noAlternates':True,'onlyChangedPath':TEST,'allOtherTrackedEntriesIdenticalToParent':True,'baselineFixture':record(OUT/'baseline-fs.test.ts'),'correctedFixture':record(OUT/'candidate-fs.test.ts'),'sourceBeforeQA':after,'installReceipt':record(OUT/'setup/install-exit.json'),'dependencyMetadata':dependencies,'TEMP':TEMP,'TMP':TEMP,'nodeCompileCache':ENV['NODE_COMPILE_CACHE'],'rootAdmission':record(E/'i4-486-d215-root-admission-01/candidate-qa-admission.json'),'generalScansConsumed':3,'capResetOrAstra4Authorized':False,'actualQAVerdict':None}
    new(OUT/'source-binding.json',binding)
    brief=(PREP/'BRIEF.md').read_text()
    start='BEFORE EXECUTION: source-binding.template.json currently has NULL corrected head/tree. Root must bind the final clean author commit, exact tree/parent/diff and the isolated QA source/index before deriving a runnable spec. Do not run against an unfinished author checkout. No checkout or provider was created by this preparation. Read repository AGENTS.md/docs/15 and the two hash-bound original D215/scan3 records listed in evidence-references.json.'
    actual='ACTUAL SOURCE ADMITTED: corrected head '+HEAD+', tree '+TREE+', direct parent '+BASE+'. Your new detached QA worktree is '+str(QA)+'. Setup/source/index/lock/baseline/candidate fixture hashes are in source-binding.json. Only fs.test.ts differs; all production and dependency blobs are identical to b812. Offline frozen install completed before QA. You may execute the root-admitted six scenarios now. Read repository AGENTS.md/docs/15 and the original D215/scan3 references. This is actual criterion QA, not author evidence, Fable review, general scan4 or cap completion.'
    require(start in brief,'Prepared source-gate paragraph changed');brief=brief.replace(start,actual)
    brief=brief.replace('source-binding.template.json','source-binding.json')
    brief+='\n\nActual setup notes: baseline-fs.test.ts and candidate-fs.test.ts in this evidence folder are byte-exact immutable blobs for your constrained QA-only swap. Their source hashes and empty index/status are bound. Do not read/copy the author test drivers or rely on author pass counts. The author reported four unchanged chat/audio failures from a broader folder; those are author limits only and outside your QA scope. Do not investigate or rerun them. You must write REPORT.md with observed verdicts and limits before finishing, then preserve raw outputs/hashes. No other provider or sub-agent is permitted.\n'
    new(OUT/'BRIEF.md',brief.encode())
    new(OUT/'evidence-references.json',read(PREP/'evidence-references.json'))
    spec={'model':'claude-opus-5-5','effort':'xhigh','cwd':str(QA),'prompt':str(OUT/'BRIEF.md'),'outputDir':str(OUT/'provider'),'readOnly':False}
    new(OUT/'spec.json',spec)
    new(OUT/'setup-complete.json',{'status':'ENVIRONMENT_PREPARATION_COMPLETE_NOT_QA','head':HEAD,'tree':TREE,'sourceBinding':record(OUT/'source-binding.json'),'spec':record(OUT/'spec.json'),'allSetupGitHousekeepingDeferred':True,'offlineInstallExit':0,'productTestsRunByOrchestrator':0,'providerInvocationsSoFar':0,'sourceIndexAndCommonMainUnchanged':True})
    print(json.dumps({'status':'READY_FOR_ONE_ACTUAL_OPUS_QA_DISPATCH','head':HEAD,'tree':TREE,'spec':record(OUT/'spec.json'),'sourceIndexUnchanged':True}))

if __name__=='__main__':
    require(len(sys.argv)==2 and sys.argv[1] in ['prepare','bind'],'Use prepare or bind')
    prepare() if sys.argv[1]=='prepare' else bind_after_install()
