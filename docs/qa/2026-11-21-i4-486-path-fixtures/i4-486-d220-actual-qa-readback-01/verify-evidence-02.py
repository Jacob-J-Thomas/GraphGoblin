from pathlib import Path,PurePosixPath,PureWindowsPath
import json,hashlib,re,datetime

P=Path(__file__).resolve().parent
E=P.parent
A=E/'i4-486-d216-independent-02'
C=E/'i4-486-d220-api-controller-01'
HEAD='e630bb83679bdb055bdd90d2b30e25fbf60571ac'
TREE='0713eef9779a14e68b8ca0461f784538ba116c9f'
PARENT='6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08'
def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def ref(path):
    path=Path(path);return dict(source=str(path.resolve()),bytes=path.stat().st_size,sha256=digest(path))
def read(name):return json.loads((A/name).read_bytes())
def put(name,value):
    if (P/name).exists():
        assert json.loads((P/name).read_bytes())==value, 'Existing partial proof differs: '+name
        return
    with (P/name).open('x',encoding='utf8',newline='\n') as f:json.dump(value,f,indent=2);f.write('\n')
def verify_seal(base,path,scope):
    before=ref(path);data=json.loads(Path(path).read_bytes());seen=set();verified=[]
    for row in data['files']:
        rel=row['path'];pos=PurePosixPath(rel);win=PureWindowsPath(rel)
        assert not pos.is_absolute() and not win.drive and '\\' not in rel and ':' not in rel and '..' not in pos.parts and rel not in seen,rel
        seen.add(rel);file=base/rel
        assert file.resolve().is_relative_to(base.resolve()) and file.is_file() and not file.is_symlink(),rel
        # Controller member contents, including runtime-route, are hash-only.
        assert file.stat().st_size==row['bytes'] and digest(file)==row['sha256'],rel
        verified.append(row)
    if scope=='qa':
        physical={'REPORT.md'}|{x.relative_to(base).as_posix() for x in (base/'qa').rglob('*') if x.is_file() and x!=path}
    else:
        physical={x.relative_to(base).as_posix() for x in base.rglob('*') if x.is_file() and x!=path}
    assert seen==physical,(scope,'manifest/physical membership difference',sorted(seen^physical))
    assert ref(path)==before
    return dict(manifest=before,membersVerified=len(seen),totalMemberBytes=sum(r['bytes'] for r in verified),physicalMembershipExact=True,rootResolution='attempt root' if base==A else 'controller root',allMembersStreamHashed=True,controllerPrivateMetadataParsedOrCopied=False,verifiedRowsDigest=hashlib.sha256(json.dumps(verified,sort_keys=True,separators=(',',':')).encode()).hexdigest())

assert digest(A/'ORCHESTRATION-SHA256SUMS.json')=='9191b7fd92cb9f986e9787500b0421ac12dcf0698f0271be2d2d89b11539db01'
seals=[verify_seal(A,A/'qa/SHA256SUMS.json','qa'),verify_seal(A,A/'ORCHESTRATION-SHA256SUMS.json','orchestration'),verify_seal(C,C/'SHA256SUMS.json','controller')]
put('seal-verification.json',seals)

events=[json.loads(line) for line in (A/'provider/events.jsonl').read_text(encoding='utf8').splitlines() if line.strip()]
results=[v for v in events if v.get('type')=='result'];assert len(results)==1
terminal=read('provider/result.json');assert results[0]==terminal
assert terminal['is_error'] is False and terminal['terminal_reason']=='completed' and terminal['subtype']=='success'
assert terminal['num_turns']==75 and abs(terminal['total_cost_usd']-5.2079258)<1e-10
assert set(terminal['modelUsage'])=={'claude-opus-5-5'}
models={v['message']['model'] for v in events if v.get('type')=='assistant' and v.get('message',{}).get('model')!='<synthetic>'}
assert models=={'claude-opus-5-5'}
assert (A/'provider/provider-final-message.md').read_bytes()==terminal['result'].encode('utf8')
launch=read('provider/launch.json');ex=read('provider/exit.json');dx=read('dispatch-exit.json');orch=read('ORCHESTRATION-READBACK.json')
assert launch['model']=='claude-opus-5-5' and launch['effort']=='xhigh'
assert ex['code']==ex['runnerExitCode']==dx['code']==orch['wrapperExit']==0
assert ex['outputIntegrity']=='NO_EXACT_KEY_MATCH' and ex['acceptanceBlocked'] is False and ex['requiresOwnedControllerCleanup'] is False
assert dx['abort'] is None and dx['acceptanceBlocked'] is False and dx['ownedTreeTerminationRequested'] is False
assert dx['exactKeyOccurrencesWithheldByController']==0 and dx['runnerClosureConfirmed'] and dx['stdoutAndStderrClosed']
assert dx['providerInvocations']==orch['providerInvocations']==1
assert orch['status']=='ACTUAL_QA_REPORT_PENDING_ROOT_REVIEW' and orch['sourceAfterVerified'] and not orch['errors'] and not orch['timedOutAndOwnedTreeTerminated']
assert not any('secret-output-refusal' in r['path'] or 'taskkill' in r['path'] for r in json.loads((A/'ORCHESTRATION-SHA256SUMS.json').read_bytes())['files'])
put('provider-verification.json',dict(terminalCount=1,assistantModels=sorted(models),modelUsageModels=sorted(terminal['modelUsage']),requestedEffort=launch['effort'],terminalReason=terminal['terminal_reason'],isError=False,allExitCodes=0,turns=75,reportedEstimatedCostUsd=terminal['total_cost_usd'],actualBillingUnknown=True,noCutoffTimeoutOrSecretRefusal=True,report=ref(A/'REPORT.md'),finalMessage=ref(A/'provider/provider-final-message.md'),result=ref(A/'provider/result.json'),events=ref(A/'provider/events.jsonl'),scope='Actual provider identity and requested effort/terminal records; no account billing inference.'))

b=read('source-binding.json');pre=read('qa/raw/00-preflight.json');after=read('qa/raw/50-after.json')
state=b['sourceBeforeQA']
assert (state['head'],state['tree'],state['parent'],state['status'])==(HEAD,TREE,PARENT,'')
assert pre['sourceBefore']==after['sourceAfter']==orch['sourceReadback']['source']==state
assert all(pre['sourceBeforeMatchesBinding'].values()) and all(after['sourceAfterMatchesBinding'].values())
assert after['dependencyMetadata']==b['dependencyMetadata'] and after['dependencyMetadataMatchesBinding']
assert (A/'orchestration-source-after/status.stdout').read_bytes()==b''
assert digest(A/'orchestration-source-after/tracked-index.stdout')==state['trackedIndexSha256']
tracked=(A/'orchestration-source-after/tracked-index.stdout').read_bytes().split(b'\0')
assert all(not row or row.split(b'\t',1)[0].endswith(b' 0') for row in tracked)
assert not after['checkoutRelativeLeftovers'] and not after['cParentEntriesMatchingPrefix']
baseline=(A/'baseline-fs.test.ts').read_bytes();candidate=(A/'candidate-fs.test.ts').read_bytes()
assert hashlib.sha256(baseline).hexdigest()==b['baselineFixture']['sha256'] and hashlib.sha256(candidate).hexdigest()==b['correctedFixture']['sha256']==state['fixture']['sha256']
blob=lambda raw:hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
assert blob(baseline)==pre['fixtures']['blobIds']['baselineGitBlob'] and blob(candidate)==pre['fixtures']['blobIds']['candidateGitBlob']
old=baseline.decode('utf8');new=candidate.decode('utf8')
for source,target in [('realpathSync(dataDir)','realpathSync.native(dataDir)'),('realpathSync(path)','realpathSync.native(path)')]:
    assert old.count(source)==1 and new.count(target)==1;old=old.replace(source,target)
assert ''.join(old.split())==''.join(new.split())
assert pre['productionIdentity']['entriesDifferingFromBase']==['packages/infrastructure/src/fs/fs.test.ts']
assert pre['productionIdentity']['lsTreeEntriesBase']==pre['productionIdentity']['lsTreeEntriesHead']==38434
put('source-verification.json',dict(head=HEAD,tree=TREE,parent=PARENT,archivedBeforeAndAfterExact=True,statusEmpty=True,index=state['index'],trackedIndexSha256=state['trackedIndexSha256'],allArchivedIndexStagesZero=True,fixture=state['fixture'],lock=state['lock'],dependencyMetadata=after['dependencyMetadata'],twoSiteRewriteOnlyIgnoringWhitespace=True,allOtherParentEntriesReportedIdentical=True,sourceOrGitCommandsRunByVerifier=False,qualification='Archived post-run/source evidence compared; live checkout not probed.'))

r=read('qa/RESULTS.json');assert (r['head'],r['tree'],r['parent'])==(HEAD,TREE,PARENT)
for flag in ['allScenariosMatchExpectation','allWorkersRanIntendedFixture','allSwapsRestored','allPostStatesClean','noWatcherErrors']:assert r[flag] is True,flag
expected={'s1a':(1,0,1,19),'s1b':(1,1,0,19),'s2a':(3,0,3,17),'s2b':(3,3,0,17),'s2c':(3,3,0,17),'s3':(20,20,0,0),'s4':(3,3,0,17),'s5a':(1,1,0,19),'s5b':(1,1,0,19)}
assert len(r['scenarios'])==9
assert len(list((A/'qa/raw').glob('s*.invocation.json')))==9
matrix=[]
for s in r['scenarios']:
    id=s['id'];key=id.split('-')[0];exp=expected[key]
    inv=read('qa/raw/'+id+'.invocation.json');vit=read('qa/raw/'+id+'.vitest.json');pp=read('qa/raw/'+id+'.prepost.json')
    observed=(vit['numPassedTests']+vit['numFailedTests'],vit['numPassedTests'],vit['numFailedTests'],vit['numPendingTests'])
    assert observed==exp and vit['numTotalTests']==20 and vit['numTodoTests']==0
    assert inv['exitCode']==int(key in ['s1a','s2a'])==s['exitCode'] and not inv['timedOut'] and inv['spawnError'] is None and inv['signal'] is None
    assert s['matchesExpectation'] and not s['watcherErrors'] and not s['checkoutLeftoversAfter'] and s['statusAfter']==''
    for phase in ['pre','post']:
        assert pp[phase]['status']=='' and pp[phase]['fixture']['sha256']==state['fixture']['sha256'] and not pp[phase]['checkoutRelativeLeftovers']
    raw=[json.loads(line) for line in (A/('qa/raw/'+id+'.child.jsonl')).read_text(encoding='utf8').splitlines() if line.strip()]
    workers=[v for v in raw if v.get('kind')=='process' and v.get('isForkWorker')]
    assert len(workers)==1
    worker=workers[0];intended=b['baselineFixture']['sha256'] if key in ['s1a','s2a'] else b['correctedFixture']['sha256']
    assert worker['fixtureSha256AtStart']==intended and worker['version']=='v22.23.4'
    assert worker['tapsInstalled']==(key in ['s2c','s4','s5a','s5b'])
    if key in ['s1a','s2a']:
        swap=read('qa/raw/'+id+'.swap.json')
        assert swap['swapped']['sha256']==b['baselineFixture']['sha256'] and swap['restored']['sha256']==state['fixture']['sha256'] and swap['statusAfterRestore']==''
        failed=[a for t in vit['testResults'] for a in t['assertionResults'] if a['status']=='failed'];assert len(failed)==exp[2]
        for f in failed:
            messages='\n'.join(f['failureMessages'])
            assert 'fs.test.ts:143:' in messages or 'fs.test.ts:147:' in messages
        stderr=(A/('qa/raw/'+id+'.stderr.txt')).read_text(encoding='utf8')
        assert 'Expected:' in stderr or 'AssertionError' in stderr
    matrix.append(dict(id=key,fixture='6de-negative-byte-swap' if key in ['s1a','s2a'] else 'e630',executed=observed[0],passed=observed[1],failed=observed[2],filtered=observed[3],exit=inv['exitCode'],instrumentation=s['instrumentation'],intendedWorkerFixtureVerified=True))
assert not r['runnerEvents']['phaseErrors'] and len(r['runnerEvents']['runnerShas'])==1
assert digest(A/'qa/tools/runner.mjs')==r['runnerEvents']['runnerShas'][0]
assert digest(A/'qa/tools/child-observer.cjs')==after['observer']['sha256']=='62a5a655b8e1ef75d6ca60eeede029c20c3a45bd77376c0cfa0127d8da73814d'
put('invocation-matrix.json',dict(nineVitestInvocations=matrix,countsArePerInvocationNotSummedAcrossHeadsOrEnvironments=True,additionalProbeInvocations=4,noTimeoutsOrWatcherErrors=True,singleRunnerRevision=True,originalToolWriteFailuresRemainInOriginalReportAndProviderRecord=True))

cs=read('qa/raw/20-c-setup.json');short=cs['shortNameProbe']['cShort'];p2=read('qa/raw/p2-c-short-temp-resolver-probe.stdout.json')
assert short['available'] and re.search(r'~\d',short['shortSpelling'])
assert short['identityShortFollowed']==short['identityLong'] and short['sameDevIno'] and short['shortIsNotReparsePoint'] and short['nativeOfShortEqualsLong'] and short['markerReadViaShort'] and short['markerRemoved']
assert p2['nodeOptionsPresent'] is False and p2['inputRecord']['nativeEqualsPromises'] and p2['inputRecord']['inputAndNativeSameDevIno']
assert p2['inputRecord']['followedIdentity']['ok']==p2['inputRecord']['nativeTargetIdentity']['ok']
assert p2['childRemoved'] and p2['childRemovedViaNativeSpellingAlsoAbsent']
assert cs['volumes']['cDev']!=cs['volumes']['gDev']
fx=read('qa/raw/01-fixtures.json');cc=read('qa/raw/29-c-cleanup.json');gc=read('qa/raw/40-cleanup.json')
assert fx['upper']['sameDevInoAndNotLink'] and fx['junction']['reparsePointIdentityDiffers'] and fx['junction']['followedIdentityMatchesTarget']
for key in ['cLong','cAliasLong','croot']:assert cc[key]['identityMatches'] and cc[key]['listingBeforeRemoval']==[] and cc[key]['existsAfter'] is False
assert cc['shortSpellingExistsAfter'] is False and cc['cParentEntriesMatchingPrefix']==[]
assert gc['junction']['matchesRecorded'] and gc['junction']['targetMatches'] and gc['junction']['existsAfter'] is False and gc['junction']['physicalStillPresentAfterUnlink'] is True
for key in ['physical','upper','ordinary','root']:assert gc[key]['identityMatches'] and gc[key]['listingBeforeRemoval']==[] and gc[key]['existsAfter'] is False
assert gc['scratchListingAfter']==['node-compile-cache','npm-cache','process-temp']
for s in r['scenarios']:
    if s['id'].startswith(('s5a-','s5b-')):assert s['worker']['cwdDev']==cs['volumes']['gDev'] and s['worker']['tmpdirDev']==cs['volumes']['cDev']
put('native-artifact-consistency.json',dict(genuineCShortAliasObserved=True,shortAndLongPhysicalIdentityEqual=True,shortComponents=len(short['componentsShortened']),preexistingQaParentShortComponentQualified=True,shortNamePolicyReadAccessDeniedRetained=True,uninstrumentedNativeEqualsPromises=True,uppercaseAndJunctionIdentityRecordsConsistent=True,workerCrossDriveObserved=True,recordedIdentityCheckedEmptyNonrecursiveCleanup=True,recordedCheckoutAndOwnedPrefixLeftoversEmpty=True,liveFilesOrVolumesNotProbed=True,limits=['Controlled QA fixtures, not owner incident','6de negatives are one-file swaps, not pristine checkout','Journal/claims/cache/cwd equality in positive tests remain test assertions','One Windows host; no G short-name policy or Linux/Mac coverage','C free-space delta not attributed to QA; tool-output spill on C not independently excluded']))

# Re-read only manifest bytes to close the immutable-input receipt. No private
# controller member is decoded or copied, and no source/process/account queried.
for v in seals:assert ref(v['manifest']['source'])==v['manifest']
put('readiness.json',dict(status='BOUNDED_ACTUAL_EVIDENCE_VERIFIED_NO_MERGE_ADMISSION',atUTC=datetime.datetime.now(datetime.timezone.utc).isoformat(),seals=seals,report=ref(A/'REPORT.md'),terminalCount=1,actualModel='claude-opus-5-5',requestedEffort='xhigh',turns=75,reportedEstimatedCostUsd=terminal['total_cost_usd'],actualBillingUnknown=True,allNineInvocationExpectationsAndRestorationConsistent=True,actualTestsRerun=0,actualPrivateCredentialOrConfigContentsRead=False,controllerMetadataHashOnly=True,sourceGitAccountOrCurrentProcessActions=0,rootSemanticAdmissionAndFinalGatesRemainSeparate=True))
print(json.dumps(dict(report=ref(A/'REPORT.md'),seals=[dict(members=v['membersVerified'],sha256=v['manifest']['sha256']) for v in seals],terminalCount=1,reportedEstimatedCostUsd=terminal['total_cost_usd'],actualBillingUnknown=True)))
