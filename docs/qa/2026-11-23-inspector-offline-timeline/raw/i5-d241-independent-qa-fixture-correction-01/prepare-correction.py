from datetime import datetime, timezone
import difflib
import hashlib
import json
import os
from pathlib import Path
import subprocess

directory = Path(__file__).parent
evidence = directory.parent
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
first = evidence / 'i5-416-420-ui-independent-qa-01/corrected-component-execution-01'
old_prep = evidence / 'i5-416-420-corrected-component-execution-preparation-01'
new_prep = evidence / 'i5-416-420-corrected-component-execution-preparation-02'
binding_path = evidence / 'i5-d241-independent-qa-source-rebind-01/ROOT-BINDING.admitted.json'
component_path = 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'
old_sha = '4bf07f6fb1e26725dbc08247534eb364231a50564010f048bcc51bdb1101daa6'
prefix_sha = 'd0eb5cabb5f047d745a547b866b52397ebcca31d7f4143e47e05ac185609f8fe'
old_manifest_sha = '90aec9fdb3f52faa9056589f86751126c5c6df8a06db411255921fc02751e7b2'
root_message = "Root full61 CLOSED exec50437 exit1:60pass1fail,0filtered/todo, controls unchanged. Root read exact rawfailure and fixture1094. Same ambiguous singular network text: intended ScriptRecovery p role=alert plus p without role. Duplicate dispatch softassert before failure PASSED; finalonePOSTafterfailureunreached. This is concrete independent-fixture query defect; product semantics unchanged. ROOT ADMISSION: preserve all firstphase files/rawfixture4bf and seal first results; change ONLY this one appended B2 lookup to header-scoped findByRole('alert') + toBeVisible AND exact anchored text. Keep all preceding/following assertions, schedules/deadlines, original49prefix35518B, names61. Prepare fresh runner/binding copy outside sealed prep with ONLY ownedexecutiondir -02 and this newoverlayhash (schema/template), same d71head/tree/index/cohorts/4otheroverlays/20s/1worker/retry0. You may execute ONE new unfiltered61 phase once you've verified exact allowed fixture diff and equivalent runner mechanics, and saved root-admission receipt quoting this message+rawfailure. Sole heavy slot GRANTED to you immediately, no other checks currently running. Stop firstfailure/noautomaticretry. Keep browser12 prep progressing after closure. Report exact before/afterhash+runnerdelta+results; no product/NEXT edits."


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_bytes(path, data):
    with path.open('xb') as stream:
        stream.write(data)


def save(path, value):
    write_bytes(path, (json.dumps(value, indent=2) + '\n').encode())


def manifest(path, scope):
    members = [{'path': str(member.relative_to(path)).replace('\\', '/'), 'bytes': member.stat().st_size,
                'sha256': sha(member.read_bytes())} for member in sorted(path.rglob('*'))
               if member.is_file() and member.name != 'MANIFEST.json']
    save(path / 'MANIFEST.json', {'scope': scope, 'members': members})
    return sha((path / 'MANIFEST.json').read_bytes())


def git(*arguments):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(root), *arguments],
                                   env=dict(os.environ, GIT_OPTIONAL_LOCKS='0'))


binding_bytes = binding_path.read_bytes()
assert sha(binding_bytes) == 'f78a502644cf391b1ccd794d16ff0cbe8a9844cbec2f17fdc001ad1bf5b8ad65'
binding = json.loads(binding_bytes)
assert binding['source']['head'] == 'd71fbe81a3bff5ea3c9cb672fa470a16c0d4a881'
assert sha((old_prep / 'MANIFEST.json').read_bytes()) == old_manifest_sha
old_members = json.loads((old_prep / 'MANIFEST.json').read_text())['members']
for member in old_members:
    data = (old_prep / member['path']).read_bytes()
    assert len(data) == member['bytes'] and sha(data) == member['sha256']
for key, command in [('head', ['rev-parse', 'HEAD']), ('tree', ['rev-parse', 'HEAD^{tree}'])]:
    assert git(*command).decode().strip() == binding['source'][key]
index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
assert sha(index.read_bytes()) == binding['source']['indexSha256']
assert sha(git('ls-files', '--stage', '-z')) == binding['source']['stagedEntriesSha256']
assert not (common / 'index').exists()
assert git('status', '--porcelain=v1', '--untracked-files=all', '-z').decode().split('\0')[:-1] == binding['source']['status']
for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays', 'selectedSources']:
    expected = binding['source'][group] if group == 'selectedSources' else binding[group]
    for path, pin in expected.items():
        data = (root / path).read_bytes()
        assert (sha(data) == pin if isinstance(pin, str) else {'bytes': len(data), 'sha256': sha(data)} == pin), path
assert not git('diff', '--exit-code', '--no-ext-diff')
assert not git('diff', '--cached', '--exit-code', '--no-ext-diff')
raw = (root / component_path).read_bytes()
assert sha(raw) == old_sha and sha(raw[:35518]) == prefix_sha
phase = json.loads((first / 'PHASE-RECEIPT.json').read_text())
selection = json.loads((first / 'ACTUAL-SELECTION.json').read_text())
assert phase['afterMatchesRootBinding'] and phase['stageReached'] == 'full61'
assert selection == {'actualCases': 61, 'passed': 60, 'failed': 1, 'filteredOrPending': 0, 'todo': 0,
                     'expectedCases': 61, 'patternUsed': False, 'processExit': 1}
results = json.loads((first / '06-full61.json').read_text())
failed = [case for suite in results['testResults'] for case in suite['assertionResults'] if case['status'] == 'failed']
assert len(failed) == 1 and failed[0]['title'] == 'B2 retains a sent script error and sends no second retry while the first is unresolved'
assert 'Found multiple elements with the text: The GraphGoblin API cannot be reached.' in '\n'.join(failed[0]['failureMessages'])
write_bytes(first / 'executed.component.tsx', raw)
write_bytes(first / 'REPORT.md', (
    'First corrected-source full61 run at immutable d71fbe/tree57e4 closed exit1:60passed,1failed,0filtered/pending/todo. '
    'All typed/scoped static commands passed. The one B2 failure is a singular text lookup matching the intended ScriptRecovery alert and an unrelated non-alert paragraph; the full raw DOM/message remains. '
    'The preceding soft duplicate-dispatch assertion passed; the final one-POST assertion after this lookup was unreached. This result is not61pass. '
    'Exact executed component4bf07f6 is copied here before the root-admitted one-lookup fixture correction. Original49prefix remains35518bytes/d0eb5cab. '
    'Before/after root-bound source/index/19+18 cohorts/all5 overlays and selected modules matched. Root executed this phase; no build/browser evidence follows. '
    'The separately admitted correction/rerun does not overwrite these first results.\n').encode())
first_manifest = manifest(first, 'First root-executed corrected-source61 result, exact4bf fixture and raw failures; excludes manifest itself')
admission = {
    'capturedUtc': datetime.now(timezone.utc).isoformat(), 'origin': '/root message to /root/i5_final_inspector_qa',
    'rootMessageVerbatim': root_message, 'firstPhase': str(first), 'firstPhaseManifestSha256': first_manifest,
    'firstSelection': selection, 'failedCaseVerbatim': failed[0],
    'rawStderr': {'path': str(first / '06-full61.stderr.log'), 'sha256': sha((first / '06-full61.stderr.log').read_bytes())},
    'singleLookupCorrectionOnly': True, 'oneUnfiltered61ExecutionAdmitted': True, 'noProductEdits': True,
}
save(directory / 'ROOT-ADMISSION.json', admission)
newline = b'\r\n' if b'\r\n' in raw else b'\n'
old = b"    expect(await screen.findByText('The GraphGoblin API cannot be reached.')).toBeVisible();" + newline
new = newline.join([
    b"    const runHeader = (await heading(run.id)).closest('header');",
    b"    if (!runHeader) throw new Error('Run header must be present');",
    b"    const scriptError = await within(runHeader).findByRole('alert');",
    b"    expect(scriptError).toBeVisible();",
    b"    expect(scriptError).toHaveTextContent(/^The GraphGoblin API cannot be reached\\.$/);",
]) + newline
assert raw.count(old) == 1 and raw.index(old) > 35518
corrected = raw.replace(old, new)
assert corrected.replace(new, old) == raw and corrected[:35518] == raw[:35518]
corrected_sha = sha(corrected)
write_bytes(directory / 'component.before.tsx', raw)
write_bytes(directory / 'component.corrected.tsx', corrected)
write_bytes(directory / 'fixture.diff', ''.join(difflib.unified_diff(raw.decode().splitlines(keepends=True),
    corrected.decode().splitlines(keepends=True), fromfile='first/component4bf.tsx', tofile='corrected/component.tsx')).encode())
new_prep.mkdir(exist_ok=False)
for name in ['run-corrected-component.ps1', 'module-boundary.cjs', 'ROOT-BINDING.template.json', 'ROOT-BINDING.schema.json']:
    data = (old_prep / name).read_bytes()
    if name == 'run-corrected-component.ps1':
        token = b"$taskEvidence = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-420-ui-independent-qa-01/corrected-component-execution-01'"
        assert data.count(token) == 1
        replacement = token.replace(b'corrected-component-execution-01', b'corrected-component-execution-02')
        changed = data.replace(token, replacement)
        assert changed.replace(replacement, token) == data
    elif name == 'ROOT-BINDING.template.json':
        value = json.loads(data)
        value['executionDirectory'] = value['executionDirectory'][:-2] + '02'
        value['overlays'][component_path] = corrected_sha
        changed = (json.dumps(value, indent=2) + '\n').encode()
        value['executionDirectory'] = json.loads(data)['executionDirectory']
        value['overlays'][component_path] = old_sha
        assert value == json.loads(data)
    elif name == 'ROOT-BINDING.schema.json':
        value = json.loads(data)
        value['properties']['executionDirectory']['const'] = value['properties']['executionDirectory']['const'][:-2] + '02'
        value['properties']['overlays']['const'][component_path] = corrected_sha
        changed = (json.dumps(value, indent=2) + '\n').encode()
        value['properties']['executionDirectory']['const'] = json.loads(data)['properties']['executionDirectory']['const']
        value['properties']['overlays']['const'][component_path] = old_sha
        assert value == json.loads(data)
    else:
        changed = data
    write_bytes(new_prep / name, changed)
write_bytes(new_prep / 'REPORT.md', (
    'Root-admitted second corrected-source61 mechanics. Prior sealed preparation01 remains unchanged. '
    'Runtime runner differs by only its owned execution directory literal, now corrected-component-execution-02. '
    'Template/schema differ only by the same directory and the one corrected component-overlay hash. Module resolver is byte-identical. '
    'No pattern, worker/retry/deadline/environment/source/cohort/runtime mechanics changed. Root admission and raw first failure are at '
    + str(directory / 'ROOT-ADMISSION.json') + '. '
    'First61 remains60pass1lookupfailure. Only the appended B2 lookup is corrected to a header-scoped alert, visible plus exact anchored text; all schedules, names, other assertions and original49prefix are retained. '
    'Root admitted exactly one new unfiltered61 phase; stop first failure, no automatic retry, no product/build/browser/NEXT change.\n').encode())
new_manifest_sha = manifest(new_prep, 'Only root-admitted execution directory and corrected overlay identity changes; excludes manifest itself')
new_binding = json.loads(binding_bytes)
new_binding['executionDirectory'] = new_binding['executionDirectory'][:-2] + '02'
new_binding['overlays'][component_path] = corrected_sha
new_binding['rootAdmission'] = {'path': str(directory / 'ROOT-ADMISSION.json'), 'sha256': sha((directory / 'ROOT-ADMISSION.json').read_bytes())}
new_binding['preparationManifestSha256'] = new_manifest_sha
save(directory / 'ROOT-BINDING.admitted.json', new_binding)
(root / component_path).write_bytes(corrected)
assert sha((root / component_path).read_bytes()) == corrected_sha
assert sha(index.read_bytes()) == binding['source']['indexSha256']
assert sha(git('ls-files', '--stage', '-z')) == binding['source']['stagedEntriesSha256']
for path, expected in binding['overlays'].items():
    assert sha((root / path).read_bytes()) == (corrected_sha if path == component_path else expected), path
for path, expected in binding['source']['selectedSources'].items():
    assert sha((root / path).read_bytes()) == expected, path
assert not git('diff', '--exit-code', '--no-ext-diff')
assert not git('diff', '--cached', '--exit-code', '--no-ext-diff')
receipt = {
    'beforeComponentSha256': old_sha, 'afterComponentSha256': corrected_sha,
    'original49PrefixBytes': 35518, 'original49PrefixSha256': prefix_sha, 'original49PrefixUnchanged': True,
    'onlyFixtureDelta': 'One appended B2 singular text lookup -> header-scoped findByRole alert, visibility and exact anchored text.',
    'firstPhaseManifestSha256': first_manifest, 'runnerOnlyExecutionDirectoryLiteralChanged': True,
    'templateSchemaOnlyDirectoryAndComponentHashChanged': True, 'moduleResolverByteIdentical': True,
    'newPreparationManifestSha256': new_manifest_sha, 'newPreparationDirectory': str(new_prep),
    'admittedBindingSha256': sha((directory / 'ROOT-BINDING.admitted.json').read_bytes()),
    'executionDirectory': new_binding['executionDirectory'], 'sourceIndexOtherFourOverlaysUnchanged': True,
    'productTestOrBuildOrBrowserExecutedDuringPreparation': False, 'nextRead': False,
}
save(directory / 'CORRECTION.json', receipt)
print(json.dumps(receipt, indent=2))
