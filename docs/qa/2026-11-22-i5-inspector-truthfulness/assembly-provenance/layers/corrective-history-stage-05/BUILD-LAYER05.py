"""Explicit closed-public layer only. Never follows provider/private/live-source references."""
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import re
import shutil

ROOT=Path(__file__).resolve().parent
E=ROOT.parent
Q=Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents')
PREFIX='docs/qa/2026-11-22-i5-inspector-truthfulness'
def load(p):return json.loads(p.read_bytes())
def record(p):
    b=p.read_bytes();return {'source':str(p.resolve()),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def put(name,value):
    with (ROOT/name).open('xb') as f:f.write((json.dumps(value,indent=2)+'\n').encode())
def safe(relative):
    parts=relative.replace('\\','/').split('/')
    assert parts and not any(p in ('','.','..') for p in parts)
    assert not any(p.casefold() in ('provider','node_modules','.git') or p.casefold().endswith('.before') for p in parts)
    assert not any(p.casefold() in ('events.jsonl','result.json','private-launcher.unarmed-seed.json') for p in parts)
    assert not re.search(r'[:<>"|?*\x00-\x1f]',relative)

selected=[];packet_proofs=[]
def add(source,archive_path=None,category='public closed record'):
    source=Path(source);assert source.is_relative_to(E) or source.parent==Q
    assert source.resolve()==source and not source.is_symlink()
    relative=archive_path or source.relative_to(E).as_posix();safe(relative)
    assert not any(r['archivePath'].casefold()==relative.casefold() for r in selected)
    selected.append({**record(source),'archivePath':relative,'category':category})
def packet(folder,manifest_name,field,extras,category):
    directory=E/folder;manifest=directory/manifest_name;data=load(manifest);rows=data[field]
    for row in rows:
        safe(row['path']);p=directory/row['path'];r=record(p)
        assert r['bytes']==row['bytes'] and r['sha256']==row['sha256']
        add(p,category=category)
    for name in extras:add(directory/name,category=category)
    packet_proofs.append({'folder':folder,'manifest':record(manifest),'members':len(rows),
                          'selectedFullPhysicalSealLayout':True,'extraFiles':extras})

packet('i5-386-gpt-review-01','SHA256-MANIFEST.json','members',['SHA256-MANIFEST.json','SEAL.json'],'first formal negative review')
arch=E/'i5-386-correction-architecture-01'
for n in ('README.md','source-and-decision.json','SEAL.json'):add(arch/n,category='original corrective architecture advice')
partial=E/'i5-386-corrective-partial-01'
for n in ('cost-and-closure.json','source-preservation.json','selected-provider-provenance.json'):
    add(partial/n,category='D224 failed-author public closure')
preservation=load(partial/'source-preservation.json');assert preservation['changedFiles']==14 and preservation['accepted'] is False
source_aliases=[]
for row in preservation['files']:
    p=partial/'original-author-source'/row['path'];r=record(p)
    assert (r['bytes'],r['sha256'])==(row['file']['bytes'],row['file']['sha256'])
    add(p,category='fourteen preserved preformat D224 author originals')
    source_aliases.append({'originalDescriptor':row['file'],'resolvedClosedOriginal':r,
                           'archivePath':selected[-1]['archivePath'],'resolution':'exact preserved original, live checkout not read'})
# Only these three expressly public files are selected from the closed author packet.
for n in ('AUTHOR-OUTCOME.json','dispatch-exit.json','source-after.json'):
    add(E/'i5-386-claude-corrective-author-01'/n,category='D224 public controller/runner/source receipt')
add(E/'i5-386-corrective-partial-freeze-01/source.json',category='unsigned unaccepted56e3 freeze receipt')
add(E/'i5-386-corrective-candidate-01/CANDIDATE.json',category='twenty-file partial source descriptor only')
packet('i5-386-corrective-independent-qa-01','PREPARATION-SEAL.json','files',['PREPARATION-SEAL.json'],'rejected582 core QA preparation and negative baseline')
packet('i5-386-corrective-independent-qa-01/diagnostic-candidate-01','DIAGNOSTIC-SEAL.json','files',['DIAGNOSTIC-SEAL.json'],'unaccepted56e3 C1/G2 negative diagnostics')
for decision in (224,225,226):add(Q/f'decision-{decision}.md',f'decisions/decision-{decision}.md','canonical delegated decision')
for n in ('root-disposition.json','cost-and-closure.json','selected-provider-provenance.json','claude-review.md'):
    add(E/'i5-d225-review-closure-01'/n,category='D225 closed actual read-only fixture critique')
helper_whitelist={
    'd225-fixture-review-helper-preparation-01':['README.md'],
    'd225-fixture-review-helper-preparation-02':['README.md'],
    'd225-fixture-review-helper-independent-01':['REPORT.md','independent-controls-v1.json','independent-controls-v2.json','filter-results.json','scope-controls.json','v2-delta-scope.json','preparation-v2.json'],
    'd226-ui-completion-metadata-preparation-01':['REPORT.md'],
    'd226-ui-completion-metadata-preparation-02':['REPORT.md'],
    'd226-ui-completion-metadata-independent-01':['REPORT.md','independent-metadata-checks.json','independent-source-checks.json','prep-integrity.json'],
    'd226-ui-completion-metadata-independent-02':['REPORT.md','checks-01.json','checks-02.json','verification.json'],
    'i5-d226-root-materials-01':['root-metadata-execution.json'],
}
for folder,names in helper_whitelist.items():
    for n in names:add(E/folder/n,category='selected helper/refusal/targeted closure summary; rest remains local')
add(E/'i5-d226-dispatch-checkpoint-01/checkpoint.json',category='historical running checkpoint, no acceptance')
baseline_path=E/'i5-386-385-archive-preparation-04/merged-copy-proposal.json'
baseline=load(baseline_path);assert baseline['count']==250 and len(baseline['files'])==250
assert baseline['archivePrefix']==PREFIX
baseline_paths={r['archivePath'].casefold():r for r in baseline['files']}
assert not {r['archivePath'].casefold() for r in selected}.intersection(baseline_paths)
# Frozen20 source descriptors resolve to existing exact bytes when selected; otherwise retain a closed local original.
candidate_dir=E/'i5-386-corrective-candidate-01';candidate=load(candidate_dir/'CANDIDATE.json')
assert len(candidate['files'])==20
for row in candidate['files']:
    p=candidate_dir/'source'/row['path'];r=record(p)
    assert (r['bytes'],r['sha256'])==(row['bytes'],row['sha256'])
    same=next((x for x in selected+baseline['files'] if x['bytes']==r['bytes'] and x['sha256']==r['sha256']),None)
    source_aliases.append({'partialCandidatePath':row['path'],'closedOriginal':r,
        'archivePath':same['archivePath'] if same else None,
        'resolution':'exact byte alias in selected/baseline payload' if same else 'local-only closed original; hash descriptor retained, not copied',
        'publicArchiveAloneVerifiesThisOriginal':bool(same)})
# No raw key values are printed or retained in this bounded content inventory.
privacy=[];hazards=[]
patterns={'anthropic_key_shaped':rb'sk-ant-[A-Za-z0-9_-]{12,}',
          'pem_private_key':rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
          'github_token_shaped':rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})'}
for row in selected:
    data=Path(row['source']).read_bytes()
    findings={label:len(re.findall(pattern,data)) for label,pattern in patterns.items()}
    if any(findings.values()):hazards.append({'archivePath':row['archivePath'],'sha256':row['sha256'],'patternCounts':findings})
    names=set()
    if row['archivePath'].endswith('.json'):
        try:
            def walk(v):
                if isinstance(v,dict):
                    for k,x in v.items():
                        if re.search(r'auth|credential|token|secret|password|account|config|pin',k,re.I):names.add(k)
                        walk(x)
                elif isinstance(v,list):
                    for x in v:walk(x)
            walk(json.loads(data))
        except (ValueError,UnicodeError):pass
    if names:privacy.append({'archivePath':row['archivePath'],'sha256':row['sha256'],'propertyNamesOnly':sorted(names)})
assert not hazards, 'Potential secret-shaped selected public data requires root disposition before staging'
put('selection-inputs-before.json',{'utc':datetime.now(timezone.utc).isoformat(),'files':selected,
    'baselineProposal':record(baseline_path),'readOnlyClosedCandidateDescriptors':[r for r in source_aliases if 'closedOriginal' in r]})
put('explicit-public-whitelist.json',{'count':len(selected),'bytes':sum(r['bytes'] for r in selected),'files':selected,
    'allSourcePathsClosedAndExplicitlySelected':True,'rawProviderPrivateRuntimeFolderRecursion':False})
for row in selected:
    src=Path(row['source']);dst=ROOT/row['archivePath'];assert not dst.exists() and dst.resolve().is_relative_to(ROOT)
    dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
    r=record(dst);assert (r['bytes'],r['sha256'])==(row['bytes'],row['sha256'])
put('source-descriptor-map.json',{'archivePrefix':PREFIX,'sourceDescriptors':source_aliases,
    'notes':['No live checkout descriptor was opened. Preserved preformat files are resolved through the closed14-file original copy.',
             'The20-file partial descriptor is not claimed as a complete newly materialized source snapshot. Local-only originals are explicit.'],
    'selectedRecords':[{'original':{'source':r['source'],'bytes':r['bytes'],'sha256':r['sha256']},
        'stagePath':str(ROOT/r['archivePath']),'archivePath':r['archivePath'],
        'repositoryRelativeCitation':PREFIX+'/'+r['archivePath']} for r in selected]})
put('packet-seal-resolution.json',{'fullPhysicalPackets':packet_proofs,
    'architecturePacket':'All three original files selected; original seal hashes both payloads.',
    'helperPackets':'Selected report/control summaries only; their full original inventories remain local and no complete helper seal resolution is claimed.'})
put('PUBLIC-PRIVACY-QUALIFICATION.json',{'scope':'Explicit closed-public whitelist; no credential/key/config/pin/account/financial-private/raw-thinking or provider-event/result contents selected.',
    'selectedBytesChecked':sum(r['bytes'] for r in selected),'credentialBearingPropertyNamesOnly':privacy,
    'boundedKeyPatternCandidates':hazards,'zeroPatternFindingsIsNotPrivacyClearance':True,
    'noImagesOrBrowserTracesInThisLayer':True,'actualD226LiveAttemptNotRead':True,
    'publicCostDecisionsAndSelectedProvenanceAllowed':True,'privateReferenceLocatorsAreNotTheirContents':True,
    'rootExactCopyAndPublicationPrivacyAdmission':False,
    'omittedCategories':['raw provider events/results/thinking','private keys/pins/configuration/account/funding files',
       '*.before and master contents','runtime/controller/config folders','live D226 provider/source/outcomes',
       'hundreds of synthetic helper fixtures and complete helper manifests','duplicate partial source copies with explicit local-only mappings']})
put('layer-manifest-05.json',{'status':'CLOSED_HISTORICAL_CORRECTIVE_LAYER_CURRENT_AUTHOR_AND_DELIVERY_PENDING',
    'archivePrefix':PREFIX,'files':selected,'count':len(selected),'bytes':sum(r['bytes'] for r in selected),
    'baselineProposal':record(baseline_path),'baselineRows':250,'combinedOriginalCopyRows':250+len(selected),
    'stageREADMERepositoryPath':PREFIX+'/assembly-provenance/layers/corrective-history-stage-05/README.md',
    'generatedAssemblyMetadataRequiresFinalManifest':True,'repoWrites':False,'finalAcceptance':False})
after=[record(Path(r['source'])) for r in selected]
assert all((a['source'],a['bytes'],a['sha256'])==(b['source'],b['bytes'],b['sha256']) for a,b in zip(selected,after))
put('preservation-and-verification.json',{'allSelectedOriginalsAndCopiesExact':True,'selectedOriginals':after,
    'baselineProposalUnchanged':record(baseline_path),'baselinePayloadNotCopiedOrModified':True,
    'currentSourceProviderPrivateMasterAndGitNotAccessed':True,'formalFeatureScansConsumed':0})
print(json.dumps({'selected':len(selected),'bytes':sum(r['bytes'] for r in selected),'baselineRows':250,
    'combinedOriginalCopyRows':250+len(selected),'localOnlyPartialSourceOriginals':sum(1 for r in source_aliases if r.get('resolution','').startswith('local-only')),
    'boundedPatternCandidates':len(hazards),'stage':str(ROOT)}))
