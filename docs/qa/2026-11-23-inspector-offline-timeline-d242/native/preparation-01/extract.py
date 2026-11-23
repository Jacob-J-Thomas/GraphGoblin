import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZipFile

out = Path(__file__).parent
e = out.parent
artifacts = e / 'i5-416-420-post-feedback-browser12-execution-01/browser-artifacts'
trace = next(artifacts.glob('*812c1*/trace.zip'))
assert hashlib.sha256(trace.read_bytes()).hexdigest() == '08b00707e26c4940dabdf14a3a56038a5ecf23f2041198d2f15d058b485bddee'
responses = {}
with ZipFile(trace) as z:
    for line in z.read('2-trace.network').splitlines():
        snapshot = json.loads(line)['snapshot']
        request, content = snapshot['request'], snapshot['response']['content']
        path = urlsplit(request['url']).path
        if request['method'] == 'GET' and not path.startswith('/app/') and content.get('_file') and 'json' in content['mimeType']:
            responses[path] = json.loads(z.read(content['_file']))
run_path = next(p for p in responses if p.startswith('/runs/') and len(p.split('/')) == 3)
run = responses[run_path]
assert run['status'] == 'failed' and run['finalizedAt'] and run['recovery']['observedSeq'] == 6
value = {'provenance': {'trace': str(trace), 'sha256': hashlib.sha256(trace.read_bytes()).hexdigest(),
    'scope': 'Controlled retained B3 test-app GET projections used by the final native review; no live/owner listener'},
    'runPath': run_path, 'responses': responses}
with (out / 'API-FIXTURE.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(value, stream, indent=2)
    stream.write('\n')
print(json.dumps({'runPath': run_path, 'run': run, 'routes': list(responses)}, indent=2))
