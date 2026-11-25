import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

E = Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
OUT = Path(__file__).resolve().parent
W = Path('G:/ggq/gg-macos-current-main/GraphGoblin')
AUTHOR = E / 'mac-d237-lock-author-01'
ALIAS = E / 'mac-d238-canonical-test-independent-qa-01'
OLD = 'e2161f5d9b13f6701929fa67ef77329d4bb98945'
CORRECTED = 'b7a7bbd83b3ae542f07e432d65ba04483493b57f'
CURRENT = 'd91386a7509a77db4bccdab6f95a3d01e730ad50'

def sha(b): return hashlib.sha256(b).hexdigest()
def read(p): return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def pin(p):
    b = Path(p).read_bytes()
    return {'source': str(p), 'bytes': len(b), 'sha256': sha(b)}
def save(n, v):
    with (OUT/n).open('x', encoding='utf-8', newline='\n') as f:
        json.dump(v, f, indent=2); f.write('\n')
commands = []
def git(*args):
    argv = ['C:/Program Files/Git/cmd/git.exe', '--no-optional-locks', '-C', str(W), *args]
    p = subprocess.run(argv, env=dict(os.environ, GIT_OPTIONAL_LOCKS='0'), capture_output=True, check=True)
    commands.append({'argv': argv, 'exit': p.returncode, 'stdoutBytes': len(p.stdout), 'stdoutSha256': sha(p.stdout), 'stderrBytes': len(p.stderr)})
    return p.stdout
def text(*args): return git(*args).decode().strip()
def object_map(commit, roots):
    result = {}
    for row in git('ls-tree', '-z', commit, '--', *roots).split(b'\0'):
        if row:
            meta, path = row.split(b'\t', 1)
            result[path.decode()] = meta.decode().split()
    return result

stage_results, case_rows = [], []
for name in ['06-ownership', '07-startup', '08-log-adapters']:
    receipt = read(AUTHOR/name/'exit.json')
    raw = (AUTHOR/name/'stdout.log').read_bytes()
    err = (AUTHOR/name/'stderr.log').read_bytes()
    assert receipt['exitCode'] == 0 and sha(raw) == receipt['stdoutSha256'].lower() and sha(err) == receipt['stderrSha256'].lower()
    clean = re.sub(r'\x1b\[[0-9;]*m', '', raw.decode('utf-8-sig'))
    summary = re.search(r'Tests\s+(\d+) passed\s*\|\s*(\d+) skipped\s*\((\d+)\)', clean)
    assert summary
    stage_results.append({'stage': name, 'receipt': pin(AUTHOR/name/'exit.json'), 'command': {'program': receipt['program'], 'args': receipt['args'], 'cwd': receipt['workingDirectory']}, 'exit': receipt['exitCode'], 'node': receipt['nodeVersion'], 'startUtc': receipt['startedUtc'], 'endUtc': receipt['endedUtc'], 'passed': int(summary[1]), 'skipped': int(summary[2]), 'total': int(summary[3]), 'stdout': pin(AUTHOR/name/'stdout.log'), 'stderr': pin(AUTHOR/name/'stderr.log')})
    if name == '07-startup':
        for status, name in re.findall(r'^\s*([✓↓]) src/main\.test\.ts > (.+)$', clean, flags=re.M):
            case_rows.append({'state': 'passed' if status == '✓' else 'platform-skipped', 'name': re.sub(r' \d+ms$', '', name)})
assert len(case_rows) == 21 and sum(c['state'] == 'passed' for c in case_rows) == 15
assert sum(c['state'] == 'platform-skipped' for c in case_rows) == 6
assert sum(r['passed'] for r in stage_results) == 296 and sum(r['skipped'] for r in stage_results) == 27
build = read(AUTHOR/'05-build-formatted/exit.json')
assert build['exitCode'] == 0
assert sha((AUTHOR/'05-build-formatted/stdout.log').read_bytes()) == build['stdoutSha256'].lower()
assert sha((AUTHOR/'05-build-formatted/stderr.log').read_bytes()) == build['stderrSha256'].lower()
roots = ['apps/api', 'packages', 'tooling', 'pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml', 'turbo.json', 'patches', 'tsconfig.json', 'tsconfig.build.json']
old_objects, new_objects = object_map(OLD, roots), object_map(CURRENT, roots)
changed = git('diff', '--name-only', '-z', OLD, CURRENT, '--', *roots).decode().strip('\0').split('\0')
assert changed == ['apps/api/src/main.test.ts']
main_path = 'apps/api/src/main.test.ts'
old_main = git('show', OLD+':'+main_path)
new_main = git('show', CURRENT+':'+main_path)
expected = old_main.replace(b'import { access, mkdir, readFile, readdir, writeFile }', b'import { access, mkdir, readFile, readdir, realpath, writeFile }', 1).replace(b'const databaseLock = `${database}.graphgoblin.lock`;', b'const databaseLock = `${await realpath(database)}.graphgoblin.lock`;', 1)
assert expected == new_main
assert sha(old_main) == 'e7474752b74784044d88bc09c04dffbe680a0f94529f62eb1ef90f98a4b3829a'
assert sha(new_main) == '637998c1f8b332379d0844107fa04735a918c6140c99b4864cb7b5c570db5c80'
start = b"describe('built entry"
end = b"describe('built API entry and startup failures'"
old_groups = old_main[old_main.index(start):old_main.index(end)]
new_groups = new_main[new_main.index(start):new_main.index(end)]
assert old_groups == new_groups
patch = git('diff', OLD, CURRENT, '--', main_path)
(OUT/'main.test.only-delta.patch').write_bytes(patch)
api_trees = {k: text('rev-parse', commit+':apps/api') for k,commit in [('earlierD237',OLD),('correctedD238',CORRECTED),('historical638','6384342bcf561d81bab2f63064d61470aea65bdc'),('current',CURRENT)]}
assert api_trees['correctedD238'] == api_trees['historical638'] == api_trees['current']
assert api_trees['earlierD237'] != api_trees['current']
assert all(v == new_objects[k] for k,v in old_objects.items() if k != 'apps/api')
selected = ['apps/api/src/main.ts', 'apps/api/src/serve.ts', 'apps/api/src/config.ts', 'apps/api/src/container.ts', 'apps/api/src/data-dir-lock.ts', 'apps/api/src/testing/api-subprocess.ts', 'apps/api/src/main-entry.test.ts', 'apps/api/src/managed-log/gateway-log-writer.ts', 'apps/api/src/managed-log/guard.ts', 'apps/api/src/windows-log/guard.ts', 'apps/api/src/windows-log/managed-root.ts', 'apps/api/src/macos-log/guard.ts']
pins = []
for p in selected:
    earlier = git('show', OLD+':'+p)
    current = git('show', CURRENT+':'+p)
    assert earlier == current == (W/p).read_bytes()
    pins.append({'path': p, 'blob': text('rev-parse', CURRENT+':'+p), 'bytes': len(current), 'sha256': sha(current)})
assert (W/main_path).read_bytes() == new_main
positive = read(ALIAS/'12-corrected-positive.receipt.json')
positive_results = read(ALIAS/'RESULTS.json')
identity = read(ALIAS/'SOURCE-IDENTITY.json')
worker = read(ALIAS/'corrected-positive.worker.json')
assert positive['exitCode'] == 0 and identity['correctedSha256'] == sha(new_main)
assert sha((ALIAS/'12-corrected-positive.stdout.log').read_bytes()) == positive['stdoutSha256']
assert sha((ALIAS/'12-corrected-positive.stderr.log').read_bytes()) == positive['stderrSha256']
entry = pin(W/'apps/api/dist/main.js')
assert entry['sha256'] == identity['entrySha256'] == worker['entrySha256']
inputs = [E/'mac-post-564-fable-review-01/ordinary-handoff.md', E/'mac-d237-integration-freeze-01/freeze.json', AUTHOR/'FINAL-SOURCE.json', AUTHOR/'HANDOFF.md', AUTHOR/'MANIFEST.json', AUTHOR/'05-build-formatted/exit.json', AUTHOR/'05-build-formatted/stdout.log', AUTHOR/'05-build-formatted/stderr.log', E/'mac-d238-canonical-test-author-01/source-before.json', E/'mac-d238-canonical-test-author-01/source-after.json', E/'mac-d238-canonical-test-author-01/canonical-test.patch', E/'mac-d238-independent-qa-admission-01/checkout.json', ALIAS/'SOURCE-IDENTITY.json', ALIAS/'RESULTS.json', ALIAS/'12-corrected-positive.receipt.json', ALIAS/'12-corrected-positive.stdout.log', ALIAS/'12-corrected-positive.stderr.log', ALIAS/'12-corrected-positive.json', ALIAS/'corrected-positive.worker.json', ALIAS/'worker-alias.setup.mjs', ALIAS/'vitest.alias.config.mjs', ALIAS/'MANIFEST.json']
save('READBACK.json', {'scope': 'Historical Windows startup reconciliation only; no test/provider/runtime execution or repository mutation', 'earlierFrozenSource': OLD, 'currentFrozenSource': CURRENT, 'historicalRunIsPrecommit': 'D237 author command ran pending merge before root froze e216 at02:25. Only edited lock/test files have author final-source pins; no complete precommand API/dist roster was retained.', 'stageResults': stage_results, 'aggregateSelected': 323, 'aggregatePassed': 296, 'aggregateSkipped': 27, 'mainTestCases': case_rows, 'mainPassed': 15, 'mainPlatformSkipped': 6, 'sourceRootsCompared': roots, 'oldRootObjects': old_objects, 'currentRootObjects': new_objects, 'completeChangedPathSetAcrossApiWorkspaceDependencyAndBuildRoots': changed, 'mainTestExactTwoSubstitutions': True, 'mainOldSha256': sha(old_main), 'mainCurrentSha256': sha(new_main), 'windowsAndMacVariableGroupsByteIdentical': {'bytes': len(old_groups), 'sha256': sha(old_groups)}, 'apiTrees': api_trees, 'namedStartupFixtureAndSharedWriterPins': pins, 'oldFinalBuildReceipt': pin(AUTHOR/'05-build-formatted/exit.json'), 'oldFinalBuildPassedTasks': 12, 'oldBuildFullDistManifestRetained': False, 'currentBuiltEntryMatchesD238ActualEntry': entry, 'correctedAliasPositive': {'command': positive['command'], 'receipt': pin(ALIAS/'12-corrected-positive.receipt.json'), 'exit': positive['exitCode'], 'selectedPassed': 1, 'filtered': 20, 'filteredAreNotPlatformAcceptance': True, 'sourceMainTestObjectEqualsCurrent': True, 'wholeApiTreeAtB7EqualsCurrent': True, 'ownedWindowsJunctionControlled': True, 'childOnlyOllamaFalseControl': True, 'actualThreeChildrenClosed': worker['allChildrenClosed'], 'ownedFixtureDirectoriesAbsent': worker['allFixtureDirectoriesAbsent'], 'networkPacketTrace': worker['networkPacketTrace']}, 'inputPins': [pin(p) for p in inputs], 'gitCommandReceipts': commands, 'qualifications': ['No full main.test Windows run with the exact current21-case file was found; current-head Windows-specific execution remains absent.', 'The earlier Windows branch bodies and complete runtime/API dependency source roots are unchanged; the only changed API object is the D238 shared-database test oracle/import.', 'D237 full Windows run predates the provider-isolation concern and has no packet trace or child discovery-disabled proof; do not retrospectively call it isolated.', 'Current built main entry matches the later D238 pinned entry, not a complete digest of every earlier built module or installed dependency.', 'No new test execution, provider contact, Mac GUI evidence, final/general review or local-run authorization follows from this reconciliation.']})
for source,name in [(AUTHOR/'07-startup/exit.json','D237-startup.exit.json'),(AUTHOR/'07-startup/stdout.log','D237-startup.stdout.log'),(AUTHOR/'07-startup/stderr.log','D237-startup.stderr.log')]:
    with (OUT/name).open('xb') as f: f.write(source.read_bytes())
print(json.dumps({'mainPassed':15,'mainSkipped':6,'apiTrees':api_trees,'sourceChanges':changed,'readback':pin(OUT/'READBACK.json')}))
