"""Independent offline birth-aware reconstruction from the retained ZIP; no extraction."""
from pathlib import Path, PureWindowsPath
from xml.etree import ElementTree as ET
from collections import defaultdict
import hashlib, json, zipfile

OUT = Path(__file__).resolve().parent
PACKET = Path(r'C:\Users\98jak\.codex\worktrees\gg-20261115-runtime\GraphGoblin\docs\qa\2026-11-16-installer-validation-candidate-corrected')
ZIP = PACKET/'artifact/artifact-14206620250.zip'
SUP = 'qa436-candidate-corrected-supervisor/'
EVID = 'qa436-candidate-corrected/evidence/'

with zipfile.ZipFile(ZIP) as z:
    def read(name): return json.loads(z.read(name))
    observer = read(SUP+'observer-summary.json')
    xml_bytes = z.read(SUP+'process-start.xml')
    xml = ET.fromstring(xml_bytes)
    rows = []
    for ordinal,event in enumerate(xml.findall('.//{*}Event'),1):
        system = event.find('{*}System')
        if system is None: continue
        provider = system.find('{*}Provider')
        provider_id = provider.get('Guid','').strip('{}').lower() if provider is not None else ''
        event_guid = event.findtext('{*}ExtendedTracingInfo/{*}EventGuid','').strip('{}').lower()
        opcode = system.findtext('{*}Opcode')
        if provider_id != '9e814aad-3204-11d2-9a82-006008a86939' or event_guid != '3d6fa8d0-fe05-11d0-9dda-00c04fd7ba7c' or opcode not in ('1','2'): continue
        assert system.findtext('{*}Version') == '4'
        data={d.get('Name'):d.text for d in event.findall('./{*}EventData/{*}Data')}
        rows.append({'ordinal':ordinal,'time':system.find('{*}TimeCreated').get('SystemTime'),'opcode':opcode,
            'pid':int(data['ProcessId'],0),'parent':int(data['ParentId'],0),'key':data['UniqueProcessKey'],
            'image':data['ImageFileName'],'argv':data['CommandLine'],'exit':int(data['ExitStatus'])})
    rows.sort(key=lambda r:(r['time'],r['ordinal']))
    by_ordinal={r['ordinal']:r for r in rows}
    early,late=[by_ordinal[c['ordinal']] for c in observer['canaries']]
    driver_ordinal=observer['driver']['ordinal']
    active={}
    owned={}
    ends={}
    for row in rows:
        if row['opcode']=='1':
            parent=active.get(row['parent'])
            within=(early['time'],early['ordinal'])<(row['time'],row['ordinal'])<(late['time'],late['ordinal'])
            row['owned']=within and (row['ordinal']==driver_ordinal or bool(parent and parent['owned']))
            if row['owned']: owned[row['ordinal']]=row
            active[row['pid']]=row
        else:
            start=active.get(row['pid'])
            if start and all(start[k]==row[k] for k in ('pid','parent','key','image')):
                if start['owned']:
                    assert start['ordinal'] not in ends
                    assert (row['time'],row['ordinal'])<(late['time'],late['ordinal'])
                    ends[start['ordinal']]=row
                del active[row['pid']]
    assert len(owned)==399 and set(ends)==set(owned)
    # Compare to the original supervisor only after independently deriving the family.
    assert set(owned)=={r['ordinal'] for r in observer['ownedStarts']}
    receipts=[]
    matches=[(driver_ordinal,SUP+'driver','birthUtc','exitUtc')]
    for item in observer['caseBirths']:
        relative=PureWindowsPath(item['file']).as_posix().split('/evidence/',1)[1]
        matches.append((item['start']['ordinal'],EVID+relative.removesuffix('.spawn.json'),'startedUtc','exitedUtc'))
    for ordinal,prefix,birth_key,exit_key in matches:
        spawn,exited,closed=[read(prefix+'.'+part+'.json') for part in ('spawn','exit','close')]
        start,end=owned[ordinal],ends[ordinal]
        assert spawn['pid']==exited['pid']==closed['pid']==start['pid']
        assert spawn[birth_key]==exited[birth_key]
        assert exited['exitCode']==closed['exitCode']==end['exit']
        assert closed['streamsClosed'] is True
        receipts.append({'prefix':prefix,'pid':start['pid'],'birthOrdinal':ordinal,'endOrdinal':end['ordinal'],'exitCode':end['exit'],'streamsClosed':True})
    assert len(receipts)==50
    starts_between=[r for r in rows if r['opcode']=='1' and early['time']<r['time']<late['time']]
    forbidden=[r for r in starts_between if PureWindowsPath(r['image']).name.lower() in ('chrome.exe','chrome_proxy.exe') or
        (PureWindowsPath(r['image']).name.lower()=='node.exe' and 'apps/api/dist/main.js' in (r['argv'] or '').replace('\\','/').lower())]
    assert not forbidden
    reused={str(pid):[{'birthOrdinal':r['ordinal'],'endOrdinal':ends[r['ordinal']]['ordinal'],'key':r['key']} for r in owned.values() if r['pid']==pid] for pid in (8984,2352)}
    result={'status':'PASS','method':'Independent chronological active-parent reconstruction from classic process start/end XML, with birth-specific PID lifetime; compared to supervisor owned set only after deriving descendants.',
        'zip':str(ZIP),'xmlSha256':hashlib.sha256(xml_bytes).hexdigest(),'rawStarts':sum(r['opcode']=='1' for r in rows),
        'rawEnds':sum(r['opcode']=='2' for r in rows),'ownedLifetimes':len(owned),'matchedEnds':len(ends),
        'directReceiptMatchesIncludingDriver':len(receipts),'forbiddenChromeOrGatewayStarts':len(forbidden),
        'earlyCanary':early['ordinal'],'lateCanary':late['ordinal'],'reusedPidLives':reused,'receipts':receipts,
        'scope':'Retained matrix XML only. No native execution or new trace. This does not cover composed rollback or owner UI.'}
    (OUT/'retained-lifetime-verification.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k not in ('receipts','reusedPidLives')},indent=2))
