from pathlib import Path
from hashlib import sha256
import json
import subprocess
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
out=E/'d217-root-admission-01'
rows=[]
for number, comment, source in [(279,7070618762,out/'decision-217.md'),(553,7070620384,E/'i4-486-d216-independent-01/REPORT.md')]:
    raw=subprocess.check_output(['gh','api',f'repos/Jacob-J-Thomas/GraphGoblin/issues/comments/{comment}'])
    data=json.loads(raw)
    assert data['body'].encode()==source.read_bytes()
    assert data['issue_url'].endswith('/'+str(number))
    (out/f'comment-{comment}.json').write_bytes(raw)
    rows.append({'issue':number,'comment':comment,'url':data['html_url'],'source':str(source),'bodySha256':sha256(source.read_bytes()).hexdigest(),'exact':True})
(out/'publication-verification.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
print(json.dumps(rows))
