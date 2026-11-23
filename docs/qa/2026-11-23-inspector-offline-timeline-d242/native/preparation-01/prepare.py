import hashlib
import json
from pathlib import Path

out = Path(__file__).parent
e = out.parent
q = Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i5-564-final-astra-max-03')
uiqa = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')


def pin(path):
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'source': str(path), 'bytes': path.stat().st_size, 'sha256': digest}


def save(name, value):
    with (out / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


old_packet = e / 'i5-416-420-post-feedback-browser12-execution-01'
build_path = old_packet / 'BUILD-MANIFEST.json'
build = json.loads(build_path.read_bytes())
assert len(build['webDist']) == 28
for name, expected in build['webDist'].items():
    assert {k: pin(old_packet / 'owned-web-dist' / name)[k] for k in ['bytes', 'sha256']} == expected
requested = {'head': 'f64287619b499c14601e11bce3d1c6b5414b6227', 'tree': '9ee891b9e1f43317afe7f6b7ce9198e473f824fd',
             'parents': ['a0ce7b781e333b70f4711b5e9201ef63c157df1d']}
publication_path = e / 'i5-416-420-archive-integration-01/PUBLICATION-CANDIDATE.json'
publication = json.loads(publication_path.read_bytes())
verified_path = q / 'diagnostic/verified-inputs.json'
verified = json.loads(verified_path.read_bytes())
assert publication['head'] == requested['head'] and publication['parent'] == build['source']['head']
assert publication['source18BlobsAndBytesUnchanged'] and publication['stagedPathsAndBytesVerified'] == publication['archiveFilesIncludingSeal'] + 3
assert verified['source']['metadata'] == ['.prettierignore', '.gitattributes', 'docs/delivery/2026-11-17-five-intents-register.md']
assert pin(q / 'REPORT.md')['sha256'] == '9cb4a10d6241abfa9f6d9dc1711ac44fd8ec412eef03fe6778933fd067e6a61b'
save('OLD-BUILD-EQUIVALENCE.json', {'requestedSource': requested, 'buildSource': build['source'], 'appsWebTreeEqual': True,
    'basis': 'Root exact staged1431 paths = archive1428 plus three non-app metadata paths, 18 shipping-source blobs/bytes unchanged from a0; finalized reviewer source metadata agrees.',
    'publicationReceipt': pin(publication_path), 'reviewerVerifiedInputs': pin(verified_path),
    'finalReport': pin(q / 'REPORT.md'), 'assetMembersRehashed': 28,
    'noMovingNextSourceRead': True, 'noFreshBuildClaimed': True})
previous = json.loads((e / 'i5-d241-session-feedback-qa-rebind-01/ROOT-BINDING.admitted.json').read_bytes())
runtime = previous['runtime']
node = pin(Path(runtime['node']['path'])); assert node['sha256'] == runtime['node']['sha256']
pnpm = pin(Path(runtime['pnpm']['pnpmExecutable'])); assert pnpm['sha256'] == runtime['pnpm']['executableSha256']
test = next(row for row in previous['selectedModules'] if row['name'] == '@playwright/test')
test_pin = pin(Path(test['entry'])); assert test_pin['sha256'] == test['entrySha256']
playwright_path = uiqa / 'node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.js'
contracts_path = uiqa / 'packages/contracts/dist/index.js'
project_pin = pin(uiqa / 'apps/web/package.json')
protected = []
for relative, expected in previous['overlays'].items():
    file = uiqa / relative
    # No overlay source is opened in preparation. Expected hash comes from the
    # prior closed root binding; actual bytes are checked only after admission.
    protected.append({'source': str(file), 'bytes': file.stat().st_size, 'sha256': expected})
git_pointer = (uiqa / '.git').read_text().strip().removeprefix('gitdir: ')
index_path = Path(git_pointer) / 'index'
index_pin = pin(index_path); assert index_pin['sha256'] == previous['source']['indexSha256']
protected.append(index_pin)
protected.append(pin(e / 'i5-d241-feedback-render-diagnostic-qa-03/original.component.8a.tsx'))
protected += [project_pin, pin(uiqa / 'package.json'), pin(uiqa / 'pnpm-lock.yaml'), pin(uiqa / 'node_modules/.modules.yaml'),
              pin(Path(test['manifest'])), test_pin, pin(playwright_path), pin(contracts_path)]
common_runtime = {'node': node, 'pnpm': pnpm, 'workspace': str(uiqa), 'projectPackage': project_pin,
                  'testEntry': test_pin, 'playwrightEntry': pin(playwright_path), 'contractsEntry': pin(contracts_path)}
old_output = e / 'i5-d242-b2-native-old-f642-execution-01'
template = {'executionAdmitted': False, 'preparationManifestSha256': None,
    'rootAdmission': {'source': None, 'bytes': None, 'sha256': None},
    'selection': 'repro', 'source': requested, 'outputDirectory': str(old_output), 'nativeDirectory': str(old_output / 'native'),
    'fixture': pin(out / 'API-FIXTURE.json'), 'runtime': common_runtime, 'protectedInputs': protected,
    'build': {'manifest': pin(build_path), 'dist': str(old_packet / 'owned-web-dist'),
              'shippingEquivalence': pin(out / 'OLD-BUILD-EQUIVALENCE.json')},
    'authority': 'UNARMED. Root must read/admit exact repro4, then fill admission and manifest hash. No browser/test/gate currently authorized.'}
save('OLD-ROOT-BINDING.template.json', template)
corrected_output = e / 'i5-d242-b2-native-corrected-execution-01'
corrected = json.loads(json.dumps(template))
corrected.update(selection='all', source={'head': None, 'tree': None, 'parents': None}, outputDirectory=str(corrected_output), nativeDirectory=str(corrected_output / 'native'))
corrected['build'] = {'manifest': None, 'dist': None, 'shippingEquivalence': None}
corrected['authority'] = 'UNARMED corrected10; requires actual author closure, immutable new source, build/distribution/equivalence and root admission. Same fixture bytes only.'
save('CORRECTED-ROOT-BINDING.template.json', corrected)
original = json.loads((q / 'diagnostic/sent-action-01.json').read_bytes())
baseline = json.loads((q / 'diagnostic/baseline-comparison-02.json').read_bytes())
save('ORIGINAL-OBSERVATIONS.json', {'sources': [pin(q / 'diagnostic/sent-action-01.json'), pin(q / 'diagnostic/baseline-comparison-02.json')],
    'candidateFirstInvocation': [{'action': row['action'], 'mode': row['mode'], 'state': row['state'],
        'pendingObserved': row['pendingObserved'], 'oldHeaderConnectedWhileHeld': row.get('originalHeaderConnectedWhileNewReadHeld'),
        'writes': row.get('outstandingWriteCount', len(row.get('postPayloads', []))),
        'feedbackWithin2s': row.get('feedbackObservedWithinTwoSeconds')} for row in original['cases'] if row['source'] == 'candidate'],
    'firstBaselineFixtureErrorsPreserved': [row for row in original['cases'] if row['source'] == 'baseline'],
    'laterBaselineObserved': [{'action': row['action'], 'state': row['state'], 'feedbackWithin2s': row['feedbackObservedWithinTwoSeconds']} for row in baseline['cases']],
    'newFixtureExpectedCorrectAssertionsAreNotTakenFromObservedVerdicts': True})
inputs = [pin(e / 'i5-d242-b2-remount-correction-01/DECISION.md'), pin(q / 'REPORT.md'),
    pin(q / 'diagnostic/sent-action.cjs'), pin(q / 'diagnostic/baseline-comparison.cjs'),
    pin(q / 'diagnostic/sent-action-01.json'), pin(q / 'diagnostic/baseline-comparison-02.json'),
    pin(verified_path), pin(build_path), pin(publication_path)]
save('INPUTS.json', {'inputs': inputs, 'oldDistributionMembersVerified': 28,
    'npxPresent': 'C:/nvm4w/nodejs/npx.cmd', 'playwrightSkill': 'C:/Users/98jak/.codex/skills/playwright/SKILL.md',
    'activeAuthorSourceRead': False, 'uiqaOverlaySourceReadOrWritten': False, 'noBrowserTestOrServerExecution': True})
print(json.dumps({'oldReproCases': 4, 'correctedAllCases': 10, 'oldAssetsVerified': 28, 'executionAdmitted': False}))
