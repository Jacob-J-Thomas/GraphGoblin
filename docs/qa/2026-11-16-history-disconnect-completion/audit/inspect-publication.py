import hashlib
import json
from pathlib import Path
import re

OUT=Path(__file__).resolve().parent
EXT=OUT.parent
def data(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
live=data(OUT/'live-pr-comments-followup.json')
comments=live['comments']['structuredContent']['comments']
comment=next(c for c in comments if c['id']==6904020571)
report_path=EXT/'review-419-opus-scan1/full-report.md'
disposition_path=EXT/'runtime-419-opus-root-disposition.md'
assert sha(report_path)=='1f0abc7a32cd9a3b17e98e62cf37f04766ea833e47c11dd8728093a9c45061dc'
text_checks=[]
for p in [report_path,disposition_path]:
    original=p.read_bytes().decode('utf-8-sig')
    exact=original in comment['body']
    lf=original.replace('\r\n','\n').rstrip('\n') in comment['body'].replace('\r\n','\n')
    assert exact or lf
    text_checks.append({'path':str(p),'sha256':sha(p),'exactTextPresent':exact,'LFTextPresent':lf})
root_readback=EXT/'runtime-419-opus-published-readback.json'
archival_receipt=data(EXT/'runtime-419-opus-publication-root-acceptance.json')
packet=Path(archival_receipt['packet'])
manifest=packet/'SHA256SUMS.txt'
assert sha(packet/'README.md')==archival_receipt['readmeSha256']
assert sha(packet/'source-copy-map.json')==archival_receipt['mapSha256']
assert sha(manifest)==archival_receipt['manifestSha256']
count=0
for line in manifest.read_text(encoding='utf-8-sig').splitlines():
    if not line.strip(): continue
    expected,name=re.split(r'\s+',line,maxsplit=1)
    assert sha(packet/name.lstrip('*'))==expected
    count+=1
assert count==26
mapping=data(packet/'source-copy-map.json')
copies=0
for row in mapping['files']:
    if not row.get('sourcePath'): continue
    original=Path(row['sourcePath'])
    if not original.is_absolute(): original=Path(mapping.get('sourceRoot',str(EXT)))/original
    assert sha(original)==sha(packet/row['path'])==row['sha256']
    copies+=1
assert copies==23
receipt={'commentId':comment['id'],'commentURL':comment['url'],'textChecks':text_checks,
    'rootPublishedReadbackSha256':sha(root_readback),
    'currentPR':{k:live['pr']['value']['structuredContent'][k] for k in ['number','state','draft','head_sha','base_sha','merge_commit_sha']},
    'deferred491':{'state':live['followup491']['value']['structuredContent']['issue']['state'],
                  'labels':[x['name'] for x in live['followup491']['value']['structuredContent']['issue']['labels']]},
    'externalFutureOpusPacket':{'packet':str(packet),'manifestRowsVerified':count,'originalCopyPairsVerified':copies,
       'rootReceipt':archival_receipt,'qualification':'External future-publication wrapper only; not part of PR490 head. Earlier wrong-PR draft remains rejected and retained by root.'}}
(OUT/'publication-verification.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'textChecks':text_checks,'commentId':comment['id'],'externalOpusSealRows':count,'externalOpusCopies':copies},indent=2))
