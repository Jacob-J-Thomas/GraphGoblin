"""Independent D242 mechanics fixtures. Only declarations and synthetic inputs are executed."""
import ast
from copy import deepcopy
from datetime import datetime, timezone
import difflib
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
from tempfile import TemporaryDirectory
from types import SimpleNamespace

OUT = Path(__file__).resolve().parent
EVIDENCE = OUT.parent
PACKET = EVIDENCE / 'i5-d242-fable-correction-preparation-01'
Q_PUBLIC = Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents')
OLD = EVIDENCE / 'i5-d236-max-continuation-preparation-02/max-continuation.draft.py'
MAC = EVIDENCE / 'mac-d237-claude-review-preparation-01/mac-review.draft.py'
HELPER = PACKET / 'fable-correction.draft.py'
WRAPPER = PACKET / 'admit.py'
MANIFEST_SHA = 'fdb9890ed2608aa06e3c98998463d087710df2122fc95476e783ee086dbeba98'
HELPER_SHA = 'e21dd6dd3aadbb85409fd0dad34f6f729d98f26a3a5be123a6fc3066077633dd'
BEFORE = 'f64287619b499c14601e11bce3d1c6b5414b6227'
FIXED = json.loads((PACKET / 'FIXED-CONTROLS.json').read_bytes())
TEMPLATE = json.loads((PACKET / 'fable-review.unarmed.json').read_bytes())
PROTOCOL = ast.parse(HELPER.read_bytes())
GATE = ast.parse(WRAPPER.read_bytes())
CLOCK = datetime(2026, 11, 23, 16, 0, tzinfo=timezone.utc)
CASES = []


def verify(ok, description):
    if not ok:
        raise AssertionError(description)


def add(case, outcome, **detail):
    CASES.append(dict(case=case, outcome=outcome, **detail))


def pin(path):
    raw = path.read_bytes()
    return dict(source=str(path), bytes=len(raw), sha256=sha256(raw).hexdigest())


def load(path):
    return json.loads(path.read_bytes())


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding='utf-8')


def materialize(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return pin(path)


def extract(tree, names, context, overrides=None):
    declarations = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names:
            declarations.append((overrides or {}).get(node.name, node))
        elif isinstance(node, ast.Assign) and all(isinstance(t, ast.Name) and t.id in names for t in node.targets):
            declarations.append(node)
    module = ast.fix_missing_locations(ast.Module(body=declarations, type_ignores=[]))
    exec(compile(module, '<reviewed isolated declarations>', 'exec'), context)
    return context


def declaration_map(source):
    return {node.name: ast.dump(node) for node in ast.parse(source.read_bytes()).body
            if isinstance(node, (ast.FunctionDef, ast.ClassDef))}


def fingerprint_control():
    manifest = PACKET / 'MANIFEST.json'
    verify(pin(manifest)['sha256'] == MANIFEST_SHA and pin(HELPER)['sha256'] == HELPER_SHA, 'exact packet')
    members = load(manifest)
    verify(all(pin(PACKET / name) == ref for name, ref in members['members'].items()), 'member pins')
    verify(all(pin(Path(ref['source'])) == ref for ref in members['references']), 'reference pins')
    for controller, directory, expected in [
        (OLD, 'i5-d236-max-continuation-independent-02',
         '636679ad6e298c47cc7ca5bbe2d3b04ef5ab73a4b7fbc23e76128235c8222a36'),
        (MAC, 'mac-d237-claude-review-independent-01',
         '880470e0fdcd8f641ae49f5a1e9021da45ae3ad8c2ac8b197776fb2259a4ac10'),
    ]:
        receipt = load(EVIDENCE / directory / 'ACCEPTANCE.json')
        verify(pin(controller)['sha256'] == expected == receipt['controllerSha256'], 'exact accepted lineage')
        verify(receipt['mechanicsAccepted'] and not receipt['actualRuntimeAdmission'], 'independent lineage')
    old_code, mac_code, new_code = map(declaration_map, [OLD, MAC, HELPER])
    verify(old_code.keys() == new_code.keys() == mac_code.keys(), 'declaration roster')
    delta = sorted(name for name in new_code if old_code[name] != new_code[name])
    mac_delta = sorted(name for name in mac_code if old_code[name] != mac_code[name])
    verify(delta == ['argv', 'launch', 'scope_for'], 'D242 diff')
    verify(mac_delta == ['argv', 'launch', 'scope_for', 'source_state'], 'D237 diff')
    expected_diff = ''.join(difflib.unified_diff(OLD.read_text().splitlines(True),
        HELPER.read_text().splitlines(True), fromfile='accepted-D236/max-continuation.draft.py',
        tofile='D242/fable-correction.draft.py'))
    verify(expected_diff == (PACKET / 'controller.diff').read_text(), 'complete supplied diff')
    prior = load(EVIDENCE / 'i5-b2-remount-max-preparation-01/correction.draft.json')
    core_receipt = load(EVIDENCE / 'i5-b2-remount-max-preparation-01/CORE-REVIEW-REBIND.json')
    verify(len(FIXED['allowedReadCeiling']) == 36 and set(FIXED['allowedReadCeiling']) == set(prior['allowedReadPaths']),
           'prior ceiling')
    verify(len(FIXED['correctionPaths']) == 8 and set(FIXED['correctionPaths']) == set(prior['allowedWritePaths']),
           'eight correction paths')
    verify(FIXED['protectedCore'] == prior['corePins'], 'kept prior core pins')
    verify(all(FIXED['reviewedCoreBlobs'][name] == expected['reviewedBlob'] == expected['candidateBlob']
               and FIXED['protectedCore'][name]['sha256'] == expected['sha256']
               and FIXED['protectedCore'][name]['bytes'] == expected['bytes']
               for name, expected in core_receipt['coreBlobEquality'].items()), 'prior core bytes/blob cross-check')
    verify(all(FIXED[name] == prior[name] for name in ['claudeBinary', 'gitBinary']), 'historical binary pins')
    add('lineage-and-ceiling', 'pass', changedDeclarations=delta, unchangedFromD236=len(new_code)-len(delta),
        macChangedDeclarations=mac_delta, priorReadCeiling=36, requiredReads=11,
        manifestMembers=len(members['members']), manifestReferences=len(members['references']))


def guard_refusal(case, expected, fn, *args):
    try:
        fn(*args)
    except (ValueError, RuntimeError) as err:
        verify(str(err) == expected, (case, str(err), expected))
        add(case, 'refused', reason=str(err))
    else:
        raise AssertionError(f'{case} was not refused')


def controller_controls(tmp):
    env = extract(PROTOCOL, {'Refusal', 'need', 'literal', 'scope_for', 'argv', 'clean_env', 'max_auth',
        'require_owner', 'tool_scope', 'terminal', 'CORE', 'CORRECTION_PATHS', 'READ_LIMIT', 'SCOPE',
        'REVIEW', 'MODEL', 'KEEP_ENV'}, dict(Path=Path, PurePosixPath=PurePosixPath, json=json, re=re, os=os,
        datetime=datetime, NODE=tmp / 'dummy-node'))
    selected = set(FIXED['correctionPaths']) | set(FIXED['protectedCore'])
    verify(selected == env['CORE'] | env['CORRECTION_PATHS'] and
           env['READ_LIMIT'] == set(FIXED['allowedReadCeiling']), 'controller matches wrapper ceilings')
    scope, model, role = [env[name] for name in ('SCOPE', 'MODEL', 'REVIEW')]
    cfg = dict(TEMPLATE, rootAdmitted=True, allowedReadPaths=sorted(selected))
    verify(env['scope_for'](cfg) == (selected, set()), 'root minimal roster')
    params = env['argv'](tmp / 'claude.exe', role, model, selected, set())
    flags = {'--model': model, '--effort': 'xhigh', '--tools': 'Read', '--allowedTools': 'Read',
             '--setting-sources': '', '--mcp-config': '{"mcpServers":{}}', '--output-format': 'stream-json',
             '--permission-mode': 'dontAsk', '--permission-prompts': 'none'}
    verify(all(params[params.index(k)+1] == v for k, v in flags.items()), 'fixed argv value')
    verify(set(['--print', '--safe-mode', '--restricted', '--strict-mcp-config', '--disable-slash-commands',
                '--no-chrome', '--no-session-persistence']) <= set(params), 'fixed argv flags')
    verify(f'Read paths: {json.dumps(sorted(selected))}. Write paths: [].' in params[-1], 'exact roster prompt')
    add('controller-minimal-positive', 'pass', role=role, scope=scope, argvFlags=flags, selectedReads=sorted(selected))
    for case, change, reason in [
        ('unarmed-controller', {'rootAdmitted': False}, 'ROOT_ADMISSION_UNSET'),
        ('d237-scope-controller', {'scope': 'D237-ordinary-max-macos-integration-review'}, 'ROOT_ADMISSION_UNSET'),
        ('api-authorization-controller', {'apiRouteAuthorized': True}, 'API_ROUTE_MUST_REMAIN_CLOSED'),
        ('author-controller', {'role': 'ui-author'}, 'ROLE_MODEL_UNSET'),
        ('old-core-controller', {'role': 'core-review'}, 'ROLE_MODEL_UNSET'),
        ('opus-model-controller', {'model': 'claude-opus-5-5'}, 'ROLE_MODEL_UNSET'),
        ('high-effort-controller', {'effort': 'high'}, 'ROLE_MODEL_UNSET'),
        ('write-controller', {'allowedWritePaths': ['CHANGELOG.md']}, 'WRITE_SCOPE_DIFFERS'),
        ('wildcard-controller', {'allowedReadPaths': sorted(selected) + ['docs/*.md']}, 'UNSAFE_LITERAL_PATH'),
        ('extra-beyond-ceiling-controller', {'allowedReadPaths': sorted(selected) + ['package.json']}, 'READ_SCOPE_DIFFERS'),
        ('missing-required-controller', {'allowedReadPaths': sorted(selected - {'CHANGELOG.md'})}, 'READ_SCOPE_DIFFERS'),
        ('case-duplicate-controller', {'allowedReadPaths': sorted(selected) + ['changelog.md']}, 'READ_SCOPE_DIFFERS'),
        ('deadline-controller', {'deadlineSeconds': 1201}, 'DEADLINE_UNSET'),
    ]:
        guard_refusal(case, reason, env['scope_for'], cfg | change)
    max_login = dict(loggedIn=True, authMethod='claude.ai', apiProvider='firstParty', subscriptionType='max', apiKeySource=None)
    verify(env['max_auth'](max_login) and all(not env['max_auth'](max_login | change)
           for change in ({'subscriptionType': 'pro'}, {'apiProvider': 'bedrock'}, {'apiKeySource': 'env'},
                          {'authMethod': 'console'}, {'loggedIn': False})), 'auth strict variants')
    clean = env['clean_env']({'SystemRoot':'fixture', 'USERPROFILE':'fixture', 'PATH':'fixture',
        'ANTHROPIC_API_KEY':'dummy', 'ANTHROPIC_BASE_URL':'dummy', 'CLAUDE_CONFIG_DIR':'dummy',
        'CLAUDE_CODE_USE_BEDROCK':'dummy', 'GIT_CONFIG_COUNT':'dummy'})
    verify(set(clean) == {'SystemRoot', 'USERPROFILE', 'PATH'}, 'clean provider environment')
    add('ordinary-max-and-env', 'pass', credentialByteValuesLogged=False)
    source = dict(head='a'*40, tree='b'*40, parents=['c'*40])
    stamp = CLOCK.timestamp()
    claim = dict(utc=CLOCK.isoformat(), source=source, scope=scope, role=role, rootExclusiveOwner=True,
        noOtherOwnedWorker=True)
    env['require_owner'](claim, cfg | {'source':source}, stamp+300)
    guard_refusal('owner-stale', 'FRESH_EXCLUSIVE_OWNER_REQUIRED', env['require_owner'], claim,
                  cfg | {'source':source}, stamp+301)
    guard_refusal('owner-other-source', 'FRESH_EXCLUSIVE_OWNER_REQUIRED', env['require_owner'], claim,
                  cfg | {'source':source | {'head':'d'*40}}, stamp)
    add('owner-fresh-positive', 'pass', maximumAgeSeconds=300)
    text = 'Fixture ordinary decision'
    final = dict(type='result', subtype='success', terminal_reason='completed', is_error=False, modelUsage={model:{}},
                 result=text)
    partial_text = {'type':'assistant', 'message':{'model':model, 'content':[dict(type='text', text=text)]}}
    result = {'type':'user', 'message':{'content':[dict(type='tool_result', tool_use_id='id-1')]}}
    def do(tool, file, user=None):
        request = {'type':'assistant', 'message':{'model':user or model, 'content':[
            dict(type='tool_use', name=tool, input={'file_path':file}, id='id-1')]}}
        return request
    def terminal(events, code=0, complete=True):
        raw = ('\n'.join(map(json.dumps, events))).encode()
        return env['terminal'](raw, model, tmp, selected, set(), code, complete)
    initial = do('Read', 'CHANGELOG.md')
    ok, ordinary, accepted = terminal([initial, result, partial_text, final])
    verify(accepted and ok['matchedToolResults']==1 and ordinary==text, 'paired positive')
    add('controller-paired-normal-terminal', 'pass', matchedToolResults=1, model=model)
    for case, events, reason in [
        ('paired-write', [do('Write', 'CHANGELOG.md'), result, partial_text, final], 'OUT_OF_SCOPE_TOOL'),
        ('paired-glob', [do('Glob', 'CHANGELOG.md'), result, partial_text, final], 'OUT_OF_SCOPE_TOOL'),
        ('ceiling-member-outside-selected-roster', [do('Read', 'docs/README.md'), result, partial_text, final],
         'OUT_OF_SCOPE_TOOL_PATH'),
        ('pending-read', [initial, partial_text, final], 'UNPAIRED_TOOL_REQUEST'),
        ('event-after-terminal', [initial, result, partial_text, final, partial_text], 'EVENT_AFTER_TERMINAL'),
    ]:
        rejected, _, accepted = terminal(events)
        verify(not accepted and reason in rejected['protocolProblems'], (case, rejected))
        add(case, 'refused', reason=reason, terminalCount=rejected['terminalCount'])
    result0, partial0, accepted0 = terminal([partial_text, final | {'is_error':True}], 1, False)
    verify(partial0==text and not accepted0 and not result0['streamComplete'], 'partial remains available')
    add('partial-preservation', 'pass', ordinaryHandoffAccepted=accepted0, partialPreserved=bool(partial0))
    return env


class Fixture:
    """Real temporary file bytes and production declarations, with deterministic Git/process replies."""
    def __init__(self, home):
        self.e = home / 'evidence'
        self.p = self.e / 'packet'
        self.q = home / 'public-qa'
        self.w = home / 'checkout'
        self.lock = self.e / 'lock'
        self.output = self.e / 'output'
        self.index = home / 'git' / 'worktrees' / 'isolated' / 'index'
        self.common = home / 'git'
        self.claude = home / 'binaries' / 'claude.exe'
        self.git = home / 'binaries' / 'git.exe'
        self.helper = self.p / 'fable-correction.draft.py'
        self.prior = self.e / 'prior-core.json'
        self.acceptance = self.e / 'i5-d242-fable-correction-independent-01' / 'ACCEPTANCE.json'
        self.decision = self.e / 'decision.md'
        self.finding = self.q / 'finding.md'
        closed_flag = {'pid': 1234, 'parent': 456, 'created':CLOCK.isoformat(), 'isPrint':False}
        self.processes = [closed_flag]
        self.status = b''
        self.git_calls = []
        self.process_scans = 0
        self.changed = FIXED['correctionPaths'][0]
        self.changes = [self.changed]
        self.source = dict(head='a'*40, tree='b'*40, parents=[BEFORE])
        self.blobs = {}
        self.selected = sorted(set(FIXED['correctionPaths']) | set(FIXED['protectedCore']))
        self.patch = b'diff --git a/fixture b/fixture\nfixture patch\n'
        for path in self.selected + ['docs/README.md']:
            data = ('Fixture head bytes for ' + path).encode()
            self.blobs[self.source['head'] + ':' + path] = data
            materialize(self.w / path, data)
        self.blobs[BEFORE + ':' + self.changed] = b'Fixture held baseline bytes'
        dependencies = {name:materialize(self.w / rel, data) for name, rel, data in [
            ('lock','pnpm-lock.yaml',b'fixture lock'), ('modules','node_modules/.modules.yaml',b'fixture modules'),
            ('virtualStoreLock','node_modules/.pnpm/lock.yaml',b'fixture virtual store lock')]}
        dump(self.prior, {'visibleCandidateState':{'unchangedDependencyControlPins':dependencies}})
        self.fixed = FIXED | {
            'claudeBinary':materialize(self.claude, b'fixture claude bytes'),
            'gitBinary':materialize(self.git, b'fixture git bytes'),
            'protectedCore':{name:pin(self.w / name) for name in FIXED['protectedCore']},
            'reviewedCoreBlobs':{name:self.blob_pin(self.source['head'], name)['blob'] for name in FIXED['protectedCore']},
        }
        dump(self.p / 'FIXED-CONTROLS.json', self.fixed)
        template = TEMPLATE | {'checkout':str(self.w), 'output':str(self.output)}
        dump(self.p / 'fable-review.unarmed.json', template)
        dump(self.acceptance, {key:template[key] for key in ['scope','role']} | {
            'mechanicsAccepted':True, 'actualRuntimeAdmission':False, 'readOnly':True, 'authorRoleRejected':True,
            'controllerSha256':HELPER_SHA})
        decision = EVIDENCE / 'i5-d242-b2-remount-correction-01' / 'DECISION.md'
        source_finding = Q_PUBLIC / 'i5-564-final-astra-max-03' / 'REPORT.md'
        self.binding = dict(rootAdmitted=True, apiRouteAuthorized=False, rootVerifiedClosedAuthorAndQa=True,
            beforeHead=BEFORE, source=deepcopy(self.source), target='c'*40, index=materialize(self.index,b'fixture index'),
            dependencies=dependencies, controller=materialize(self.helper, HELPER.read_bytes()),
            decision=materialize(self.decision, decision.read_bytes()),
            findingReport=materialize(self.finding, source_finding.read_bytes()),
            correctionPatch=materialize(self.e/'scope.patch', self.patch),
            brief=materialize(self.p/'BRIEF.md', b'Synthetic bound correction-only review brief\n'),
            independentAcceptance=pin(self.acceptance), allowedReadPaths=self.selected.copy(),
            readFilePins={name:self.blob_pin(self.source['head'],name) for name in self.selected},
            changedFilePins={self.changed:{'before':self.blob_pin(BEFORE,self.changed),
                'after':self.blob_pin(self.source['head'],self.changed)}},
            claudeBinary=self.fixed['claudeBinary'], gitBinary=self.fixed['gitBinary'])
        for key in ['authorClosure', 'focusedQaReport', 'independentQaReport', 'targetReadback']:
            self.binding[key] = materialize(self.e/(key+'.txt'), ('Root fixture attests '+key).encode())
        dump(self.p / 'MANIFEST.json', {'members':{
            name:pin(self.p / name) for name in ['FIXED-CONTROLS.json', 'fable-review.unarmed.json',
                                                'fable-correction.draft.py']},
            'references':[pin(self.decision), pin(self.prior)]})

    def blob_pin(self, rev, path):
        raw = self.blobs[rev+':'+path]
        return {'blob':sha256(b'fixture-blob:'+raw).hexdigest()[:40],
                'bytes':len(raw), 'sha256':sha256(raw).hexdigest()}

    def git_reply(self, *args):
        self.git_calls.append(args)
        if args == ('rev-list', '--parents', '-1', 'HEAD'):
            return (' '.join([self.source['head'], *self.source['parents']])+'\n').encode()
        if args == ('rev-parse','HEAD^{tree}'):
            return self.source['tree'].encode()
        if args == ('status','--porcelain=v1','-z','--untracked-files=all'):
            return self.status
        if args == ('rev-parse','--git-path','MERGE_HEAD'):
            return str(self.index.parent/'MERGE_HEAD').encode()
        if args == ('rev-parse','--git-path','index'):
            return str(self.index).encode()
        if args == ('rev-parse','--git-common-dir'):
            return str(self.common).encode()
        if args == ('merge-base',BEFORE,self.source['head']):
            return BEFORE.encode()
        if args[:4] == ('diff','--no-ext-diff','--no-textconv','--no-renames'):
            if args[4:] == ('--name-only','-z',BEFORE,self.source['head']):
                return ('\0'.join(self.changes)+'\0').encode()
            if args[4:] == ('--binary','--full-index',BEFORE,self.source['head']):
                return self.patch
        if args[0] == 'rev-parse' and ':' in args[1]:
            rev, path = args[1].split(':', maxsplit=1)
            return self.blob_pin(self.source['head'] if rev=='HEAD' else rev,path)['blob'].encode()
        if args[:2] == ('cat-file','blob'):
            return self.blobs[args[2]]
        raise AssertionError(f'unexpected mocked Git request {args}')

    def git_stub(self, call, **kwargs):
        verify(call[:4] == [str(self.git), '--no-optional-locks', '-C', str(self.w)], 'checkout/git pinned')
        verify(kwargs['env']['GIT_OPTIONAL_LOCKS']=='0' and kwargs['env']['GIT_NO_LAZY_FETCH']=='1', 'Git safety env')
        return self.git_reply(*call[4:])

    def process_stub(self):
        self.process_scans += 1
        return self.processes

    def simulate_admission(self):
        class FixtureClock:
            @staticmethod
            def now(zone):
                verify(zone == timezone.utc, 'UTC owner')
                return CLOCK
        context = dict(P=self.p, E=self.e, Q=self.q, DECISION=self.decision, FINDING=self.finding, PRIOR_CORE=self.prior,
                       BEFORE=BEFORE, LOCK=self.lock, HELPER=self.helper, datetime=FixtureClock, timezone=timezone,
                       sha256=sha256, json=json, os=os, Path=Path, re=re,
                       subprocess=SimpleNamespace(check_output=self.git_stub, PIPE=object()),
                       time=SimpleNamespace(time=CLOCK.timestamp), closed_processes=self.process_stub, print=lambda *args: None)
        wrapper = extract(GATE, {'need','read','content_pin','pin','save','public','admit'}, context)
        return wrapper['admit']()

    def written(self):
        return [name for name in ['owner.json','fable-review.admitted.json','ADMISSION.json'] if (self.p/name).is_file()]

def wrapper_controls(home):
    def apply(fixture, name, mutate, expected, absent_binding=False):
        mutate(fixture)
        if not absent_binding:
            dump(fixture.p / 'ROOT-ADMISSION.json', fixture.binding)
        if expected:
            guard_refusal(name, expected, fixture.simulate_admission)
            verify(not fixture.written(), f'{name} wrote a receipt')
            CASES[-1].update(admissionWrites=0, mockGitCalls=len(fixture.git_calls),
                             mockProcessScans=fixture.process_scans)
        else:
            fixture.simulate_admission()
            verify(len(fixture.written()) == 3, f'{name} did not materialize all fixture receipts')

    baseline = Fixture(home / 'positive')
    apply(baseline, 'wrapper-positive', lambda f: None, None)
    bound = load(baseline.p/'fable-review.admitted.json')
    owner = load(baseline.p/'owner.json')
    receipt = load(baseline.p/'ADMISSION.json')
    verify(bound['rootAdmitted'] is True and bound['apiRouteAuthorized'] is False and bound['allowedWritePaths']==[],
           'exact materialized role envelope')
    verify(bound['source'] == owner['source'] == receipt['source'] == baseline.source and
           bound['allowedReadPaths'] == baseline.selected and receipt['target'] == baseline.binding['target'],
           'source, root roster and target preserved')
    verify(bound['singleOwner'] == pin(baseline.p/'owner.json') and
           receipt['config'] == pin(baseline.p/'fable-review.admitted.json') and
           receipt['rootBinding'] == pin(baseline.p/'ROOT-ADMISSION.json') and
           receipt['patch'] == baseline.binding['correctionPatch'], 'receipt pins')
    verify(owner['rootExclusiveOwner'] is True and owner['noOtherOwnedWorker'] is True and
           owner['utc'] == CLOCK.isoformat() and owner['observedClaude'] == baseline.processes and
           receipt['providerCalledByAdmission'] is False, 'fresh owner and no provider')
    add('wrapper-positive', 'pass', mockGitCalls=len(baseline.git_calls), mockProcessScans=baseline.process_scans,
        admissionsWritten=baseline.written(), configuredReadCount=len(bound['allowedReadPaths']))
    def set_binding(field, value):
        return lambda f: f.binding.update({field:value})
    def drift_patch(f):
        f.patch += b'contradicting Git patch'
    def drift_dependency(f):
        (f.w/'node_modules/.pnpm/lock.yaml').write_bytes(b'store drift')
    def drift_core(f):
        (f.w/next(iter(f.fixed['protectedCore']))).write_bytes(b'core drift')
    def drift_read(f):
        (f.w/f.selected[0]).write_bytes(b'nonmatching worktree read bytes')
    def drift_read_git_blob(f):
        f.binding['readFilePins'][f.selected[0]]['blob'] = '0' * 40
    def drift_changed_file(f):
        f.binding['changedFilePins'][f.changed]['before']['sha256'] = '0' * 64
    def wrong_source(f):
        f.binding['source']['head'] = 'd'*40
    def false_receipt(f):
        rejected = load(f.acceptance) | {'mechanicsAccepted':False}
        dump(f.acceptance,rejected)
        f.binding['independentAcceptance']=pin(f.acceptance)
    def set_read_paths(f, name):
        f.binding['allowedReadPaths'].append(name)
    def tamper_public(f, key):
        Path(f.binding[key]['source']).write_bytes(b'post-pin drift')
    def merge_marker(f):
        (f.index.parent / 'MERGE_HEAD').write_bytes(b'fixture marker')
    def common_index(f):
        (f.common / 'index').write_bytes(b'fixture common index')
    def reread_brief(f, raw):
        f.binding['brief'] = materialize(f.p/'BRIEF.md',raw)

    negatives = [
        ('missing-root-file', lambda f:None, 'Actual D242 root admission is absent', True),
        ('root-false', set_binding('rootAdmitted', False), 'D242 runtime admission is unset', False),
        ('api-authorization-wrapper', set_binding('apiRouteAuthorized', True), 'D242 runtime admission is unset', False),
        ('closed-author-qa-false', set_binding('rootVerifiedClosedAuthorAndQa', False), 'D242 runtime admission is unset', False),
        ('before-head-mismatch', set_binding('beforeHead', 'f'*40), 'D242 runtime admission is unset', False),
        ('target-shape', set_binding('target', 'unsigned or malformed'), 'Exact corrected source or target is missing', False),
        ('extra-source-field', lambda f: f.binding['source'].update(extra=True), 'Exact corrected source or target is missing', False),
        ('wrong-corrected-head', wrong_source, 'Exact clean frozen source required', False),
        ('dirty-source', lambda f:setattr(f,'status', b'?? drift\0'), 'Exact clean frozen source required', False),
        ('merge-source', merge_marker, 'Exact clean frozen source required', False),
        ('changed-index', lambda f:f.index.write_bytes(b'pre-admission index drift'), 'Index binding differs', False),
        ('common-index-present', common_index, 'Index binding differs', False),
        ('virtual-store-drift', drift_dependency, 'Dependency control changed', False),
        ('patch-git-mismatch', drift_patch, 'Scoped Git patch differs from root preservation', False),
        ('unexpected-changed-path', lambda f:f.changes.append('package.json'),
         'Visible patch does not match the named eight-path correction envelope', False),
        ('literal-roster-outside-ceiling', lambda f:set_read_paths(f,'package.json'),
         'Read roster differs from exact review boundary', False),
        ('literal-roster-missing-core', lambda f:f.binding['allowedReadPaths'].remove(next(iter(f.fixed['protectedCore']))),
         'Read roster differs from exact review boundary', False),
        ('literal-roster-duplicate', lambda f:set_read_paths(f,f.selected[0]),
         'Read roster differs from exact review boundary', False),
        ('author-evidence-drift', lambda f:tamper_public(f,'authorClosure'), 'Public evidence changed: authorClosure.txt', False),
        ('independent-qa-evidence-drift', lambda f:tamper_public(f,'independentQaReport'),
         'Public evidence changed: independentQaReport.txt', False),
        ('focused-qa-evidence-drift', lambda f:tamper_public(f,'focusedQaReport'),
         'Public evidence changed: focusedQaReport.txt', False),
        ('target-evidence-drift', lambda f:tamper_public(f,'targetReadback'), 'Public evidence changed: targetReadback.txt', False),
        ('brief-digest-drift', lambda f:tamper_public(f,'brief'), 'Public evidence changed: BRIEF.md', False),
        ('empty-brief', lambda f:reread_brief(f,b''), 'Public evidence changed: BRIEF.md', False),
        ('mechanics-withheld', false_receipt, 'Fresh independent mechanics acceptance is missing', False),
        ('local-git-binary-drift', lambda f:f.git.write_bytes(b'mismatched binary'), 'Pinned local binary changed: gitBinary', False),
        ('open-print-worker', lambda f:f.processes[0].update(isPrint=True), 'Existing task owner or print worker', False),
        ('existing-lock', lambda f:f.lock.mkdir(), 'Existing lock, owner, admission or output', False),
    ]
    for ix, (case, mutate, expected, absent_binding) in enumerate(negatives):
        apply(Fixture(home / f'refuse-{ix}'), case, mutate, expected, absent_binding)
    fixture = Fixture(home/'core-refuse')
    apply(fixture, 'changed-protected-core', drift_core,
          f'Protected core differs: {next(iter(fixture.fixed["protectedCore"]))}')
    for ix, (case, mutate, prefix) in enumerate([
        ('changed-old-blob-pin', drift_changed_file, 'Before/after blob binding differs: '),
        ('changed-read-physical-bytes', drift_read, 'Bound review input differs: '),
        ('changed-read-git-blob', drift_read_git_blob, 'Bound review input differs: '),
    ]):
        f = Fixture(home/f'byte-refuse-{ix}')
        name = f.changed if ix==0 else f.selected[0]
        apply(f, case, mutate, prefix+name)
    for case, raw in [('whitespace-brief', b' \t\n'), ('non-UTF8-brief', b'\xffD242')]:
        f = Fixture(home/case)
        apply(f, case, lambda fx: reread_brief(fx, raw), None)
        add(case, 'observed-wrapper-limit', fixtureReceiptsWritten=len(f.written()),
            eventualControllerEmptyGuardRefuses=not bool(raw.strip()))
    f = Fixture(home/'unknown-root-field')
    apply(f, 'unknown-root-field', set_binding('irrelevantExtension', {'marker':1}), None)
    add('unknown-root-field', 'observed-wrapper-limit', fixtureReceiptsWritten=len(f.written()),
        fieldPropagated='irrelevantExtension' in load(f.p/'fable-review.admitted.json'))
    return baseline


def launch_prefix_controls(f):
    # Compile only the exact checks before the controller acquires its owner lock.
    # There is no lock, auth, launch, or harvest statement in this prefix.
    launch = next(node for node in PROTOCOL.body if isinstance(node, ast.FunctionDef) and node.name=='launch')
    end = next(ix for ix, stmt in enumerate(launch.body) if 'newly_writable' in ast.unparse(stmt))
    prefix = deepcopy(launch)
    prefix.name = 'prelock_checks'
    prefix.body = prefix.body[:end] + [ast.parse('return sorted(reads), before, brief').body[0]]
    synthetic_os = SimpleNamespace(path=os.path, pathsep=os.pathsep,
        environ={'SystemRoot':'fixture', 'USERPROFILE':'fixture', 'PATH':'fixture'})
    def git_factory(binary, cwd, env):
        verify(binary == f.git and cwd == f.w and set(env) == {'SystemRoot','USERPROFILE','PATH'}, 'runtime synthetic Git')
        def git(*args):
            fixed = {
                ('rev-parse','--show-toplevel'):str(f.w),
                ('rev-parse','--path-format=absolute','--git-path','MERGE_HEAD'):str(f.index.parent/'MERGE_HEAD'),
                ('rev-parse','--path-format=absolute','--git-path','index'):str(f.index),
                ('rev-parse','HEAD'):f.source['head'],
                ('show','-s','--format=%P','HEAD'):' '.join(f.source['parents']),
            }
            if args in fixed:
                return fixed[args].encode()
            return f.git_reply(*args)
        return git
    env = extract(PROTOCOL, {'Refusal','need','read','pin','path_at','bound','evidence_path','public_ref','literal',
        'scope_for','require_owner','source_state','local_file','clean_env','launch','NOT_BEFORE','SCOPE','REVIEW','MODEL',
        'CORE','CORRECTION_PATHS','READ_LIMIT','KEEP_ENV','DECISION_SHA'},
        dict(Path=Path, PurePosixPath=PurePosixPath, sha256=sha256, json=json, re=re, datetime=datetime, E=f.e,
             DECISION=f.decision, HELPER=f.helper, CLAUDE=f.claude, GIT=f.git, os=synthetic_os,
             NODE=f.e/'node', time=SimpleNamespace(time=CLOCK.timestamp), git_reader=git_factory),
        {'launch':prefix})
    standard = f.p/'fable-review.admitted.json'
    reads, snapshot, brief = env['prelock_checks'](str(standard))
    verify(reads==f.selected and snapshot['source']==f.source and brief.startswith(b'Synthetic'), 'normal prefix')
    add('runtime-exact-generated-prelock', 'pass', selectedReadCount=len(reads), actualChildLaunch=False)
    c = load(standard)
    guard_refusal('runtime-owner-source-differs', 'FRESH_EXCLUSIVE_OWNER_REQUIRED', lambda:
        _check_changed_runtime_config(env, f, c | {'source':f.source | {'tree':'d'*40}}))
    original_tree = f.source['tree']
    f.source['tree'] = 'd'*40
    guard_refusal('runtime-actual-tree-differs', 'EXACT_CLEAN_SOURCE_REQUIRED', env['prelock_checks'], str(standard))
    f.source['tree'] = original_tree
    f.index.write_bytes(b'index changed after mock wrapper')
    (f.w/'node_modules/.modules.yaml').write_bytes(b'modules changed after mock wrapper')
    drift_cfg = c | {'allowedReadPaths':c['allowedReadPaths']+['docs/README.md'], 'ignoredExtra':1}
    drift_reads, drift_snapshot, _ = _check_changed_runtime_config(env, f, drift_cfg)
    verify('docs/README.md' not in reads and 'docs/README.md' in drift_reads and
           snapshot['index']!=drift_snapshot['index'] and snapshot['modules']!=drift_snapshot['modules'],
           'runtime prelock uses altered roster and newly baselines mutable worktree controls without receipt readback')
    add('runtime-scope-and-controls-after-wrapper-edit', 'observed-separated-trust-boundary',
        addedInCeilingRead='docs/README.md', indexRebaselined=True, modulesRebaselined=True,
        requiredRootAssumption='Invoke exact originally materialized config with its verified pins and exclusive source')
    f.binding['brief'] = materialize(f.p/'BRIEF.md',b'\xffD242')
    _, _, readback = _check_changed_runtime_config(env,f,c|{'brief':f.binding['brief']})
    verify(readback==b'\xffD242','prelock admits malformed bytes')
    add('non-UTF8-brief-controller-prelock', 'observed-controller-limit', passedPrefix=True)


def _check_changed_runtime_config(env, fixture, config):
    alternative = fixture.p/'alternative-fixture.json'
    dump(alternative, config)
    return env['prelock_checks'](str(alternative))


def main():
    fingerprint_control()
    with TemporaryDirectory(dir=OUT, prefix='transient-fixture-') as tmp:
        base = Path(tmp).resolve()
        controller_controls(base)
        normal = wrapper_controls(base)
        launch_prefix_controls(normal)
    path = OUT/'fixture-results.json'
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps({'cases':CASES, 'caseCount':len(CASES), 'actualGitCalls':0,
            'actualProcessProbes':0, 'actualProviderCalls':0, 'operationalEntrypointsInvoked':0,
            'actualSourceOrIndexAccess':False}, indent=2)+'\n')
    print(f'{len(CASES)} independently observed controls recorded in {path.name}')


if __name__=='__main__':
    main()

