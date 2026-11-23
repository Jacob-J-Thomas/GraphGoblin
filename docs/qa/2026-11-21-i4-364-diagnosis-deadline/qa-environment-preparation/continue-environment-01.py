"""Continue the retained preparation after correcting Node executable selection.

No checkout recreation, source change, repeated install/build or online fallback.
The first runner's original bytes and failed version observation remain canonical.
Reuse its unmodified preparation functions and remaining install/build/proof steps;
only this continuation selects the absolute Node path and a unique failure file.
"""
from pathlib import Path
import json

HERE = Path(__file__).resolve().parent
original = HERE / 'prepare-environment.py'
source = original.read_text(encoding='utf-8')
prefix = source[:source.index('protected_before = None\ntry:')]
ns = {'__file__': str(original), '__name__': 'environment_preparation_continuation'}
exec(compile(prefix, str(original), 'exec'), ns)
read = lambda name: json.loads((HERE / name).read_bytes())
require = ns['require']
require(not (HERE / 'commands/07-pnpm-version.receipt.json').exists(), 'Later preparation already started; do not repeat')
require(not ns['POINTER'].exists(), 'Success pointer exists; do not overwrite')
before = read('protected-worktrees-before.json')
require(ns['state'](ns['AUTHOR']) == before['author'] and ns['state'](ns['OLD_QA']) == before['oldQA'], 'Protected original worktree state changed')
candidate = read('candidate-before-install-build.json')
require(ns['state'](ns['DEST']) == candidate, 'New candidate changed after stopped version check')
admission = read('admission.json')
freeze_raw = ns['FREEZE'].read_bytes()
require(ns['sha'](freeze_raw) == admission['rootFreeze']['sha256'], 'Root freeze changed')
require(not (ns['DEST'] / 'node_modules').exists(), 'Unexpected dependencies already present before first install')
ns['write']('preparation-continuation-01.json', {
    'scope': 'Environment preparation mechanism correction only; not product QA',
    'originalRunner': ns['file_info'](original),
    'priorFailure': 'failure.json', 'observedWrongBareExecutableVersion': 'v23.10.0',
    'cause': 'Windows CreateProcess searched the Python parent executable path for bare node; child PATH alone did not control that lookup',
    'correction': 'Use the absolute project Node 22.23.4 node.exe for version admission; child PowerShell still selects Node 22 first on PATH for all pnpm commands',
    'absoluteNode': str(ns['RUNTIME'] / 'node.exe'),
    'unchanged': ['Original source/index/dependencies/lock', 'All remaining frozen install/build/source/output assertions', 'Offline-only boundary', 'One build invocation limit'],
    'noInstallOrBuildHadRun': True,
})
node = ns['run']('06a-node-version-explicit-project', [str(ns['RUNTIME'] / 'node.exe'), '--version'], ns['DEST'])
require(node['exitCode'] == 0 and Path(node['stdout']['path']).read_text().strip() == 'v22.23.4', 'Explicit project Node version differs')
ns.update({'protected_before': before, 'protected_sources': read('protected-source-inventories.json'),
           'candidate_before': candidate, 'candidate_sources': read('candidate-source-inventory.json'),
           'freeze_raw': freeze_raw, 'freeze': json.loads(freeze_raw), 'before_ports': admission['initialOwnerPorts']})
tail = 'try:\n' + source[source.index("    pnpm = run('07-pnpm-version'"):]
require(tail.count("write('failure.json', failure)") == 1, 'Expected unique failure-output declaration')
tail = tail.replace("write('failure.json', failure)", "write('failure-continuation-01.json', failure)")
exec(compile(tail, str(original) + ':unchanged_remaining_preparation_steps', 'exec'), ns)
