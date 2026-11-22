from pathlib import Path
import datetime,hashlib,json,os,subprocess,sys
sys.dont_write_bytecode=True
OUT=Path(__file__).resolve().parent
Q=OUT.parent
ROOT='C:/Users/98jak/source/repos/GraphGoblin'
REPO='G:/ggq/gg-i4-486-delivery/GraphGoblin'
FROZEN=['G:/ggq/gg-i4-486-authored-errors/GraphGoblin','G:/ggq/gg-i4-486-qa/GraphGoblin']
HEAD='633d9ac72c10fe4b8d76f7ba50221f9ed8557cb9'
MAIN='02a0000998fa119be7553ddc06a60b63fbde1e31'
BASE='02351e2fb932b3be44e7cc3fb3943a61d568226c'
BRANCH='codex/gg-i4-486-delivery'
RUNTIME='C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64'
os.environ['PATH']=RUNTIME+os.pathsep+os.environ['PATH']
ENV=dict(os.environ)
ENV['GIT_OPTIONAL_LOCKS']='0'
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(b):return hashlib.sha256(b).hexdigest()
def write(p,obj):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj,indent=2)+'\n',encoding='utf8',newline='\n')
def run(name,args,cwd=REPO,allowed=(0,),input=None):
 assert not (OUT/(name+'.json')).exists(),name
 start=utc();p=subprocess.run(args,cwd=cwd,env=ENV,input=input,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 for ext,b in [('stdout',p.stdout),('stderr',p.stderr)]:
  f=OUT/(name+'.'+ext);f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b)
 write(OUT/(name+'.json'),{'command':args,'cwd':cwd,'startedUTC':start,'finishedUTC':utc(),'exitCode':p.returncode,'stdoutBytes':len(p.stdout),'stdoutSha256':sha(p.stdout),'stderrBytes':len(p.stderr),'stderrSha256':sha(p.stderr),'runtimeFirstPATH':RUNTIME,'gitOptionalLocks':'0'})
 assert p.returncode in allowed,(name,p.returncode,p.stderr.decode(errors='replace')[-2000:]);return p

def git(name,*args,cwd=REPO,allowed=(0,),input=None):return run(name,['git','--no-optional-locks',*args],cwd,allowed,input)
def text(name,*args,cwd=REPO):return git(name,*args,cwd=cwd).stdout.decode().strip()
def entries(name,rev,cwd=REPO):
 b=git(name,'ls-tree','-r','-z',rev,cwd=cwd).stdout;d={}
 for row in b.split(b'\0'):
  if row:
   meta,p=row.split(b'\t',1);mode,typ,oid=meta.decode().split();d[p.decode()]={'mode':mode,'type':typ,'oid':oid}
 return d

def snapshot_frozen(phase):
 freeze=json.loads((Q/'i4-486-source-freeze-01/receipt.json').read_bytes());values=[]
 for i,repo in enumerate(FROZEN):
  pref=phase+'/frozen-'+str(i)
  ident=text(pref+'/identity','show','-s','--format=%H %T %P','HEAD',cwd=repo).split()
  assert ident==[HEAD,'d0e38c6c0212e312e6b605ac3d6bc8f7af5a129f',BASE],ident
  assert not git(pref+'/status','status','--porcelain=v1',cwd=repo).stdout
  idx=text(pref+'/index-path','rev-parse','--path-format=absolute','--git-path','index',cwd=repo)
  ib=Path(idx).read_bytes();(OUT/(pref+'/index-original')).write_bytes(ib)
  staged=git(pref+'/index-entries','ls-files','--stage','-z',cwd=repo).stdout
  source=[]
  for f in freeze['files']:
   b=(Path(repo)/f['path']).read_bytes();assert sha(b)==f['sha256'] and len(b)==f['bytes'];source.append({'path':f['path'],'sha256':sha(b),'bytes':len(b)})
  values.append({'repo':repo,'identity':ident,'clean':True,'indexPath':idx,'indexBytes':len(ib),'indexSha256':sha(ib),'indexEntriesSha256':sha(staged),'files':source,'sourceVerified':len(source)})
 write(OUT/(phase+'/frozen-checkouts.json'),values)
 return values

def init():
 assert not (OUT/'contract.json').exists()
 assert not Path(REPO).exists()
 assert git('preflight/delivery-branch-existence','show-ref','--verify','refs/heads/'+BRANCH,cwd=ROOT,allowed=(0,1,128)).returncode!=0
 snapshot_frozen('before')
 remote=git('preflight/remote-main','ls-remote','origin','refs/heads/main',cwd=ROOT).stdout.decode().split()
 assert remote==[MAIN,'refs/heads/main'],('REMOTE_MAIN_MOVED_STOP',remote)
 git('preflight/fetch-main','fetch','origin','main',cwd=ROOT)
 assert text('preflight/fetched-main','rev-parse','origin/main',cwd=ROOT)==MAIN
 ident=text('preflight/main-identity','show','-s','--format=%H %T %P',MAIN,cwd=ROOT).split()
 assert ident==[MAIN,'d0bedeba38fd7cae85057ab1d275cc4e6424a7d0','a84f988b89e456b0e2270e3c4750afb250b6c68f','d02f2b0b9dd56c2f8eeee62737aff1cbf1559f5d'],ident
 assert text('preflight/merge-base','merge-base',HEAD,MAIN,cwd=ROOT)==BASE
 write(OUT/'contract.json',{'authority':'D200 and explicit root task: separate worktree/branch ordinary integration commit; no publication/push/CI/main merge or source/test changes','issue':486,'originalHead':HEAD,'main':MAIN,'mergeBase':BASE,'deliveryBranch':BRANCH,'deliveryWorktree':REPO,'frozenCheckouts':FROZEN,'runtimeFirstPATH':RUNTIME,'gateLimit':'Preliminary engineering integration only; original actual-Claude review and QA unfinished, CI and final audit separate','decisionSha256':sha((Q/'decision-200.md').read_bytes()),'patternReadOnlySha256':sha((Q/'i4-552-main-02a-integration-01/integrate.py').read_bytes()),'utc':utc()})
 git('worktree-create','worktree','add','-b',BRANCH,REPO,HEAD,cwd=ROOT)
 assert text('before-merge/head','rev-parse','HEAD')==HEAD
 assert not git('before-merge/status','status','--porcelain=v1').stdout
 entries('trees/original',HEAD);entries('trees/main',MAIN);entries('trees/base',BASE)
 p=git('merge-original','merge','--no-ff','--no-commit',MAIN,allowed=(0,1))
 assert text('conflict/merge-head','rev-parse','MERGE_HEAD')==MAIN
 conflicts=git('conflict/path-list','diff','--name-only','--diff-filter=U').stdout.decode().splitlines()
 git('conflict/index-unmerged','ls-files','--unmerged','-z')
 for i,path in enumerate(conflicts):
  folder=OUT/'conflict'/str(i);folder.mkdir(parents=True)
  (folder/'path.txt').write_text(path,encoding='utf8');(folder/'worktree-original').write_bytes((Path(REPO)/path).read_bytes())
  for s in [1,2,3]:git('conflict/'+str(i)+'/stage'+str(s),'show',':'+str(s)+':'+path,allowed=(0,128))
 write(OUT/'conflicts.json',conflicts)
 print(json.dumps({'remoteMain':MAIN,'worktree':REPO,'original':HEAD,'conflicts':conflicts,'frozenPreservedBefore':True}))



def read_entries(path):
 d={}
 for row in Path(path).read_bytes().split(b'\0'):
  if row:
   a,p=row.split(b'\t',1);mode,typ,oid=a.decode().split();d[p.decode()]={'mode':mode,'type':typ,'oid':oid}
 return d

def blob_many(name,mapping):
 ids=list(dict.fromkeys(x['oid'] for x in mapping.values()))
 data=git(name,'cat-file','--batch',input=('\n'.join(ids)+'\n').encode()).stdout
 found={};pos=0
 for oid in ids:
  end=data.index(b'\n',pos);head=data[pos:end].decode().split();assert head[:2]==[oid,'blob'];size=int(head[2]);pos=end+1
  found[oid]=data[pos:pos+size];pos+=size+1
 assert pos==len(data)
 return {p:found[e['oid']] for p,e in mapping.items()}

def archive_proof(phase,target_entries,all_main):
 specs=[('inherited547','docs/qa/2026-11-21-i4-427-365','integration-manifest.json',243),('original363','docs/qa/2026-11-21-i4-363-structured-temp','manifest.json',339),('corrective363','docs/qa/2026-11-21-i4-363-marker-correction','integration-manifest.json',272)]
 selected={p:e for p,e in all_main.items() if any(p.startswith(prefix+'/') for _,prefix,_,_ in specs)}
 assert len(selected)==854
 original=blob_many(phase+'/archives/main-original-blobs',selected)
 values=[]
 for label,prefix,manifest,count in specs:
  mapping={p:e for p,e in selected.items() if p.startswith(prefix+'/')};assert len(mapping)==count
  dest={p:e for p,e in target_entries.items() if p.startswith(prefix+'/')};assert mapping==dest,(label,'archive entry/mode changed')
  mp=prefix+'/'+manifest;mb=original[mp];seal=json.loads(mb)
  members=[];seen=set()
  for f in seal['files']:
   path=prefix+'/'+f['path'];assert path!=mp and path not in seen;seen.add(path);b=original[path]
   assert len(b)==f['bytes'] and sha(b)==f['sha256'],path
  assert seen==set(mapping)-{mp}
  for path,e in mapping.items():
   b=original[path];disk=(Path(REPO)/path).read_bytes();assert disk==b,(phase,path,'disk bytes differ')
   members.append({'path':path,'mainEntry':e,'integratedEntry':dest[path],'bytes':len(b),'sha256':sha(b),'diskBytesEqual':True})
  manifest_copy=OUT/'archive-manifests'/prefix/manifest;manifest_copy.parent.mkdir(parents=True,exist_ok=True)
  if manifest_copy.exists():assert manifest_copy.read_bytes()==mb
  else:manifest_copy.write_bytes(mb)
  values.append({'name':label,'prefix':prefix,'originalCommit':MAIN,'manifest':mp,'manifestBlob':mapping[mp]['oid'],'manifestSha256':sha(mb),'allOriginalManifestMembersVerified':True,'manifestListedMembers':len(seen),'treeFileCountIncludingManifest':count,'allGitBlobsModesAndDiskBytesEqualMain':True,'files':members})
 write(OUT/(phase+'/archives/proof.json'),values)
 return [{'name':v['name'],'files':v['treeFileCountIncludingManifest'],'manifestSha256':v['manifestSha256']} for v in values]

def resolve():
 assert json.loads((OUT/'conflicts.json').read_bytes())==['CHANGELOG.md']
 # Preserve the failed write-tree result while the initial index is unmerged.
 git('conflict/write-tree-expected-refusal','write-tree',allowed=(128,))
 old=(Path(REPO)/'CHANGELOG.md').read_bytes();assert old==(OUT/'conflict/0/worktree-original').read_bytes()
 assert old.count(b'<<<<<<< HEAD\n')==1 and old.count(b'=======\n')==1
 pre,c=old.split(b'<<<<<<< HEAD\n');ours,c=c.split(b'=======\n');theirs,suf=c.split(('>>>>>>> '+MAIN+'\n').encode())
 new=pre+ours+b'\n'+theirs+suf
 assert ours in new and theirs in new and b'<<<<<<<' not in new and b'>>>>>>>' not in new
 for s in [2,3]:
  parent=(OUT/('conflict/0/stage'+str(s)+'.stdout')).read_bytes();it=iter(new.splitlines(keepends=True));assert all(any(x==line for x in it) for line in parent.splitlines(keepends=True))
 (Path(REPO)/'CHANGELOG.md').write_bytes(new)
 (OUT/'resolved-CHANGELOG.md').write_bytes(new)
 write(OUT/'resolution-record.json',{'path':'CHANGELOG.md','onlyConflict':True,'method':'Remove only conflict markers; preserve complete #486 block, one blank line, complete main #363/#427/#365 block; preserve bytes outside conflict','originalConflictSha256':sha(old),'oursBlockSha256':sha(ours),'mainBlockSha256':sha(theirs),'resolvedSha256':sha(new),'bothBlocksVerbatim':True,'completeParentsLinePreservingSubsequences':True})
 git('stage-exact-resolution','add','--','CHANGELOG.md')
 assert not git('resolved/unmerged','ls-files','--unmerged').stdout
 assert not git('resolved/unstaged','diff','--name-only').stdout
 tree=text('resolved/write-tree','write-tree');entries('trees/prospective',tree)
 git('resolved/cached-diff','diff','--cached','--binary',HEAD)
 write(OUT/'prospective-tree.json',{'tree':tree,'parents':[HEAD,MAIN],'utc':utc()})
 print(json.dumps({'resolvedOnly':'CHANGELOG.md','prospectiveTree':tree}))

def checks():
 import difflib
 assert text('checks/head','rev-parse','HEAD')==HEAD
 assert text('checks/merge-head','rev-parse','MERGE_HEAD')==MAIN
 prospective=json.loads((OUT/'prospective-tree.json').read_bytes())['tree'];assert text('checks/index-tree','write-tree')==prospective
 orig,main,base,final=[read_entries(OUT/'trees'/f'{n}.stdout') for n in ['original','main','base','prospective']]
 # Shared harness doc must equal the exact disjoint application of both parents' edits.
 path='docs/06-harness-integration.md';parts={}
 for label,ref in [('base',BASE),('original',HEAD),('main',MAIN),('prospective',prospective)]:parts[label]=git('shared-doc/'+label,'show',ref+':'+path).stdout
 lines=parts['base'].splitlines(keepends=True);ops=[]
 for side in ['original','main']:
  changed=parts[side].splitlines(keepends=True)
  for tag,i,j,k,l in difflib.SequenceMatcher(a=lines,b=changed,autojunk=False).get_opcodes():
   if tag!='equal':ops.append({'side':side,'tag':tag,'start':i,'end':j,'before':lines[i:j],'after':changed[k:l]})
 ops.sort(key=lambda a:(a['start'],a['end']))
 for a,b in zip(ops,ops[1:]):assert a['end']<b['start'],('ACTUAL_DOC_OVERLAP_STOP',a['side'],b['side'])
 expected=list(lines)
 for op in reversed(ops):expected[op['start']:op['end']]=op['after']
 assert parts['prospective']==b''.join(expected)
 docproof={'path':path,'exactDisjointParentEditCombination':True,'allChangedParentSectionsVerbatim':True,'operations':[{'side':o['side'],'tag':o['tag'],'baseStart':o['start'],'baseEnd':o['end'],'beforeSha256':sha(b''.join(o['before'])),'afterSha256':sha(b''.join(o['after']))} for o in ops],'hashes':{k:sha(v) for k,v in parts.items()}}
 write(OUT/'shared-harness-doc-proof.json',docproof)
 editorial={'CHANGELOG.md',path};rows=[];main_noneditorial=[]
 for p in sorted(set(base)|set(orig)|set(main)|set(final)):
  b,o,t,f=base.get(p),orig.get(p),main.get(p),final.get(p)
  if p in editorial:
   assert f['mode']==o['mode']==t['mode']==b['mode'] and f['type']==o['type']==t['type']==b['type']=='blob';rule='documented exact additive/disjoint editorial combination'
   if p=='CHANGELOG.md':assert git('checks/changelog-final-blob','show',prospective+':'+p).stdout==(OUT/'resolved-CHANGELOG.md').read_bytes()
  else:
   if o==t or t==b:exp=o;rule='original or identical parents'
   elif o==b:exp=t;rule='main-only change'
   else:raise AssertionError(('BEHAVIOR_OR_UNEXPECTED_CONFLICT_STOP',p))
   assert f==exp,(p,'not exact clean parent combination')
   if f!=o and not p.startswith('docs/') and p not in {'.gitattributes','.prettierignore'}:main_noneditorial.append(p)
  rows.append([p,b,o,t,f,rule])
 proof={'original':HEAD,'main':MAIN,'mergeBase':BASE,'prospectiveTree':prospective,'columns':['path','base','original','main','prospective','rule'],'entries':rows,'allNoneditorialBlobsAndModesEqualExactParentCombination':True,'mainNoneditorialInheritedPaths':main_noneditorial}
 write(OUT/'source-blob-mode-parent-combination-proof.json',proof)
 freeze=json.loads((Q/'i4-486-source-freeze-01/receipt.json').read_bytes());mappings=[]
 assert len(freeze['files'])==52
 assert sorted(f['path'] for f in freeze['files'])==sorted(p for p in set(base)|set(orig) if base.get(p)!=orig.get(p))
 for f in freeze['files']:
  p=f['path'];e=orig[p];dest=final[p]
  disk=(Path(REPO)/p).read_bytes()
  if p not in editorial:assert e==dest and sha(disk)==f['sha256'] and len(disk)==f['bytes']
  else:assert dest['mode']==e['mode']
  mappings.append({'path':p,'sourceBytes':f['bytes'],'sourceSha256':f['sha256'],'sourceEntry':e,'integratedEntry':dest,'integratedBytes':len(disk),'integratedSha256':sha(disk),'mapping':'exact original blob and mode' if p not in editorial else 'exact documented editorial parent union'})
 write(OUT/'all52-original-source-mappings.json',{'total':52,'exactBlobAndMode':50,'editorialCombinations':2,'files':mappings})
 archives=archive_proof('prospective',final,main)
 runtime=run('checks/node-version',['node','--version']).stdout.strip();assert runtime==b'v22.23.4'
 run('checks/pnpm-version',['pnpm.cmd','--version'])
 changed=git('checks/main-inherited-paths','diff','--cached','--name-only',HEAD).stdout.decode().splitlines()
 editorial_paths=[p for p in changed if p.endswith('.md') and not p.startswith('docs/qa/')]
 assert editorial_paths
 write(OUT/'format-scope.json',{'paths':editorial_paths,'dependencyHostCwd':FROZEN[0],'reason':'New isolated checkout has no installed dependencies; pnpm exec uses existing frozen-author dependencies read-only, with absolute integration target files and integration ignore rules. No install/build/lifecycle/test command.','excluded':'All854immutable archive files and exact inherited production/test/fixture/lock/patch bytes. Git attributes and prettierignore checked through Git diff.'})
 run('checks/prettier-scope',['pnpm.cmd','exec','prettier','--check','--ignore-unknown','--ignore-path',REPO+'/.prettierignore',*[REPO+'/'+p for p in editorial_paths]],cwd=FROZEN[0])
 git('checks/diff-worktree','diff','--check');git('checks/diff-index','diff','--cached','--check')
 assert not git('checks/unstaged-final','diff','--name-only').stdout
 assert text('checks/index-tree-after','write-tree')==prospective
 after=snapshot_frozen('before-commit')
 before=json.loads((OUT/'before/frozen-checkouts.json').read_bytes());assert before==after,'Frozen author or QA changed'
 write(OUT/'verified-prospective.json',{'tree':prospective,'parents':[HEAD,MAIN],'all52Mappings':True,'50ExactOriginalBlobsAndModes':True,'twoExactEditorialParentCombinations':True,'allNoneditorialEntriesExactCleanParentCombination':True,'mainNoneditorialInheritedPaths':main_noneditorial,'archives':archives,'archiveFileTotal':854,'allChecksPassed':['Node22.23.4','ScopedPrettier','GitDiffWorktreeAndIndex','ExactSourceParentModesBlobs','854ArchiveFilesManifestAndDisk','FrozenSourceAndIndexPreserved'],'noBuildTestCoverageInstallProvidersPublicationCI':True,'utc':utc()})
 print(json.dumps({'checks':'PASS','tree':prospective,'sourceExact':50,'docCombinations':2,'archiveFiles':854,'mainNoneditorialInheritedPaths':main_noneditorial}))



def commit():
 verified=json.loads((OUT/'verified-prospective.json').read_bytes());want=verified['tree']
 assert text('commit/pre-head','rev-parse','HEAD')==HEAD
 assert text('commit/pre-merge-head','rev-parse','MERGE_HEAD')==MAIN
 assert text('commit/pre-index-tree','write-tree')==want
 # Inspect executable hooks before committing; no test/build hook is authorized.
 hook_config=git('commit/hooks-config','config','--get','core.hooksPath',allowed=(0,1)).stdout.decode().strip()
 common=text('commit/common-git-dir','rev-parse','--path-format=absolute','--git-common-dir')
 hooks=Path(hook_config) if hook_config else Path(common)/'hooks'
 if not hooks.is_absolute():hooks=Path(REPO)/hooks
 active=[str(hooks/name) for name in ['pre-commit','prepare-commit-msg','commit-msg','post-commit'] if (hooks/name).is_file()]
 write(OUT/'commit/hook-inspection.json',{'hooksDirectory':str(hooks),'activeCommitHooks':active,'noBuildTestHooksExecuted':True})
 assert not active,('Unexpected active commit hooks need inspection before any execution',active)
 git('commit/ordinary-merge','commit','-m','Merge main into authored failure delivery branch')
 ident=text('commit/identity','show','-s','--format=%H %T %P','HEAD').split();assert ident[1:]==[want,HEAD,MAIN],ident
 committed=entries('trees/committed',ident[0]);prospective=read_entries(OUT/'trees/prospective.stdout');assert committed==prospective
 assert text('commit/final-index-tree','write-tree')==want
 assert not git('commit/final-status','status','--porcelain=v1').stdout
 git('commit/final-show','show','-s','--format=fuller','HEAD')
 git('commit/diff-main','diff','--binary',MAIN,'HEAD')
 git('commit/diff-original','diff','--binary',HEAD,'HEAD')
 assert git('commit/ancestry-original','merge-base','--is-ancestor',HEAD,'HEAD').returncode==0
 assert git('commit/ancestry-main','merge-base','--is-ancestor',MAIN,'HEAD').returncode==0
 main=read_entries(OUT/'trees/main.stdout');archives=archive_proof('committed',committed,main)
 after=snapshot_frozen('after-commit');before=json.loads((OUT/'before/frozen-checkouts.json').read_bytes());assert after==before
 remote=git('commit/remote-main-final','ls-remote','origin','refs/heads/main').stdout.decode().split();assert remote==[MAIN,'refs/heads/main'],('REMOTE_MAIN_MOVED_STOP',remote)
 remote_branch=git('commit/remote-delivery-branch-final','ls-remote','origin','refs/heads/'+BRANCH).stdout;assert not remote_branch,'Unexpected already-published delivery branch; no push made by this task'
 summary={'head':ident[0],'tree':want,'parents':ident[2:],'branch':BRANCH,'worktree':REPO,'ordinaryTwoParentMerge':True,'prospectiveIndexCommittedTreesEqual':True,'clean':True,'original52FilesMapped':True,'50ExactOriginalBlobsAndModes':True,'twoExactEditorialCombinations':['CHANGELOG.md','docs/06-harness-integration.md'],'allNoneditorialEntriesExactCleanParentCombination':True,'mainNoneditorialInheritedPaths':verified['mainNoneditorialInheritedPaths'],'archives':archives,'archiveFileCount':854,'frozenAuthorAndQASourceAndIndexBytesUnchanged':True,'frozenSourceHead':HEAD,'remoteMainStillExact':MAIN,'remoteDeliveryBranchAbsent':True,'pushed':False,'providersLaunched':False,'noProductionTestEdits':True,'noBuildTestCoverageInstallOrCI':True,'preliminaryIntegrationOnly':True,'reviewQAArchiveFinalAuditAndCurrentHeadTargetCIStillRequired':True,'utc':utc()}
 write(OUT/'integration-summary.json',summary)
 report=f'''# #486 preliminary ordinary main integration

Engineering integration is complete in `{REPO}` on `{BRANCH}`. No publication, push, CI request or merge to main was performed. D200 authorizes the separate branch/worktree and this ordinary integration commit; the unfinished actual-Claude review/QA remain bound to frozen633 and are not promoted to acceptance by this integration.

- Commit: `{ident[0]}`
- Prospective, index and committed tree: `{want}`
- Parents in order: `{HEAD}` and `{MAIN}`
- Worktree/index clean. Both original author and QA remain clean at633/tree d0e38c6c0212e312e6b605ac3d6bc8f7af5a129f. Their index bytes, complete stage-entry bytes and all52source file lengths/hashes are identical before/after.
- Remote main was verified before fetch and again after commit as exact02a; the new delivery branch is absent remotely.

All52original candidate files have explicit mappings:50remain exact original Git blobs/modes/disk bytes. `CHANGELOG.md` resolves the sole conflict by preserving both complete additive blocks verbatim with one blank separator; bytes outside conflict markers are retained. `docs/06-harness-integration.md` was auto-merged and independently proved equal to the exact disjoint application of original's authored-failure insertion and main's three separate changes. Neither combined document is called byte-identical to633. No #486 production or regression-test blob changed.

Every other path/mode/blob follows the exact clean parent combination. Nine noneditorial main changes are exact main entries: adapter fixtures(schema-cli,sdk-schema-case),isolation.ts,options.ts,sdk-schema.test.ts,structured.test.ts,structured.ts,the managed SDK patch and pnpm-lock.yaml. They are inherited parent behavior, not new edits or independently verified runtime behavior. No production/test overlap or behavior conflict required resolution.

All854inherited archive files retain main's exact manifest/member bytes, Git blobs, modes and checkout bytes: #547243, original#363339, corrective#363272 (counts include each manifest;851manifest-listed content members). Every manifest-listed size/hash and exact membership set passed before commit and again against the committed tree. No raw archive bytes were formatted or rewritten.

Scoped Prettier check and working/index Git diff checks passed with Node22.23.4 first on whole-process PATH and pnpm12.8.1. New worktree has no installed dependencies; read-only pnpm exec used existing author dependencies with absolute integration document targets and integration .prettierignore. It installed nothing and ran no build,test,coverage or lifecycle gate; frozen index/source preservation was reverified afterwards. Only CHANGELOG.md was manually resolved/staged; all other integration index entries came from ordinary Git merge. No active commit hooks existed, so no hidden test/build hook ran.

Raw command arrays, cwd,timestamps,status/stdout/stderr hashes and bytes are retained alongside initial conflict and stages1/2/3. Initial unmerged index's expected write-tree refusal is retained; after resolution all prospective/index/precommit/postcommit trees equal. `source-blob-mode-parent-combination-proof.json` covers every tree entry; `all52-original-source-mappings.json` covers the original52. `shared-harness-doc-proof.json`,resolution-record.json,prospective/committed archive proofs,before/before-commit/after-commit frozen index snapshots and integration-summary.json provide the detailed evidence. Seal.json hashes the complete evidence packet except itself.

Limits: initial read of the batch register in the unrelated stale workspace failed because that path was absent; the actual frozen author's register was then read. This was read-only and did not affect integration. No provider/model request, external issue comment, publication, source/test authored edit, install, runtime launch, build,test,coverage,history rewrite,reset,cleanup,CI trigger/rerun/cancellation or owner deployment was performed. Current ordinary hosted CI at the exact new head/current target, completion of Fable review cycle1 and independent Opus QA, later source-bound evidence archive and fresh final audit remain separate root-owned gates. Preliminary CI can qualify only its own exact head/target; it completes neither review nor QA nor delivery.
'''
 (OUT/'REPORT.md').write_text(report,encoding='utf8',newline='\n')
 print(json.dumps(summary))

def seal():
 summary=json.loads((OUT/'integration-summary.json').read_bytes())
 assert not (OUT/'seal.json').exists()
 files=[]
 for p in sorted(OUT.rglob('*')):
  if p.is_file():
   b=p.read_bytes();files.append({'path':p.relative_to(OUT).as_posix(),'bytes':len(b),'sha256':sha(b)})
 result={'kind':'IMMUTABLE_PRELIMINARY_INTEGRATION_EVIDENCE','utc':utc(),'head':summary['head'],'tree':summary['tree'],'parents':summary['parents'],'fileCount':len(files),'excludesOnlyThisManifest':True,'files':files}
 write(OUT/'seal.json',result)
 for f in files:
  b=(OUT/f['path']).read_bytes();assert sha(b)==f['sha256'] and len(b)==f['bytes']
 print(json.dumps({'seal':str(OUT/'seal.json'),'sealSha256':sha((OUT/'seal.json').read_bytes()),'fileCount':len(files),'head':summary['head'],'tree':summary['tree'],'reportSha256':sha((OUT/'REPORT.md').read_bytes())}))

if __name__=='__main__':{'init':init,'resolve':resolve,'checks':checks,'commit':commit,'seal':seal}[sys.argv[1]]()
