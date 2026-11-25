from pathlib import Path
import json,hashlib
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents');O=Path(__file__).resolve().parent
groups=['mac-post-564-root-integration-independent-01','mac-post-564-windows-startup-reconciliation-01','mac-post-564-fixture-scope-reconciliation-01']
count=0
for g in groups:
 p=E/g;m=json.loads((p/'MANIFEST.json').read_text(encoding='utf-8-sig'))['members']
 rows=[{'path':n,**v} for n,v in m.items()] if isinstance(m,dict) else m
 for row in rows:
  f=p/row['path'];raw=f.read_bytes()
  assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256'];count+=1
members=[{'path':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(O.iterdir()) if p.is_file() and p.name!='MANIFEST.json']
with (O/'MANIFEST.json').open('x',encoding='utf-8') as f:json.dump({'members':members,'independentMembersRehashed':count,'initialReadbackFailure':'First inline readback assumed every members field was a list; the fixture report uses a keyed map. It failed before output creation. This reader honors both explicit retained schemas without changing inputs or rerunning tests.'},f,indent=2);f.write('\n')
print(json.dumps({'independentMembersRehashed':count,'dispositionMembers':len(members),'manifestSha256':hashlib.sha256((O/'MANIFEST.json').read_bytes()).hexdigest()}))
