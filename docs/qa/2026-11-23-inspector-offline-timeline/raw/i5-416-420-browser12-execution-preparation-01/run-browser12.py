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
OUT = E / 'i5-416-420-browser12-execution-01'
DIST = W / 'apps/web/dist'
PNPM = Path('C:/nvm4w/nodejs/node_modules/pnpm/pnpm.exe')
GIT = Path('C:/Program Files/Git/cmd/git.exe')
NODE = Path(os.environ['USERPROFILE']) / '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe'
SPECS = {
    'independent-416-listener.qa.spec.ts': 5,
    'independent-420-geometry.qa.spec.ts': 2,
    'inspector-availability.spec.ts': 4,
    'bounded-history.spec.ts': 1,
}
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


def build(binding):
    before = snapshot(binding)
    need(not os.path.lexists(OUT) and not os.path.lexists(DIST), 'Expected fresh output and first web build')
    OUT.mkdir()
    tmp = OUT / 'build-temp'
    tmp.mkdir()
    env = make_env(tmp)
    put(OUT / 'BUILD-BEFORE.json', before)
    put(OUT / 'RUNTIME.json', check_binaries(env))
    need(command('00-node',[NODE,'--version'],env) == 0 and
         (OUT/'00-node.stdout').read_text(encoding='utf-8').strip() == 'v22.23.4',
         'Unexpected Node version')
    need(command('01-pnpm',[PNPM,'--version'],env) == 0 and
         (OUT/'01-pnpm.stdout').read_text(encoding='utf-8').strip() == '12.8.1',
         'Unexpected pnpm version')
    status = command('02-build',[PNPM,'build'],env)
    after = snapshot(binding)
    put(OUT / 'BUILD-AFTER.json', after)
    if status or before != after:
        put(OUT / 'BUILD-RESULT.json', {'exit':status,'sourceUnchanged':before == after,'buildAccepted':False})
        return status or 1
    manifest = {'source': binding['source'], 'sourceSnapshot': after,
                'commandReceipt': pin(OUT / '02-build.json'), 'webDist': tree_manifest(DIST)}
    put(OUT / 'BUILD-MANIFEST.json', manifest)
    put(OUT / 'BUILD-RESULT.json', {'exit':0,'sourceUnchanged':True,'buildAccepted':True,
                                    'manifest':pin(OUT / 'BUILD-MANIFEST.json')})
    return 0


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


def browser(binding, admission):
    manifest_path = OUT / 'BUILD-MANIFEST.json'
    need(admission['rootAdmitted'] is True and admission['source'] == binding['source']
         and admission['buildManifestSha256'] == pin(manifest_path)['sha256'], 'Root browser/build binding absent')
    need(read(OUT/'BUILD-RESULT.json')['buildAccepted'] is True, 'Build failed or lacks closed evidence')
    build_manifest = read(manifest_path)
    before = snapshot(binding)
    need(before == build_manifest['sourceSnapshot'] and tree_manifest(DIST) == build_manifest['webDist'],
         'Web distribution or source changed after build')
    for name in ('owned-web-dist','browser-temp','browser-results.json','browser-artifacts','I5_QA_CASE_BINDING.json'):
        need(not os.path.lexists(OUT / name), 'Browser output already exists: ' + name)
    copied = OUT / 'owned-web-dist'
    shutil.copytree(DIST, copied)
    need(tree_manifest(copied) == build_manifest['webDist'], 'Isolated web distribution copy differs')
    tmp = OUT / 'browser-temp'
    tmp.mkdir()
    env = make_env(tmp, browser=True)
    need(read(OUT/'RUNTIME.json') == check_binaries(env), 'Runtime drift between build and browser')
    put(OUT/'BROWSER-BEFORE.json', before)
    put(OUT/'I5_QA_CASE_BINDING.json', {
        'candidateHead':binding['source']['head'], 'candidateTree':binding['source']['tree'],
        'buildManifestSha256':admission['buildManifestSha256'], 'lastObservedText':'Last observed, may be out of date',
    })
    status = command('03-browser', [PNPM,'--filter','@graphgoblin/web','exec','playwright','test',
        *('e2e/' + name for name in SPECS), '--workers=1','--retries=0','--trace=on',
        '--reporter=list,json','--output', OUT / 'browser-artifacts'], env)
    after = snapshot(binding)
    put(OUT/'BROWSER-AFTER.json', after)
    dist_equal = tree_manifest(DIST) == build_manifest['webDist']
    copy_equal = tree_manifest(copied) == build_manifest['webDist']
    verdict = {'exit':status, 'sourceUnchanged':before == after, 'buildDistUnchanged':dist_equal,
               'ownedDistRestored':copy_equal, 'jsonReportPresent':(OUT/'browser-results.json').is_file(),
               'browserPassed':False, 'processClosureLimit':'Direct structured command closed; native global teardown retained. No unobserved descendant closure claim.'}
    if verdict['jsonReportPresent']:
        report = read(OUT/'browser-results.json')
        rows = cases(report)
        roster = Counter(row[0] for row in rows)
        first_pass = all(len(test['results']) == 1 and test['results'][0]['retry'] == 0
                         and test['results'][0]['status'] == 'passed' and test['projectName'] == 'chromium'
                         and test['expectedStatus'] == 'passed' for _,_,test in rows)
        verdict.update({'report':pin(OUT/'browser-results.json'), 'specCases':dict(roster),
                        'expectedSelection':roster == SPECS, 'firstAttemptAllPass':first_pass,
                        'playwrightStats':report.get('stats'), 'geometry':geometry_files(report, rows)})
        verdict['browserPassed'] = (status == 0 and before == after and dist_equal and copy_equal
                                    and roster == SPECS and first_pass and verdict['geometry']['strictMatrixComplete'])
    put(OUT/'BROWSER-RESULT.json', verdict)
    return status or (0 if verdict['browserPassed'] else 1)


def main():
    args = sys.argv[1:]
    need(args in (['build'],['browser']), 'Specify build or browser after root admission')
    binding = read(P/'SOURCE-BINDING.json')
    need(binding['rootAdmitted'] is True, 'Root source/build admission unset')
    if args == ['build']:
        return build(binding)
    return browser(binding, read(P/'BROWSER-ADMISSION.json'))


if __name__ == '__main__':
    sys.exit(main())
