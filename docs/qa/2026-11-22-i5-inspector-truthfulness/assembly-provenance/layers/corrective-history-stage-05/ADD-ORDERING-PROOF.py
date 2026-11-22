"""Add the explicitly public ordinary-text ordering receipt before sealing this new layer."""
import hashlib
import json
from pathlib import Path
import shutil

ROOT=Path(__file__).resolve().parent;E=ROOT.parent
def record(p):
    b=p.read_bytes();return {'source':str(p.resolve()),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def read(name):return json.loads((ROOT/name).read_bytes())
def update(name,value):(ROOT/name).write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8',newline='\n')
relative='i5-d225-fixture-review-admission-01/critique-ordering-observation.json'
source=E/relative;target=ROOT/relative
assert not target.exists() and source.resolve()==source
row={**record(source),'archivePath':relative,'category':'selected ordinary-text D224 missed-ordering receipt; no thinking'}
data=json.loads(source.read_bytes())
assert data['thinkingContentNeverSelected'] is True and data['rawStreamLocalOnly'] is True
assert data['crossFamilyFixtureGateSatisfied'] is False
assert all(k not in data for k in ('thinking','events','result','apiKey','credential'))
target.parent.mkdir(exist_ok=False);shutil.copyfile(source,target)
assert record(target)['sha256']==row['sha256']
selected=read('explicit-public-whitelist.json')
assert selected['count']==104
selected['files'].append(row);selected['count']+=1;selected['bytes']+=row['bytes'];update('explicit-public-whitelist.json',selected)
manifest=read('layer-manifest-05.json');manifest['files'].append(row);manifest['count']+=1;manifest['bytes']+=row['bytes'];manifest['combinedOriginalCopyRows']+=1;update('layer-manifest-05.json',manifest)
mapping=read('source-descriptor-map.json');mapping['selectedRecords'].append({
    'original':{k:row[k] for k in ('source','bytes','sha256')},'stagePath':str(target),'archivePath':relative,
    'repositoryRelativeCitation':manifest['archivePrefix']+'/'+relative});update('source-descriptor-map.json',mapping)
before=read('selection-inputs-before.json');before['files'].append(row);update('selection-inputs-before.json',before)
verification=read('preservation-and-verification.json');verification['selectedOriginals'].append(record(source));update('preservation-and-verification.json',verification)
privacy=read('PUBLIC-PRIVACY-QUALIFICATION.json');privacy['selectedBytesChecked']+=row['bytes'];privacy['selectedOrdinaryTextOrderingReceipt']={
    'archivePath':relative,'sha256':row['sha256'],'twoVisibleMessagesOnly':True,'rawPrefixHashOnly':True,'hiddenReasoningCopied':False};update('PUBLIC-PRIVACY-QUALIFICATION.json',privacy)
print(json.dumps({'selected':manifest['count'],'bytes':manifest['bytes'],'combinedOriginalCopyRows':manifest['combinedOriginalCopyRows']}))
