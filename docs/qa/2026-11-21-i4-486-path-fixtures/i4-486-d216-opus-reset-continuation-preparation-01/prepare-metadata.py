"""Write fresh preparation metadata only; no controller/provider launch."""
from pathlib import Path
import hashlib, json, subprocess

P = Path(__file__).resolve().parent
E = P.parent
O = E / 'i4-486-d216-independent-01'

def rec(p):
    p = Path(p).resolve()
    return {'source': str(p), 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}

def new(p, obj):
    data = obj if isinstance(obj, bytes) else (json.dumps(obj, indent=2) + '\n').encode()
    with Path(p).open('xb') as f:
        f.write(data)

brief = (O / 'BRIEF.md').read_text(encoding='utf-8')
new(P / 'BRIEF.attempt02.md', (brief + '''

## Reset continuation and exact output protocol

This is fresh attempt02 under D217. Attempt01 is an immutable weekly-quota failure with zero tools/tests and no e630 verdict. Its full seal and actual reset receipt are bound in source-binding.json. Do not edit attempt01 or the older6de packet. Current output root is G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d216-independent-02; use it for your new harness, raw logs, REPORT.md and qa records. The controller already performed fresh exact frozen source/index/lock/dependency/admission checks. Existing dependencies are installed; do not install/build or inspect accounts.

The controller binds decision C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/decision-217.md and the actual root quota/publication receipts at G:/ggq/delivery-evidence/2026-11-17-five-intents/d217-root-admission-01. These receipts authorize this same native matrix only. No new review, production fix or general scan is admitted.

Write a final qa/SHA256SUMS.json with a files array containing path (relative to this attempt root), bytes and sha256. Cover REPORT.md plus all completed qa records/raw outputs, exclude this QA manifest itself and the active provider/controller stream. Use exact forward-slash relative paths with no parent traversal. The controller will preserve a separate closed-provider manifest after process exit. A criterion PASS never implies root final admission or CI/native/cap/merge completion. If any scenario cannot run, record the exact blocker without inventing a result. Leave the fixture restored in finally and state native cleanup limits.
''').encode())
q = Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents')
node = Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe')
runner = Path('C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/claude-bounded-runner.mjs')
qa = Path('G:/ggq/gg-i4-486-d216-qa/GraphGoblin')
sparse = Path(subprocess.check_output(['git', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '--no-optional-locks', 'rev-parse', '--path-format=absolute', '--git-path', 'info/sparse-checkout'], cwd=qa).decode().strip())
paths = [node, runner, P / 'BRIEF.attempt02.md',
    E / 'i4-486-d216-root-admission-01/candidate-review-qa-admission.json',
    q / 'decision-216.md', q / 'decision-217.md',
    E / 'd217-root-admission-01/decision-217.md',
    E / 'd217-root-admission-01/verification.json',
    E / 'd217-root-admission-01/publication-verification.json']
c = {'rootExecutionAuthorized': False, 'resetEpoch': 1795417200,
    'latestLaunchEpoch': 1795424400, 'maximumProviderSeconds': 7200,
    'model': 'claude-opus-5-5', 'effort': 'xhigh',
    'head': 'e630bb83679bdb055bdd90d2b30e25fbf60571ac',
    'tree': '0713eef9779a14e68b8ca0461f784538ba116c9f',
    'parent': '6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08',
    'attempt': str(E / 'i4-486-d216-independent-02'),
    'controllerEvidence': str(E / 'i4-486-d216-opus-reset-controller-01'),
    'scratch': 'G:/ggq/qa-scratch/i4-486-d216-independent-02',
    'inputBindings': [rec(p) for p in paths], 'sparseBinding': rec(sparse),
    'singleProviderInvocationOnly': True, 'automaticQuotaRetry': False,
    'modelAccountOrOverageSubstitution': False,
    'timeoutPolicy': 'At 7200 seconds terminate only the owned runner process tree; preserve all evidence, flag cleanup/restoration limits and never auto-retry.',
    'generalScansConsumed': 3, 'capReset': False,
    'finalCiNativeAndRootCapMergeAcceptanceRemainSeparate': True}
new(P / 'config.template.json', c)
new(P / 'input-provenance.json', {'originalQuotaSeal': rec(O / 'ORCHESTRATION-SHA256SUMS.json'),
    'originalQuotaReport': rec(O / 'REPORT.md'), 'originalSourceBinding': rec(O / 'source-binding.json'),
    'newBrief': rec(P / 'BRIEF.attempt02.md'), 'rootAndRuntimeBindings': c['inputBindings'],
    'sparseBinding': c['sparseBinding'], 'providerCallsDuringPreparation': 0})
print(json.dumps({'status': 'PREPARATION_METADATA_ONLY', 'config': rec(P / 'config.template.json'), 'brief': rec(P / 'BRIEF.attempt02.md')}))
