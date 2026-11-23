from base64 import b64decode
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys

P = Path(__file__).resolve().parent
E = P.parent
W = Path(r'G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
OUT = E / 'i5-416-420-baseline-g1-execution-01'
ORIGINAL_RUN = E / 'i5-416-420-browser12-execution-01'
ORIGINAL_PREP = E / 'i5-416-420-browser12-execution-preparation-01'
FOLLOWUP_PREP = E / 'i5-416-420-native-failure-followup-preparation-01'
G1 = 'independent-420-geometry.qa.spec.ts'
FOCUS = 'G1: real built Timeline geometry at1440/320 and actual CSS200% page text for5/6/15digits'
DIST = W / 'apps/web/dist'
PNPM = Path('C:/nvm4w/nodejs/node_modules/pnpm/pnpm.exe')
GIT = Path('C:/Program Files/Git/cmd/git.exe')
NODE = Path(os.environ['USERPROFILE']) / '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe'
BROWSER_OVERLAYS = {
    'apps/web/e2e/independent-416-420-helpers.ts': 'e642e8502fde06b41047f082fb7446183dd022097bd12f57cde46351d904bd38',
    'apps/web/e2e/independent-420-geometry.ts': '2baa8bebcc6ecab903604ba76fb0b5bad5e728434d823b008f44347392dc828e',
    'apps/web/e2e/independent-416-listener.qa.spec.ts': '581e9166dfad8d9b8d734dd9bc467d1b3a09e82283127e3a3e555370e85619b4',
    'apps/web/e2e/independent-420-geometry.qa.spec.ts': '252b198c91712d068fbbb0d466be2ae025d633d529116d110c8b5548cc7294ad',
}
TRACKED_SPECS = {
    'apps/web/e2e/inspector-availability.spec.ts': '7c3bf7921d5ef1848fee44e7c7ae0f4dd6912f11ce4b4687cd9ca59bbfcd9ff5',
    'apps/web/e2e/bounded-history.spec.ts': '4a2f365ad6aa96fd27b7dc5e7272c78cfb4702da87619abe7b8f5a08386edb1f',
}
EXTRA_OVERLAY = 'apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx'
FRESH_INSTALL = E / 'i5-416-ui-qa-fresh-install-01/AFTER.json'
ENV_NAMES = {
    'appdata', 'localappdata', 'userprofile', 'homepath', 'homedrive', 'programdata',
    'programfiles', 'programfiles(x86)', 'programw6432', 'public', 'systemroot', 'windir',
    'systemdrive', 'comspec', 'path', 'pathext', 'number_of_processors', 'processor_architecture',
}
CORED = (
    'apps/web/src/api/queries.ts',
    'apps/web/src/runs/inspector-read-provenance.ts',
    'apps/web/src/runs/inspector-read-provenance.test.ts',
)


def need(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def utc():
    return datetime.now(timezone.utc).isoformat()


def pin(path):
    with path.open('rb') as stream:
        digest = sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return {'bytes': path.stat().st_size, 'sha256': digest.hexdigest()}


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def put(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def inside(path, root):
    return path.resolve(strict=True).is_relative_to(root.resolve(strict=True))


def make_env(tmp, browser=False):
    env = {key: value for key, value in os.environ.items() if key.casefold() in ENV_NAMES}
    path_key = next(key for key in env if key.casefold() == 'path')
    env[path_key] = str(NODE.parent) + os.pathsep + env[path_key]
    env.update({'TEMP': str(tmp), 'TMP': str(tmp)})
    if browser:
        env.update({
            'GG_TEST_DATA_PREFIX': 'gg-i5-browser12-', 'GG_E2E_MAIN_PORT': '0',
            'GG_E2E_CONTROL_PORT': '0', 'GG_OLLAMA_ENABLED': 'false',
            'GG_E2E_WEB_DIST': str(OUT / 'owned-web-dist'),
            'I5_QA_CASE_BINDING': str(OUT / 'I5_QA_CASE_BINDING.json'),
            'PLAYWRIGHT_JSON_OUTPUT_FILE': str(OUT / 'browser-results.json'),
        })
    return env


def check_binaries(env):
    wanted = {
        NODE: 'dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f',
        PNPM: '627592f9596b0de81c6642f1b3b6f92793be753359eb010dcecf2eb4dcac266b',
        GIT: 'fec691d80fccc35fcc309fbc9f720536c1d795b8a562ec169f28c9923da9600f',
    }
    result = {str(path): pin(path) for path in wanted}
    need(all(result[str(path)]['sha256'] == digest for path,digest in wanted.items()),
         'Pinned tool changed')
    whole_path = next(value for key,value in env.items() if key.casefold() == 'path')
    need(Path(shutil.which('node.exe', path=whole_path) or '.').resolve() == NODE.resolve(),
         'Node must be first on PATH')
    return result


def command(label, args, env):
    stdout, stderr = (OUT / f'{label}.{kind}' for kind in ('stdout','stderr'))
    when = utc()
    argv = [str(item) for item in args]
    with stdout.open('xb') as out, stderr.open('xb') as err:
        result = subprocess.run(argv, cwd=W, env=env, stdout=out, stderr=err, check=False,
                                creationflags=subprocess.CREATE_NO_WINDOW)
    put(OUT / f'{label}.json', {'argv': argv, 'cwd': str(W), 'startedUtc': when, 'finishedUtc': utc(),
                                'exit': result.returncode, 'stdout': pin(stdout), 'stderr': pin(stderr)})
    return result.returncode


def git(*args):
    env = os.environ | {'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_LAZY_FETCH': '1'}
    return subprocess.check_output([str(GIT),'--no-optional-locks','-C',str(W),*args], env=env)


def snapshot(binding):
    head = git('rev-list','--parents','-1','HEAD').decode('ascii').split()
    tree = git('rev-parse','HEAD^{tree}').decode('ascii').strip()
    expected = binding['source']
    need(head == [expected['head'], *expected['parents']] and tree == expected['tree'],
         'UIQA is not at the exact final freeze')
    index = (W / git('rev-parse','--git-path','index').decode('utf-8').strip()).resolve()
    common = (W / git('rev-parse','--git-common-dir').decode('utf-8').strip()).resolve()
    need(pin(index)['sha256'] == binding['indexSha256'] and not os.path.lexists(common / 'index'),
         'UIQA index changed or shared index present')
    overlays = binding['overlays']
    need(set(overlays) in (set(BROWSER_OVERLAYS), set(BROWSER_OVERLAYS) | {EXTRA_OVERLAY}),
         'Unexpected untracked overlay roster')
    need(all(overlays[name] == value for name,value in BROWSER_OVERLAYS.items()), 'Browser overlay pin changed')
    actual_status = sorted(git('status','--porcelain=v1','-z','--untracked-files=all').decode('utf-8').split('\0')[:-1])
    need(actual_status == sorted('?? ' + name for name in overlays), 'Tracked change or unadmitted overlay')
    for name, digest in (overlays | TRACKED_SPECS | binding['sourceFiles']).items():
        need(inside(W / name, W) and pin(W / name)['sha256'] == digest, f'Frozen input differs: {name}')
    need(set(CORED) <= set(binding['sourceFiles']), 'Three protected core SHA256 pins required')
    need(all(name in binding['sourceFiles'] for name in ('apps/web/playwright.config.ts',
        'apps/web/e2e/global-setup.ts','apps/web/e2e/server.ts','apps/web/e2e/fixtures.ts')),
        'Exact API/browser harness source pins required')
    need(pin(FRESH_INSTALL)['sha256'] == binding['freshInstallAfterSha256'], 'Fresh dependency baseline changed')
    for name, expected_pin in read(FRESH_INSTALL)['inputs'].items():
        need(pin(W / name) == expected_pin, f'Frozen dependency input differs: {name}')
    install_meta = {
        rel: pin(W / rel) for rel in ('node_modules/.modules.yaml','node_modules/.pnpm/lock.yaml')
    }
    need(install_meta == binding['modules'], 'UIQA module metadata changed')
    need(pin(W/'apps/web/node_modules/@playwright/test/package.json')['sha256'] == binding['playwrightManifestSha256']
         and inside(W/'apps/web/node_modules/@playwright/test', W), 'Unbound Playwright installation')
    tracked = {}
    for entry in git('ls-files','-t','-z').decode('utf-8').split('\0')[:-1]:
        tag, name = entry[0], entry[2:]
        if tag == 'S':
            continue
        need(inside(W / name, W), f'Tracked path resolves outside UIQA: {name}')
        tracked[name] = pin(W / name)
    digest = sha256(json.dumps(tracked, sort_keys=True, separators=(',',':')).encode('utf-8')).hexdigest()
    return {'source': expected, 'index': pin(index), 'commonIndexPresent': False, 'overlays': overlays,
            'sourceFiles': binding['sourceFiles'], 'trackedMaterializedCount': len(tracked),
            'trackedMaterializedBytesSha256': digest, 'modules': install_meta,
            'playwrightManifestSha256': binding['playwrightManifestSha256']}


def tree_manifest(root):
    members = {}
    for path in sorted(root.rglob('*')):
        need(inside(path, root), f'Distribution contains redirected item: {path}')
        if path.is_file():
            members[path.relative_to(root).as_posix()] = pin(path)
    need({'index.html','sw.js','chat-update-worker.js'} <= members.keys(), 'Incomplete built web distribution')
    return members


def geometry_files(report, tests):
    case = next((case for name, case, result in tests if name == 'independent-420-geometry.qa.spec.ts'
                 and case['title'].startswith('G1:')), None)
    if case is None or not case['caseResults']:
        return {'metrics': 0, 'photos': 0, 'strictMatrixComplete': False}
    attachments = case['caseResults'][0].get('attachments', [])
    output = OUT / 'geometry'
    output.mkdir()
    captured = []
    matrix = None
    for row in attachments:
        name = row['name']
        if name != 'real-geometry-matrix' and not re.fullmatch(r'geometry-\d+-\d+-\d+(?:-render)?', name):
            continue
        is_png = name.endswith('-render')
        expected_type = 'image/png' if is_png else 'application/json'
        need(row['contentType'] == expected_type, 'Geometry type differs')
        if row.get('body') is not None:
            data = b64decode(row['body'], validate=True)
        else:
            path = Path(row['path'])
            need(inside(path, OUT / 'browser-artifacts'), 'Geometry attachment outside browser artifact directory')
            data = path.read_bytes()
        if is_png:
            need(data.startswith(b'\x89PNG\r\n\x1a\n'), 'Geometry PNG invalid')
        elif name == 'real-geometry-matrix':
            matrix = json.loads(data.decode('utf-8'))
        else:
            json.loads(data.decode('utf-8'))
        dest = output / (name + ('.png' if is_png else '.json'))
        with dest.open('xb') as stream:
            stream.write(data)
        captured.append(name)
    metrics = {name for name in captured if name.startswith('geometry-') and not name.endswith('-render')}
    photos = {name.removesuffix('-render') for name in captured if name.endswith('-render')}
    observed = set()
    if matrix is not None:
        observed = {(m['width'],m['textScale'],m['seq']) for m in matrix['measurements']}
    expected = {(w,f,n) for w in (1440,320) for f in (1,2) for n in (10593,123456,123456789012345)}
    return {'metrics': len(metrics), 'photos': len(photos), 'strictMatrixComplete':
            matrix is not None and len(matrix['measurements']) == 12 and len(metrics) == len(photos) == 12
            and metrics == photos and observed == expected}


def cases(report):
    rows = []
    def visit(suite):
        for spec in suite.get('specs', []):
            name = Path(spec['file']).name
            for test in spec.get('tests', []):
                attempts = test.get('results',[])
                rows.append((name, {'title':spec['title'],'caseResults':attempts}, test))
        for child in suite.get('suites', []):
            visit(child)
    for suite in report.get('suites', []):
        visit(suite)
    return rows


def read_pinned(path, wanted):
    need(pin(path)['sha256'] == wanted, f'Pinned evidence changed: {path}')
    return read(path)


def compare_matrices(old, fresh):
    def keyed(doc):
        return {(row['width'], row['textScale'], row['seq']): row for row in doc['measurements']}
    candidate = keyed(old)
    baseline = keyed(fresh)
    need(len(candidate) == 12 and candidate.keys() == baseline.keys(), 'Geometry matrices do not align')
    comparison = []
    def summary(row):
        viewport = row['viewport']
        return {'documentScrollWidth': viewport['scrollWidth'], 'bodyScrollWidth': viewport['bodyScrollWidth'],
                'visibleTextOutsideViewport': len(viewport['visibleTextOutsideViewport']),
                'sequenceClips': row['number']['clipping'], 'typeClips': row['type']['clipping'],
                'overlapCount': len(row['overlaps']),
                'sequenceFontSize': row['number']['fontSize'], 'typeFontSize': row['type']['fontSize']}
    for width, scale, seq in sorted(candidate):
        key = (width, scale, seq)
        comparison.append({'width': width, 'textScale': scale, 'seq': seq,
                           'originalCandidate': summary(candidate[key]), 'baseline': summary(baseline[key])})
    return comparison


def main():
    admission = read(P / 'BASELINE-ADMISSION.json')
    need(admission['rootAdmitted'] is True, 'Root baseline-only admission unset')
    need(admission['apiSource']['head'] == '2231400e7986f349376d7c19ebd62ae71f7708a4'
         and admission['apiSource']['tree'] == 'c20cdcad4bf3c91fcd7b84c81284c491479f7ed9',
         'Unexpected comparison API checkout')
    need(admission['baselineEvidenceSha256'] == '53e5d4edd227e63f92b7eed705b0f21debc4f7fa59b04a9c4a456ff6e0b05656'
         and admission['originalSourceBindingSha256'] == 'fb7fcae7bd1bca854901b3aee0c6a9cd5b807c555d7ee2aaf4e4ac255050bbb2',
         'Unexpected comparison provenance pins')
    baseline = read_pinned(FOLLOWUP_PREP / 'SOURCE-AND-ARTIFACT-BINDING.json', admission['baselineEvidenceSha256'])
    binding = read_pinned(ORIGINAL_PREP / 'SOURCE-BINDING.json', admission['originalSourceBindingSha256'])
    prior = read_pinned(ORIGINAL_RUN / 'BROWSER-AFTER.json',
                        '0ed6ff580f90a134f2bf1104b44c80125b66d3931e82f98f9d5b704e187cdbce')
    prior_geometry = read_pinned(ORIGINAL_RUN / 'geometry/real-geometry-matrix.json',
                                 '46eca022bd107b852cf29652bf5649faba4056172622d2d6a2dc7caf2e6717a1')
    base = baseline['releaseBase']
    need(base == admission['baselineSource'] and base['head'] == '0f6c325becf3e3e0562ae69dfae2c42bcf1d7129'
         and base['tree'] == 'b3b6118f17594e3dede3c19425ef30364c63bfbc', 'Wrong release baseline')
    need(binding['source'] == admission['apiSource'] and len(binding['overlays']) == 5,
         'API source or exact five-overlay roster differs')
    need(baseline['UIQAApiHarnessEquivalent']['candidateHead'] == binding['source']['head'],
         'Shipping API harness equivalence missing')
    qa = E / 'i5-d241-observation-entry-loss-independent-qa-01'
    handoff = read_pinned(P / 'COMPONENT-CLOSURE-BINDING.json', admission['componentClosureBindingSha256'])
    need(handoff['afterSha256'] == admission['componentAfterSha256']
         and handoff['phaseSha256'] == admission['componentPhaseSha256'], 'Root must bind the closed B1 phase')
    m = read_pinned(qa / 'MATERIALIZATION.json', handoff['materializationSha256'])
    root = read_pinned(qa / 'ROOT-BINDING.admitted.json', handoff['rootBindingSha256'])
    closed = read_pinned(qa / 'old/after.json', handoff['afterSha256'])
    phase = read_pinned(qa / 'old/PHASE-RECEIPT.json', handoff['phaseSha256'])
    selected = read_pinned(qa / 'old/ACTUAL-SELECTION.json', handoff['selectionSha256'])
    component = {'bytes':71543,'sha256':'8a344821db18ec25fa7cf2219c07721acf4eddae0d109b8eb3a412ca58aa6c2b'}
    need(phase['stageReached'] == 'replacement2' and phase['afterMatchesRootBinding'] is True
         and phase['rootBindingSha256'] == handoff['rootBindingSha256']
         and phase['sourceFixesOrReruns'] is False and selected['actualCases'] == 63
         and selected['expectedSelected'] == 2 and selected['filteredOrPending'] == 61
         and selected['failed'] == 2 and selected['processExit'] == 1,
         'Expected closed two-case B1 evidence is absent')
    need(m['executedComponentSha256'] == component['sha256']
         and m['oldComponentSha256'] == binding['overlays'][EXTRA_OVERLAY]
         and m['onlyCheckoutDelta'] == EXTRA_OVERLAY and m['literalBase61Unchanged'] is True
         and m['otherFourOverlaysAndSourceIndexDependenciesModulesUnchanged'] is True,
         'Unexpected B1 component materialization')
    expected_overlays = binding['overlays'] | {EXTRA_OVERLAY: component['sha256']}
    source_keys = ('head','tree','indexSha256','stagedEntriesSha256','commonIndexExists','selectedSources','status')
    need(all(closed[k] == root['source'][k] for k in source_keys)
         and closed['head'] == binding['source']['head'] and closed['tree'] == binding['source']['tree']
         and closed['indexSha256'] == binding['indexSha256'] and closed['commonIndexExists'] is False
         and closed['trackedAndStagedDiffExit'] == 0
         and closed['overlays'] == root['overlays'] == expected_overlays,
         'Closed B1 source, index or overlay snapshot differs')
    need(closed['rootInstallInputs19'] == root['rootInstallInputs19'] and all(
         pin(W / n) == v for n,v in closed['rootInstallInputs19'].items()), 'B1 installation inputs changed')
    for key in ('independentInputs18','metadata'):
        need(closed[key] == root[key] and all(pin(W / n)['sha256'] == v for n,v in closed[key].items()),
             f'B1 {key} inputs changed')
    need(pin(W / EXTRA_OVERLAY) == component, 'Exact admitted 63-case component required; no reversal')
    adopted = binding | {'overlays':expected_overlays}
    before = snapshot(adopted)
    need(before == prior | {'overlays':expected_overlays},
         'Original browser state may differ only by the exact admitted B1 component overlay')

    h2 = baseline['H2']
    retained = Path(h2['webDistRoot'])
    pinned_h2 = Path('G:/ggq/gg-i5-d231-correction-qa/GraphGoblin/apps/web/dist')
    need(retained == pinned_h2 and retained.resolve(strict=True) == pinned_h2,
         'Unexpected retained H2 dist location')
    h2_build_receipt = h2['sourceBuildReceipt']
    retained_build = read_pinned(Path(h2_build_receipt['path']),h2_build_receipt['sha256'])
    need(retained_build['exitCode'] == 0, 'Retained H2 build not closed successfully')
    h2_original_binding = h2['retainedBuildBinding']
    h2_source = read_pinned(Path(h2_original_binding['path']), h2_original_binding['sha256'])
    need(h2_source['sourceHead'] == h2['source']['head'] and h2_source['sourceTree'] == h2['source']['tree'],
         'Retained build/source identity mismatch')
    base_dist = tree_manifest(retained)
    need(base_dist == h2['webDistMemberPins'] and len(base_dist) == 28, 'Retained baseline build bytes changed')
    built_candidate = read_pinned(ORIGINAL_RUN / 'BUILD-MANIFEST.json',
                                  'df261c0afc987d45e5228ddb265d487be53a899b1cff9f93cc8dd050023f7315')
    need(tree_manifest(DIST) == built_candidate['webDist'], 'Original candidate web dist changed')
    base_fonts = {name: row for name, row in base_dist.items() if name.startswith('fonts/')}
    candidate_fonts = {name: row for name, row in built_candidate['webDist'].items() if name.startswith('fonts/')}
    need(base_fonts == candidate_fonts and len(base_fonts) == 15, 'Baseline/candidate font bytes differ')
    need(not os.path.lexists(OUT), 'New owned baseline output required')

    OUT.mkdir()
    copied = OUT / 'owned-web-dist'
    shutil.copytree(retained,copied)
    need(tree_manifest(copied) == base_dist, 'Baseline dist copy differs')
    tmp = OUT / 'browser-temp'
    tmp.mkdir()
    env = make_env(tmp,browser=True)
    need(check_binaries(env) == read(ORIGINAL_RUN / 'RUNTIME.json'), 'Browser runtime drift')
    put(OUT/'BROWSER-BEFORE.json',before)
    put(OUT/'ADOPTED-B1-CLOSURE.json', {'receipt':handoff,'sourceSnapshot':closed,
        'component':component,'originalFourBrowserOverlays':BROWSER_OVERLAYS})
    put(OUT/'BASELINE-WEB-MANIFEST.json', {
        'releaseBase':base, 'actualWebBuildSource':h2['source'], 'apiSource':binding['source'],
        'baseApiHarnessEquivalence':baseline['UIQAApiHarnessEquivalent'], 'webDist':base_dist,
        'exactCandidateFontCount':len(base_fonts), 'sourceArtifactBinding':pin(FOLLOWUP_PREP/'SOURCE-AND-ARTIFACT-BINDING.json'),
        'retainedBuildReceipt':h2_build_receipt,'retainedBuildSourceBinding':h2_original_binding,
    })
    put(OUT/'I5_QA_CASE_BINDING.json',{
        'candidateHead':base['head'],'candidateTree':base['tree'],
        'buildManifestSha256':pin(OUT/'BASELINE-WEB-MANIFEST.json')['sha256'],
        'lastObservedText':'Last observed, may be out of date',
    })
    status = command('baseline-g1',[PNPM,'--filter','@graphgoblin/web','exec','playwright','test',
        'e2e/'+G1,'--grep','G1: real built Timeline geometry','--workers=1','--retries=0',
        '--trace=on','--reporter=list,json','--output',OUT/'browser-artifacts'],env)
    after = snapshot(adopted)
    put(OUT/'BROWSER-AFTER.json',after)
    untouched = tree_manifest(DIST) == built_candidate['webDist']
    retained_unchanged = tree_manifest(retained) == base_dist
    copied_restored = tree_manifest(copied) == base_dist
    summary = {'exit':status,'apiSourceAndOverlaysUnchanged':before == after,'candidateDistUnchanged':untouched,
               'retainedBaselineDistUnchanged':retained_unchanged,'ownedBaselineDistRestored':copied_restored,
               'originalG1OracleUnchanged':True,'comparisonComplete':False,'productAcceptance':False}
    if (OUT/'browser-results.json').is_file():
        report=read(OUT/'browser-results.json')
        rows=cases(report)
        selected=False
        if len(rows) == 1:
            name,case,test=rows[0]
            selected=(name == G1 and case['title'] == FOCUS and test['projectName'] == 'chromium'
                      and test['expectedStatus'] == 'passed' and len(case['caseResults']) == 1
                      and case['caseResults'][0]['retry'] == 0)
        geometry=geometry_files(report,rows)
        traces=len(list((OUT/'browser-artifacts').rglob('trace.zip')))
        summary.update({'report':pin(OUT/'browser-results.json'),'selectedG1Once':selected,
            'rawPlaywrightStats':report.get('stats'),'geometry':geometry,'traceFiles':traces})
        if selected and geometry['strictMatrixComplete']:
            put(OUT/'G1-COMPARISON.json',compare_matrices(prior_geometry,read(OUT/'geometry/real-geometry-matrix.json')))
        summary['comparisonComplete']=(before == after and untouched and retained_unchanged and copied_restored
                                       and selected and geometry['strictMatrixComplete'] and traces == 1)
    put(OUT/'RESULT.json',summary)
    return status or (0 if summary['comparisonComplete'] else 1)


if __name__ == '__main__':
    sys.exit(main())
