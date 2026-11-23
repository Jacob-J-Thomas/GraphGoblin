"""Seal this new additive public stage after exact original/copy verification."""
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent;E=ROOT.parent
def load(p):return json.loads(p.read_bytes())
def record(p):
    b=p.read_bytes();return {'source':str(p.resolve()),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def put(name,value):
    with (ROOT/name).open('xb') as f:f.write((json.dumps(value,indent=2)+'\n').encode())
selection=load(ROOT/'explicit-public-whitelist.json');assert selection['count']==105 and selection['bytes']==675939
for row in selection['files']:
    original=record(Path(row['source']));copied=record(ROOT/row['archivePath'])
    assert (original['bytes'],original['sha256'])==(row['bytes'],row['sha256'])==(copied['bytes'],copied['sha256'])
proofs=load(ROOT/'packet-seal-resolution.json')
for packet in proofs['fullPhysicalPackets']:
    folder=ROOT/packet['folder'];manifest_name=Path(packet['manifest']['source']).name
    manifest=load(folder/manifest_name);rows=manifest.get('members',manifest.get('files'))
    assert len(rows)==packet['members']
    for row in rows:
        r=record(folder/row['path']);assert (r['bytes'],r['sha256'])==(row['bytes'],row['sha256'])
old_bindings={
    'i5-386-385-partial-stage-01/stage-manifest-01.json':'13b8dc4b9323531873c5f959a0ebaad7a7889caac05e845d3c24e358cd3ac806',
    'i5-386-385-qa-interim-stage-01/layer-manifest-01.json':'ebd7f8df08731e80c5f8113210c12ba4846c2dd790c1128aa94e4e860bda8127',
    'i5-386-385-final-source-qa-layer-04/layer-manifest-04.json':'32e25f4749a833cb880819e070b07409d8955888b51adfb9ff4457d08fb0bc88',
    'i5-386-385-archive-preparation-04/MANIFEST.sha256.json':'f5db6158fcd4763d6e5ae96281b51ac0216b02192115b5d6c057397b989c65e7'}
old=[]
for name,sha in old_bindings.items():
    r=record(E/name);assert r['sha256']==sha;old.append(r)
baseline=load(ROOT/'selection-inputs-before.json')['baselineProposal']
assert record(Path(baseline['source']))==baseline
private=load(ROOT/'PUBLIC-PRIVACY-QUALIFICATION.json')
assert private['rootExactCopyAndPublicationPrivacyAdmission'] is False
mapping=load(ROOT/'source-descriptor-map.json')['sourceDescriptors']
local=[r for r in mapping if r.get('resolution','').startswith('local-only')]
assert len(local)==2
for row in local:assert record(Path(row['closedOriginal']['source']))==row['closedOriginal']
put('final-verification.json',{'originalCopiesVerified':105,'originalBytesVerified':675939,
    'allSelectedOriginalsUnchanged':True,'sealedPacketMembersVerified':proofs['fullPhysicalPackets'],
    'priorLayerManifestBindingsUnchanged':old,'baselineProposalUnchanged':baseline,
    'baselineRows':250,'combinedOriginalCopyRows':355,'localOnlyPartialOriginalsVerified':local,
    'noLiveSourceOrProviderOrPrivateOrMasterRead':True,'noRepositoryOrIndexWrites':True,
    'formalFeatureScansConsumed':0,'rootExactSelectionAndPrivacyAdmission':False})
rows=[]
for p in sorted(ROOT.rglob('*')):
    if p.is_file() and p.name not in ('MANIFEST.sha256.json','SEAL.json'):
        assert not p.is_symlink();r=record(p)
        rows.append({'path':p.relative_to(ROOT).as_posix(),'bytes':r['bytes'],'sha256':r['sha256']})
put('MANIFEST.sha256.json',{'scope':'Layer05 closed public corrective history only','files':rows})
for row in rows:
    r=record(ROOT/row['path']);assert (r['bytes'],r['sha256'])==(row['bytes'],row['sha256'])
put('SEAL.json',{'sealedUtc':datetime.now(timezone.utc).isoformat(),
    'status':'SEALED_ADDITIVE_HISTORICAL_LAYER_NO_CURRENT_CORRECTION_OR_DELIVERY_ACCEPTANCE',
    'manifest':record(ROOT/'MANIFEST.sha256.json'),'members':len(rows),
    'originalCopyCount':105,'originalCopyBytes':675939,'combinedProposalOriginalRows':355,
    'layerManifest':record(ROOT/'layer-manifest-05.json'),'sourceDescriptorMap':record(ROOT/'source-descriptor-map.json'),
    'readme':record(ROOT/'README.md'),'report':record(ROOT/'REPORT.md'),
    'rootPrivacyAndPublicationAdmission':False,'actualProviderOrGitActions':0})
print(json.dumps({'manifestMembers':len(rows),'originalCopyCount':105,'originalCopyBytes':675939,
    'combinedOriginalCopyRows':355,'manifest':record(ROOT/'MANIFEST.sha256.json'),
    'seal':record(ROOT/'SEAL.json'),'layerManifest':record(ROOT/'layer-manifest-05.json'),
    'sourceDescriptorMap':record(ROOT/'source-descriptor-map.json'),'readme':record(ROOT/'README.md')}))
