"""Root-authorized isolated setup/orchestration only; actual Opus executes QA."""
from pathlib import Path
from hashlib import sha256
import datetime,json,os,subprocess,sys

E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
OUT=Path(__file__).resolve().parent
PREP=E/'i4-486-d215-qa-preparation-01'
COMMON=Path('G:/ggq/gg-delivery-next-independent/GraphGoblin')
QA=Path('G:/ggq/gg-i4-486-d216-qa/GraphGoblin')
HEAD='e630bb83679bdb055bdd90d2b30e25fbf60571ac'
TREE='0713eef9779a14e68b8ca0461f784538ba116c9f'
BASE='6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08'
TEST='packages/infrastructure/src/fs/fs.test.ts'
NODE=Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe')
SCRATCH=Path('G:/ggq/qa-scratch/i4-486-d216-independent-01')
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
    require(str(QA.resolve()).startswith('G:\\ggq\\gg-i4-486-d216-qa\\'),'Unexpected resolved QA path')
    seal=read(PREP/'SHA256SUMS.json');require(len(seal['files'])==6,'Expected six preparation members')
    for item in seal['files']:
        actual=record(PREP/item['path']);require(actual['sha256']==item['sha256'] and actual['bytes']==item['bytes'],'Preparation member changed')
    admission=E/'i4-486-d216-root-admission-01/candidate-review-qa-admission.json';a=read(admission)
    require(a['targetedReviewAndSeparateQaAdmitted'] is True and a['head']==HEAD and a['tree']==TREE and a['parent']==BASE and a['oneTestFileOnly'] is True,'Wrong root source admission')
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
    install=read(OUT/'setup/install-exit.json');require(install['code']==0,'One admitted offline install failed; no retry/fallback')
    before=read(OUT/'source-before-install.json');after=snapshot();require(after==before,'Source/index/lock changed during install')
    require((QA/'node_modules/.modules.yaml').is_file(),'Independent node_modules missing')
    require(common_state()==read(OUT/'setup-admission.json')['commonBefore'],'Common main worktree/index changed')
    binding={'status':'D216_ACTUAL_SOURCE_AND_INDEPENDENT_SETUP_BOUND','head':HEAD,'tree':TREE,'parent':BASE,'worktree':str(QA),'commonGitDirectory':str((COMMON/'.git').resolve()),'noAlternates':True,'onlyChangedPath':TEST,'allOtherTrackedEntriesIdenticalToParent':True,'baselineFixture':record(OUT/'baseline-fs.test.ts'),'correctedFixture':record(OUT/'candidate-fs.test.ts'),'sourceBeforeQA':after,'installReceipt':record(OUT/'setup/install-exit.json'),'dependencyMetadata':record(QA/'node_modules/.modules.yaml'),'TEMP':TEMP,'TMP':TEMP,'nodeCompileCache':ENV['NODE_COMPILE_CACHE'],'rootAdmission':record(E/'i4-486-d216-root-admission-01/candidate-review-qa-admission.json'),'generalScansConsumed':3,'capResetOrAstra4Authorized':False,'actualQAVerdict':None}
    new(OUT/'source-binding.json',binding)
    spec={'model':'claude-opus-5-5','effort':'xhigh','cwd':str(QA),'prompt':str(OUT/'BRIEF.md'),'outputDir':str(OUT/'provider'),'readOnly':False}
    new(OUT/'spec.json',spec)
    new(OUT/'setup-complete.json',{'status':'ENVIRONMENT_PREPARATION_COMPLETE_NOT_QA','head':HEAD,'tree':TREE,'sourceBinding':record(OUT/'source-binding.json'),'spec':record(OUT/'spec.json'),'offlineInstallExit':0,'productTestsRunByOrchestrator':0,'providerInvocationsSoFar':0,'sourceIndexAndCommonMainUnchanged':True})
    print(json.dumps({'status':'READY_FOR_ONE_ACTUAL_OPUS_D216_SUPPLEMENT','head':HEAD,'tree':TREE,'spec':record(OUT/'spec.json')}))

if __name__=='__main__':
    require(len(sys.argv)==2 and sys.argv[1] in ['prepare','bind'],'Use prepare or bind')
    prepare() if sys.argv[1]=='prepare' else bind_after_install()
