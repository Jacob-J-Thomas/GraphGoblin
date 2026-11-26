import csv,hashlib,json,re
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path('G:/ggq/gg-macos-current-main/GraphGoblin')
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
OUT=E/'mac-post-564-integration-01'
PACK=E/'i5-d242-core-delivery-supplement-01'
NAMESPACE='docs/qa/2026-11-23-inspector-core-delivery'
def sha(b):return hashlib.sha256(b).hexdigest()
def save(name,value):
    with (OUT/name).open('x',encoding='utf-8') as f:json.dump(value,f,indent=2);f.write('\n')
seal=PACK/'SUPPLEMENT-SEAL.json'
assert sha(seal.read_bytes())=='dede81e62611df9757585e1a668630a228157e8e21a9e07b4c9a54c7e5d67f16'
for name,pin in json.loads(seal.read_text())['members'].items():
    raw=(PACK/name).read_bytes();assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256'],name
assert sha((PACK/'COPY-PLAN.csv').read_bytes())=='98bb932e97af5b49aa56876b8e440b4ed337f6bcaf76f51807b1e81cd734aeb7'
rows=list(csv.DictReader((PACK/'COPY-PLAN.csv').read_text(encoding='utf-8-sig').splitlines()))
assert len(rows)==65 and not (ROOT/NAMESPACE).exists()
seen=set()
for r in rows:
    dest=(ROOT/r['repository_relative_destination']).resolve()
    assert dest.is_relative_to((ROOT/NAMESPACE).resolve()) and str(dest).casefold() not in seen
    seen.add(str(dest).casefold());assert len(str(dest))<260
    src=Path(r['source']).resolve();assert src.is_relative_to(E.resolve()) or src.is_relative_to(Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents').resolve())
    raw=src.read_bytes();assert len(raw)==int(r['bytes']) and sha(raw)==r['sha256']
assert sum(int(r['bytes']) for r in rows)==1306597
resolved=[]
pattern=rb'^<<<<<<< HEAD\r?\n(.*?)^=======\r?\n(.*?)^>>>>>>> d2df8600c2c8574bec420947de686b936910b245\r?\n'
for rel in ['.gitattributes','.prettierignore','CHANGELOG.md']:
    path=ROOT/rel;raw=path.read_bytes()
    saved=(OUT/(rel.replace('/','_').lstrip('.')+'.conflicted.raw')).read_bytes();assert raw==saved
    matches=list(re.finditer(pattern,raw,re.M|re.S));assert len(matches)==1
    m=matches[0];nl=b'\r\n' if b'\r\n' in m.group(0) else b'\n'
    union=m.group(1).rstrip(b'\r\n')+nl+nl+m.group(2).rstrip(b'\r\n')+nl
    result=raw[:m.start()]+union+raw[m.end():]
    assert not re.search(rb'^(<<<<<<<|=======|>>>>>>>)',result,re.M)
    path.write_bytes(result)
    resolved.append({'path':rel,'conflictedSha256':sha(raw),'unionSha256':sha(result),'leftBytesPreserved':True,'rightBytesPreserved':True,'resolution':'Retain both independent additions with a blank separator; remove only conflict markers.'})
for r in rows:
    dest=ROOT/r['repository_relative_destination'];dest.parent.mkdir(parents=True,exist_ok=True)
    with dest.open('xb') as f:f.write(Path(r['source']).read_bytes())
    assert sha(dest.read_bytes())==r['sha256']
for rel,name in [('.gitattributes','gitattributes.additions.txt'),('.prettierignore','prettierignore.additions.txt')]:
    with (ROOT/rel).open('ab') as f:f.write(b'\n'+(PACK/name).read_bytes().rstrip()+b'\n')
register=ROOT/'docs/delivery/2026-11-17-five-intents-register.md'
(OUT/'register.before-append.raw').write_bytes(register.read_bytes())
fragment=(PACK/'REGISTER-FRAGMENT.draft.md').read_bytes()
assert sha(fragment)=='fb101d241ce33b6d79ccacdb34b3364b44ac0577d956f9aac7aca31bed08dc53'
with register.open('ab') as f:f.write(b'\n'+fragment.rstrip()+b'\n')
save('RESOLUTION-AND-SUPPLEMENT.json',dict(utc=datetime.now(timezone.utc).isoformat(),resolution=resolved,filesCopied=65,bytesCopied=1306597,copyPlanSha256=sha((PACK/'COPY-PLAN.csv').read_bytes()),supplementSealSha256=sha(seal.read_bytes()),registerAppendSha256=sha(fragment),staged=False,committed=False))
print('Resolved three metadata conflicts by union; copied exact65 closed core proofs and appended current delivery register. Not staged.')
