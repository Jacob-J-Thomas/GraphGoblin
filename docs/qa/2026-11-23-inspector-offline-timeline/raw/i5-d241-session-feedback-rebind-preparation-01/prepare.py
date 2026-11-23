import hashlib
import json
from pathlib import Path

directory = Path(__file__).parent
evidence = directory.parent
baseline = evidence / 'i5-d241-feedback-render-diagnostic-qa-03'
runner_prep = evidence / 'i5-d241-session-feedback-corrected-preparation-01'
freeze_path = evidence / 'i5-d241-session-feedback-corrected-freeze-01/FREEZE.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(name, value):
    with (directory / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def verify(path, digest):
    assert sha((path / 'MANIFEST.json').read_bytes()) == digest
    members = json.loads((path / 'MANIFEST.json').read_text())['members']
    for member in members:
        data = (path / member['path']).read_bytes()
        assert len(data) == member['bytes'] and sha(data) == member['sha256']
    return len(members)


counts = [verify(baseline, '745ff32e330c85d8bdbad1d202c952486404189327c4d7e22cfaa0468e7f2058'),
          verify(runner_prep, '920a0e5fed8c1818af69a4294dcfe37c0d1b8e2963059c26c2dfa8a7bb3bfee8')]
assert sha(freeze_path.read_bytes()) == '777c5e8f9f3a2f6d2d4ef170b5992f3065a2bb1471a55d40d1671dc594fc3ed7'
freeze = json.loads(freeze_path.read_text())
actual_binding = json.loads((baseline / 'ROOT-BINDING.executed.json').read_text())
assert freeze['source']['parents'] == [actual_binding['source']['head']]
target = json.loads((runner_prep / 'ROOT-BINDING.template.json').read_text())
target['source'] = actual_binding['source']
target['source']['head'] = freeze['source']['head']
target['source']['tree'] = freeze['source']['tree']
target['source']['indexSha256'] = None
target['source']['stagedEntriesSha256'] = None
for path, pin in {**freeze['files'], **freeze['protectedCore']}.items():
    target['source']['selectedSources'][path] = pin['sha256']
target['preparationManifestSha256'] = '920a0e5fed8c1818af69a4294dcfe37c0d1b8e2963059c26c2dfa8a7bb3bfee8'
target['rootInstructions'] = 'UNARMED target binding for frozena0ce7b7. Root must first admit exact UIQA d8-to-a0 FF; then read live source/index/cohorts/modules/five overlays, fill new raw index/staged digest and exact execution admission. No overlay materialization or B3 reapplication is allowed; exact55 remains. No FF or execution authority from this preparation.'
assert target['executionAdmitted'] is False
assert target['overlays'] == actual_binding['overlays']
save('ROOT-BINDING.target.unarmed.json', target)
actual_after = json.loads((baseline / 'after.json').read_text())
plan = {
    'ffAdmitted': False, 'executionAdmitted': False,
    'worktree': 'G:/ggq/gg-i5-offline-ui-qa/GraphGoblin',
    'freezePath': str(freeze_path), 'freezeSha256': sha(freeze_path.read_bytes()),
    'currentHead': actual_after['head'], 'currentTree': actual_after['tree'],
    'currentRawIndexSha256': actual_after['indexSha256'], 'currentStagedEntriesSha256': actual_after['stagedEntriesSha256'],
    'targetSource': freeze['source'], 'exactAllowedDeltaPaths': freeze['exactDeltaFromPriorFreeze'],
    'plannedGitArgv': ['git', '--no-optional-locks', '-C', 'G:/ggq/gg-i5-offline-ui-qa/GraphGoblin', 'merge', '--ff-only', freeze['source']['head']],
    'futureEvidenceDirectory': str(evidence / 'i5-d241-session-feedback-qa-rebind-01'),
    'preserveRawIndexBytesAndStagedDigestBeforeAfter': True,
    'preserveRawFiveOverlaysBeforeAfter': actual_after['overlays'],
    'b3AlreadyInstalledDoNotReapply': actual_after['overlays']['apps/web/e2e/independent-416-listener.qa.spec.ts'],
    'protectedCore': freeze['protectedCore'],
    'protectedConfigPaths': ['.gitattributes', '.npmrc', '.nvmrc', 'eslint.config.js', 'turbo.json', 'tsconfig.base.json', 'tsconfig.json', 'tsconfig.build.json', 'apps/web/tsconfig.json', 'apps/web/vitest.config.ts', 'apps/web/playwright.config.ts', 'apps/web/vite.config.ts', 'apps/web/vite.goblin.config.ts'],
    'configAndDependencyCondition': 'Before FF assert actual six-path Git delta, all config/core/root19/independent18 Git paths equal across d8/a0, tracked/staged clean, matching current index/common absence. Record actual materialized config pins before/after.',
    'root19InputReference': actual_binding['rootInstallInputs19'], 'independent18InputReference': actual_binding['independentInputs18'],
    'metadataReference': actual_binding['metadata'], 'selectedModulesReference': actual_binding['selectedModules'],
    'runtimeReference': actual_binding['runtime'],
    'afterFF': 'Rehash all selected-source paths plus every final freeze file and protected core. Preserve every overlay byte unchanged. Verify configs, cohorts, metadata, selected module files/runtime and common index. Fill target binding from actual new head/tree/raw index/staged digest; keep execution unarmed for root readback.',
    'runnerPath': str(runner_prep / 'run-corrected.ps1'),
    'runnerSha256': sha((runner_prep / 'run-corrected.ps1').read_bytes()),
    'runnerDelta': 'None. Exact already-prepared e2c639 fresh2 then conditional full63; same55 for both. No new fixture or B3 step.',
    'closedMembersReverified': counts,
    'noGitOrProductCommandsExecutedInThisPreparation': True,
}
save('FF-PLAN.json', plan)
print(json.dumps({'targetHead': freeze['source']['head'], 'targetTree': freeze['source']['tree'],
                  'deltaPaths': len(plan['exactAllowedDeltaPaths']), 'runnerDelta': 'none',
                  'runnerSha256': plan['runnerSha256'], 'targetBindingSha256': sha((directory / 'ROOT-BINDING.target.unarmed.json').read_bytes()),
                  'ffAdmitted': False, 'executionAdmitted': False}, indent=2))
