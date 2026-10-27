"""Read-only audit of main-created store before/after PR migration. Writes QA evidence only."""
import sys, sqlite3, json, hashlib, os, itertools
from pathlib import Path
here=Path(__file__).resolve().parent
base=Path(os.environ['TEMP'])/'gg-qa-412f-b-mig'/'data'
db=sqlite3.connect('file:'+str(base/'graphgoblin.db').replace('\\','/')+'?mode=ro',uri=True)
mode=sys.argv[1]
def digest(v): return hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
if mode=='before':
    out={'tables':{},'files':{}}
    for (t,) in db.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name!='__drizzle_migrations'"):
        cols=[x[1] for x in db.execute('pragma table_info("'+t+'")')]
        rows=list(db.execute('select * from "'+t+'"'))
        out['tables'][t]={'columns':cols,'hashes':sorted(digest(r) for r in rows),'count':len(rows)}
        if t=='runs': out['runFields']={r[0]:{c:digest(v) for c,v in zip(cols,r)} for r in rows}
    for p in base.rglob('*'):
        if p.is_file() and not p.name.startswith('graphgoblin.db') and p.name!='.lock': out['files'][str(p.relative_to(base))]=hashlib.sha256(p.read_bytes()).hexdigest()
    out['migrations']=db.execute('select count(*) from __drizzle_migrations').fetchone()[0]
    (here/'upgrade-before-b.json').write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8')
    print('main before migration:',out['migrations'],'migrations; tables/counts:',{t:v['count'] for t,v in out['tables'].items() if v['count']},'; resource file hashes:',len(out['files']))
    assert out['migrations']==22
    assert db.execute("select count(*) from pragma_table_info('runs') where name='deletion_approval'").fetchone()[0]==0
else:
    before=json.loads((here/'upgrade-before-b.json').read_text(encoding='utf-8'))
    bad=[]
    for t,v in before['tables'].items():
        cols=','.join('"'+c+'"' for c in v['columns'])
        now=sorted(digest(r) for r in db.execute('select '+cols+' from "'+t+'"'))
        if now!=v['hashes']: bad.append(t)
    changed=[s for s,h in before['files'].items() if not (base/s).exists() or hashlib.sha256((base/s).read_bytes()).hexdigest()!=h]
    count=db.execute('select count(*) from __drizzle_migrations').fetchone()[0]
    approved=db.execute('select count(*) from runs where deletion_approval is not null').fetchone()[0]
    owned=db.execute('select count(*) from run_resources').fetchone()[0]
    fields=[]
    normalized=[]
    db.row_factory=sqlite3.Row
    for r in db.execute('select * from runs'):
        for c,h in before['runFields'][r['id']].items():
            if digest(r[c])!=h:
                if c=='waiting' and any(digest(json.dumps(dict(items),separators=(',',':')))==h for items in itertools.permutations(json.loads(r[c]).items())):
                    normalized.append((r['id'],c,'identical keys and values; JSON key order changed by wait recovery'))
                else: fields.append((r['id'],c,r[c]))
    if bad==['runs'] and normalized and not fields: bad=[]
    print('after migration:',count,'migrations; altered historical tables:',bad,'; altered resource files:',changed,'; approved:',approved,'; ownership claims:',owned,'; changed fields:',fields,'; serialization-only changes:',normalized)
    assert count==24 and not bad and not changed and approved==0 and owned==0
    print('PASS migrations 0022/0023 applied once; every old column/row and resource file preserved, no historical approval or ownership inferred')
db.close()
