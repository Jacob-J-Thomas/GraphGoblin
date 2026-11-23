from pathlib import Path
import json,hashlib,datetime
q=Path(__file__).resolve().parent;h=lambda b:hashlib.sha256(b).hexdigest()
p=q/'i4-486-continuation-preparation-01';m=json.loads((p/'manifest.json').read_text())
assert h((p/'manifest.json').read_bytes())=='b7217e029ab795582bae654d539d642befbf550c83c84f99ba659faa087f431b'
for x in m['newFiles']:
 f=Path(x['path']);b=f.read_bytes();assert len(b)==x['bytes'] and h(b)==x['sha256'],str(f)
records=[]
for folder in ['i4-486-fable-review-02','i4-486-independent-02']:
 d=q/folder;old=json.loads((d/'spec.json').read_text());new=json.loads((d/'dispatch-spec-D201.json').read_text())
 assert {k:v for k,v in old.items() if k!='prompt'}=={k:v for k,v in new.items() if k!='prompt'}
 assert (d/'dispatch-BRIEF-D201.md').read_text().endswith((d/'BRIEF.md').read_text())
 assert not (d/'provider').exists()
 for name in ['dispatch-BRIEF-D201.md','dispatch-spec-D201.json']:
  f=d/name;b=f.read_bytes();records.append({'path':str(f),'bytes':len(b),'sha256':h(b)})
out=q/'i4-486-dispatch-D201-addenda-receipt.json'
with out.open('x',encoding='utf-8') as f:json.dump({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalPreparedMembersVerified':len(m['newFiles']),'originalPreparationManifestSha256':h((p/'manifest.json').read_bytes()),'newDispatchFiles':records,'onlySpecChange':'prompt path to original complete brief with D200/D201 prefix','notBeforeUTC':'2026-11-21T16:00:00Z','rootCapacityCheckRequired':True,'providersStarted':False},f,indent=2)
print(out.read_text())
