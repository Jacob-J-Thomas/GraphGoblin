import hashlib,json,sys,stat,subprocess
from datetime import datetime,timezone
from pathlib import Path
root,checkout=map(Path,sys.argv[1:3])
def h(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(name,data):
    with (root/name).open('x',encoding='utf-8',newline='\n') as f: json.dump(data,f,indent=2); f.write('\n')
assert subprocess.check_output(['git','--no-optional-locks','-C',str(checkout),'status','--porcelain=v1','--untracked-files=all'])==b''
ledger=json.loads((root/'review-ledger.json').read_text(encoding='utf-8-sig'))
for finding in ledger['findings']:
    title=(root/finding['witness']).read_text(encoding='utf-8-sig').splitlines()[finding['witnessLine']-1]
    assert title.startswith("it('")
    assert title.split("it('")[1].split("',")[0] in (root/finding['execution']).read_text(encoding='utf-16' if (root/finding['execution']).read_bytes().startswith(b'\xff\xfe') else 'utf-8-sig')
members=[dict(path=p.name,bytes=p.stat().st_size,sha256=h(p)) for p in sorted(root.iterdir()) if p.is_file()]
put('SHA256-MANIFEST.json',dict(algorithm='SHA-256',members=members))
put('SEAL.json',dict(utc=datetime.now(timezone.utc).isoformat(),state='SEALED_CHANGES_REQUIRED',head=ledger['head'],tree=ledger['tree'],soleParent=ledger['parent'],generalScansUsed=2,generalScanCap=3,changesRequiredP2=3,deferred=0,characterizationsReproduced=3,manifestMembers=len(members),reportSha256=h(root/'README.md'),ledgerSha256=h(root/'review-ledger.json'),sourceAndInputsSha256=h(root/'source-and-inputs.json'),manifestSha256=h(root/'SHA256-MANIFEST.json')))
for p in root.iterdir():
    if p.is_file(): p.chmod(stat.S_IREAD)
for m in members:
    assert h(root/m['path'])==m['sha256']
print('Manifest verified',len(members),'members. Seal SHA256',h(root/'SEAL.json'))
