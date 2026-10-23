from pathlib import Path
import json,re,sys,os
raw=Path(sys.argv[1]); qa=Path(__file__).parent

def sanitize(text):
    text=re.sub(r"C:(?:\\+|/)Users(?:\\+|/)[^\\/\s\"']+",'<USERPROFILE>',text,flags=re.I)
    account=os.environ.get('USERNAME','')
    host=os.environ.get('COMPUTERNAME','')
    if account:
        text=re.sub(r'C:(?:\\+|/)Users(?:\\+|/)'+re.escape(account),'<USERPROFILE>',text,flags=re.I)
        text=text.replace(account,'<user>')
    if host: text=text.replace(host,'<HOST>')
    return text.replace('\r','')

for source in raw.glob('*.log.txt'):
    data=source.read_bytes()
    text=data.decode('utf-16' if data.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-8-sig',errors='replace')
    (qa/source.name).write_text(sanitize(text),encoding='utf8',newline='\n')
if (raw/'listeners.jsonl').exists():
    rows=[json.loads(line) for line in (raw/'listeners.jsonl').read_text(encoding='utf8').splitlines() if line.strip()]
    ports=sorted({row['port'] for row in rows})
    assert all(5650 <= port <= 5659 for port in ports),ports
    (qa/'listener-scope.json').write_text(json.dumps({'ports':ports,'observations':len(rows),'guard':'All observed fixture listeners are within 5650-5659.'},indent=2)+'\n',encoding='utf8')
for package in ['infrastructure','engine','adapter-codex','api']:
    base=Path('apps' if package=='api' else 'packages')/package/'coverage/coverage-summary.json'
    if base.exists():
        # Do not infer coverage freshness from existence; the report identifies the producing run.
        value=json.loads(base.read_text(encoding='utf8'))
        (qa/(package+'-coverage-summary.json')).write_text(sanitize(json.dumps(value,indent=2))+'\n',encoding='utf8')
print('Sanitized gate logs and available coverage summaries collected; inspect run logs for freshness.')
