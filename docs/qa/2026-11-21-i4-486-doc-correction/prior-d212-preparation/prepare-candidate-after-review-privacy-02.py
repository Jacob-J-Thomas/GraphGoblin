"""D212 external miniarchive preparation; no provider, repository, seal or publication writes."""
from pathlib import Path
import argparse,datetime,json,re,runpy,shutil,sys

OUT=Path(__file__).resolve().parent
B=runpy.run_path(str(OUT/'bindings.py'))
globals().update({k:v for k,v in B.items() if not k.startswith('__')})

def actual_review(config,inventory):
    provider=REVIEW/'provider'
    if not provider.is_dir(): return [],None,['Actual Fable02 provider invocation and accepted original verdict are missing']
    for name in ['launch.json','exit.json','result.json','events.jsonl','provider-final-message.md']:
        require((provider/name).is_file(),'Actual provider closure file missing: '+name)
    launch,exit_,result=read(provider/'launch.json'),read(provider/'exit.json'),read(provider/'result.json')
    require(launch['model']=='claude-fable-5-2' and launch['effort']=='xhigh' and Path(launch['cwd']).resolve()==REPO.resolve(),'Actual reviewer/source/effort differs')
    require(datetime.datetime.fromisoformat(launch['startedAt'].replace('Z','+00:00')).timestamp()>=RESET,'Invocation predates announced reset')
    require(type(exit_['code']) is int and exit_['code']==0 and result['type']=='result' and result['subtype']=='success' and result['is_error'] is False and result['terminal_reason']=='completed','Provider did not complete successfully')
    require(set(result['modelUsage'])=={'claude-fable-5-2'},'Wrong actual provider model')
    events=[json.loads(line) for line in (provider/'events.jsonl').read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    terminal=[x for x in events if x.get('type')=='result']
    require(len(terminal)==1 and terminal[0]==result,'Expected exactly one exact terminal envelope')
    report=provider/'provider-final-message.md'
    require(report.read_bytes()==result['result'].encode() and result['result'].strip(),'Verbatim provider report differs')
    readiness=read(REVIEW/'dispatch-readiness.json');after=read(REVIEW/'dispatch-source-after.json')
    require(readiness['authority']=='D212' and readiness['authoritySha256']==D212 and readiness['source']==inventory['sourceSnapshot'] and readiness['wholeCiConclusion']=='failure' and readiness['boundedStaticOnly'] is True and readiness['quotaResetReached'] is True and readiness['actualModel']=='claude-fable-5-2' and readiness['effort']=='xhigh' and readiness['finalAllSuccessCIRequired'] is True and readiness['wholeCIClaimedPassing'] is False,'Actual dispatch scope/binding differs')
    require(after['sameSourceAndIndex'] is True and after['source']==inventory['sourceSnapshot'] and after['providerProcessExit']==0,'Source/index changed during provider execution')
    selected=[record(p,archivePath='actual-fable02/'+p.relative_to(REVIEW).as_posix()) for p in files(REVIEW)]
    acceptance=config['actualReviewAcceptance'];missing=[]
    if acceptance.get('rootAccepted') is not True or acceptance.get('verdict')!='ACCEPT FIX' or acceptance.get('reportSha256')!=record(report)['sha256']:
        missing.append('Root exact actual Fable02 verdict/report acceptance is pending')
    else:
        n=acceptance.get('verdictLine');text=report.read_text(encoding='utf-8-sig').splitlines()
        require(type(n) is int and 1<=n<=len(text),'Root must bind exact accepted verdict line')
        line=text[n-1].upper().replace('_',' ')
        require('ACCEPT FIX' in line and not re.search(r'CHANGES?\s+REQUIRED|CONDITIONAL|\bFAIL(?:ED)?\b',line),'Root verdict line is not accepted')
    return selected,{'model':'claude-fable-5-2','effort':'xhigh','sessionId':result['session_id'],'report':record(report),'verdict':acceptance.get('verdict'),'boundedStaticOnly':True},missing

def released_diagnostic(config):
    release=config['futureDiagnosticRelease']
    # The live reproduction folder is deliberately not even listed or statted until root releases it.
    if release.get('releasedComplete') is not True:
        return [],None,['Final sealed instrumented diagnostic and explicit root disposition are pending; live packet not read']
    require(Path(release['root']).resolve()==E/'i4-553-browser-reproduction-01','Unexpected future diagnostic root')
    root=Path(release['root']);seal=release['seal'];require(Path(seal['source']).resolve().parent==root.resolve(),'Unexpected final diagnostic seal location')
    verify(seal);manifest=read(seal['source']);key=release['memberListKey']
    require(key in ['files','members'] and isinstance(manifest[key],list) and manifest[key],'Root must bind actual final diagnostic manifest format')
    names=[]
    for item in manifest[key]:
        name=safe(item['path']);names.append(name);actual=record(root/name)
        require(actual['bytes']==item['bytes'] and actual['sha256']==item['sha256'],'Released diagnostic seal member differs')
    seal_name=Path(seal['source']).relative_to(root).as_posix()
    require(len(names)==len(set(names)) and {p.relative_to(root).as_posix() for p in files(root)}==set(names)|{seal_name},'Complete released diagnostic physical layout differs')
    disposition=release['rootDisposition'];verify(disposition)
    require(release.get('rootDispositionAccepted') is True and release.get('rootDecision') and release.get('originalFailureRetained') is True and release.get('laterPassDoesNotEraseFailure') is True,'Root diagnostic disposition and failure-retention admission required')
    require(release.get('knownReproducedProductDefect') is False,'A reproduced product defect cannot be waived or repaired by this metadata helper')
    selected=[record(p,archivePath='instrumented-diagnostic/'+p.relative_to(root).as_posix()) for p in files(root)]
    if not any(Path(p['source']).resolve()==Path(disposition['source']).resolve() for p in selected):
        selected.append(record(disposition['source'],archivePath='diagnostic-root-disposition/'+Path(disposition['source']).name))
    return selected,{'seal':seal,'members':len(names),'rootDisposition':disposition,'rootDecision':release['rootDecision'],'rootCauseStatus':release['rootCauseStatus'],'laterPassDoesNotEraseFailure':True},[]

def inspect(path):
    path=Path(path).resolve();require(path.parent==OUT,'Configuration must be a new file in this preparation folder')
    config=read(path);require(config['schema']=='graphgoblin-d212-miniarchive/2','Wrong archive configuration')
    for item in config['fixedPreparationFiles']:verify(item)
    require(record(OUT/'input-inventory.json')['sha256']==config['inventorySha256'],'Inventory changed')
    inventory=read(OUT/'input-inventory.json');bound=evidence_bindings(inventory)
    actual,review,missing=actual_review(config,inventory)
    diagnostic,disposition,pending=released_diagnostic(config);missing+=pending
    additional=config['additionalImmutableEvidence']
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
    selection=sha256(json.dumps({'copies':copies,'localReferences':local_refs},sort_keys=True,separators=(',',':')).encode()).hexdigest()
    candidates=scan(copies);admission=config['rootFinalizationAdmission']
    if admission.get('authorized') is not True:missing.append('Root candidate assembly authorization is pending')
    if admission.get('credentialContextReviewed') is not True:missing.append('Root named-credential/header/storage/body/source/image context review, including future released data, is pending')
    if admission.get('privacyApproved') is not True or admission.get('exactSelectionSha256')!=selection or not admission.get('rootDecision'):
        missing.append('Root privacy/context and exact dynamic selection admission are pending')
    if not {x['candidateSha256'] for x in candidates}<=set(admission.get('approvedCandidateHashes',[])):
        missing.append('Bounded credential-pattern candidates need explicit root dispositions')
    report={'status':'INCOMPLETE_WAITING_FOR_ACTUAL_REVIEW_DIAGNOSTIC_DISPOSITION_AND_ROOT_ADMISSION' if missing else 'READY_FOR_ROOT_AUTHORIZED_UNSEALED_EXTERNAL_CANDIDATE','source':bound['source'],'wholeCiConclusion':'failure','actualReview':review,'diagnosticDisposition':disposition,'selectionSha256':selection,'proposedCopyCount':len(copies),'localReferences':len(local_refs),'selectedLocalReferences':local_refs,'explicitLocalOnlyExclusions':exclusions,'qualifiedCredentialContext':config['credentialContextRecord'],'publicCompletePhysicalPacketClaim':not bool(exclusions),'patternCandidates':candidates,'missingInputs':missing,'generalScansConsumed':2,'generalScan3Authorized':False,'finalAllSuccessCIRequiredAfterRealMiniarchive':True,'finalNativeAndAstra3Required':True,'candidateFinalSealCreated':False}
    return inventory,copies,report

def config_editorial(path):
    return read(path)['editorialFiles']

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['inspect','prepare-candidate','finalize']);parser.add_argument('--config',required=True);parser.add_argument('--output')
    args=parser.parse_args();require(args.action!='finalize','Final seal, source/index/publication and merge are root-owned')
    inventory,copies,report=inspect(args.config)
    if args.action=='inspect':print(json.dumps(report,indent=2));return 2 if report['missingInputs'] else 0
    require(not report['missingInputs'],'Actual review/diagnostic/root admission incomplete')
    target=Path(args.output or '').resolve()
    require(args.output and target.parent==E and target.name.startswith('i4-486-d212-doc-correction-candidate-') and not target.exists(),'Use a new explicitly named external candidate directly under E')
    target.mkdir();write_new(target/'UNSEALED-COPY-STARTED.json',{'source':HEAD,'wholeCiConclusion':'failure'})
    for item in copies:
        verify(item);p=target/safe(item['archivePath']);p.parent.mkdir(parents=True,exist_ok=True)
        require(not p.exists(),'Copy destination already exists');shutil.copyfile(item['source'],p)
        require(record(p)['sha256']==item['sha256'],'Copied bytes differ')
    for editorial in config_editorial(args.config):
        verify(editorial);write_new(target/safe(editorial['archivePath']),Path(editorial['source']).read_bytes())
    write_new(target/'admitted-selection-and-seal-resolution.json',{'meaning':'Authoritative admitted resolution; earlier inventory/seal maps describe the original proposed physical selection. Original seals remain exact.','physicalCopies':copies,'localOnlyOriginals':report['selectedLocalReferences'],'explicitExclusions':report['explicitLocalOnlyExclusions'],'publicCompletePhysicalPacketClaim':report['publicCompletePhysicalPacketClaim'],'publicVerificationOfOmittedMembersRequiresExactOriginals':True})
    _,after,checked=inspect(args.config)
    require(after==copies and not checked['missingInputs'] and checked['selectionSha256']==report['selectionSha256'],'Originals/source/admission changed during assembly')
    write_new(target/'candidate-unsealed.json',{**checked,'status':'EXTERNAL_CANDIDATE_UNSEALED','READMEPendingStatementsMustBeUpdatedFromActualReleasedEvidenceByRoot':True,'copySelection':copies,'rootOwnsFormatSealSourceProofCommitAndAllFinalGates':True})
    print(json.dumps({'output':str(target),'status':'EXTERNAL_CANDIDATE_UNSEALED','wholeCiConclusion':'failure','copies':len(copies)}));return 0

if __name__=='__main__':
    try:sys.exit(main())
    except (OSError,ValueError,KeyError,TypeError,subprocess.CalledProcessError) as error:
        print(json.dumps({'status':'REFUSED','reason':str(error),'wholeCiConclusion':'failure','noSourceIndexProviderOrPublicationWrites':True}),file=sys.stderr);sys.exit(2)
