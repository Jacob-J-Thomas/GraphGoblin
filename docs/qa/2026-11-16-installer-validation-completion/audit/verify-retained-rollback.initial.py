"""Validate selected raw rollback facts and source bindings from retained ZIPs only."""
from pathlib import Path, PureWindowsPath
import hashlib, json, zipfile

OUT=Path(__file__).resolve().parent
ROOT=Path(r'C:\Users\98jak\.codex\worktrees\gg-20261115-runtime\GraphGoblin')
PACKET=ROOT/'docs/qa/2026-11-16-installer-validation-candidate-corrected'
BATCH=Path(r'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch')
manifest=json.loads((BATCH/'launcher-436-discovery-corrected-candidate-source.json').read_bytes())
def sha(b): return hashlib.sha256(b).hexdigest()
with zipfile.ZipFile(PACKET/'rollback-artifact/artifact-14205449836.zip') as z, zipfile.ZipFile(PACKET/'artifact/artifact-14206620250.zip') as m:
    def read(name): return json.loads(z.read(name))
    bindings=[m.read('qa436-candidate-corrected-supervisor/binding-before.json'),m.read('qa436-candidate-corrected-supervisor/binding-after.json'),z.read('binding-before.json'),z.read('binding-after.json')]
    assert all(b==bindings[0] for b in bindings) and len(bindings[0])==158585
    assert sha(bindings[0])=='8f094646dd799b476709323d86f8faebe5384dab575a2dafbdb5af6b948fb288'
    source=read('publisher-source.json')
    assert source['installerSha256']==manifest['files'][0]['sha256']
    assert source['declarations']=={r['function']:r['sha256'] for r in manifest['rollback']}
    assert source['publicationOrder']==['exe','config','desktop','programs','pin']
    children=[]
    for label in ('bind-before','seed','observe','bind-after'):
        spawn,exit_,close=[read(label+'.'+part+'.json') for part in ('spawn','exit','close')]
        assert spawn['pid']==exit_['pid']==close['pid']
        assert spawn['birthUtc']==exit_['birthUtc']<exit_['exitUtc']<close['closedUtc']
        assert exit_['exitCode']==close['exitCode']==0 and close['streamsClosed'] and close['stderrBytes']==0
        for pipe in ('stdout','stderr'): assert len(z.read(label+'.'+pipe))==close[pipe+'Bytes']
        if label in ('seed','observe'):
            native=read(label+'-input.json')
            assert native['pid']==spawn['pid'] and native['birthUtc']==spawn['birthUtc']
            assert native['edition']=='Desktop' and native['powerShell'].startswith('5.1.') and native['thread']=='STA'
            assert native['scriptSha256']==manifest['files'][0]['sha256']
        children.append({'label':label,'pid':spawn['pid'],'exitCode':exit_['exitCode'],'streamsClosed':True})
    old,restored=read('old.json'),read('restored.json')
    checked=[]
    for name,record in old.items():
        before=z.read('old/'+PureWindowsPath(record['copy']).name)
        after=z.read('restored/'+PureWindowsPath(restored[name]['copy']).name)
        assert before==after and sha(before)==record['sha256']==restored[name]['sha256']
        assert record['identity']==restored[name]['identity']
        assert record.get('link')==restored[name].get('link')
        checked.append({'name':name,'bytesEqual':True,'identityEqual':True,'nativeLinkEqual':True})
    assert len(checked)==6
    changed=z.read('changed-config.json.bin')
    assert sha(changed)!=old['config']['sha256']
    assert json.loads(changed)['Environment']['GG_LOG_LEVEL']=='warn'
    assert json.loads(z.read('old/config.json.bin'))['Environment']['GG_LOG_LEVEL']=='info'
    complete=[read('complete-'+str(i)+'.json') for i in range(3)]
    assert [r['name'] for r in complete]==['exe','config','desktop']
    assert all(r['op']=='File.Replace' for r in complete)
    locked,failure,published,final=[read(s+'.json') for s in ('later-lock','native-failure','publisher-result','rollback-result')]
    assert locked['handleOpen'] and locked['identity']==old['programs']['identity'] and locked['access']==locked['share']=='Read'
    assert failure['name']=='programs' and failure['failure']['hresult']=='0x80070020'
    assert complete[2]['completedTick']<locked['tick']<failure['attemptTick']<=failure['completedTick']<published['tick']
    assert published['result']=='restored' and published['delegateCalls']==4 and published['heldDuringReturn']
    assert final['lockDisposed'] and final['restoredArtifacts']==6
    result={'status':'PASS','scope':'Raw retained composed publisher witness; no new native execution or public fault timing.',
        'fullBindingCopiesEqual':4,'bindingSha256':sha(bindings[0]),'productionDeclarationsMatch':5,
        'children':children,'completedFileReplaces':3,'changedConfigObserved':'info to warn',
        'failureHresult':failure['failure']['hresult'],'publisherResult':published['result'],'heldDuringReturn':True,
        'restoredArtifacts':checked,'lockDisposed':True}
    (OUT/'retained-rollback-verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,indent=2))
