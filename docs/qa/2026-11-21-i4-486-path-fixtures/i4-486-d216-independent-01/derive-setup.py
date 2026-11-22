"""Derive isolated D216 setup from the closed D215 orchestration; no QA executed here."""
from pathlib import Path
from hashlib import sha256
import ast,json

P=Path(__file__).resolve().parent
E=P.parent
OLD=E/'i4-486-d215-independent-01'

def record(p):
    p=Path(p).resolve();b=p.read_bytes();return {'source':str(p),'bytes':len(b),'sha256':sha256(b).hexdigest()}
def new(p,obj):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    b=obj if isinstance(obj,bytes) else (json.dumps(obj,indent=2)+'\n').encode()
    with p.open('xb') as f:f.write(b)

old=(OLD/'setup-orchestration.py').read_text()
text=old.replace("QA=Path('G:/ggq/gg-i4-486-d215-qa/GraphGoblin')","QA=Path('G:/ggq/gg-i4-486-d216-qa/GraphGoblin')")
text=text.replace("HEAD='6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08'","HEAD='e630bb83679bdb055bdd90d2b30e25fbf60571ac'")
text=text.replace("TREE='34b80f155c8434abc69fc72105ae7462fc460377'","TREE='0713eef9779a14e68b8ca0461f784538ba116c9f'")
text=text.replace("BASE='b8126de18080b76b15cbbbbc00fd791030fec3e1'","BASE='6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08'")
text=text.replace('i4-486-d215-independent-01','i4-486-d216-independent-01').replace('gg-i4-486-d215-qa','gg-i4-486-d216-qa')
text=text.replace('i4-486-d215-root-admission-01/candidate-qa-admission.json','i4-486-d216-root-admission-01/candidate-review-qa-admission.json')
text=text.replace("a['qaAdmitted'] is True", "a['targetedReviewAndSeparateQaAdmitted'] is True").replace("a['testOnly'] is True", "a['oneTestFileOnly'] is True")
start=text.index('def bind_after_install():')
end=text.index("if __name__=='__main__':")
bind=r'''def bind_after_install():
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

'''
text=text[:start]+bind+text[end:]
ast.parse(text);new(P/'setup-orchestration.py',text.encode())
old_seal=json.loads((OLD/'qa/SHA256SUMS.json').read_bytes())
refs=[]
for name in ['child-observer.cjs','runner.mjs','analyze.mjs','consolidate.mjs']:
    source=OLD/'qa/tools'/name;actual=record(source)
    expected=next(x for x in old_seal['files'] if x['path']=='qa/tools/'+name)
    assert actual['sha256']==expected['sha256'] and actual['bytes']==expected['bytes']
    new(P/'reference-tools'/name,source.read_bytes());refs.append({'original':actual,'exactReferenceCopy':record(P/'reference-tools'/name)})
assert 'realpathSync.native = origRealpathNative;' in (P/'reference-tools/child-observer.cjs').read_text()
new(P/'prior-harness-bindings.json',{'standing':'Exact references to CLOSED old6de QA; no prior result is current execution','oldReport':record(OLD/'REPORT.md'),'oldQASeal119':record(OLD/'qa/SHA256SUMS.json'),'oldCompleteProviderSeal154':record(OLD/'ORCHESTRATION-SHA256SUMS.json'),'relevantHarnessCopies':refs,'observerNativePropertyPreservedAtOriginalLine159':True,'reuseRule':'Do not run old runner with old hardcoded paths. Derive a new runner here with actual source-binding and output paths; preserve old reference bytes and bind any revision.'})
new(P/'setup-derivation.json',{'originalSetup':record(OLD/'setup-orchestration.py'),'derivedSetup':record(P/'setup-orchestration.py'),'changes':['New exact e630/tree0713 source and6de baseline; new isolated QA/output/scratch paths','Actual D216 root admission fields','Reuse completed independent setup only; no test/result reuse','No old packet/worktree modification'],'orchestratorRanQATests':False})
print(json.dumps({'setup':record(P/'setup-orchestration.py'),'harnessReferencesBound':len(refs),'oldPacketModified':False}))
