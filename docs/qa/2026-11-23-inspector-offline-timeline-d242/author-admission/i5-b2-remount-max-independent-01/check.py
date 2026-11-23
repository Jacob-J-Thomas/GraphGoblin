import ast
import copy
from datetime import datetime, timedelta, timezone
import difflib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
from types import SimpleNamespace

out = Path(__file__).parent
e = out.parent
prep = e / 'i5-b2-remount-max-preparation-01'
original = e / 'i5-d236-max-continuation-preparation-02/max-continuation.draft.py'
controller = prep / 'max-continuation.draft.py'
expected_controller = '9fcbfb5f531e2889102ed23f848bf53c66a9b30260b695f1fe9c2d5ffb22cd3b'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pin(path):
    return {'source': str(path), 'bytes': path.stat().st_size,
            'sha256': hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()}


def save(name, value):
    with (out / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


manifest = json.loads((prep / 'MANIFEST.json').read_bytes())
assert sha((prep / 'MANIFEST.json').read_bytes()) == '5f6b00f73a5b941af60830239a60748d23e22516150ba3d0877158133d768272'
for name, wanted in manifest['members'].items():
    assert pin(prep / name) == wanted
for wanted in manifest['inputs']:
    assert pin(Path(wanted['source'])) == wanted
old_raw, new_raw = original.read_bytes(), controller.read_bytes()
assert sha(old_raw) == '636679ad6e298c47cc7ca5bbe2d3b04ef5ab73a4b7fbc23e76128235c8222a36'
assert sha(new_raw) == expected_controller
old_text, new_text = old_raw.decode(), new_raw.decode()
old_ast, new_ast = ast.parse(old_text), ast.parse(new_text)


def named_assignment(tree, name):
    return next(node for node in tree.body if isinstance(node, ast.Assign)
                and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == name)


old_ui, new_ui = named_assignment(old_ast, 'UI_WRITES'), named_assignment(new_ast, 'UI_WRITES')
old_paths, new_paths = ast.literal_eval(old_ui.value), ast.literal_eval(new_ui.value)
expected_paths = (
    'apps/web/src/runs/RunInspectorPage.tsx', 'apps/web/src/runs/HistoryEligibility.tsx',
    'apps/web/src/runs/inspector/ScriptRecovery.tsx', 'apps/web/src/runs/RunInspectorPage.offline.test.tsx',
    'apps/web/src/runs/HistoryEligibility.test.tsx', 'apps/web/src/runs/ScriptRecovery.test.tsx',
    'docs/09-frontend-and-pwa.md', 'CHANGELOG.md')
assert len(old_paths) == 15 and new_paths == expected_paths
old_filtered = ast.Module(body=[n for n in old_ast.body if n is not old_ui], type_ignores=[])
new_filtered = ast.Module(body=[n for n in new_ast.body if n is not new_ui], type_ignores=[])
assert ast.dump(old_filtered, include_attributes=False) == ast.dump(new_filtered, include_attributes=False)
old_segment, new_segment = ast.get_source_segment(old_text, old_ui), ast.get_source_segment(new_text, new_ui)
assert old_text.count(old_segment) == 1 and old_text.replace(old_segment, new_segment, 1).encode() == new_raw
independent_diff = ''.join(difflib.unified_diff(old_text.splitlines(True), new_text.splitlines(True),
    fromfile='previous/max-continuation.draft.py', tofile='exact-eight/max-continuation.draft.py'))
assert independent_diff.encode() == (prep / 'controller.diff').read_bytes()
draft = json.loads((prep / 'correction.draft.json').read_bytes())
previous_draft = json.loads((e / 'i5-d241-session-feedback-correction-admission-01/correction.draft.json').read_bytes())
assert draft['allowedWritePaths'] == list(expected_paths) and len(draft['allowedReadPaths']) == 36
assert set(draft['allowedReadPaths']) <= set(previous_draft['allowedReadPaths'])
assert set(expected_paths) <= set(draft['allowedReadPaths']) and len({p.casefold() for p in draft['allowedReadPaths']}) == 36
assert draft['deadlineSeconds'] == 3600 and draft['rootAdmitted'] is False
assert all(draft[key] is None for key in ['brief', 'independentAcceptance', 'singleOwner'])
template = json.loads((prep / 'ROOT-ADMISSION.template.json').read_bytes())
assert template['rootAdmitted'] is False and template['apiRouteAuthorized'] is False
assert all(template[key] is None for key in ['brief', 'findingReport', 'decision', 'independentAcceptance'])
initial_presence = {name: (prep / name).is_file() for name in ['ROOT-ADMISSION.json', 'BRIEF.md', 'owner.json', 'correction.admitted.json']}
assert not initial_presence['ROOT-ADMISSION.json'] and not initial_presence['owner.json'] and not initial_presence['correction.admitted.json']
initial_presence['findingReportPresentNotRead'] = Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i5-564-final-astra-max-03/REPORT.md').is_file()
initial_presence['thisAcceptanceInitiallyPresent'] = (out / 'ACCEPTANCE.json').is_file()
assert initial_presence['thisAcceptanceInitiallyPresent'] is False

# Only these inert class/function definitions are compiled. No module import,
# launch/admit, auth/process, source-state or stream-reader function is invoked.
safe_names = {'Refusal', 'need', 'literal', 'scope_for', 'clean_env', 'max_auth', 'argv', 'require_owner'}


def inert_namespace(tree):
    safe = ast.Module(body=[copy.deepcopy(n) for n in tree.body
        if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name in safe_names], type_ignores=[])
    ns = {'Path': Path, 'PurePosixPath': PurePosixPath, 're': re, 'json': json,
          'os': SimpleNamespace(pathsep=os.pathsep), 'datetime': datetime,
          'NODE': Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64')}
    for name in ['SCOPE', 'REVIEW', 'AUTHOR', 'CORE', 'UI_WRITES', 'MODELS', 'KEEP_ENV']:
        ns[name] = ast.literal_eval(named_assignment(tree, name).value)
    exec(compile(ast.fix_missing_locations(safe), '<inert-extracted-controller-functions>', 'exec'), ns)
    return ns


old_ns, ns = inert_namespace(old_ast), inert_namespace(new_ast)
results = []


def case(name, call, expected=None):
    actual = None
    try:
        call()
    except (ValueError, RuntimeError) as error:
        actual = str(error)
    assert actual == expected, (name, expected, actual)
    results.append({'case': name, 'expected': expected or 'accepted inert predicate only',
                    'actual': actual or 'accepted inert predicate only'})


synthetic = copy.deepcopy(draft)
synthetic['rootAdmitted'] = True
case('new exact ordered eight', lambda: ns['scope_for'](synthetic))
case('old controller rejects exact eight', lambda: old_ns['scope_for'](synthetic), 'WRITE_SCOPE_DIFFERS')
for label, writes in [
    ('old fifteen', list(old_paths)), ('extra path', list(expected_paths) + ['apps/web/src/runs/RunsPage.tsx']),
    ('missing path', list(expected_paths[:-1])), ('protected core write', list(expected_paths[:-1]) + ['apps/web/src/api/queries.ts']),
    ('reordered eight', list(reversed(expected_paths)))]:
    mutated = copy.deepcopy(synthetic); mutated['allowedWritePaths'] = writes
    case('new rejects ' + label, lambda c=mutated: ns['scope_for'](c), 'WRITE_SCOPE_DIFFERS')
case('unarmed original draft', lambda: ns['scope_for'](draft), 'ROOT_ADMISSION_UNSET')
missing_core = copy.deepcopy(synthetic); missing_core['allowedReadPaths'].remove('apps/web/src/api/queries.ts')
case('missing protected read', lambda: ns['scope_for'](missing_core), 'READ_SCOPE_DIFFERS')
bad_read = copy.deepcopy(synthetic); bad_read['allowedReadPaths'].append('../private.env')
case('unsafe read literal', lambda: ns['scope_for'](bad_read), 'UNSAFE_LITERAL_PATH')
wrong_model = copy.deepcopy(synthetic); wrong_model['model'] = 'claude-fable-5-2'
case('UI author rejects Fable substitution', lambda: ns['scope_for'](wrong_model), 'OPUS_UI_AUTHOR_REQUIRED')
bad_deadline = copy.deepcopy(synthetic); bad_deadline['deadlineSeconds'] = 7201
case('unchanged author maximum enforced', lambda: ns['scope_for'](bad_deadline), 'DEADLINE_UNSET')
toy_env = ns['clean_env']({'SystemRoot': 'C:/Windows', 'USERPROFILE': 'C:/Inert', 'PATH': 'inert',
                         'ANTHROPIC_API_KEY': 'synthetic-marker', 'ANTHROPIC_BASE_URL': 'synthetic-marker'})
assert 'ANTHROPIC_API_KEY' not in toy_env and 'ANTHROPIC_BASE_URL' not in toy_env
assert toy_env['PATH'].startswith(str(ns['NODE']))
args = ns['argv'](Path('C:/inert/claude.exe'), ns['AUTHOR'], draft['model'], set(draft['allowedReadPaths']), set(expected_paths))
assert args[args.index('--tools') + 1] == args[args.index('--allowedTools') + 1] == 'Read,Edit,Write'
assert args[args.index('--mcp-config') + 1] == '{"mcpServers":{}}' and '--no-chrome' in args
max_fixture = {'loggedIn': True, 'authMethod': 'claude.ai', 'apiProvider': 'firstParty', 'subscriptionType': 'max', 'apiKeySource': None}
assert ns['max_auth'](max_fixture)
assert not ns['max_auth'](max_fixture | {'apiKeySource': 'synthetic-marker'})
assert not ns['max_auth'](max_fixture | {'subscriptionType': 'pro'})
now = datetime(2026, 11, 23, 15, 0, tzinfo=timezone.utc)
owner = {'utc': now.isoformat(), 'scope': ns['SCOPE'], 'role': ns['AUTHOR'], 'source': draft['source'],
         'rootExclusiveOwner': True, 'noOtherOwnedWorker': True}
case('inert fresh task owner', lambda: ns['require_owner'](owner, synthetic, now.timestamp()))
case('inert stale owner rejected', lambda: ns['require_owner'](owner, synthetic, (now + timedelta(seconds=301)).timestamp()), 'FRESH_EXCLUSIVE_OWNER_REQUIRED')

# Evaluate only the added need() conditions with synthetic dictionaries/path
# stubs. This is not the admit() function and performs no real admission.
admit_ast = ast.parse((prep / 'admit.py').read_text())
admit_fn = next(n for n in admit_ast.body if isinstance(n, ast.FunctionDef) and n.name == 'admit')
needs = {n.args[1].value: n.args[0] for n in ast.walk(admit_fn) if isinstance(n, ast.Call)
         and isinstance(n.func, ast.Name) and n.func.id == 'need' and len(n.args) == 2 and isinstance(n.args[1], ast.Constant)}


def condition(message, env):
    value = eval(compile(ast.Expression(copy.deepcopy(needs[message])), '<inert-admission-condition>', 'eval'), env)
    if not value:
        raise RuntimeError(message)


missing_message = 'Root decision, finding, brief and independent acceptance are unset'
case('missing root admission refuses', lambda: condition(missing_message, {'binding_path': SimpleNamespace(is_file=lambda: False)}), missing_message)
root_message = 'Root B2 continuation admission is unset or mismatched'
fake_pin = {'source': 'inert', 'bytes': 1, 'sha256': expected_controller}
fake_root = {'rootAdmitted': True, 'apiRouteAuthorized': False, 'source': draft['source'], 'controller': fake_pin}
for label, root_fixture in [('valid inert root predicate', fake_root), ('unarmed root', fake_root | {'rootAdmitted': False}),
                            ('API route authorization', fake_root | {'apiRouteAuthorized': True})]:
    case(label, lambda b=root_fixture: condition(root_message, {'binding': b, 'c': synthetic, 'pin': lambda p: fake_pin, 'HELPER': 'inert'}),
         None if label.startswith('valid') else root_message)
mechanics_message = 'Fresh exact-eight controller review acceptance is required'
mechanics = {'scope': ns['SCOPE'], 'mechanicsAccepted': True, 'actualRuntimeAdmission': False, 'controllerSha256': expected_controller}
for label, record in [('valid inert mechanics', mechanics), ('runtime admission true', mechanics | {'actualRuntimeAdmission': True}),
                      ('wrong controller digest', mechanics | {'controllerSha256': '0' * 64})]:
    case(label, lambda m=record: condition(mechanics_message, {'mechanics': m, 'c': synthetic, 'binding': fake_root}),
         None if label.startswith('valid') else mechanics_message)

# Exact live metadata/hash readback; product bytes are hashed only, never reviewed.
core = json.loads((prep / 'CORE-REVIEW-REBIND.json').read_bytes())
assert core['source'] == draft['source'] and core['rootRuntimeAdmitted'] is False
w = Path(draft['checkout'])
env = os.environ | {'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_LAZY_FETCH': '1'}


def git(*arguments):
    return subprocess.check_output([draft['gitBinary']['source'], '--no-optional-locks', '-c', 'maintenance.auto=false',
        '-c', 'gc.auto=0', '-C', str(w), *arguments], env=env)


index_ref = core['visibleCandidateState']['worktreeIndexUnchanged']
index_before = pin(Path(index_ref['source']))
assert index_before == index_ref
assert git('rev-list', '--parents', '-1', 'HEAD').decode().split() == [draft['source']['head'], *draft['source']['parents']]
assert git('rev-parse', 'HEAD^{tree}').decode().strip() == draft['source']['tree']
assert not git('status', '--porcelain=v1', '-z', '--untracked-files=all')
read_pins = {}
for name in draft['allowedReadPaths']:
    local = w / name
    assert local.resolve(strict=True) == local and local.is_file()
    raw = git('cat-file', 'blob', draft['source']['head'] + ':' + name)
    actual = pin(local)
    assert actual['bytes'] == len(raw) and actual['sha256'] == sha(raw)
    read_pins[name] = actual
for name, wanted in draft['corePins'].items():
    assert read_pins[name] == wanted
for wanted in core['visibleCandidateState']['unchangedDependencyControlPins'].values():
    assert pin(Path(wanted['source'])) == wanted
for key in ['claudeBinary', 'gitBinary']:
    assert pin(Path(draft[key]['source'])) == draft[key]
common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
assert not os.path.lexists(common / 'index')
assert pin(Path(index_ref['source'])) == index_before
assert not Path(draft['output']).exists() and not (e / 'i5-d236-max-continuation-owner.lock').exists()
save('CONTROLS.json', {'inertCases': results, 'inertCaseCount': len(results),
    'apiEnvironmentMarkersDropped': True, 'maxAuthPredicatesSyntheticOnly': True, 'argvInspectedOnlyNotRun': True,
    'astOnlyUIWritesAssignmentChanged': True, 'binaryOnlyUIWritesAssignmentChanged': True,
    'independentlyGeneratedDiffMatches': True, 'oldOrderedWrites': list(old_paths), 'newOrderedWrites': list(new_paths),
    'controllerStatementsOtherwiseIdentical': len(new_filtered.body), 'draftReadPathsSubsetPrevious': True,
    'readScopeCount': len(read_pins), 'currentReadFilePinsMatchTrackedF642Blobs': read_pins,
    'indexBeforeAfter': index_before, 'corePinsExact': True, 'dependencyPinsExact': True,
    'claudeAndGitBinaryPinsExactWithoutExecution': True, 'commonIndexAbsent': True,
    'initialRequiredFilePresence': initial_presence,
    'unarmedDraftAndRootTemplate': True, 'ownerOutputAndAdmittedConfigAbsent': True,
    'source': draft['source'], 'manifestMembersVerified': len(manifest['members']), 'manifestInputsVerified': len(manifest['inputs']),
    'actualReportBodyRead': False, 'liveControllerOrAdmissionInvoked': False, 'providerOrCredentialCalls': False,
    'productSourceReviewTestsBuildBrowserOrRepoWrites': False})
print(json.dumps({'inertCases': len(results), 'onlyUIWritesDiff': True, 'readPins': len(read_pins),
                  'sourceIndexCoreBinaryPinsExact': True, 'runtimeAdmission': False, 'initialPresence': initial_presence}))
