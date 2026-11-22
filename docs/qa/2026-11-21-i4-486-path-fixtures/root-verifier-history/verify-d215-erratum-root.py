from pathlib import Path
import json,hashlib,datetime
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
p=E/'i4-486-d215-author-erratum-01';sha=lambda b:hashlib.sha256(b).hexdigest()
mraw=(p/'SHA256-MANIFEST.json').read_bytes()
assert sha(mraw)=='753bf10eeca8b021701e830f167935d5e315108840522064a65608eea83c00fa'
m=json.loads(mraw)
for f in m['files']:
    b=(p/f['path']).read_bytes();assert len(b)==f['bytes'] and sha(b)==f['sha256']
d=json.loads((p/'TRANSCRIPT-SOURCE-BINDING.json').read_bytes())
with Path(d['transcript']).open('rb') as fp: prefix=fp.read(d['prefixBytes'])
assert len(prefix)==d['prefixBytes'] and sha(prefix)==d['prefixSha256']
lines=prefix.splitlines(keepends=True);checks=[]
for x in d['observations']:
    records={}
    for kind in ('launch','terminalCommand','toolResponse'):
        ref=x[kind];raw=lines[ref['line']-1]
        assert len(raw)==ref['bytesIncludingLineEnding'] and sha(raw)==ref['sha256']
        records[kind]=json.loads(raw)
    launch=records['launch']['payload'];term=records['terminalCommand']['payload'];response=records['toolResponse']['payload']
    assert records['launch']['type']=='response_item' and launch['type']=='custom_tool_call'
    assert records['terminalCommand']['type']=='event_msg' and term['type']=='item_completed'
    assert records['toolResponse']['type']=='response_item' and response['type']=='custom_tool_call_output'
    assert launch['call_id']==x['launch']['callId'] and response['call_id']==x['toolResponse']['callId']
    command=term['item'];assert command['exit_code']==x['terminalCommand']['exitCode']
    assert command['process_id']==x['terminalCommand']['processId'] and command['cwd']==x['terminalCommand']['workingDirectory']
    assert sha(json.dumps(command['command'],ensure_ascii=False,separators=(',',':')).encode())==x['terminalCommand']['decodedCommandSha256']
    assert x['scriptInvoked'] in launch['input'] and any(x['scriptInvoked'] in c for c in command['command'])
    chunks=[json.loads(c['text']) for c in response['output'] if c.get('type')=='text' and c.get('text','').startswith('{"chunk_id":')]
    chunk,=[c for c in chunks if c['chunk_id']==x['toolResponse']['chunkId']]
    assert chunk.get('exit_code')==x['toolResponse']['chunkExitCode']
    raw=(p/x['stdout']).read_bytes();line=raw.decode('utf-8')
    assert line in chunk['output'].splitlines(keepends=True) and line in command['aggregated_output'].splitlines(keepends=True)
    assert 'tempFixtures=0 packageRelativeFixtures=0 checkoutRelativeFixtures=0' in line
    checks.append(dict(stdout=x['stdout'],phase=x['phase'],terminalExit=command['exit_code'],chunkExit=chunk.get('exit_code'),sha256=sha(raw),confirmedOriginalToolResult=True))
orig=E/'i4-486-d215-author-01';raw=(orig/'SHA256-MANIFEST.json').read_bytes();assert sha(raw)=='99bc9f0718129b926615170630e9600fdbca19a40b290072dfae9d3f3134f226'
for f in json.loads(raw)['files']:
    b=(orig/f['path']).read_bytes();assert len(b)==f['bytes'] and sha(b)==f['sha256']
out=E/'i4-486-d215-root-admission-01/author-erratum-verification.json';assert not out.exists()
out.write_text(json.dumps(dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),erratumManifestSha256=sha(mraw),verifiedMembers=len(m['files']),transcriptPrefixVerified=True,prefixBytes=len(prefix),prefixSha256=sha(prefix),originalAuthorMembersUnchanged=56,observations=checks,standing='Retrospective exact extraction of original completed tool output, not new execution. Missing report filenames never existed; originals remain unchanged. Separate current snapshot not substituted for historical observations.'),indent=2)+'\n')
print(json.dumps(dict(verified=True,members=len(m['files']),historicalToolObservations=len(checks),originalAuthorPreserved=True)))
