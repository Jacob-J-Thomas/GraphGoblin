import hashlib
import json
import os
from pathlib import Path
import subprocess

directory = Path(__file__).parent
evidence = directory.parent
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
prep1 = evidence / 'i5-d241-observation-entry-loss-preparation-01'
prep2 = evidence / 'i5-d241-observation-entry-loss-preparation-02'
old_mechanics = evidence / 'i5-416-420-corrected-component-execution-preparation-02'
mechanics = directory / 'mechanics'
source_binding_path = evidence / 'i5-d241-independent-qa-final-carry-01/FINAL-SOURCE-BINDING.unarmed.json'
component = 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'
expected_component = '8a344821db18ec25fa7cf2219c07721acf4eddae0d109b8eb3a412ca58aa6c2b'
pattern = 'B1 residual: observation replacement after surfaced loss'
environment = dict(os.environ, GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def write(path, data):
    with path.open('xb') as stream:
        stream.write(data)


def git(*arguments):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(root), *arguments], env=environment)


def verify(path, digest):
    assert sha((path / 'MANIFEST.json').read_bytes()) == digest
    members = json.loads((path / 'MANIFEST.json').read_text())['members']
    for member in members:
        data = (path / member['path']).read_bytes()
        assert len(data) == member['bytes'] and sha(data) == member['sha256'], member['path']
    return len(members)


counts = [verify(prep1, '15b023a6d87eca46708e63e8abc0d1b8ea49e779928b0ab321cb38e980db1771'),
          verify(prep2, 'eaf0072353cfb999dc4462be3419ef098a0573ce85a3a3e7943918203d227794'),
          verify(old_mechanics, '5f14927a8ec2b07eaea0fb94ac9680aac1942e9945e8dc212667da511163d2b2')]
assert sha(source_binding_path.read_bytes()) == '7e8c13a5e6348c9e97ab3243311c5f37137b5db199dab36ec314bc1baf2d9319'
source_binding = json.loads(source_binding_path.read_text())
for field, command in [('head', ['rev-parse', 'HEAD']), ('tree', ['rev-parse', 'HEAD^{tree}'])]:
    assert git(*command).decode().strip() == source_binding['source'][field], field
index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
assert sha(index.read_bytes()) == source_binding['source']['indexSha256']
assert sha(git('ls-files', '--stage', '-z')) == source_binding['source']['stagedEntriesSha256']
assert not (common / 'index').exists()
assert git('status', '--porcelain=v1', '--untracked-files=all', '-z').decode().split('\0')[:-1] == source_binding['source']['status']
for group in ['rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays', 'selectedSources']:
    pins = source_binding['source'][group] if group == 'selectedSources' else source_binding[group]
    for path, expected in pins.items():
        data = (root / path).read_bytes()
        assert (sha(data) == expected if isinstance(expected, str) else {'bytes': len(data), 'sha256': sha(data)} == expected), path
for item in source_binding['selectedModules']:
    assert sha(Path(item['entry']).read_bytes()) == item['entrySha256'], item['name']
    assert str(Path(item['entry']).resolve()).casefold() == str(Path(item['realEntry']).resolve()).casefold()
    if 'manifest' in item:
        assert sha(Path(item['manifest']).read_bytes()) == item['manifestSha256'], item['name']
assert not git('diff', '--exit-code', '--no-ext-diff', '--no-textconv')
assert not git('diff', '--cached', '--exit-code', '--no-ext-diff', '--no-textconv')
base = (root / component).read_bytes()
assert sha(base) == '00c1cd923039959bf92a20d80e0f1c7791031dd99419700eff957e07a9847975'
proposed = (prep2 / 'component.proposed.tsx').read_bytes()
assert sha(proposed) == expected_component and proposed[:len(base)] == base
write(directory / 'base61.component.tsx', base)
write(directory / 'executed.component.tsx', proposed)
save(directory / 'before-materialization.json', source_binding)
admission = {
    'origin': '/root message to /root/i5_final_inspector_qa',
    'rootMessageVerbatim': "Root admits preparation02 exact component8a344821... over ONLY existing UIQA untracked component00c1cd9..., retaining all61 cases literalprefix plus2. Bind current clean223/treec20/index900e, dependency/module/other4overlaypins; preserve sealedprep01/02. Own soleheavy now: fullwebtypecheck, scopedcomponentlint/format then ONE structured nativepnpm2case execution pattern 'B1 residual: observation replacement after surfaced loss',61filtered,worker1retry0/current20s freshworker browserLoss0. Preserve raw argv/results/streams/beforeafter; do not rerun/adjust if setupfails, no privatecounter injection. Report actualoldPOST/newPOST/errorfeedback and every precondition reached pervariant, especially application ApiKeyPanel path. No productedit or browser. Releaseheavy onclosure. No formalreview consumed.",
    'admittedComponentSha256': expected_component, 'candidateHead': source_binding['source']['head'],
    'candidateTree': source_binding['source']['tree'], 'testNamePatternOneArgument': pattern,
    'plannedSelected': 2, 'plannedFiltered': 61, 'oneInvocationOnly': True,
}
save(directory / 'ROOT-ADMISSION.json', admission)
mechanics.mkdir(exist_ok=False)
runner = (old_mechanics / 'run-corrected-component.ps1').read_text()
old_directory = "G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-420-ui-independent-qa-01/corrected-component-execution-02"
new_directory = str(directory / 'old').replace('\\', '/')
assert runner.count(old_directory) == 1
runner = runner.replace(old_directory, new_directory)
old_lint = "$relativeOverlays = @('src/runs/RunInspectorPage.independent-416.qa.test.tsx','e2e/independent-416-420-helpers.ts','e2e/independent-420-geometry.ts','e2e/independent-416-listener.qa.spec.ts','e2e/independent-420-geometry.qa.spec.ts')"
assert runner.count(old_lint) == 1
runner = runner.replace(old_lint, "$relativeOverlays = @('src/runs/RunInspectorPage.independent-416.qa.test.tsx')")
runner = runner.replace("$stage = 'full61'", "$stage = 'replacement2'")
runner = runner.replace('06-full61', '06-replacement2')
needle = "'src/runs/RunInspectorPage.independent-416.qa.test.tsx','--maxWorkers=1'"
assert runner.count(needle) == 1
runner = runner.replace(needle, "'src/runs/RunInspectorPage.independent-416.qa.test.tsx','--testNamePattern','" + pattern + "','--maxWorkers=1'")
runner = runner.replace('expectedCases=61; patternUsed=$false', 'expectedCases=63; expectedSelected=2; expectedFiltered=61; patternUsed=$true')
runner = runner.replace('$summary.actualCases -ne 61 -or ($summary.passed + $summary.failed) -ne 61 -or $summary.filteredOrPending -ne 0', '$summary.actualCases -ne 63 -or ($summary.passed + $summary.failed) -ne 2 -or $summary.filteredOrPending -ne 61')
runner = runner.replace('Full61 selection mismatch', 'Targeted2 selection mismatch')
write(mechanics / 'run-old-replacement.ps1', runner.encode())
write(mechanics / 'module-boundary.cjs', (old_mechanics / 'module-boundary.cjs').read_bytes())
template = json.loads((old_mechanics / 'ROOT-BINDING.template.json').read_text())
template['executionDirectory'] = str(directory / 'old')
template['overlays'] = {**source_binding['overlays'], component: expected_component}
template['selection'] = {'file': 'src/runs/RunInspectorPage.independent-416.qa.test.tsx', 'cases': 63,
                         'selected': 2, 'filtered': 61, 'maxWorkers': 1, 'retry': 0,
                         'testTimeoutMs': 20000, 'hookTimeoutMs': 20000, 'testNamePattern': pattern}
save(mechanics / 'ROOT-BINDING.template.json', template)
members = [{'path': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
           for path in sorted(mechanics.iterdir()) if path.is_file()]
save(mechanics / 'MANIFEST.json', {'scope': 'Finite root-admitted two-case runner; original normalized structured pnpm mechanics retained', 'members': members})
binding = json.loads((evidence / 'i5-416-420-ui-independent-qa-01/corrected-component-execution-02/ROOT-BINDING.executed.json').read_text())
for key in ['source', 'rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays', 'selectedModules', 'runtime']:
    binding[key] = source_binding[key]
binding['overlays'] = {**binding['overlays'], component: expected_component}
binding['executionDirectory'] = template['executionDirectory']
binding['selection'] = template['selection']
binding['rootAdmission'] = {'path': str(directory / 'ROOT-ADMISSION.json'), 'sha256': sha((directory / 'ROOT-ADMISSION.json').read_bytes())}
binding['preparationManifestSha256'] = sha((mechanics / 'MANIFEST.json').read_bytes())
binding['executionAdmitted'] = True
save(directory / 'ROOT-BINDING.admitted.json', binding)
(root / component).write_bytes(proposed)
assert sha((root / component).read_bytes()) == expected_component
assert sha(index.read_bytes()) == source_binding['source']['indexSha256']
for path, expected in source_binding['overlays'].items():
    assert sha((root / path).read_bytes()) == (expected_component if path == component else expected), path
assert not git('diff', '--exit-code', '--no-ext-diff', '--no-textconv')
assert not git('diff', '--cached', '--exit-code', '--no-ext-diff', '--no-textconv')
receipt = {
    'candidateHead': binding['source']['head'], 'candidateTree': binding['source']['tree'],
    'indexSha256': binding['source']['indexSha256'], 'oldComponentSha256': sha(base),
    'executedComponentSha256': expected_component, 'literalBase61Bytes': len(base), 'literalBase61Unchanged': True,
    'original49PrefixSha256': sha(proposed[:35518]), 'preservedPacketMemberCounts': counts,
    'onlyCheckoutDelta': component, 'otherFourOverlaysAndSourceIndexDependenciesModulesUnchanged': True,
    'runnerPath': str(mechanics / 'run-old-replacement.ps1'),
    'bindingSha256': sha((directory / 'ROOT-BINDING.admitted.json').read_bytes()),
    'runnerScopeDelta': 'Owned output directory, scoped component lint/format, exact two-case pattern and2/61 selection accounting; structured pnpm/runtime/closure logic unchanged.',
    'productTestsExecutedDuringSetup': False,
}
save(directory / 'MATERIALIZATION.json', receipt)
print(json.dumps(receipt, indent=2))
