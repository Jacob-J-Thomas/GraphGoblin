"""Append a qualified privacy revision; preserve all earlier preparation and original bytes."""
from pathlib import Path
from hashlib import sha256
import ast,json,runpy,subprocess,sys

OUT=Path(__file__).resolve().parent
B=runpy.run_path(str(OUT/'bindings.py'))
globals().update({k:v for k,v in B.items() if not k.startswith('__')})

def main():
    source_before=source_state();inventory=read(OUT/'input-inventory.json')
    source=read(OUT/'credential-source-scope-02.json');discovery=read(OUT/'credential-context-review-02.json')
    require(source['rootPrivacyApproved'] is False and len(discovery['potentialValueOccurrences'])==32,'Source qualification or candidate inventory differs')
    privacy={'status':'ROOT_NEW_PACKET_AND_FUTURE_CREDENTIAL_CONTEXT_PRIVACY_ADMISSION_PENDING','genericSixPatternZeroIsNotClearance':True,'earlierBoundedObservation':record(OUT/'bounded-privacy-context.json'),'semanticDiscovery':record(OUT/'credential-context-review-02.json'),'potentialOccurrences':32,'opaqueValueGroups':2,'qualifiedClassification':record(OUT/'credential-source-scope-02.json'),'sourceExcerpts':record(OUT/'credential-source-excerpts-02.json'),'qualifications':['controlToken is a source-bound optimistic shutdown incarnation/revision value, not an API authentication key. The optional shutdown-token header rejects stale commands and grants no API auth.','The 31 x-graphgoblin-client headers carry the source UI marker, not that controlToken. Their opaque hashes differ.','No actual Authorization/API-key header was positively identified in the selected retained network. That bounded observation is not an absence or disclosure assurance.','No credential was revoked, no current packet store was certified retired, and CI completion proves neither. D208 applies only to its exact two earlier stores/keys.','The active reproduction was not read. Its future actual keys, stores, images and lifetime claims need separate root disposition after sealed release.','All 40 selected images and exact trace/network/error-context/source bytes remain subject to root contextual review. The source fixture uses loopback, in-memory storage and fakes; no real account/provider behavior is established.'],'selectedImageInventory':read(OUT/'bounded-privacy-context.json')['selectedImageInventory'],'rootMaySelectLocalOnlyOriginals':True,'publicCopyOrCredentialDispositionApproved':False,'originalBytesRedactedOrModified':False}
    write_new(OUT/'bounded-privacy-context-02.json',privacy)
    readme=(OUT/'README.draft.md').read_text()
    readme+='''

Credential context revision: the initial six-pattern zero is not privacy clearance. A separate named-context inventory found 32 occurrences in two opaque groups. Exact source and eight captured GET /system/shutdown responses qualify controlToken as an optimistic incarnation/revision value, not an API authentication key. The 31 x-graphgoblin-client request headers carry a distinct nonsecret UI provenance marker. Normal Authorization authentication remains separate; the optional shutdown-token comparison grants no API authority. Original discovery, initial overbroad grouping, source qualification and the consumer-format correction remain exact records. No captured value is printed in these derivative records. No revocation, store-retirement or public-copy admission is inferred. D208 applies only to its exact two prior stores and keys.

The final dynamic selection requires root review of credential-bearing names, storage/header/body context, source attachments and all selected images, including the separate future instrumented diagnostic. Root may explicitly select local-only originals with exact source/size/hash and a reason. Any such omission must be resolved in admitted-selection-and-seal-resolution.json; original seals remain unchanged and public physical-packet verification then requires the disclosed local originals. That admitted map takes precedence over the earlier proposed physical-copy map. No such exclusion or disclosure is approved in this preparation. The complete actual provider folder cannot be silently reduced.
'''
    write_new(OUT/'README.privacy-02.draft.md',readme.encode())
    original_helper=OUT/'prepare-candidate-after-review.py';text=original_helper.read_text()
    text=text.replace("config['schema']=='graphgoblin-d212-miniarchive/1'","config['schema']=='graphgoblin-d212-miniarchive/2'")
    old="    copies=inventory['proposedExactCopies']+actual+diagnostic\n    require(len({x['archivePath'] for x in copies})==len(copies),'Archive destination collision')\n    selection=sha256(json.dumps({'copies':copies,'localReferences':inventory['localReferences']},sort_keys=True,separators=(',',':')).encode()).hexdigest()"
    new="""    additional=config['additionalImmutableEvidence']
    for item in additional:verify(item)
    copies=inventory['proposedExactCopies']+actual+diagnostic+additional
    require(len({x['archivePath'] for x in copies})==len(copies),'Archive destination collision')
    local_refs=list(inventory['localReferences']);exclusions=[]
    for omitted in config['rootLocalOnlyExclusions']:
        matching=[x for x in copies if x['archivePath']==omitted['archivePath']]
        require(len(matching)==1 and all(matching[0][k]==omitted[k] for k in ['source','bytes','sha256']),'Local-only exclusion does not bind exact original')
        require(omitted.get('rootDecision') and omitted.get('reason'),'Local-only exclusion requires explicit root decision/reason')
        require(omitted['archivePath'].startswith(('browser-static-diagnosis/','failed-source-head-ci/','instrumented-diagnostic/')) and Path(omitted['archivePath']).name not in ['SHA256SUMS.json','SHA256SUMS'],'Only explicitly admitted diagnostic/failed-CI members may become local-only; retain original seals/provider')
        verify(omitted);copies.remove(matching[0]);entry={**omitted,'resolution':'LOCAL_ONLY_NOT_COPIED','publicVerificationRequiresOriginal':True};local_refs.append(entry);exclusions.append(entry)
    selection=sha256(json.dumps({'copies':copies,'localReferences':local_refs},sort_keys=True,separators=(',',':')).encode()).hexdigest()"""
    require(old in text,'Original selection block changed');text=text.replace(old,new)
    text=text.replace("    if admission.get('authorized') is not True:missing.append('Root candidate assembly authorization is pending')", "    if admission.get('authorized') is not True:missing.append('Root candidate assembly authorization is pending')\n    if admission.get('credentialContextReviewed') is not True:missing.append('Root named-credential/header/storage/body/source/image context review, including future released data, is pending')")
    text=text.replace("'localReferences':len(inventory['localReferences']),", "'localReferences':len(local_refs),'selectedLocalReferences':local_refs,'explicitLocalOnlyExclusions':exclusions,'qualifiedCredentialContext':config['credentialContextRecord'],'publicCompletePhysicalPacketClaim':not bool(exclusions),")
    old_editorial="    for name in ['README.draft.md','input-inventory.json','seal-and-reference-resolution.json','bounded-privacy-context.json']:\n        write_new(target/('README.md' if name=='README.draft.md' else name),(OUT/name).read_bytes())"
    new_editorial="""    for editorial in config_editorial(args.config):
        verify(editorial);write_new(target/safe(editorial['archivePath']),Path(editorial['source']).read_bytes())
    write_new(target/'admitted-selection-and-seal-resolution.json',{'meaning':'Authoritative admitted resolution; earlier inventory/seal maps describe the original proposed physical selection. Original seals remain exact.','physicalCopies':copies,'localOnlyOriginals':report['selectedLocalReferences'],'explicitExclusions':report['explicitLocalOnlyExclusions'],'publicCompletePhysicalPacketClaim':report['publicCompletePhysicalPacketClaim'],'publicVerificationOfOmittedMembersRequiresExactOriginals':True})"""
    require(old_editorial in text,'Original editorial block changed');text=text.replace(old_editorial,new_editorial)
    text=text.replace("def main():\n", "def config_editorial(path):\n    return read(path)['editorialFiles']\n\ndef main():\n")
    helper=OUT/'prepare-candidate-after-review-privacy-02.py';ast.parse(text);write_new(helper,text.encode())
    evidence_names=['credential-context-review-01.json','credential-context-review-02.json','credential-context-derivation-02.json','credential-source-scope-02.json','credential-source-excerpts-02.json','credential-source-attempt1-correction.json']
    evidence=[record(OUT/name,archivePath='credential-context/'+name) for name in evidence_names]
    config=read(OUT/'archive-config.draft.json');config['schema']='graphgoblin-d212-miniarchive/2'
    config['additionalImmutableEvidence']=evidence;config['rootLocalOnlyExclusions']=[];config['rootFinalizationAdmission']['credentialContextReviewed']=False
    config['credentialContextRecord']=record(OUT/'bounded-privacy-context-02.json')
    config['editorialFiles']=[record(OUT/'README.privacy-02.draft.md',archivePath='README.md'),record(OUT/'input-inventory.json',archivePath='input-inventory.json'),record(OUT/'seal-and-reference-resolution.json',archivePath='seal-and-reference-resolution.json'),record(OUT/'bounded-privacy-context-02.json',archivePath='bounded-privacy-context.json')]
    config['fixedPreparationFiles']+=[record(helper),record(OUT/'bounded-privacy-context-02.json'),record(OUT/'README.privacy-02.draft.md')]+[record(OUT/name) for name in evidence_names]
    write_new(OUT/'archive-config-privacy-02.draft.json',config)
    write_new(OUT/'privacy-helper-derivation-02.json',{'originalHelper':record(original_helper),'derivedHelper':record(helper),'changes':['Schema2 explicitly binds qualified semantic context evidence in the dynamic copy selection','Root must expressly review named-credential/header/storage/body/source/image context, including future released packets','Root may admit exact diagnostic/failed-CI local-only omissions, with immutable originals, reasons and authoritative per-member resolution; provider and original seals remain physical','Use revised factual README/privacy records; no earlier preparation record is overwritten'],'publicCopyOrCredentialDispositionApproved':False})
    result=subprocess.run([sys.executable,'-B',str(helper),'inspect','--config',str(OUT/'archive-config-privacy-02.draft.json')],capture_output=True)
    write_new(OUT/'privacy-02-incomplete-inspection.stdout',result.stdout);write_new(OUT/'privacy-02-incomplete-inspection.stderr',result.stderr)
    require(result.returncode==2 and json.loads(result.stdout)['actualReview'] is None,'Privacy revision must remain incomplete')
    preservation=[]
    for item in inventory['allExistingInputFiles']:
        actual=record(item['source']);require(actual['sha256']==item['sha256'] and actual['bytes']==item['bytes'],'Original changed during privacy/source checks')
        preservation.append({'source':item['source'],'bytesBefore':item['bytes'],'bytesAfter':actual['bytes'],'sha256Before':item['sha256'],'sha256After':actual['sha256'],'unchanged':True})
    require(source_state()==source_before,'Source/index changed')
    write_new(OUT/'original-input-before-after-privacy-02.json',{'sourceBefore':source_before,'sourceAfter':source_state(),'originalFiles':preservation,'allUnchanged':True,'liveReproductionRead':False})
    write_new(OUT/'ROOT-HANDOFF-PRIVACY-02.md',b'''# D212 privacy revision handoff

Use dispatch-review-02.py and the original dispatch-config.draft.json lineage for root-authorized dispatch after epoch 1795294800. The guard is unchanged. Review 02 remains undispatched and all source/index/original bytes remain exact.

For later external candidate preparation, use prepare-candidate-after-review-privacy-02.py and a NEW root-completed configuration derived from archive-config-privacy-02.draft.json. Preserve the initial helper/config and preparation seal as history. This revision binds the actual named-context discovery and its source qualification; a generic zero-match count grants no privacy approval. Root must set credentialContextReviewed only after reading current and future released context, including images and any actual API-key/storage material.

The controlToken candidate is an optimistic shutdown incarnation/revision value, not an API-auth key. The 31 client headers are a distinct UI provenance marker. Normal Authorization checks remain separate. No revocation or retired-store claim is made; D208 covers only its two earlier stores/keys. The first broad grouping and the _sha1/_file consumer correction remain explicit history. No captured candidate value is printed in derivative records.

Any local-only diagnostic/failed-CI exclusion needs exact source/size/hash, rootDecision and reason in rootLocalOnlyExclusions. The resulting admitted-selection-and-seal-resolution.json makes the public verification limitation explicit. Original seals and all originals remain unchanged; the full provider folder stays physical. Default exclusions are empty and no copy/disclosure is approved.

Actual accepted Fable 5.2/xhigh, final sealed diagnostic/root disposition and exact dynamic selection/privacy authorization remain missing. The live reproduction folder was not read. Final all-success CI, native verification and reserved fresh Astra MAX general scan 3 remain required after the real preplanned archive commit. No candidate, provider, product, source/index, CI or GitHub action was executed here.
''')
    members=[record(p) for p in files(OUT)]+[record(REVIEW/'BRIEF.md'),record(REVIEW/'spec.json')]
    write_new(OUT/'PREPARATION-PRIVACY-02-SHA256SUMS.json',{'meaning':'Append-only preparation privacy revision, including original preparation seal and two initial review files; not archive/provider acceptance','files':members})
    print(json.dumps({'helper':record(helper),'config':record(OUT/'archive-config-privacy-02.draft.json'),'privacyRecord':record(OUT/'credential-source-scope-02.json'),'preservation':record(OUT/'original-input-before-after-privacy-02.json'),'seal':record(OUT/'PREPARATION-PRIVACY-02-SHA256SUMS.json'),'originalFilesUnchanged':len(preservation),'providerDispatched':False,'wholeCiConclusion':'failure','privacyApproved':False}))

if __name__=='__main__':main()
