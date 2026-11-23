from pathlib import Path
import json, hashlib, shutil, re, datetime, collections
E=Path(r'G:\ggq\delivery-evidence\2026-11-17-five-intents')
OUT=E/'i5-386-385-corrective-history-stage-06'
PREFIX='docs/qa/2026-11-22-i5-inspector-truthfulness'
META='assembly-provenance/layers/corrective-history-stage-06'
UTC=datetime.datetime.now(datetime.timezone.utc).isoformat()

def load(p): return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):
    b=Path(p).read_bytes(); return {'source':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def emit(name,data):
    p=OUT/name
    if p.exists(): raise RuntimeError('Refusing overwrite '+str(p))
    p.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
def safe(p):
    q=str(p).lower().replace('\\','/')
    if not q.startswith(str(E).lower().replace('\\','/')+'/'): raise RuntimeError('Outside evidence '+q)
    if any(x in q for x in ['/node_modules/','/metadata-config/','/metadata-temp/','private-','keydownload','master.before','auth-status','secure-credential','managed-policy','/result.json','/events.jsonl','.md.before','/i5-d228-claude-repair-01/','/i5-d228-repair-controller-01/']): raise RuntimeError('Forbidden '+q)
    return p
prior4=E/'i5-386-385-archive-preparation-04/merged-copy-proposal.json'
prior5=E/'i5-386-385-corrective-history-stage-05/layer-manifest-05.json'
prior5manifest=E/'i5-386-385-corrective-history-stage-05/MANIFEST.sha256.json'
prior5seal=E/'i5-386-385-corrective-history-stage-05/SEAL.json'
assert sha(prior5manifest)['sha256']=='a736849e70058d40d8a0228627984f61f03a48cc156d1309ad4827679be28d88'
assert sha(prior5seal)['sha256']=='d420be6126578f0757785e775f63549416aeed7ab03b084b6ccee1d4f8423870'
prior_receipts=[sha(p) for p in [prior4,prior5,prior5manifest,prior5seal]]
prior=load(prior4)['files']+load(prior5)['files']
assert len(prior)==355
known={}
for row in prior:
    key=(row['bytes'],row['sha256'])
    known.setdefault(key,{**row,'layer':'01-04' if row in load(prior4)['files'] else '05'})
selected=[]; aliases=[]; physical=[]

def add(rel,category,dedup=False):
    p=safe(E/rel); d=sha(p); key=(d['bytes'],d['sha256'])
    if dedup and key in known:
        target=known[key]; t=Path(target.get('stagePath',target['source']))
        if target.get('layer')=='05':
            t=E/'i5-386-385-corrective-history-stage-05'/target['archivePath']
        safe(t); actual=sha(t)
        assert (actual['bytes'],actual['sha256'])==key, str(t)
        a={'sourceIdentity':d,'logicalArchivePath':rel,'category':category,'resolution':'BYTE_IDENTICAL_ALIAS_NOT_PHYSICALLY_COPIED_AT_LOGICAL_PATH','targetArchivePath':target['archivePath'],'targetRepositoryRelativeCitation':PREFIX+'/'+target['archivePath'],'verifiedTarget':actual,'targetLayer':target['layer']}
        aliases.append(a); selected.append({'kind':'alias',**a}); return
    dest=OUT/rel
    assert not dest.exists(),str(dest)
    dest.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(p,dest)
    copied=sha(dest); assert copied['bytes']==d['bytes'] and copied['sha256']==d['sha256']
    row={**d,'archivePath':rel,'category':category,'stagePath':str(dest),'repositoryRelativeCitation':PREFIX+'/'+rel}
    physical.append(row); selected.append({'kind':'physical',**row})
    known.setdefault(key,{**row,'layer':'06'})

def roots(folder,names,category,dedup=False):
    for n in names.split(): add(folder+'/'+n,category,dedup)
def tree(folder,category,dedup=False):
    for p in sorted((E/folder).rglob('*')):
        if p.is_file(): add(p.relative_to(E).as_posix(),category,dedup)

roots('i5-d226-completion-preservation-01','cost-and-closure.json selected-provider-provenance.json source-preservation.json','D226 failed terminal and cost closure')
tree('i5-d226-completion-preservation-01/original-author-source','D226 five emitted production originals',True)
roots('i5-d226-partial-production-freeze-01','commit.log.txt source.json','D226 unaccepted partial production freeze')
roots('i5-d227-supporting-implementation-01','ARTIFACT-SEAL.json focused-tests.json focused-tests.log.txt HANDOFF.md preservation-verification.json query-fixture-corrected-tests.json query-fixture-corrected-tests.log.txt seal-attempt-01.log.txt source-before-after-manifest.json source-before.json supporting.diff validation.json web-typecheck.log.txt','D227 exact supporting source and scoped validation')
tree('i5-d227-supporting-implementation-01/original-source','D227 original nine supporting files',True)
tree('i5-d227-supporting-implementation-01/final-source','D227 final nine supporting files',True)
tree('i5-d227-supporting-implementation-01/failed-fixture-source','D227 original failed fixture',True)
roots('i5-d227-stable-candidate-01','CANDIDATE.json comment-only-proof.json commit.log.txt','D227 stable candidate frozen identity')
add('i5-d227-stable-candidate-01/supporting-exact-delta.patch','D227 canonical support delta alias',True)
tree('i5-d227-stable-candidate-01/source','D227 stable 22-member source inventory',True)
roots('i5-d227-review-closure-01','cost-and-closure.json root-disposition.json selected-provider-provenance.json','D227 actual failed critic public receipts only')
Q='i5-386-corrective-final-qa-01/stable-candidate-01'
roots(Q,'README.md partial-results-and-frozen-source.json component-command-result.json component-summary.json components.json components.log.txt types-lint-command-result.json types-lint.log.txt build-command-result.json build.log.txt build-artifacts.json source-parity-after-build.json source-parity-after-components-types-lint.json apply-source-parity.json held-projection-browser-command-result.json held-projection-browser.json held-projection-browser.log.txt original-claude-browser-command-result.json original-claude-browser.json original-claude-browser.log.txt original-claude-browser-selected-command-result.json original-claude-browser-selected.json original-claude-browser-selected.log.txt failed-independent-cleanup-timeline.json failed-independent-route-trace-events.json browser-ports-after-partial-closure.json run-build.ps1 run-components.ps1 run-types-lint.ps1 run-held-projection-browser.ps1 run-original-claude-browser.ps1 run-original-claude-browser-selected.ps1','Stable QA bounded observations and original failures')
roots(Q,'CANDIDATE.json root-comment-only-proof.json','Stable QA candidate identities',True)
tree(Q+'/candidate-source','Stable QA verified 22-member candidate aliases',True)
tree(Q+'/qa-overlay','Stable QA exact executed fixture source',True)
tree(Q+'/independent-browser-closure-01','Unexecuted browser fixture correction and proof',True)
add(Q+'/output/playwright/independent/S1-S2-schedule.json','Failed independent browser completed schedule')
add(Q+'/output/playwright/held-and-projection/inspector-final-independen-37cdb-released-before-observation-chromium/error-context.md','Original browser failure context')
R='i5-386-gpt-repair-review-02'
review=load(E/R/'SHA256-MANIFEST.json')
assert len(review['members'])==13
for member in review['members']:
    d=sha(E/R/member['path']); assert d['bytes']==member['bytes'] and d['sha256']==member['sha256']
    add(R+'/'+member['path'],'Review 2 sealed negative product review')
roots(R,'SHA256-MANIFEST.json SEAL.json','Review 2 exact original manifest and seal')
roots('i5-d227-finalization-admission-01','decision-227.md receipt.json','Canonical public D227 delegated decision')
roots('i5-d228-repair-admission-01','decision-228.md receipt.json','Canonical public D228 decision and pending admission')
roots('i5-d228-root-materials-01','old-generation-401-disposition.json old-generation-401-witness.json','Closed old-generation 401 diagnostic')
for name in ['d228-old-generation-401-witness.ts','d228-old-generation-401-witness-original.mts','d228-old-generation-401-witness.mts']:
    add(name,'Closed 401 diagnostic exact invocation source')

# Verify all source identities again; closed originals only, no live checkout/provider reads.
for row in physical:
    d=sha(safe(Path(row['source']))); assert d['bytes']==row['bytes'] and d['sha256']==row['sha256']
for alias in aliases:
    d=sha(safe(Path(alias['sourceIdentity']['source']))); assert d['bytes']==alias['sourceIdentity']['bytes'] and d['sha256']==alias['sourceIdentity']['sha256']
for expected in prior_receipts: assert sha(Path(expected['source']))==expected

# Structured embedded descriptors are resolved by exact size/hash, never by opening their local locators.
refs=[]
def inspect(obj,origin,jpath='$'):
    if isinstance(obj,dict):
        loc=next((obj[k] for k in ['source','file','path'] if isinstance(obj.get(k),str) and re.match(r'^[A-Za-z]:[/\\]',obj[k])),None)
        h=obj.get('sha256'); n=obj.get('bytes')
        if loc and isinstance(h,str) and isinstance(n,int):
            target=known.get((n,h)); row={'selectedRecord':origin,'jsonPath':jpath,'originalDescriptor':{'source':loc,'bytes':n,'sha256':h}}
            if target:
                row.update(resolution='PUBLIC_COPY_INDEXED_BY_EXACT_BYTES',archivePath=target['archivePath'],repositoryRelativeCitation=PREFIX+'/'+target['archivePath'],targetLayer=target['layer'])
            else: row.update(resolution='LOCAL_ONLY_UNSELECTED_OR_UNPUBLISHED_REFERENCE',verification='Locator and supplied descriptor preserved; referenced bytes not opened for this layer')
            refs.append(row)
        for k,v in obj.items(): inspect(v,origin,jpath+'.'+k)
    elif isinstance(obj,list):
        for i,v in enumerate(obj): inspect(v,origin,jpath+'['+str(i)+']')
for row in physical:
    if row['archivePath'].endswith('.json'):
        try: inspect(load(OUT/row['archivePath']),row['archivePath'])
        except json.JSONDecodeError: pass

# Verify original support seal through physical copies and explicit aliases, retaining its original layout identities.
resolution={row['archivePath']:row for row in physical}
resolution.update({a['logicalArchivePath']:{'bytes':a['sourceIdentity']['bytes'],'sha256':a['sourceIdentity']['sha256']} for a in aliases})
for mem in load(E/'i5-d227-supporting-implementation-01/ARTIFACT-SEAL.json')['files']:
    item=resolution['i5-d227-supporting-implementation-01/'+mem['path']]
    assert item['bytes']==mem['bytes'] and item['sha256']==mem['sha256']

candidate=load(E/'i5-d227-stable-candidate-01/CANDIDATE.json')
stable_aliases=[a for a in aliases if a['logicalArchivePath'].startswith('i5-d227-stable-candidate-01/source/')]
assert len(stable_aliases)==candidate['sourceCount']==22

# Pattern findings report only path/line/rule, never candidate values.
patterns={
 'live-key-shaped':re.compile(r'\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|\bsk-ant-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}'),
 'private-key-header':re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
 'long-bearer-literal':re.compile(r'Bearer\s+[A-Za-z0-9_.-]{25,}')}
findings=[]
for row in physical:
    for i,line in enumerate((OUT/row['archivePath']).read_text(encoding='utf-8',errors='replace').splitlines(),1):
        for rule,pattern in patterns.items():
            if pattern.search(line): findings.append({'archivePath':row['archivePath'],'line':i,'rule':rule})

emit('alias-inventory.json',{'status':'EXACT_BYTE_ALIASES_NOT_DUPLICATE_PHYSICAL_COPIES','archivePrefix':PREFIX,'count':len(aliases),'stableCandidateSourceMembers':22,'allStableCandidateMembersResolved':True,'aliases':aliases,'scope':'Every listed source identity and canonical target was hashed from closed evidence originals. No live checkout was opened.'})
emit('source-map.json',{'archivePrefix':PREFIX,'physicalSelectedRecords':physical,'descriptorReferences':refs,'unselectedLocalReferencePolicy':'Every absolute local path in any original receipt, log, script or source that is not resolved by this physical inventory or alias-inventory is LOCAL_ONLY. Relative links within original source packets also require that inventory; no existence, public availability or verification is implied for unselected files. Private/provider locators remain descriptors only; their contents were not opened.','structuredDescriptorReferenceCount':len(refs),'localOnlyStructuredDescriptors':sum(r['resolution'].startswith('LOCAL_ONLY') for r in refs),'aliasInventory':'alias-inventory.json'})
emit('layer-manifest-06.json',{'status':'PUBLIC_HISTORICAL_PROPOSAL_D228_ACTIVE_WORK_EXCLUDED_NO_ACCEPTANCE','archivePrefix':PREFIX,'files':physical,'count':len(physical),'bytes':sum(r['bytes'] for r in physical),'baselineOriginalCopyRows':355,'combinedProposedOriginalCopyRows':355+len(physical),'sourceAliasIdentities':len(aliases),'physicalStableCandidate22SnapshotClaim':False,'metadataArchivePrefix':META,'readmeRepositoryPath':PREFIX+'/README-layer-06.md','generatedMetadataRequiresFinalAssemblyManifest':True,'priorLayerIdentityChecks':prior_receipts,'repositoryProductGitIndexProviderMutations':False,'rootPrivacyAndPublicationAdmission':False,'finalAcceptance':False})
emit('verification.json',{'utc':UTC,'physicalOriginalCopiesExact':len(physical),'sourceAliasIdentitiesVerified':len(aliases),'stableCandidateMembersResolved':22,'supportOriginalSealMembersVerified':len(load(E/'i5-d227-supporting-implementation-01/ARTIFACT-SEAL.json')['files']),'review2OriginalManifestMembersVerified':13,'earlierManifestAndSealIdentitiesUnchanged':True,'selectedClosedOriginalsUnchangedAfterCopy':True,'boundedPatternRules':list(patterns),'boundedPatternFindings':findings,'privacyQualification':'Bounded selection and pattern inspection only; final privacy/publication admission remains root. No full privacy audit is claimed.','noTestsBuildBrowserProviderOrGitActions':True,'noActiveD228WorkerOutputsRead':True,'unselectedAndForbidden':['raw provider events/results/thinking','PRIVATE files and pins','credential/keyDownload/config/auth contents','master .before files','owner checkout/store','D228 active worker outputs','node_modules/temp/runtime and generated application bundles','whole helper mock archives','browser images/trace ZIPs']})
readme=f'''# Inspector correction history, layer 06

Closed public history only: D226 partial author output, D227 supporting work and failed critic, frozen independent QA, product Review 2, and the public D228 contract/admission. **The candidate remains UNACCEPTED.** D228 is currently running actual Opus 5.5/xhigh; its worker files and any future result are outside this snapshot. A later completion needs a new layer.

This proposal adds **{len(physical)} exact original-copy rows ({sum(r['bytes'] for r in physical):,} bytes)** to the unchanged 355-row layers 01–05, giving **{355+len(physical)} proposed original-copy rows**. It separately records **{len(aliases)} verified source identities as byte aliases**. Aliases are not additional physical copies. Nothing was assembled into the repository, staged, committed, published or accepted.

| Closed evidence | Exact meaning |
| --- | --- |
| [D226 source preservation](i5-d226-completion-preservation-01/source-preservation.json), [cost closure](i5-d226-completion-preservation-01/cost-and-closure.json), [selected provenance](i5-d226-completion-preservation-01/selected-provider-provenance.json), [partial freeze](i5-d226-partial-production-freeze-01/source.json) | Actual Opus 5.5/xhigh stopped with `error_max_budget_usd` after 26 requests. Five emitted production originals are preserved; `AUTHOR_OUTPUT_BLOCKED`, no completed author handoff and no acceptance remain. Local partial checkpoint `9a895ce`, tree `95432fa`, was unpublished. Reported estimate 1.0149768; aggregate 15.375814; residual 4.624186; reservation 1.50 released. |
| [D227 supporting handoff](i5-d227-supporting-implementation-01/HANDOFF.md), [validation](i5-d227-supporting-implementation-01/validation.json), [exact diff](i5-d227-supporting-implementation-01/supporting.diff), [original support seal](i5-d227-supporting-implementation-01/ARTIFACT-SEAL.json), [stable candidate](i5-d227-stable-candidate-01/CANDIDATE.json) | GPT authored exactly nine supporting test/docs/comment files. Before/final identities and the failed fixture are retained; unchanged production belongs to actual Claude. The first invocation **failed: 90/92 passed, 2 failed**. Corrected query fixture passed 37/37; the five unchanged test files passed 55/55 in the first invocation. **No single final 92-case rerun occurred.** Types/scoped lint/diff observations retain their stated limits. The handoff's missing `scoped-lint.log.txt` reference is LOCAL_ONLY, not silently supplied. |
| [D227 failed critic disposition](i5-d227-review-closure-01/root-disposition.json), [selected provenance](i5-d227-review-closure-01/selected-provider-provenance.json), [cost closure](i5-d227-review-closure-01/cost-and-closure.json) | Only these three public receipts are selected. Actual Opus made 14 Read calls, stopped `error_max_budget_usd`, and gave **no ordinary-text verdict**. INCOMPLETE_NO_ACCEPTANCE; source unchanged. Reported estimate 0.5868786; aggregate 15.9626926; residual 4.0373074; reservation 0.75 released. No provider streams/results are included. |
| [Stable QA README](i5-386-corrective-final-qa-01/stable-candidate-01/README.md), [component summary](i5-386-corrective-final-qa-01/stable-candidate-01/component-summary.json), [frozen status/source](i5-386-corrective-final-qa-01/stable-candidate-01/partial-results-and-frozen-source.json) | On `0f500bd`, tree `a915436`, 31/31 independent component cases passed, types/lint and build passed, and **5 of 6 distinct browser cases passed**. The first browser invocation remains **4 pass/1 failed**; its held-read case errored during teardown after assertions. An initial original-harness command selected zero tests; the corrected selection then passed 1/1. These observations do not accept the rejected candidate. |
| [Original browser failure log](i5-386-corrective-final-qa-01/stable-candidate-01/held-projection-browser.log.txt), [raw failure JSON](i5-386-corrective-final-qa-01/stable-candidate-01/held-projection-browser.json), [cleanup timeline](i5-386-corrective-final-qa-01/stable-candidate-01/failed-independent-cleanup-timeline.json), [prepared correction](i5-386-corrective-final-qa-01/stable-candidate-01/independent-browser-closure-01/fixture-correction-receipt.json) | `Route is already handled!` is preserved. Exact old/new fixture bytes, handler-drain-only diff and lint receipt are retained. **Corrected browser fixture UNEXECUTED.** HTTP response completion/rendered checks do not prove every overlapping response reached the query cache. No browser traces/images or generated bundles are selected. |
| [Review 2 report](i5-386-gpt-repair-review-02/README.md), [ledger](i5-386-gpt-repair-review-02/review-ledger.json), [13-member manifest](i5-386-gpt-repair-review-02/SHA256-MANIFEST.json), [seal](i5-386-gpt-repair-review-02/SEAL.json) | Exact sealed packet retained. **CHANGES_REQUIRED, scan 2/3**, three P2 FIX-IN-PR, none deferred: uncertified agreement suppresses terminal evidence; foreign run ID borrows same-position evidence; same-key recovery misses a quiet fresh run read. Three passing defect characterizations are **negative evidence**, not passing acceptance. The original Review 1 remains CHANGES_REQUIRED, scan 1/3. |
| [D227 decision](i5-d227-finalization-admission-01/decision-227.md), [D228 decision](i5-d228-repair-admission-01/decision-228.md), [pending D228 admission receipt](i5-d228-repair-admission-01/receipt.json) | Canonical delegated workflow decisions, not new personal owner sign-off. The receipt made no reservation/provider call and admits no future result. Production repair, visible opposing-family critique, independent affected QA, coverage/checks, final Astra MAX scan 3, current-head/target CI/native, signed merge and ordinary issue/owner gates remain separate. |
| [Closed old-generation 401 diagnostic](i5-d228-root-materials-01/old-generation-401-witness.json), [disposition](i5-d228-root-materials-01/old-generation-401-disposition.json) | Synthetic credentials, zero network requests: late old-generation 401 wrongly rejects recovered scope. Two preliminary source-invocation failures and the successful negative diagnostic remain distinct. All three exact invocation source files are selected. This extends the existing D228 R2-3 obligation; no new scan or acceptance. Brief locators remain LOCAL_ONLY. |

`layer-manifest-06.json` is the proposed physical-copy inventory; `alias-inventory.json` independently supplies every alias source, size/hash, canonical archive target and verified target identity. All 22 stable candidate members resolve to selected or earlier preserved originals; no new physical 22-file snapshot is claimed. The original D227 support seal verifies through that physical/alias inventory. Original seals are never rewritten to pretend an aliased path is materialized.

`source-map.json` resolves embedded structured descriptors by exact bytes. **Every other local absolute locator, unselected relative packet member, helper archive, unpublished source, provider or private reference remains LOCAL_ONLY.** Receipt text is preserved exactly; a reference does not publish its target. Earlier layer-05's two postformat test-file gaps now have exact retained D227 before-file identities, without rewriting that earlier limitation. Bare source/log paths retain their original historical context.

All originals were copied byte for byte. Original failed statuses, stale “pending/awaited” wording and later closures remain distinct. The bounded selection/pattern check in `verification.json` is not final privacy clearance. Root owns privacy admission, final assembly, publication and all product gates. No repository/product/Git/index/provider mutation, test execution or heavy work was performed.
'''
(OUT/'README.md').write_text(readme,encoding='utf-8')

# Seal every existing layer member except the manifest and seal themselves.
members=[]
for p in sorted(OUT.rglob('*')):
    if p.is_file() and p.relative_to(OUT).as_posix() not in ['MANIFEST.sha256.json','SEAL.json']:
        d=sha(p); members.append({'path':p.relative_to(OUT).as_posix(),'bytes':d['bytes'],'sha256':d['sha256']})
emit('MANIFEST.sha256.json',{'algorithm':'SHA-256','members':members})
emit('SEAL.json',{'sealedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'state':'SEALED_PUBLIC_HISTORICAL_PROPOSAL_NO_D228_RESULT_NO_ACCEPTANCE','manifest':sha(OUT/'MANIFEST.sha256.json'),'members':len(members),'originalCopyCount':len(physical),'originalCopyBytes':sum(r['bytes'] for r in physical),'aliasIdentities':len(aliases),'combinedProposalOriginalRows':355+len(physical),'layerManifest':sha(OUT/'layer-manifest-06.json'),'sourceMap':sha(OUT/'source-map.json'),'aliasInventory':sha(OUT/'alias-inventory.json'),'readme':sha(OUT/'README.md'),'rootPrivacyAndPublicationAdmission':False,'repositoryProductGitIndexProviderMutations':False})
print(json.dumps({'originals':len(physical),'bytes':sum(r['bytes'] for r in physical),'aliases':len(aliases),'combinedRows':355+len(physical),'structuredReferences':len(refs),'localOnlyStructured':sum(r['resolution'].startswith('LOCAL_ONLY') for r in refs),'patternFindings':findings,'manifest':sha(OUT/'MANIFEST.sha256.json'),'seal':sha(OUT/'SEAL.json')},indent=2))
