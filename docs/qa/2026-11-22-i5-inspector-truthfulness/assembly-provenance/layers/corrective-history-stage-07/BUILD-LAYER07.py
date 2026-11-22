from pathlib import Path
import json,hashlib,shutil,re,datetime,collections
E=Path(r'G:\ggq\delivery-evidence\2026-11-17-five-intents')
OUT=E/'i5-386-385-corrective-history-stage-07'
READER=E/'owner-decision-reader-supplement-229-01'
CANON=Path(r'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\decision-229.md')
PREFIX='docs/qa/2026-11-22-i5-inspector-truthfulness'
UTC=datetime.datetime.now(datetime.timezone.utc).isoformat()
def load(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def desc(p):
 b=Path(p).read_bytes();return {'source':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def emit(root,n,o):
 p=root/n;assert not p.exists(),str(p);p.write_text(json.dumps(o,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
def safe(p):
 q=str(p).lower().replace('\\','/')
 assert p==CANON or q.startswith(str(E).lower().replace('\\','/')+'/'),q
 assert not any(x in q for x in ['/node_modules/','/metadata-config/','/metadata-temp/','private-','keydownload','master.before','auth-status','secure-credential','managed-policy','/result.json','/events.jsonl','.md.before','/i5-d228-claude-repair-01/','/i5-d228-repair-controller-01/','/i5-d229-supporting-implementation-01/']),q
 return p
priorpaths=[E/'i5-386-385-archive-preparation-04/merged-copy-proposal.json',E/'i5-386-385-corrective-history-stage-05/layer-manifest-05.json',E/'i5-386-385-corrective-history-stage-06/layer-manifest-06.json']
known={};priorrows=0
for ix,p in enumerate(priorpaths):
 data=load(p)['files'];priorrows+=len(data)
 for r in data:
  t=Path(r.get('stagePath',r['source']))
  if ix==1:t=E/'i5-386-385-corrective-history-stage-05'/r['archivePath']
  known.setdefault((r['bytes'],r['sha256']),{**r,'layer':['01-04','05','06'][ix],'verifiedPath':str(t)})
assert priorrows==463
bindings=[desc(p) for p in priorpaths]
for p in [E/'i5-386-385-corrective-history-stage-05/MANIFEST.sha256.json',E/'i5-386-385-corrective-history-stage-05/SEAL.json',E/'i5-386-385-corrective-history-stage-06/MANIFEST.sha256.json',E/'i5-386-385-corrective-history-stage-06/SEAL.json',E/'owner-decision-reader-supplement-228-01/snapshot.json',E/'owner-decision-reader-supplement-228-01/SEAL.json',E/'owner-decision-reader-supplement-228-01/MANIFEST.sha256.json']:
 bindings.append(desc(p))
physical=[];aliases=[]
def addpath(p,rel,category,dedup=False):
 d=desc(safe(p));key=(d['bytes'],d['sha256'])
 if dedup and key in known:
  target=known[key];actual=desc(safe(Path(target['verifiedPath'])));assert (actual['bytes'],actual['sha256'])==key
  aliases.append({'sourceIdentity':d,'logicalArchivePath':rel,'category':category,'resolution':'BYTE_IDENTICAL_ALIAS_NOT_PHYSICALLY_COPIED_AT_LOGICAL_PATH','targetArchivePath':target['archivePath'],'targetRepositoryRelativeCitation':PREFIX+'/'+target['archivePath'],'verifiedTarget':actual,'targetLayer':target['layer']});return
 dest=OUT/rel;assert not dest.exists();dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);assert desc(dest)['sha256']==d['sha256']
 r={**d,'archivePath':rel,'stagePath':str(dest),'repositoryRelativeCitation':PREFIX+'/'+rel,'category':category};physical.append(r);known.setdefault(key,{**r,'layer':'07','verifiedPath':str(dest)})
def add(rel,cat,dedup=False):addpath(E/rel,rel,cat,dedup)
def roots(folder,names,cat,dedup=False):
 for n in names.split():add(folder+'/'+n,cat,dedup)
def tree(folder,cat):
 for p in sorted((E/folder).rglob('*')):
  if p.is_file():add(p.relative_to(E).as_posix(),cat,True)
P='i5-d228-repair-preservation-01'
roots(P,'selected-provider-provenance.json cost-and-closure.json source-preservation.json pre-edit-visible-message-01.md visible-message-chronology.json','Closed D228 actual author and negative critique provenance')
tree(P+'/original-author-source','D228 exact preformat emitted source')
C='i5-d228-partial-candidate-01'
roots(C,'CANDIDATE.json commit.log.txt partial-exact-delta.patch','D228 unaccepted partial candidate frozen identity')
tree(C+'/source','D228 frozen 23-member source inventory')
S='i5-d229-support-admission-01'
roots(S,'decision-229.md receipt.json support-critique-disposition.json','D229 public decision and negative-critique disposition')
assert CANON.read_bytes()==(E/S/'decision-229.md').read_bytes()
addpath(CANON,S+'/canonical-decision-229.md','Canonical D229 exact byte binding',True)
D='i5-386-corrective-final-qa-01/d228-diagnostic-01'
diag=load(E/D/'DIAGNOSTIC-SEAL.json')
assert diag['initialInvocation']=={'total':36,'passed':35,'failed':1,'retries':0}
assert diag['distinctCasesPassed']==36 and not diag['single36Green'] and not diag['finalAcceptance']
add(D+'/DIAGNOSTIC-SEAL.json','Original sealed diagnostic identity')
for m in diag['files']:
 p=safe(E/D/m['path']);z=desc(p);assert z['bytes']==m['bytes'] and z['sha256']==m['sha256']
 add(D+'/'+m['path'],'Diagnostic original sealed member',True)
# Complete original diagnostic seal resolution through copies and explicit aliases.
resolved={r['archivePath']:(r['bytes'],r['sha256']) for r in physical}
resolved.update({a['logicalArchivePath']:(a['sourceIdentity']['bytes'],a['sourceIdentity']['sha256']) for a in aliases})
for m in diag['files']:assert resolved[D+'/'+m['path']]==(m['bytes'],m['sha256'])
assert len([r for r in physical if r['archivePath'].startswith(C+'/source/')])+len([r for r in aliases if r['logicalArchivePath'].startswith(C+'/source/')])==23
for b in bindings:assert desc(Path(b['source']))==b
for r in physical:assert desc(safe(Path(r['source'])))['sha256']==r['sha256']
for a in aliases:assert desc(safe(Path(a['sourceIdentity']['source'])))['sha256']==a['sourceIdentity']['sha256']
refs=[]
def walk(o,origin,j='$'):
 if isinstance(o,dict):
  loc=next((o[k] for k in ['source','file','path'] if isinstance(o.get(k),str) and re.match(r'^[A-Za-z]:[/\\]',o[k])),None)
  if loc and isinstance(o.get('bytes'),int) and isinstance(o.get('sha256'),str):
   t=known.get((o['bytes'],o['sha256']));r={'selectedRecord':origin,'jsonPath':j,'originalDescriptor':{'source':loc,'bytes':o['bytes'],'sha256':o['sha256']}}
   if t:r.update(resolution='PUBLIC_COPY_INDEXED_BY_EXACT_BYTES',archivePath=t['archivePath'],repositoryRelativeCitation=PREFIX+'/'+t['archivePath'],targetLayer=t['layer'])
   else:r.update(resolution='LOCAL_ONLY_UNSELECTED_OR_UNPUBLISHED_REFERENCE',verification='Descriptor preserved; target bytes not opened for this layer')
   refs.append(r)
  for k,v in o.items():walk(v,origin,j+'.'+k)
 elif isinstance(o,list):
  for i,v in enumerate(o):walk(v,origin,j+'['+str(i)+']')
for r in physical:
 if r['archivePath'].endswith('.json'):walk(load(OUT/r['archivePath']),r['archivePath'])
policy='Any local absolute locator, unselected relative packet member or unpublished/private/provider reference outside this physical inventory and alias inventory is LOCAL_ONLY. Original references are not assertions of public availability. No descriptor was followed into a live checkout, provider packet, private configuration or master file.'
patterns={'key-shaped':re.compile(r'\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|\bsk-ant-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}'),'private-key-header':re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),'long-bearer':re.compile(r'Bearer\s+[A-Za-z0-9_.-]{25,}')}
findings=[]
for r in physical:
 for no,line in enumerate((OUT/r['archivePath']).read_text(encoding='utf-8',errors='replace').splitlines(),1):
  for rule,pat in patterns.items():
   if pat.search(line):findings.append({'archivePath':r['archivePath'],'line':no,'rule':rule})
emit(OUT,'alias-inventory.json',{'status':'EXACT_BYTE_ALIASES_NO_DUPLICATE_PHYSICAL_SOURCE_CLAIM','archivePrefix':PREFIX,'count':len(aliases),'partialCandidateSourceMembersResolved':23,'diagnosticOriginalMembersResolved':len(diag['files']),'aliases':aliases})
emit(OUT,'source-map.json',{'archivePrefix':PREFIX,'physicalSelectedRecords':physical,'descriptorReferences':refs,'localOnlyReferencePolicy':policy,'structuredDescriptorReferences':len(refs),'localOnlyStructuredDescriptors':sum(r['resolution'].startswith('LOCAL_ONLY') for r in refs),'canonicalD229':desc(CANON),'canonicalMatchesPublicMirror':True,'aliasInventory':'alias-inventory.json'})
emit(OUT,'layer-manifest-07.json',{'status':'CLOSED_D228_HISTORY_D229_DECISION_DIAGNOSTIC_PROPOSAL_UNACCEPTED','archivePrefix':PREFIX,'files':physical,'count':len(physical),'bytes':sum(r['bytes'] for r in physical),'baselineOriginalCopyRows':463,'combinedProposedOriginalCopyRows':463+len(physical),'aliasIdentities':len(aliases),'readmeRepositoryPath':PREFIX+'/README-layer-07.md','metadataArchivePrefix':'assembly-provenance/layers/corrective-history-stage-07','priorBindings':bindings,'noRepositoryProductGitIndexProviderChanges':True,'rootPrivacyAndPublicationAdmission':False,'finalAcceptance':False})
emit(OUT,'verification.json',{'utc':UTC,'exactOriginalCopies':len(physical),'aliasesVerified':len(aliases),'diagnosticSealOriginalMembersVerified':len(diag['files']),'diagnosticSealResolution':'Every original member is indexed physically or by explicit verified alias; the original seal was copied unchanged. Aliased original paths are not claimed as materialized.','canonicalD229MatchesMirror':True,'priorSelectedManifestSealAndReaderSnapshotIdentitiesUnchanged':True,'closedSourcesUnchangedAfterCopy':True,'patternFindings':findings,'patternRules':list(patterns),'privacyQualification':'Bounded pattern inspection only; final privacy/publication admission remains root.','forbiddenOrActiveSourcesOpened':False,'noLiveD229SupportingArtifactsRead':True,'noNewProductReviewOrTestBuildBrowserExecution':True})
readme=f'''# Inspector correction history, layer 07

This append-only proposal closes the earlier D228 RUNNING snapshot using closed public receipts. **Partial source remains UNACCEPTED.** No live D229 supporting implementation artifact is selected. Nothing was assembled into the repository, staged, committed, published or accepted; this is documentation preparation, not another product review.

The layer adds **{len(physical)} exact originals ({sum(r['bytes'] for r in physical):,} bytes)** after 463 original-copy rows in layers 01–06, for **{463+len(physical)} proposed original-copy rows**. **{len(aliases)} further identities are verified byte aliases**, not extra physical copies. The partial candidate's 23 source members and every one of the diagnostic seal's {len(diag['files'])} original members resolve through the physical/alias inventory.

| Closed evidence | Meaning and limits |
| --- | --- |
| [Visible pre-edit critique](i5-d228-repair-preservation-01/pre-edit-visible-message-01.md), [ordinary-text chronology](i5-d228-repair-preservation-01/visible-message-chronology.json), [root disposition](i5-d229-support-admission-01/support-critique-disposition.json) | Actual Opus 5.5/xhigh gave **CHANGES REQUIRED** at event 672 before first Edit at 673. Root accepts four FIX-IN-PR dispositions (selector expectation, foreign-ID cache assertion, active-node absence, docs); three bounded observations are accepted/no-change. This is a completed **negative supporting-review phase**, not implementation approval. The chronology's earlier PENDING_ROOT_READING text remains historical; D229 supplies the later disposition. |
| [Selected provider provenance](i5-d228-repair-preservation-01/selected-provider-provenance.json), [cost closure](i5-d228-repair-preservation-01/cost-and-closure.json), [source preservation](i5-d228-repair-preservation-01/source-preservation.json) | Later author terminal **error_max_budget_usd / AUTHOR_OUTPUT_BLOCKED**; no completed author handoff. Four production files and one selector unit original are retained before formatting. The run reported USD **3.3168466**, exceeding CLI estimate 2.75 by **0.5668466** and reservation 3.25 by **0.0668466**. Aggregate **19.2795392**, residual **0.7204608**; reservation released, owned processes closed. Invoice amount remains unknown. |
| [Frozen partial candidate](i5-d228-partial-candidate-01/CANDIDATE.json), [exact partial delta](i5-d228-partial-candidate-01/partial-exact-delta.patch) | Local unsigned `3168250`, tree `920a547`, parent `0f500bd`; 23 members. Original emitted and mechanically formatted identities remain separate. Tests/docs incomplete, source/QA unaccepted. No fabricated successful author terminal. |
| [D229 canonical-matched decision](i5-d229-support-admission-01/decision-229.md), [admission receipt](i5-d229-support-admission-01/receipt.json) | Canonical Q decision matches the preserved public mirror exactly. GPT is authorized only for bounded supporting tests/docs; no live supporting result is included. **No further API launch under D229** and no renewal of the USD20 aggregate. Remaining Claude obligations use the unchanged ordinary Max subscription after fixed **2026-11-23 01:00 America/Chicago**, epoch 1795417200. This is a delegated decision, not new personal owner sign-off. |
| [Sealed diagnostic](i5-386-corrective-final-qa-01/d228-diagnostic-01/DIAGNOSTIC-SEAL.json), [diagnostic README](i5-386-corrective-final-qa-01/d228-diagnostic-01/README.md), [case summary](i5-386-corrective-final-qa-01/d228-diagnostic-01/case-summary.json) | Initial invocation remains **FAILED: 35 passed / 1 failed / 36**, retries zero. Its R2-2 fixture failed before producing the intended foreign body. After D229-Q1, **one scoped case passed**, with four file cases unselected. **36 distinct desired-outcome cases have passing evidence across invocations; no single green 36-case run.** No browser/build/coverage/new scan occurred. |
| [Raw initial failed log](i5-386-corrective-final-qa-01/d228-diagnostic-01/components.log.txt), [raw failed JSON](i5-386-corrective-final-qa-01/d228-diagnostic-01/components.json), [schema cause](i5-386-corrective-final-qa-01/d228-diagnostic-01/r2-2-schema-cause.json), [raw cause log](i5-386-corrective-final-qa-01/d228-diagnostic-01/r2-2-schema-cause.log.txt) | Strict RunRecordSchema rejected legitimate GET detail field `recovery`; RunSnapshotSchema accepted the same synthetic body. Cause capture used no application/query/Vitest/network and was not a rerun of the desired behavior. Initial desired assertions were unreached. |
| [D229-Q1 correction receipt](i5-386-corrective-final-qa-01/d228-diagnostic-01/r2-2-schema-fixture-closure-01/fixture-correction-receipt.json), [exact two-identifier diff](i5-386-corrective-final-qa-01/d228-diagnostic-01/r2-2-schema-fixture-closure-01/exact-two-identifier-schema-fix.diff), [scoped pass log](i5-386-corrective-final-qa-01/d228-diagnostic-01/r2-2-schema-fixture-closure-01/component.log.txt), [scoped JSON](i5-386-corrective-final-qa-01/d228-diagnostic-01/r2-2-schema-fixture-closure-01/component.json) | Root approved only import/parse identifier RunRecordSchema → RunSnapshotSchema. Mutations, assertions, requests, timeouts and budgets stayed unchanged. Old/new fixture bytes and proof are indexed. The earlier PREPARED_ONLY receipt is preserved; later sealed execution establishes the one-case pass. Types/lint passed before correction; no broader repeat followed. |

`alias-inventory.json` supplies every source identity, exact target bytes/hash and public archive citation. `source-map.json` resolves embedded structured descriptors and qualifies every unindexed local/unpublished/private/provider locator **LOCAL_ONLY**. Raw provider streams/results/thinking, private pins/configuration/master-before files, live checkout/store and live D229 worker output were not opened or copied. The diagnostic is admitted solely through its original closed seal; all selected members were verified against it. Original seals, failed statuses and stale checkpoint wording remain unchanged.

The separately sealed `owner-decision-reader-supplement-229-01` closes the historical RUNNING statement and adds D229 after prior decisions, retaining approved D01–D03 first. Independent final affected QA (including all six browser criteria and the earlier teardown correction), relevant checks/coverage, actual-Claude review of the final GPT support delta, fresh Astra MAX final scan 3, current-head/current-target CI/native, signed merge and ordinary issue/owner gates remain pending. Reviews 1 and 2 both remain CHANGES_REQUIRED; the diagnostic consumes no general scan. No acceptance or delivered-issue claim follows from these component observations.
'''
(OUT/'README.md').write_text(readme,encoding='utf-8')
# Reader is a new append-only explanation; exact originals live in layer07 instead of duplicate reader copies.
reader_links={
 'priorSnapshot':'../owner-decision-reader-supplement-228-01/snapshot.json',
 'priorSupplement':'../owner-decision-reader-supplement-228-01/SUPPLEMENT.md',
 'decision':'../'+OUT.name+'/'+S+'/decision-229.md',
 'disposition':'../'+OUT.name+'/'+S+'/support-critique-disposition.json',
 'critique':'../'+OUT.name+'/'+P+'/pre-edit-visible-message-01.md',
 'cost':'../'+OUT.name+'/'+P+'/cost-and-closure.json',
 'candidate':'../'+OUT.name+'/'+C+'/CANDIDATE.json',
 'diagnostic':'../'+OUT.name+'/'+D+'/DIAGNOSTIC-SEAL.json',
 'diagnosticReadme':'../'+OUT.name+'/'+D+'/README.md',
 'initialFailure':'../'+OUT.name+'/'+D+'/components.json',
 'correction':'../'+OUT.name+'/'+D+'/r2-2-schema-fixture-closure-01/fixture-correction-receipt.json',
 'scopedPass':'../'+OUT.name+'/'+D+'/r2-2-schema-fixture-closure-01/component.json'}
supp=f'''# Owner decision reader: D228 closure and D229

This append-only supplement closes the [historical D228 RUNNING snapshot]({reader_links['priorSnapshot']}) in the [unchanged D227/D228 supplement]({reader_links['priorSupplement']}). It does not rewrite that snapshot or infer that it was wrong when captured. Add these outcomes and D229 after the earlier decisions in the eventual catalogue; **keep the owner's approved D01–D03 first**. D228/D229 are delegated workflow decisions, not new personal owner sign-off.

**Current disposition: partial candidate UNACCEPTED; final source/review/QA/gates remain pending.** The [23-member partial candidate]({reader_links['candidate']}) is `3168250645fe37bced7ace6a664c82fd137b1196`, tree `920a5471f4dc7c374cbfe724984bd7615da395d9`, parent `0f500bd`. No live D229 supporting implementation result is included here.

## D228: the running attempt closed with a real negative critique and a failed author terminal

Actual Claude Code Opus 5.5/xhigh delivered the visible [CHANGES REQUIRED critique]({reader_links['critique']}) at event 672 before the first Edit at 673. The [D229 root disposition]({reader_links['disposition']}) accepts four FIX-IN-PR obligations: event-qualified agreement and its selector expectation; rejection of a foreign run body before cache installation; stronger absence of active-node position text; and updated behavior docs. Three bounded test/comment observations were accepted or needed no change. That completed negative phase supplies the previously missing ordinary-text critique. It does **not** approve the supporting implementation, the later GPT corrections or the UI.

The subsequent actual author stopped `error_max_budget_usd` / `AUTHOR_OUTPUT_BLOCKED`; there is **no completed author handoff**. Four production originals and one selector-unit original were preserved before mechanical formatting. Useful partial source may receive a truthful integration handoff, never a fabricated successful author outcome.

The [closed cost receipt]({reader_links['cost']}) reports **USD3.3168466** for this actual run, against the **2.75 CLI estimate** and **3.25 reservation**. It exceeded the former by **0.5668466** and the latter by **0.0668466**. Those limits were estimates, not invoice guarantees; invoice amount is unknown. Aggregate reported estimate is **19.2795392** of the unchanged **20** cap, leaving **0.7204608**. Reservation released; owned runner/provider/controller absent at closure. The earlier snapshot's selected estimate and RUNNING status remain historical, with this closure appended after them.

## D229: finish bounded supporting work, keep actual Claude gates, launch no more API attempts

[Canonical-matched D229]({reader_links['decision']}) routes only easier supporting tests/docs to fast GPT while preserving actual Claude production authorship. The final exact GPT correction delta still needs actual Claude targeted opposing-family review. A negative pre-edit critique of its predecessor does not approve upcoming edits, and following the review's prose does not close unresolved findings by itself. Any newly diagnosed production defect remains an actual Claude implementation obligation.

**No further API call from the remaining 0.7204608 and no renewal of the USD20 aggregate.** Continue useful independent work now; remaining Claude work uses the unchanged ordinary Claude Code Max subscription after the fixed **2026-11-23 01:00 America/Chicago reset/cutoff**, epoch **1795417200**. The decision authorizes no replacement model, extra funding, retired-waiter restart or job-tracking automation.

Alternatives declined: hide the estimate/reservation overrun; spend the final residual on another fragile API continuation; renew aggregate funds; let GPT finish production UI; infer positive approval from the negative critique; manufacture a completed author handoff; suspend all independent work until reset; or weaken technical acceptance. The chosen split preserves model roles and finite gates while allowing supporting work to proceed. Global credential-panel query coordination remains subject to independent bounded request/auth checks.

## D229-Q1: preserve the failed 36-case invocation and qualify the scoped closure

The [sealed independent diagnostic]({reader_links['diagnostic']}) and [public explanation]({reader_links['diagnosticReadme']}) cover exact partial production bytes. Its initial once-only suite was **35 passed / 1 failed out of 36**, retries zero. The [original failed JSON]({reader_links['initialFailure']}) remains failed. R2-2's synthetic foreign-body path used strict RunRecordSchema on a legitimate GET detail envelope containing `recovery`, so it failed before returning the intended foreign body or reaching the desired assertions. Separate bounded cause capture showed RunSnapshotSchema accepts that body; this was a QA fixture error, not an established product defect.

Root's **D229-Q1** approval allowed exactly two identifier replacements: the import and parse use of RunRecordSchema became RunSnapshotSchema. [Original correction proof]({reader_links['correction']}) retains unchanged foreign mutation, assertions, requests, budgets and timeouts. The receipt's PREPARED_ONLY wording remains historical; the later seal and [raw scoped pass]({reader_links['scopedPass']}) establish execution. Only the formerly failed case ran once and passed; four other cases in its file were unselected. Therefore **36 distinct desired-outcome cases have passing evidence across invocations; there was no single green 36-case run**. Initial types/scoped lint passed before this exact QA correction, without a broader repeat afterward. No new browser/build/coverage or product scan was run by that diagnosis.

## What remains open

Supporting corrections and exact-source integration are unaccepted. Actual Claude targeted review of the final supporting delta, independent affected final QA including all six browser criteria and the earlier teardown correction, full relevant coverage/checks, fresh Astra MAX final scan 3 within the existing cap, current-head/current-target CI/native, signed merge and ordinary issue/owner gates remain open. Formal Reviews 1 and 2 both remain CHANGES_REQUIRED; this diagnostic consumes no new product scan. #416 then #420 remain ordered after this pair's engineering delivery. Component observations are distinct from owner acceptance and delivery.

This supplement uses closed public originals and verified canonical decision bytes. Layer07 retains exact originals plus explicit aliases to layers01–06; its source-map distinguishes unpublished/local-only references. No raw provider reasoning/results/streams, private configuration/pins, master-before files, live checkout, live D229 supporting artifacts or owner store were read. No repository, Git/index, provider, publication or product action was taken. Final privacy/assembly/publication admission remains root.
'''
(READER/'SUPPLEMENT.md').write_text(supp,encoding='utf-8')
inputs=[desc(CANON)]+[desc(E/x) for x in [P+'/selected-provider-provenance.json',P+'/cost-and-closure.json',P+'/source-preservation.json',P+'/pre-edit-visible-message-01.md',P+'/visible-message-chronology.json',C+'/CANDIDATE.json',S+'/decision-229.md',S+'/receipt.json',S+'/support-critique-disposition.json',D+'/DIAGNOSTIC-SEAL.json',D+'/case-summary.json',D+'/r2-2-schema-fixture-closure-01/fixture-correction-receipt.json',D+'/r2-2-schema-fixture-closure-01/component.json','owner-decision-reader-supplement-228-01/snapshot.json','owner-decision-reader-supplement-228-01/SEAL.json']]
emit(READER,'entries.json',{'appendAfter':228,'originalApprovedOrderMustRemainFirst':['D01','D02','D03'],'entries':[{'id':'D228-CLOSURE','kind':'CLOSURE_NOT_NEW_DECISION','outcome':'Pre-edit visible CHANGES REQUIRED critique completed; later author budget-stopped without completed handoff. Partial source unaccepted.','reportedRunEstimateUsd':3.3168466,'excessOverCliEstimateUsd':0.5668466,'excessOverReservationUsd':0.0668466,'aggregateReportedEstimateUsd':19.2795392,'remainingReportedEstimateAllowanceUsd':0.7204608,'ownerAcceptance':False},{'id':'D229','choice':'Bounded GPT supporting tests/docs; preserve actual Claude production authorship and final opposing-family correction review; no further API call.','why':'Continue useful work after budget-stopped author while retaining model roles, financial cap and technical gates.','outcome':'Decision admitted; no live D229 support result selected. Ordinary Max after fixed reset/cutoff1795417200.','alternativesDeclined':['Hide overrun','Spend small residual on another API attempt','Renew aggregate','Replace Claude production author with GPT','Infer positive review from negative critique','Fabricate completed handoff','Stop all independent work until reset','Loosen acceptance'],'ownerAcceptance':False},{'id':'D229-Q1','kind':'BOUNDED_QA_APPROVAL','choice':'Exactly two QA import/parse identifiers RunRecordSchema to RunSnapshotSchema; assertions and budgets unchanged.','outcome':'Initial35/36 invocation remains failed; one scoped pass supplies36 distinct passing criteria across invocations, not one green36 run.','newProductGeneralScan':False,'ownerAcceptance':False}],'noNewDecisionManufactured':True})
emit(READER,'input-hashes.json',{'capturedUtc':UTC,'closedPublicInputs':inputs,'priorReaderAndLayerBindings':bindings,'canonicalD229MatchesPublicMirror':True,'evidenceCopyPolicy':'No duplicate original copies here; exact originals and aliases are in layer07 and earlier layers. Relative links resolve in the evidence preparation tree. Final catalogue/assembly is root-owned.','layer07OriginalInventory':str(OUT/'layer-manifest-07.json'),'noTransitivePrivateOrLiveSourceReads':True})
links=re.findall(r'\]\(([^)]+)\)',supp);linkrows=[]
for x in links:
 p=(READER/x).resolve();assert p.is_file(),x;linkrows.append({'relativeCitation':x,'target':desc(p)})
emit(READER,'link-verification.json',{'relativeLinks':len(links),'allResolve':True,'links':linkrows})
(READER/'REPORT.md').write_text('Prepared an append-only D228 closure and D229/D229-Q1 owner-reader supplement from closed public evidence. The earlier RUNNING snapshot, failed author terminal, negative critique and initial diagnostic failure remain unchanged. Exact canonical D229 equals its public mirror. No live D229 implementation result or final acceptance is inferred. Keep approved D01-D03 first. Root owns final privacy, assembly and publication.\n',encoding='utf-8')

def seal(root,state,extra):
 members=[]
 for p in sorted(root.rglob('*')):
  if p.is_file() and p.relative_to(root).as_posix() not in ['MANIFEST.sha256.json','SEAL.json']:
   d=desc(p);members.append({'path':p.relative_to(root).as_posix(),'bytes':d['bytes'],'sha256':d['sha256']})
 emit(root,'MANIFEST.sha256.json',{'algorithm':'SHA-256','members':members})
 emit(root,'SEAL.json',{'sealedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'state':state,'manifest':desc(root/'MANIFEST.sha256.json'),'members':len(members),'rootPrivacyAndPublicationAdmission':False,'noRepositoryProductGitIndexProviderChanges':True,**extra})
 return {'manifest':desc(root/'MANIFEST.sha256.json'),'seal':desc(root/'SEAL.json'),'members':len(members)}
rs=seal(READER,'SEALED_APPEND_ONLY_D228_CLOSURE_D229_READER_NOT_ACCEPTANCE',{'canonicalD229Sha256':desc(CANON)['sha256'],'priorRunningSnapshotPreserved':True,'finalAcceptance':False})
ls=seal(OUT,'SEALED_CLOSED_D228_D229_HISTORICAL_PROPOSAL_NO_ACCEPTANCE',{'originalCopyCount':len(physical),'originalCopyBytes':sum(r['bytes'] for r in physical),'aliasIdentities':len(aliases),'combinedProposalOriginalRows':463+len(physical),'diagnosticSealMembersResolved':len(diag['files']),'ownerReaderSupplementSeal':desc(READER/'SEAL.json'),'finalAcceptance':False})
print(json.dumps({'layer07':ls,'reader229':rs,'originals':len(physical),'bytes':sum(r['bytes'] for r in physical),'aliases':len(aliases),'combinedOriginalCopyRows':463+len(physical),'diagnosticOriginalMembersResolved':len(diag['files']),'keyPatternFindings':findings},indent=2))
