import difflib
import hashlib
import json
from pathlib import Path

directory = Path(__file__).parent
evidence = directory.parent
previous_prep = evidence / 'i5-d241-observation-entry-loss-corrected-preparation-02'
previous_result = evidence / 'i5-d241-observation-entry-loss-corrected-qa-01'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(name, data):
    with (directory / name).open('xb') as stream:
        stream.write(data)


base = (directory / 'base63.component.tsx').read_bytes()
proposed = (directory / 'component.diagnostic.proposed.tsx').read_bytes()
assert sha(base) == '8a344821db18ec25fa7cf2219c07721acf4eddae0d109b8eb3a412ca58aa6c2b'
assert sha(proposed) == 'b2a6c41a7e0aa9936619cc2d5156ff7bea5d4b54f25eca3902212da445bcb950'
assert proposed[:60996] == base[:60996]
write('fixture.diagnostic.diff', ''.join(difflib.unified_diff(base.decode().splitlines(keepends=True),
    proposed.decode().splitlines(keepends=True), fromfile='sealed-original8a/component.tsx', tofile='diagnostic/component.tsx')).encode())
initial_runner = (previous_prep / 'run-corrected.ps1').read_text()
assert sha(initial_runner.encode()) == 'd2b07274b7ee52f7a0ace866e81af44294b4497dd180e1fe17cb975f01615206'
runner = initial_runner.replace('G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d241-observation-entry-loss-corrected-qa-01',
    'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d241-feedback-render-diagnostic-qa-01')
start = runner.index("  $stage = 'fresh2'")
end = runner.index("  $stage = 'full63'", start)
runner = runner[:start] + '  # One unfiltered diagnostic full63 preserves the earlier browser-loss history.\n' + runner[end:]
runner = runner.replace("$stage = 'full63'", "$stage = 'diagnostic63'")
runner = runner.replace('07-full63', '06-diagnostic63').replace('FULL63-SELECTION.json', 'DIAGNOSTIC63-SELECTION.json')
runner = runner.replace("-Label '08-after-modules'", "-Label '07-after-modules'")
runner = runner.replace("Get-Content -LiteralPath (Join-Path $taskEvidence 'FRESH2-SELECTION.json') -Raw\n", '')
assert '--testNamePattern' not in runner and '06-fresh2' not in runner
write('run-diagnostic.ps1', runner.encode())
write('runner.delta.diff', ''.join(difflib.unified_diff(initial_runner.splitlines(keepends=True),
    runner.splitlines(keepends=True), fromfile='reviewed-d2b072/run-corrected.ps1', tofile='diagnostic/run-diagnostic.ps1')).encode())
write('module-boundary.cjs', (previous_prep / 'module-boundary.cjs').read_bytes())
binding = json.loads((previous_result / 'ROOT-BINDING.executed.json').read_text())
binding['executionDirectory'] = str(evidence / 'i5-d241-feedback-render-diagnostic-qa-01')
binding['overlays']['apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'] = sha(proposed)
binding['selection'] = {'file': 'src/runs/RunInspectorPage.independent-416.qa.test.tsx', 'total': 63,
    'selected': 63, 'filtered': 0, 'testNamePattern': None, 'maxWorkers': 1, 'retry': 0,
    'testTimeoutMs': 20000, 'hookTimeoutMs': 20000, 'existingDefaultWaitForMs': 5000,
    'diagnosticOnly': True, 'originalImmediateCaptureAndAssertionsRetained': True}
binding['rootAdmission'] = {'path': None, 'sha256': None}
binding['preparationManifestSha256'] = None
binding['executionAdmitted'] = False
binding['rootInstructions'] = 'UNARMED. One diagnostic full63 at same frozen d8; root must admit exact proposed overlay, fill admission/preparation-manifest SHA and executionAdmitted=true. Original8a results remain strict failure. No source/FF/browser authority; no private state or timeout changes.'
data = (json.dumps(binding, indent=2) + '\n').encode()
write('ROOT-BINDING.template.json', data)
write('ROOT-BINDING.unarmed.json', data)
print(json.dumps({'fixtureSha256': sha(proposed), 'runnerSha256': sha(runner.encode()),
    'unarmedBindingSha256': sha(data), 'exact61PrefixUnchanged': True,
    'candidateHead': binding['source']['head'], 'indexSha256': binding['source']['indexSha256'],
    'planned63Selected': True, 'executionAdmitted': False}, indent=2))
