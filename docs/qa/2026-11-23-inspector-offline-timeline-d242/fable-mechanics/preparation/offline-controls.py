"""Synthetic predicates and AST checks; does not import or launch either controller."""
from datetime import datetime, timezone
import ast
import json
import os
from pathlib import Path, PurePosixPath
import re

P = Path(__file__).resolve().parent
E = P.parent
old = ast.parse((E / 'i5-d236-max-continuation-preparation-02/max-continuation.draft.py').read_bytes())
new = ast.parse((P / 'fable-correction.draft.py').read_bytes())
wrapper = ast.parse((P / 'admit.py').read_bytes())
template = json.loads((P / 'fable-review.unarmed.json').read_text(encoding='utf-8'))
assert template['source'] is None and template['allowedReadPaths'] is None and template['singleOwner'] is None


def funcs(module):
    return {node.name: ast.dump(node) for node in module.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))}


def extract(module, names, namespace):
    body = []
    for node in module.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names:
            body.append(node)
        elif isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and node.targets[0].id in names:
            body.append(node)
    exec(compile(ast.Module(body=body, type_ignores=[]), '<extracted offline declarations>', 'exec'), namespace)
    return namespace


def refusal(expected, callback, *args):
    try:
        callback(*args)
    except ValueError as error:
        assert str(error) == expected, (str(error), expected)
        print(expected)
    else:
        raise AssertionError('Missing refusal: ' + expected)


a, b = funcs(old), funcs(new)
assert a.keys() == b.keys()
assert {name for name in a if a[name] != b[name]} == {'scope_for', 'argv', 'launch'}
assert a['terminal'] == b['terminal'] and a['owned_capture'] == b['owned_capture']
assert a['require_owner'] == b['require_owner'] and a['max_auth'] == b['max_auth']
print('Controller AST comparison passed; only scope_for, argv and launch changed.')
env = extract(new, {'SCOPE', 'REVIEW', 'MODEL', 'CORE', 'CORRECTION_PATHS', 'READ_LIMIT',
                   'KEEP_ENV', 'Refusal', 'need', 'literal', 'scope_for', 'clean_env', 'max_auth',
                   'argv', 'tool_scope', 'terminal', 'require_owner'},
              {'Path': Path, 'PurePosixPath': PurePosixPath, 're': re, 'json': json,
               'datetime': datetime, 'NODE': P / 'synthetic-node', 'os': os})
scope_for = env['scope_for']
scope, role, model = (env[name] for name in ('SCOPE', 'REVIEW', 'MODEL'))
reads = env['CORE'] | env['CORRECTION_PATHS']
cfg = template | {'rootAdmitted': True, 'allowedReadPaths': sorted(reads)}
assert scope_for(cfg) == (reads, set())
print('Only the named read-only Fable scope accepted in synthetic config.')
for code, change in (
    ('ROOT_ADMISSION_UNSET', {'rootAdmitted': False}),
    ('ROOT_ADMISSION_UNSET', {'scope': 'D236-ordinary-max-continuation'}),
    ('API_ROUTE_MUST_REMAIN_CLOSED', {'apiRouteAuthorized': True}),
    ('ROLE_MODEL_UNSET', {'role': 'ui-author'}),
    ('ROLE_MODEL_UNSET', {'role': 'core-review'}),
    ('ROLE_MODEL_UNSET', {'model': 'claude-opus-5-5'}),
    ('ROLE_MODEL_UNSET', {'effort': 'high'}),
    ('DEADLINE_UNSET', {'deadlineSeconds': True}),
    ('DEADLINE_UNSET', {'deadlineSeconds': 1201}),
    ('LITERAL_PATHS_UNSET', {'allowedReadPaths': None}),
    ('WRITE_SCOPE_DIFFERS', {'allowedWritePaths': [sorted(reads)[0]]}),
    ('READ_SCOPE_DIFFERS', {'allowedReadPaths': sorted(reads) + ['package.json']}),
    ('READ_SCOPE_DIFFERS', {'allowedReadPaths': sorted(reads)[1:]}),
    ('READ_SCOPE_DIFFERS', {'allowedReadPaths': sorted(reads) + [sorted(reads)[0].upper()]}),
    ('UNSAFE_LITERAL_PATH', {'allowedReadPaths': sorted(reads) + ['../outside']}),
):
    refusal(code, scope_for, cfg | change)

argv = env['argv'](P / 'synthetic-claude.exe', role, model, reads, set())
for flag in ('--tools', '--allowedTools'):
    assert argv[argv.index(flag) + 1] == 'Read'
assert argv[argv.index('--model') + 1] == model and argv[argv.index('--effort') + 1] == 'xhigh'
assert argv[argv.index('--setting-sources') + 1] == '' and '--strict-mcp-config' in argv
refusal('READ_ONLY_FABLE_ROLE_REQUIRED', env['argv'], 'synthetic', 'ui-author', model, reads, set())
refusal('READ_ONLY_FABLE_ROLE_REQUIRED', env['argv'], 'synthetic', role, model, reads, {'CHANGELOG.md'})
normal = {'loggedIn': True, 'authMethod': 'claude.ai', 'apiProvider': 'firstParty',
          'subscriptionType': 'max', 'apiKeySource': None}
assert env['max_auth'](normal) and not env['max_auth'](normal | {'apiKeySource': 'environment'})
assert not env['max_auth'](normal | {'apiProvider': 'bedrock'})
clean = env['clean_env']({'USERPROFILE': 'synthetic', 'SystemRoot': 'synthetic',
                           'ANTHROPIC_API_KEY': 'dummy', 'ClAuDe_CoNfIg_DiR': 'dummy'})
assert 'ANTHROPIC_API_KEY' not in clean and 'CLAUDE_CONFIG_DIR' not in clean
print('Exact Read argv and synthetic ordinary-Max auth/environment controls passed.')

source = {'head': 'a' * 40, 'tree': 'b' * 40, 'parents': ['c' * 40]}
stamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
owner = {'utc': stamp.isoformat(), 'scope': scope, 'role': role, 'source': source,
         'rootExclusiveOwner': True, 'noOtherOwnedWorker': True}
env['require_owner'](owner, cfg | {'source': source}, stamp.timestamp())
refusal('FRESH_EXCLUSIVE_OWNER_REQUIRED', env['require_owner'], owner, cfg | {'source': source},
        stamp.timestamp() + 301)
refusal('FRESH_EXCLUSIVE_OWNER_REQUIRED', env['require_owner'], owner,
        cfg | {'source': source | {'head': 'd' * 40}}, stamp.timestamp())

cwd = P / 'synthetic-source-does-not-exist'
chosen = sorted(reads)[0]
def request(tool, path):
    return {'type': 'assistant', 'message': {'model': model, 'content': [
        {'type': 'tool_use', 'name': tool, 'id': 'fixture-read', 'input': {'file_path': path}}]}}
paired = {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'fixture-read'}]}}
text = {'type': 'assistant', 'message': {'model': model, 'content': [{'type': 'text', 'text': 'Synthetic ordinary result'}]}}
done = {'type': 'result', 'subtype': 'success', 'is_error': False, 'terminal_reason': 'completed',
        'modelUsage': {model: {}}, 'result': 'Synthetic ordinary result'}
def run(rows, code=0):
    raw = '\n'.join(json.dumps(row) for row in rows).encode()
    return env['terminal'](raw, model, cwd, reads, set(), code, True)
state, ordinary, accepted = run([request('Read', chosen), paired, text, done])
assert accepted and state['matchedToolResults'] == 1 and ordinary == 'Synthetic ordinary result'
for code, events, expected in [
    (0, [request('Write', chosen), paired, text, done], 'OUT_OF_SCOPE_TOOL'),
    (0, [request('Glob', chosen), paired, text, done], 'OUT_OF_SCOPE_TOOL'),
    (0, [request('Read', 'package.json'), paired, text, done], 'OUT_OF_SCOPE_TOOL_PATH'),
    (0, [request('Read', chosen), text, done], 'UNPAIRED_TOOL_REQUEST'),
    (0, [text, done, text], 'EVENT_AFTER_TERMINAL'),
]:
    state, _, accepted = run(events, code)
    assert not accepted and expected in state['protocolProblems'], state
    print(expected)
state, partial, accepted = run([text, done | {'is_error': True, 'subtype': 'error_max_budget_usd'}], 1)
assert not accepted and partial == 'Synthetic ordinary result'
print('Synthetic unsuccessful terminal remained partial.')

class SyntheticBoundPath:
    def __init__(self, present):
        self.present = present

    def __truediv__(self, _):
        return self

    def is_file(self):
        return self.present


def admits(present):
    env = extract(wrapper, {'need', 'admit'}, {
        'P': SyntheticBoundPath(present), 'read': lambda _: {'rootAdmitted': False}})
    try:
        env['admit']()
    except RuntimeError as error:
        return str(error)
    raise AssertionError('Synthetic admission unexpectedly continued')
assert admits(False) == 'Actual D242 root admission is absent'
assert admits(True) == 'D242 runtime admission is unset'
print('Missing and unarmed token stop prior to any real source, process or Git call.')
print('All finite offline controls passed.')
