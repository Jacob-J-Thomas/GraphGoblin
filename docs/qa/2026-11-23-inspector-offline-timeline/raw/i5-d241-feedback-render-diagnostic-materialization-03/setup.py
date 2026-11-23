import difflib
import hashlib
import json
import os
from pathlib import Path
import subprocess

directory = Path(__file__).parent
evidence = directory.parent
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
first = evidence / 'i5-d241-feedback-render-diagnostic-qa-02'
prep1 = evidence / 'i5-d241-feedback-render-diagnostic-preparation-02'
prep2 = evidence / 'i5-d241-feedback-render-diagnostic-preparation-03'
component = 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(path, data):
    with path.open('xb') as stream:
        stream.write(data)


def save(path, value):
    write(path, (json.dumps(value, indent=2) + '\n').encode())


def git(*args):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(root), *args], env=dict(os.environ, GIT_OPTIONAL_LOCKS='0'))


def verify(path, digest):
    assert sha((path / 'MANIFEST.json').read_bytes()) == digest
    members = json.loads((path / 'MANIFEST.json').read_text())['members']
    for member in members:
        data = (path / member['path']).read_bytes()
        assert len(data) == member['bytes'] and sha(data) == member['sha256']
    return len(members)


first_count = verify(first, '7dd5b513f945632ee1eafd37f91151d4650c838444662c63094d0f481832eaa5')
binding = json.loads((first / 'ROOT-BINDING.executed.json').read_text())
prep_count = verify(prep1, binding['preparationManifestSha256'])
assert git('rev-parse', 'HEAD').decode().strip() == binding['source']['head']
assert git('rev-parse', 'HEAD^{tree}').decode().strip() == binding['source']['tree']
index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
assert sha(index.read_bytes()) == binding['source']['indexSha256']
assert sha(git('ls-files', '--stage', '-z')) == binding['source']['stagedEntriesSha256']
for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays', 'selectedSources']:
    pins = binding['source'][group] if group == 'selectedSources' else binding[group]
    for path, expected in pins.items():
        data = (root / path).read_bytes()
        assert (sha(data) == expected if isinstance(expected, str) else {'bytes': len(data), 'sha256': sha(data)} == expected), path
before = (root / component).read_bytes()
assert sha(before) == 'ed2577e25352efeacf962b77b05c39778cb906b5ac3875905c988cb8a575089c'
assert before.count(b'console.info(') == 1
raw = before.replace(b'console.info(', b'console.warn(')
assert sha(raw) == '55a0c5a29f8f7dc6de1045d3d4858d790fdca548385237684ec3bbb5c6f31c3a' and len(raw) == 76934
write(directory / 'console-warn.raw55.tsx', raw)
node = Path(os.environ['USERPROFILE']) / '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe'
result = subprocess.run([str(node), str(directory / 'format.mjs')], capture_output=True, check=False)
write(directory / 'format.stdout.log', result.stdout)
write(directory / 'format.stderr.log', result.stderr)
assert result.returncode == 0
formatted = (directory / 'component.final.tsx').read_bytes()
formatting = json.loads((directory / 'FORMAT.json').read_text())
write(directory / 'console-method.diff', ''.join(difflib.unified_diff(before.decode().splitlines(keepends=True), raw.decode().splitlines(keepends=True), fromfile='sealed-ed257/component.tsx', tofile='allowed-console-warn55/component.tsx')).encode())
write(directory / 'mechanical-format.diff', ''.join(difflib.unified_diff(raw.decode().splitlines(keepends=True), formatted.decode().splitlines(keepends=True), fromfile='raw55/component.tsx', tofile='formatted/component.tsx')).encode())
admission = {'origin': '/root message', 'rootMessageVerbatim': "Root read sole no-console error. Admit ONLY sole console.info( → console.warn( in exact ed257. Root computed SHA55a0c5a29f8f7dc6de1045d3d4858d790fdca548385237684ec3bbb5c6f31c3a,76934B; original61prefix unchanged. Preserve/seal attempt02 and ed257. You may prepare/materialize successor03 and execute unchanged static+singlefull63 once with only output directory/pin corrections; diagnostics will be in stderr, preserve payload unchanged. Sole heavy slot assigned. Also authorized purely mechanical Prettier changes confined to these added diagnostic lines if its check requires them, recording raw/formatted diff and rehash before execution; no product/assertion/timing/private-state change, no lint disable. Do not create another root permission loop for mechanical formatting. No behavioral test has run yet; first actual full63 remains one authorized invocation.", 'formatting': formatting, 'oneBehaviorProgramAdmitted': True, 'noBehaviorInEarlierAttempts': True}
save(directory / 'ROOT-ADMISSION.json', admission)
prep2.mkdir(exist_ok=False)
runner = (prep1 / 'run-diagnostic.ps1').read_bytes()
old_output = b'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d241-feedback-render-diagnostic-qa-02'
new_output = old_output[:-2] + b'03'
assert runner.count(old_output) == 1
successor = runner.replace(old_output, new_output)
write(prep2 / 'run-diagnostic.ps1', successor)
write(prep2 / 'module-boundary.cjs', (prep1 / 'module-boundary.cjs').read_bytes())
write(prep2 / 'component.diagnostic.proposed.tsx', formatted)
template = json.loads((prep1 / 'ROOT-BINDING.template.json').read_text())
template['executionDirectory'] = template['executionDirectory'][:-2] + '03'
template['overlays'][component] = sha(formatted)
save(prep2 / 'ROOT-BINDING.template.json', template)
write(prep2 / 'REPORT.md', ('Root-admitted diagnostic console.warn successor03. Payload/oracles/waits unchanged; exact console method diff and authorized mechanical-format evidence in materialization03. Runner changes only output directory02-to03; module resolver unchanged. Prior static-only attempts remain sealed. One unchanged static plus first actual full63 program is admitted.\n').encode())
save(prep2 / 'MANIFEST.json', {'scope': 'Root-admitted console.warn diagnostic successor; mechanical formatting separately evidenced', 'members': [{'path': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())} for path in sorted(prep2.iterdir()) if path.is_file()]})
binding['executionDirectory'] = template['executionDirectory']
binding['overlays'][component] = sha(formatted)
binding['rootAdmission'] = {'path': str(directory / 'ROOT-ADMISSION.json'), 'sha256': sha((directory / 'ROOT-ADMISSION.json').read_bytes())}
binding['preparationManifestSha256'] = sha((prep2 / 'MANIFEST.json').read_bytes())
save(directory / 'ROOT-BINDING.admitted.json', binding)
(root / component).write_bytes(formatted)
for path, expected in binding['overlays'].items():
    assert sha((root / path).read_bytes()) == expected
assert sha(index.read_bytes()) == binding['source']['indexSha256']
assert not git('diff', '--exit-code', '--no-ext-diff', '--no-textconv')
assert not git('diff', '--cached', '--exit-code', '--no-ext-diff', '--no-textconv')
receipt = {'verifiedSecondStaticFailureMembers': first_count, 'verifiedPreviousPrepMembers': prep_count,
    'oldFixtureSha256': sha(before), 'rawConsoleWarnSha256': sha(raw), 'installedFixtureSha256': sha(formatted),
    'installedBytes': len(formatted), 'formatting': formatting, 'runtimePayloadOracleWaitChanges': False,
    'runnerOnlyOutputDirectoryChanged': True, 'runnerSha256': sha(successor),
    'otherFourOverlaysSourceIndexCohortsUnchanged': True, 'bindingSha256': sha((directory / 'ROOT-BINDING.admitted.json').read_bytes()), 'behaviorExecutedDuringSetup': False}
save(directory / 'MATERIALIZATION.json', receipt)
print(json.dumps(receipt, indent=2))
