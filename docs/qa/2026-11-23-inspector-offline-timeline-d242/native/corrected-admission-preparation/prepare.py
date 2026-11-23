import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

E = Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
OUT = Path(__file__).resolve().parent
PREP = E / 'i5-d242-b2-native-qa-preparation-03'
BUILD = E / 'i5-d242-b2-browser12-execution-01'
QA = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')

def pin(p):
    data = Path(p).read_bytes()
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

def ref(p):
    return {'source': str(p), **pin(p)}

def read(p):
    return json.loads(Path(p).read_text(encoding='utf-8-sig'))

def save(name, data):
    with (OUT / name).open('x', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

def check(r):
    assert pin(r['source']) == {k: r[k] for k in ('bytes', 'sha256')}, r['source']

def git(*args):
    env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(QA), *args], env=env, text=True).strip()

def roster(p):
    paths = sorted(x for x in p.rglob('*') if x.is_file())
    assert not any(x.is_symlink() for x in p.rglob('*'))
    return {x.relative_to(p).as_posix(): pin(x) for x in paths}

assert pin(PREP / 'MANIFEST.json')['sha256'] == '717d855b5a5b03f02a2e588d306e8c13b9bd9436764925a81f95ef6898db117e'
members = read(PREP / 'MANIFEST.json')['members']
for m in members:
    check({'source': str(PREP / m['path']), 'bytes': m['bytes'], 'sha256': m['sha256']})
freeze_path = E / 'i5-d242-b2-corrected-freeze-01/FREEZE.json'
freeze = read(freeze_path)
source = freeze['source']
assert source['head'] == '20a69d9b53910a5ede81088e9ff67680f348ce68'
assert source['tree'] == '8be5890a170f2a51af49467e1f71e88839bef28b'
assert git('rev-parse', 'HEAD') == source['head']
assert git('rev-parse', 'HEAD^{tree}') == source['tree']
manifest_path = BUILD / 'BUILD-MANIFEST.json'
assert pin(manifest_path) == {'bytes': 9364, 'sha256': '846a598b764feddc49b9f5ae241482407814b3fe2d2efe8b9f42ec1cda1cb53f'}
manifest = read(manifest_path)
build_result = read(BUILD / 'BUILD-RESULT.json')
browser_result = read(BUILD / 'BROWSER-RESULT.json')
assert manifest['source'] == source
assert build_result['exit'] == 0 and build_result['buildAccepted'] is True
assert build_result['sourceUnchanged'] is True
assert browser_result['sourceUnchanged'] is True and browser_result['buildDistUnchanged'] is True
assert browser_result['ownedDistRestored'] is True
owned = BUILD / 'owned-web-dist'
assert roster(owned) == manifest['webDist']
assert roster(QA / 'apps/web/dist') == manifest['webDist']
apps_web_tree = git('rev-parse', source['head'] + ':apps/web')
binding = read(PREP / 'CORRECTED-ROOT-BINDING.template.json')
index = next(x for x in binding['protectedInputs'] if x['source'].endswith('GraphGoblin15\\index'))
old_index = copy.deepcopy(index)
index.update(bytes=6401836, sha256='4eabeb57705bf85c084b6939b22b475d06a9c7df9b1d903115a834d75a71dac6')
for r in binding['protectedInputs']:
    check(r)
for key, r in binding['runtime'].items():
    if isinstance(r, dict):
        check(r)
check(binding['fixture'])
source_refs = []
for group in ('files', 'protectedCore'):
    for relative, expected in freeze[group].items():
        r = {'source': str(QA / relative), **expected}
        check(r)
        source_refs.append(r)
binding['protectedInputs'].extend(source_refs)
common_index = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir')) / 'index'
assert not common_index.exists()
equivalence = {
    'requestedSource': source,
    'buildSource': manifest['source'],
    'appsWebTreeEqual': True,
    'requestedAppsWebTree': apps_web_tree,
    'buildAppsWebTree': apps_web_tree,
    'sameExactFrozenSourceNoSurrogate': True,
    'buildManifest': ref(manifest_path),
    'buildResult': ref(BUILD / 'BUILD-RESULT.json'),
    'closedBrowserResult': ref(BUILD / 'BROWSER-RESULT.json'),
    'buildAccepted': True,
    'distribution': str(owned),
    'distributionMembers': len(manifest['webDist']),
    'ownedAndWorkspaceDistBothMatchCompleteBuildManifest': True,
    'limit': 'Distribution/source binding only. The separate fixed12 run retained one strict G1 failure (11 pass/1 fail); this binding does not accept geometry or the native10 behavior.'
}
save('SHIPPING-EQUIVALENCE.json', equivalence)
binding.update(executionAdmitted=False, preparationManifestSha256=pin(PREP / 'MANIFEST.json')['sha256'], source=source)
binding['build'] = {'manifest': ref(manifest_path), 'dist': str(owned), 'shippingEquivalence': ref(OUT / 'SHIPPING-EQUIVALENCE.json')}
binding['authority'] = 'UNARMED corrected native10. Root must separately admit source, selection and execution; no runner/case changes.'
save('ROOT-BINDING.DRAFT.json', binding)
admission = {
    'executionAdmitted': False,
    'head': source['head'],
    'selection': 'all',
    'expectedCases': 10,
    'source': source,
    'bindingDraft': ref(OUT / 'ROOT-BINDING.DRAFT.json'),
    'fixturePreparation': ref(PREP / 'MANIFEST.json'),
    'nativeController': ref(PREP / 'native.cjs'),
    'wrapper': ref(PREP / 'run-native.ps1'),
    'sourceFreeze': ref(freeze_path),
    'buildManifest': ref(manifest_path),
    'shippingEquivalence': ref(OUT / 'SHIPPING-EQUIVALENCE.json'),
    'independent63Manifest': ref(E / 'i5-d242-b2-independent63-execution-01/MANIFEST.json'),
    'oldNegativeManifest': ref(E / 'i5-d242-b2-native-old-f642-execution-02/MANIFEST.json'),
    'rootDecision': 'PENDING: root must write a distinct admitted receipt and armed binding after direct checks.',
    'scope': 'Native Edge, entirely intercepted API/static responses, actual browser offline/online and same-route second-tab storage event; no backend/server duplicate-effect claim.',
    'noRetriesOrFixtureChanges': True,
    'providerRouteAuthorized': False
}
save('ROOT-ADMISSION.DRAFT.json', admission)
readback = {
    'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'executed': False,
    'source': source,
    'preparedManifestMembersRehashed': len(members),
    'originalPreparation': ref(PREP / 'MANIFEST.json'),
    'template': ref(PREP / 'CORRECTED-ROOT-BINDING.template.json'),
    'oldIndexHistorical': old_index,
    'currentUiQaIndex': index,
    'indexAdvance': 'Intentional root-owned f642 to 20a69 UIQA rebind; distinct from the NEXT index in the source freeze.',
    'commonIndexAbsent': True,
    'commonIndexPath': str(common_index),
    'allOriginalNonIndexProtectedInputsStillExact': True,
    'freezeEightAndCoreThreeExactInUiQa': True,
    'frozenProtectedRefsAdded': source_refs,
    'ownedDistribution': str(owned),
    'distributionMembers': len(manifest['webDist']),
    'originalRunnerAndAllTenCasesUnchanged': True,
    'freshOutputAbsent': not Path(binding['outputDirectory']).exists(),
    'independent63Closure': ref(E / 'i5-d242-b2-independent63-execution-01/CLOSURE.json'),
    'independent63Report': ref(E / 'i5-d242-b2-independent63-execution-01/REPORT.md')
}
assert readback['freshOutputAbsent']
save('READBACK.json', readback)
print(json.dumps({'draft': str(OUT / 'ROOT-BINDING.DRAFT.json'), 'binding': pin(OUT / 'ROOT-BINDING.DRAFT.json'), 'source': source, 'distMembers': len(manifest['webDist'])}))
