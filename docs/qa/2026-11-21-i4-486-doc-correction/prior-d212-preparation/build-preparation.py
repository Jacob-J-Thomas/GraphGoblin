"""One-time metadata generation only; no model, product, CI, repository or candidate writes."""
from pathlib import Path
from hashlib import sha256
import ast,datetime,json,runpy,subprocess,sys

OUT=Path(__file__).resolve().parent
B=runpy.run_path(str(OUT/'bindings.py'))
globals().update({k:v for k,v in B.items() if not k.startswith('__')})
OLD=E/'i4-486-doc-correction-archive-preparation-01'
PARTIAL=E/'i4-553-partial-job-verification-01'
FAILURE=E/'i4-553-browser-failure-29e-01'

def key(path):return str(Path(path).resolve()).lower()

def main():
    before=source_state();old=read(OLD/'input-inventory.json')
    require(before==old['sourceSnapshot'],'Source/index differs from preserved preparation')
    require(not (REVIEW/'provider').exists(),'Actual review02 must not have been invoked during preparation')
    copies=[];copy_by_source={};aliases=[];originals={};roots=[]
    def original(p):
        item=record(p);originals[key(p)]=item;return item
    def add(p,dest):
        item=original(p)
        if key(p) in copy_by_source:
            canonical=copy_by_source[key(p)]['archivePath']
            if canonical!=dest:aliases.append({'requestedArchivePath':dest,'canonicalArchivePath':canonical,'source':item['source'],'sha256':item['sha256']})
            return canonical
        safe(dest);entry={**item,'archivePath':dest};copies.append(entry);copy_by_source[key(p)]=entry;return dest
    def full(root,prefix,complete=True):
        members=files(root)
        for p in members:add(p,prefix+'/'+p.relative_to(root).as_posix())
        if complete:roots.append({'source':str(root.resolve()),'relativeFiles':[p.relative_to(root).as_posix() for p in members]})
    for item in old['allExistingInputFiles']:
        verify(item);originals[key(item['source'])]={k:item[k] for k in ['source','bytes','sha256']}
    for item in old['proposedExactCopies']:add(item['source'],item['archivePath'])
    roots+=old['completeExistingRoots']
    full(OLD,'prior-preparation-01')
    full(E/'i4-486-d209-d211-fable-review-01','unused-review-01')
    require(not (E/'i4-486-d209-d211-fable-review-01/provider').exists(),'Review01 was never dispatched; unexpected provider exists')
    full(DIAG,'browser-static-diagnosis')
    full(READBACK,'browser-root-readback')
    full(CI,'failed-source-head-ci',False)
    full(NATIVE,'partial-native-artifact')
    full(PARTIAL,'partial-successful-jobs')
    for p in files(FAILURE):
        if p.name!='artifact.zip':add(p,'browser-failure-metadata/'+p.relative_to(FAILURE).as_posix())
    for p in Q.glob('decision-212*'):
        if p.is_file():add(p,'decisions/'+p.name)
    for p in [RUNNER,NODE,REVIEW/'BRIEF.md',REVIEW/'spec.json',OUT/'REVIEW-CONTEXT.json']:
        original(p)
    local=[]
    for item in old['localReferences']:
        verify(item);local.append(item);originals[key(item['source'])]={k:item[k] for k in ['source','bytes','sha256']}
    zip_ref=original(FAILURE/'artifact.zip')
    require(zip_ref['bytes']==51023578 and zip_ref['sha256']=='31b7a2e7ff0bbf766e49a95d19b85dedcd22a2be701be941cbb8aeb2e16a9853','Retained large browser artifact differs')
    local.append({**zip_ref,'resolution':'LOCAL_ONLY_NOT_COPIED','reason':'D202 redundant full browser artifact retained locally; complete selected diagnostic extraction is copied with its seal','artifactId':14720031919,'publicVerificationLimit':'Public archive cannot verify the complete original 51 MB ZIP without this exact local original or GitHub artifact; selected extraction is independently sealed'})
    inventory={'status':'INCOMPLETE_PREPARATION_ONLY','authority':'D212','sourceSnapshot':before,'proposedExactCopies':copies,'aliases':aliases,'localReferences':local,'allExistingInputFiles':list(originals.values()),'completeExistingRoots':roots,'futureReviewRoot':str(REVIEW),'futureDiagnosticRootNotRead':str(E/'i4-553-browser-reproduction-01'),'futureReviewAndDiagnosticDataPreapproved':False}
    write_new(OUT/'input-inventory.json',inventory)
    bound=evidence_bindings(inventory)
    partial_seal=PARTIAL/'SHA256SUMS.json'
    require(record(partial_seal)['sha256']=='4c26fd8d29f053b4efad2e859e4378d56119c1e1b078d802f67302379bfe4a9a','Partial verification seal differs')
    partial_members=read(partial_seal)['files'];require(len(partial_members)==41,'Partial verification member count differs')
    for item in partial_members:
        actual=record(item['path']);require(actual['bytes']==item['bytes'] and actual['sha256']==item['sha256'],'Partial verification member differs')
    old_metadata_seal=OLD/'PREPARATION-METADATA-SHA256.json'
    for item in read(old_metadata_seal)['files']:
        actual=record(OLD/item['path']);require(actual['bytes']==item['bytes'] and actual['sha256']==item['sha256'],'Preserved preparation metadata changed')
    resolution={'meaning':'Exact original seals remain unchanged; canonical paths and explicit aliases resolve every selected member, including absolute-path historical manifests. Local-only raw references are disclosed separately.','inheritedSealGroups':read(OLD/'seal-and-reference-resolution.json')['seals'],'additionalSeals':[],'aliases':aliases,'localOnly':local}
    def seal_group(root,seal,key_,absolute=False):
        members=[]
        for item in read(root/seal)[key_]:
            source=Path(item['path']) if absolute else root/item['path'];canonical=copy_by_source.get(key(source))
            require(canonical is not None,'Seal member has no physical archive resolution: '+str(source))
            members.append({'originalManifestPath':item['path'],'canonicalArchivePath':canonical['archivePath'],'sha256':item['sha256'],'bytes':item['bytes']})
        resolution['additionalSeals'].append({'manifest':record(root/seal),'archivePath':copy_by_source[key(root/seal)]['archivePath'],'originalMemberRoot':str(root),'members':members,'completePhysicalMembershipThroughCanonicalPathsAndAliases':True})
    seal_group(DIAG,'SHA256SUMS.json','members')
    seal_group(PARTIAL,'SHA256SUMS.json','files',True)
    seal_group(OLD,'PREPARATION-METADATA-SHA256.json','files')
    write_new(OUT/'seal-and-reference-resolution.json',resolution)
    images=[{**x,'context':'Exact image selected by the sealed static Browser diagnosis; content requires root contextual privacy admission; no new visual QA performed'} for x in copies if Path(x['source']).suffix.lower() in ['.png','.jpg','.jpeg','.webp','.gif']]
    hits=scan(copies)
    privacy={'status':'ROOT_EXACT_DYNAMIC_SELECTION_AND_CONTEXT_REVIEW_PENDING','existingCopiesScanned':len(copies),'boundedPatterns':[{'name':n,'regex':p.decode()} for n,p in PATTERNS],'patternCandidates':hits,'candidateValuesPrinted':False,'selectedImageInventory':images,'futureProviderAndReleasedDiagnosticContentScanned':False,'context':['Original D208 test keys remain explicitly not revoked; original stores are retired. No original feature-archive key/store payload is recopied.','Exact selected CI/diagnostic HTTP bodies, paths, session IDs, screenshots and metadata need root contextual admission; zero bounded matches is not exhaustive assurance.','The 51 MB original browser ZIP and historical full-tree proof remain local-only with exact paths, sizes and hashes; public verification of those raw originals requires them.','The active instrumented reproduction directory was not read, listed or captured. Future released evidence remains unapproved.']}
    write_new(OUT/'bounded-privacy-context.json',privacy)
    write_new(OUT/'source-and-CI-boundary.json',{**bound,'priorAllGreenGuardUnchanged':record(E/'dispatch-486-doc-correction-review-01.py'),'oldPreparationMetadataUnchanged':record(old_metadata_seal),'failedRunRetainedAfterAnyLaterPass':True,'candidateFinalAllSuccessCIRequired':True,'productionFixAuthorized':False,'generalScan3Authorized':False,'liveReproductionRead':False,'original1534FeaturePayloadRecopied':False})
    readme='''# D209 and D211 correction evidence under D212

This is a proposed evidence miniarchive, not delivery completion. D212 permits only the already required actual Fable 5.2/xhigh static correction review after the announced reset. The frozen clean source remains 29e165e14fdda138300ba2a34585ddd47268b475, tree d50fb576f1ef4498cb30e52521198575d6d0ebd4, target a60843a9050b3a203726db84f6abf1f45b8bc694. Source and index hashes are bound. No production repair or general scan 3 is authorized.

The two D209 recovery sentences preserve a fresh run from the corrected definition: UI New run uses a published version; REST may explicitly select an editable draft versionId with allowDraft: true. Existing run snapshots and Resume/Replay pins stay unchanged. D211 adds one exact historical-artifact conflict-marker-size rule. Complete independent static QA preserves all 13 sealed members and its original bounded PASS report. Prior D197 runtime evidence remains historical, not new execution.

Ordinary CI 44934348117 attempt 1 FAILED. It tested synthetic merge 20363bc9beff94e33623307fffed52cd9d509796 with the same source tree. Browser recorded 487 passed, 1 skipped and 1 failed. The other five jobs succeeded. Thirteen numeric coverage summaries meet the existing line/branch thresholds and record 10328 passed / 53 skipped tests. The audit reports 20 findings: 7 low and 13 moderate. The successful native Windows job passed 27 tests, and its exact artifact's 338 observations replay canonically. Those successes remain explicitly partial; no overall passing verified.json is created or inferred.

The sealed static diagnosis retains every one of its 87 members. The second Update click did not reload; a later /worker/reset cleanup error masked the earlier body timeout. The protocol stage and root cause remain unresolved. Exact web-source identity with main excludes direct web-source edits, not indirect runtime effects, existing defects or scheduling effects. Neither this preparation nor a later green candidate establishes flakiness or harmlessness. The exact partial public report and root readback are retained.

Actual Fable review 02 is PENDING. Review 01 was never dispatched and its original brief/spec, old all-green dispatcher and earlier preparation remain immutable historical inputs. The new guard permits this static review against the actual failed run under D212, while retaining the quota reset, exact source/index, full static QA, diagnosis and partial native bindings. It changes no final gate. The complete actual review folder and its one successful correct-model terminal must later be preserved verbatim and expressly accepted by root.

The instrumented reproduction is independently active and has not been inspected here. Final candidate assembly remains blocked until root releases its complete sealed packet and exact diagnostic disposition. A later pass cannot erase the failed attempt or establish its cause. A reproduced product defect cannot be waived through this metadata helper. No outcome, fix or passing diagnostic is invented.

All three publication attempts, the D210 sparse repair, D211 marker proofs, integration receipts, narrow snippets and root proof replay remain exact. The tuple/list comparison erratum remains separate from the successful substantive proofs. Root's prior scoped format check installed 801 existing-lock packages from G with zero downloads; it is not described as install-free. The integration agent did not install or run product checks.

The original 1534-file feature archive and original key/store payloads are not recopied. D208's generated test keys remain explicitly not revoked and their original stores retired. The redundant 51023578-byte browser ZIP and large historical full-tree proof remain explicit local absolute-path/size/hash references under D202. Public readers need those originals to verify those raw proofs; the complete selected diagnosis extraction is physically preserved with its seal. Every selected seal has an explicit member-root, canonical-path or alias resolution map. Root must contextually review exact screenshots and diagnostic bodies; bounded credential patterns give no exhaustive assurance or future approval.

After actual correction-review acceptance and diagnostic disposition, root may admit exact selection/privacy and assemble the preplanned real evidence miniarchive. Fresh all-success final-head/current-target ordinary CI, canonical native verification and reserved fresh independent Astra MAX general scan 3 remain required after that archive changes HEAD. Exactly two general scans have been consumed. Root owns final editorial updates, formatting, sealing, source-preservation proof, repository/index/commit/push actions, signed merge and separately retained owner acceptance. This preparation runs no product check, provider or CI job and writes no repository state.
'''
    write_new(OUT/'README.draft.md',readme.encode())
    fixed_names=['bindings.py','dispatch-review-02.py','prepare-candidate-after-review.py','REVIEW-CONTEXT.json','README.draft.md','seal-and-reference-resolution.json','bounded-privacy-context.json','source-and-CI-boundary.json']
    fixed=[record(OUT/name) for name in fixed_names]
    inv_hash=record(OUT/'input-inventory.json')['sha256']
    guard={'schema':'graphgoblin-d212-bounded-review/1','rootExecutionAuthorized':False,'rootAdmission':None,'inventorySha256':inv_hash,'fixedPreparationFiles':fixed,'authority':'D212','quotaResetEpoch':RESET,'wholeCiConclusion':'failure','finalAllSuccessCIRequired':True}
    write_new(OUT/'dispatch-config.draft.json',guard)
    config={'schema':'graphgoblin-d212-miniarchive/1','archivePrefixProposed':'docs/qa/2026-11-21-i4-486-doc-correction','inventorySha256':inv_hash,'fixedPreparationFiles':fixed,'actualReviewAcceptance':{'rootAccepted':False,'verdict':None,'reportSha256':None,'verdictLine':None},'futureDiagnosticRelease':{'releasedComplete':False,'root':str(E/'i4-553-browser-reproduction-01'),'seal':None,'memberListKey':None,'rootDisposition':None,'rootDispositionAccepted':False,'rootDecision':None,'rootCauseStatus':None,'originalFailureRetained':False,'laterPassDoesNotEraseFailure':False,'knownReproducedProductDefect':None},'rootFinalizationAdmission':{'authorized':False,'privacyApproved':False,'exactSelectionSha256':None,'rootDecision':None,'approvedCandidateHashes':[]},'wholeCiConclusion':'failure','finalAllSuccessCIRequiredAfterRealMiniarchive':True,'noGeneralScan3OrMergeAuthorization':True}
    write_new(OUT/'archive-config.draft.json',config)
    for name in ['bindings.py','dispatch-review-02.py','prepare-candidate-after-review.py']:
        ast.parse((OUT/name).read_text(encoding='utf-8'),filename=name)
    # Inspect only: never dispatch, inspect the live diagnostic, or create a candidate.
    guard_check=subprocess.run([sys.executable,'-B',str(OUT/'dispatch-review-02.py'),'inspect','--config',str(OUT/'dispatch-config.draft.json')],capture_output=True)
    write_new(OUT/'guard-inspection.stdout',guard_check.stdout);write_new(OUT/'guard-inspection.stderr',guard_check.stderr)
    require(guard_check.returncode==0,'Read-only guard inspection failed')
    archive_check=subprocess.run([sys.executable,'-B',str(OUT/'prepare-candidate-after-review.py'),'inspect','--config',str(OUT/'archive-config.draft.json')],capture_output=True)
    write_new(OUT/'archive-incomplete-inspection.stdout',archive_check.stdout);write_new(OUT/'archive-incomplete-inspection.stderr',archive_check.stderr)
    require(archive_check.returncode==2,'Archive helper must remain incomplete')
    checked=json.loads(archive_check.stdout);require(checked['actualReview'] is None and checked['diagnosticDisposition'] is None and checked['wholeCiConclusion']=='failure','Future data was incorrectly admitted')
    for item in inventory['allExistingInputFiles']:verify(item)
    after=source_state();require(before==after,'Source/index changed during preparation')
    report={'status':'INCOMPLETE_D212_METADATA_PREPARATION_READY_FOR_ROOT_REVIEW','createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceBefore':before,'sourceAfter':after,'allExistingInputsUnchanged':len(inventory['allExistingInputFiles']),'proposedExistingPhysicalCopies':len(copies),'proposedExistingBytes':sum(x['bytes'] for x in copies),'localOnlyReferences':len(local),'diagnosisMembersVerified':87,'independentStaticQAMembersVerified':13,'partialVerificationSealMembersVerified':41,'priorPreparationMetadataMembersVerified':12,'boundedPatternCandidates':len(hits),'selectedImages':len(images),'wholeCiConclusion':'failure','newGuardSourceAndEvidenceChecksPass':True,'providerDispatched':False,'futureReproductionFolderRead':False,'archiveOrCandidateAssembled':False,'sourceIndexCIOrGitHubWrites':False,'productionFixOrGeneralScan3Authorized':False,'guard':record(OUT/'dispatch-review-02.py'),'archiveHelper':record(OUT/'prepare-candidate-after-review.py'),'commonBindings':record(OUT/'bindings.py'),'missingInputs':checked['missingInputs']}
    write_new(OUT/'preparation-report.json',report)
    handoff='''# D212 preparation handoff

Only this new preparation and the new review 02 brief/spec were written. All old guards, preparation packets, CI/QA/diagnosis originals and the clean 29e source/index remain exact. The active reproduction directory was not read.

Root should inspect dispatch-review-02.py, bindings.py, the new BRIEF/spec and the read-only guard result. At or after epoch 1795294800, derive a NEW configuration from dispatch-config.draft.json, set rootExecutionAuthorized true and record rootAdmission. Then run python -B dispatch-review-02.py dispatch --config <new-root-admitted-config>. The provider must not already exist. The guard preserves the failed whole-CI status and permits only the bounded actual Fable 5.2/xhigh static correction review under D212. It launches nothing during preparation.

After actual closure, read the complete verbatim report/envelope and derive a NEW archive configuration. Bind root acceptance to the exact ACCEPT FIX report hash and verdict line. Do not infer approval from subtype alone. Keep the complete review folder, including readiness and source-after records.

Do not set futureDiagnosticRelease.releasedComplete until the diagnostic agent has released its complete final sealed packet. Bind its exact seal record, actual files/members key, exact root disposition file hash and decision. A known reproduced product defect cannot be waived by this helper. Root must explicitly retain the failed attempt and state that a later pass does not erase it or establish cause. No future result is preapproved.

Run python -B prepare-candidate-after-review.py inspect --config <new-config> to obtain the complete dynamic selection hash and private-pattern candidate hashes. Root must read contextual content and admit that exact selection/privacy before authorizing prepare-candidate to a NEW E/i4-486-d212-doc-correction-candidate-<unique> directory. It makes an UNSEALED external candidate only; final sealing and all Git actions remain root-owned. Update pending README facts from genuine released evidence before final sealing. Public verification cannot reconstruct the disclosed local-only full browser ZIP or historical tree dump without those originals.

Final all-success ordinary CI at the real post-miniarchive head/current target, native verification and reserved fresh independent Astra MAX general scan 3 remain required. There is no CI rerun, general review, production fix or merge authorization here.
'''
    write_new(OUT/'ROOT-HANDOFF.md',handoff.encode())
    seal=[record(p) for p in files(OUT)] + [record(REVIEW/'BRIEF.md'),record(REVIEW/'spec.json')]
    write_new(OUT/'PREPARATION-SHA256SUMS.json',{'meaning':'Preparation records and two initial review02 files only; not final archive/provider seal or future approval','files':seal})
    print(json.dumps({'report':record(OUT/'preparation-report.json'),'seal':record(OUT/'PREPARATION-SHA256SUMS.json'),'guard':record(OUT/'dispatch-review-02.py'),'helper':record(OUT/'prepare-candidate-after-review.py'),'existingCopies':len(copies),'wholeCiConclusion':'failure','providerDispatched':False}))

if __name__=='__main__':main()
