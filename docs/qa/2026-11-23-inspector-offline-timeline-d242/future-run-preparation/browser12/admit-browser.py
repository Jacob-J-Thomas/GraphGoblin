from datetime import datetime, timezone
from hashlib import sha256
import importlib.util
import json
from pathlib import Path

P = Path(__file__).resolve().parent
root_inputs = json.loads((P / 'ROOT-ADMISSION-INPUTS.json').read_text(encoding='utf-8'))
browser_inputs = json.loads((P / 'BROWSER-ROOT-INPUTS.json').read_text(encoding='utf-8'))
assert root_inputs['rootAdmitted'] is True and browser_inputs['rootAdmitted'] is True
spec = importlib.util.spec_from_file_location('bounded_browser', P / 'run-browser12.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
assert runner.pin(P / 'run-browser12.py') == runner.read(P / 'PREPARATION-MANIFEST.json')['members']['run-browser12.py']
binding = runner.read(P / 'SOURCE-BINDING.json')
assert runner.pin(P / 'SOURCE-BINDING.json')['sha256'] == browser_inputs['sourceBindingSha256']
out = runner.OUT
manifest = runner.read(out / 'BUILD-MANIFEST.json')
digest = runner.pin(out / 'BUILD-MANIFEST.json')['sha256']
assert digest == browser_inputs['buildManifestSha256']
result = runner.read(out / 'BUILD-RESULT.json')
assert result['exit'] == 0 and result['buildAccepted'] and result['sourceUnchanged'] and result['previousRetainedCopyUnchanged']
assert runner.read(out / '02-build.json')['exit'] == 0
assert manifest['commandReceipt'] == runner.pin(out / '02-build.json')
assert runner.read(out / 'BUILD-BEFORE.json') == runner.read(out / 'BUILD-AFTER.json') == manifest['sourceSnapshot'] == runner.snapshot(binding)
assert runner.tree_manifest(runner.DIST) == manifest['webDist']
assert runner.tree_manifest(runner.PREVIOUS_OUT / 'owned-web-dist') == runner.read(runner.PREVIOUS_BUILD)['webDist']
qa = Path(root_inputs['independentQa']['folder'])
assert runner.pin(qa / 'MANIFEST.json')['sha256'] == root_inputs['independentQa']['manifestSha256']
seal = runner.read(qa / 'MANIFEST.json')
for record in seal['members']:
    assert runner.pin(qa / record['path']) == {k: record[k] for k in ('bytes', 'sha256')}, record['path']
closure = runner.read(qa / 'CLOSURE.json')
assert closure['sourceHead'] == binding['source']['head']
assert closure['freshSelection']['passed'] == 2 and closure['fullSelection']['passed'] == 63
assert closure['sourceIndexCohortsOverlaysBeforeAfterEqual'] and closure['heavySlotReleased']
admission = runner.read(P / 'BROWSER-ADMISSION.template.json')
assert admission['source'] == {'head': None, 'tree': None, 'parents': None} and admission['rootAdmitted'] is False
admission['source'] = binding['source']
admission.update(rootAdmitted=True, buildManifestSha256=digest,
    rootReadback={'utc': datetime.now(timezone.utc).isoformat(), 'sourceBinding': runner.pin(P / 'SOURCE-BINDING.json'),
      'freshBuildExit': 0, 'liveWorkingDistMembersRehashed': len(manifest['webDist']),
      'retainedPriorDistMembersRehashed': len(runner.read(runner.PREVIOUS_BUILD)['webDist']), 'qaManifest': runner.pin(qa / 'MANIFEST.json'),
      'qaMembersRehashed': len(seal['members']), 'qaReport': runner.pin(qa / 'REPORT.md'),
      'scope': 'One unchanged 12-case browser run, one worker, zero retries, strict G1 unchanged. Isolated fixture only; no product edits, dependency changes, owner instance, provider use, or additional review pass.'})
runner.put(P / 'BROWSER-ADMISSION.json', admission)
print(json.dumps({'admission': runner.pin(P / 'BROWSER-ADMISSION.json'), 'build': result,
    'qaMembersRehashed': len(seal['members']), 'qaManifest': runner.pin(qa / 'MANIFEST.json')}, indent=2))
