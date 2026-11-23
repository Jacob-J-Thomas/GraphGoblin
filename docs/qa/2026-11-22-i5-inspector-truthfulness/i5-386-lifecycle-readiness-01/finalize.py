import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
REPO = Path('G:/ggq/gg-i4-486-current158/GraphGoblin')
EXPECTED_HEAD = '0d024bc4f8706846dfcd3da251899f4a6ea23a0d'
EXPECTED_TREE = 'a88175975c42062a08e3012a7f106396be0c685f'
ENV = dict(os.environ, GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1', PYTHONDONTWRITEBYTECODE='1')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def write(name, obj):
    (ROOT / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')

def git(*args):
    p = subprocess.run(['git', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '--no-optional-locks', *args], cwd=REPO, env=ENV, capture_output=True, check=True)
    return p.stdout

def file_record(path):
    data = path.read_bytes()
    return {'path': str(path).replace('\\', '/'), 'bytes': len(data), 'sha256': sha(data)}

def snapshot():
    head, tree = git('rev-parse', 'HEAD', 'HEAD^{tree}').decode().splitlines()
    status = git('status', '--porcelain=v1', '--untracked-files=all')
    idx = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
    common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
    state = {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'repo': str(REPO), 'head': head, 'tree': tree, 'statusUtf8': status.decode(), 'statusBytes': len(status), 'index': file_record(idx), 'commonMetadata': [file_record(p) for p in [common / 'HEAD', common / 'index'] if p.is_file()], 'gitEnvironment': {k: ENV[k] for k in ['GIT_OPTIONAL_LOCKS', 'GIT_NO_LAZY_FETCH']}, 'commandPrefix': ['git', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '--no-optional-locks']}
    assert head == EXPECTED_HEAD and tree == EXPECTED_TREE and not status
    return state

assert not (ROOT / 'SHA256-MANIFEST.json').exists()
before = snapshot()
write('source-state-before.json', before)
report = ROOT / 'REPORT.md'
text = report.read_text(encoding='utf-8')
old = '## Minimum safe options for root selection'
new = '''5. **Refused refresh is a separate ordered scope.** The page wraps the header in `QueryState` without `keepDataOnError` (line 161). That component defaults false and replaces children on error even if cached data exists ([status.tsx:50–69](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/0d024bc4f8706846dfcd3da251899f4a6ea23a0d/apps/web/src/components/status.tsx#L50)). Parent root clarified during this task that #386's minimum acceptance is terminal header truth while the refreshed run response is delayed/in flight; retaining the whole inspector on a refused query belongs to later #416. Do not silently broaden #386 to outage retention, change the wrapper globally, or keep stale controls usable. The same lifecycle primitive can be reused by #416 later.

## Minimum safe options for root selection'''
assert old in text
text = text.replace(old, new, 1)
text = text.replace('show its actual execution status even when the run refresh is held, refused, or returns a lagging status at an equal tail.', 'show its actual execution status while the run refresh is held/in flight or returns a lagging status at an equal tail. A refused query can retain the existing error boundary in #386; later #416 owns outage retention.')
text = text.replace('and still needs live-event presentation for a refused/delayed refresh.', 'and still needs live-event presentation for a delayed refresh; refused-query retention remains #416.')
text = text.replace('refetch-only cannot satisfy the refused-refresh case;', 'refetch-only cannot make the header truthful while the response is held;')
text = text.replace('(2) refused run/observation refresh without an endless retry or false control/finalization;', '(2) refused run/observation refresh preserves the existing #386 error boundary without endless retry or false control/finalization; inspector retention is separately tested under #416;')
text = text.replace('Fresh issue #386 snapshot remains OPEN/backlog with no comments or approved implementation plan;', 'The captured pre-admission issue #386 snapshot was OPEN/backlog with no comments or approved implementation plan;')
text = text.replace('At genuine admission, refresh the target/head and issue gate, choose A or B plus the uncertainty wording, define the small test contract, then use the existing opposite-family review and independent QA gates.', 'Root subsequently reported signed PR553 main `3a6943a` with the same tree `a88175975c42062a08e3012a7f106396be0c685f` and D222 intent-5 admission; those are coordinator observations, not independently reverified by this packet. Root should bind the actual admitted source/issue gate, choose A or B plus the uncertainty wording, define the small test contract, then use the existing opposite-family review and independent QA gates. The new implementation checkout was not inspected or changed here.')
report.write_text(text, encoding='utf-8', newline='\n')
paths = [
    'AGENTS.md', 'docs/README.md', 'docs/12-implementation-plan.md', 'docs/15-issue-workflow.md',
    'docs/05-execution-engine.md', 'docs/07-api-and-streaming.md', 'docs/09-frontend-and-pwa.md',
    'docs/decisions/ADR-0057-execution-and-delivery-finalization.md', 'docs/delivery/2026-11-17-five-intents-register.md',
    'packages/contracts/src/events.ts', 'packages/contracts/src/run.ts', 'packages/domain/src/replay.ts',
    'packages/infrastructure/src/sqlite/events.ts', 'packages/engine/src/run-manager.ts', 'packages/engine/src/run-recovery.ts',
    'apps/api/src/routes/runs.ts', 'apps/web/src/runs/RunInspectorPage.tsx', 'apps/web/src/components/status.tsx',
    'apps/web/src/api/queries.ts', 'apps/web/src/runs/live-refresh.ts', 'apps/web/src/runs/useLiveRefresh.ts',
    'apps/web/src/runs/event-store.ts', 'apps/web/src/runs/useRunEvents.ts', 'apps/web/src/runs/follow-run-attempts.ts',
    'apps/web/src/runs/RunInspectorPage.test.tsx', 'apps/web/src/runs/live-refresh.test.ts',
    'apps/web/src/runs/follow-run-attempts.test.ts', 'apps/web/src/runs/useRunEvents.test.tsx', 'apps/web/src/runs/event-retention.test.ts',
    'apps/web/e2e/live-follow.spec.ts', 'apps/web/e2e/claude-harness.spec.ts', 'apps/web/e2e/bounded-history.spec.ts'
]
write('input-hashes.json', {'sourceHead': EXPECTED_HEAD, 'sourceTree': EXPECTED_TREE, 'files': [dict(file_record(REPO / p), repoPath=p) for p in paths], 'connectorSnapshots': [file_record(ROOT / p) for p in ['issue386.connector.json', 'issue386-comments.connector.json']], 'copiesOfSourcePayload': False})
write('architecture-selection-pending.json', {'status': 'READ_ONLY_PREPARATION', 'selectedOption': None, 'options': ['A: separate bounded per-run header lifecycle presentation', 'B: bounded server-derived execution-header observation plus live presentation'], 'rootScopeClarification': {'issue386': 'terminal truth while refreshed response is delayed/in flight', 'issue416': 'retain inspector evidence after a refused query / broader outage behavior'}, 'invariants': ['lastEventSeq is not status projection version', 'latest started/resumed invalidates earlier terminal for same run', 'resumed does not alone establish running phase', 'history window is not current lifecycle', 'late callbacks/responses cannot cross run or lifecycle generation', 'cached snapshot/recovery/control/finalization are not fabricated', 'terminal execution is not stream.complete or EOF'], 'implementationTestsBuildsProvidersExecuted': False, 'newImplementationCheckoutTouched': False})
after = snapshot()
for k in ['head', 'tree', 'statusUtf8', 'statusBytes', 'index', 'commonMetadata']:
    assert before[k] == after[k], k
write('source-state-after.json', after)
members = []
for p in sorted(ROOT.iterdir(), key=lambda p: p.name):
    assert p.is_file() and not p.is_symlink()
    if p.name not in ['SHA256-MANIFEST.json', 'SEAL.json']:
        members.append({'path': p.name, 'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())})
write('SHA256-MANIFEST.json', {'scope': 'bounded source-linked architecture readiness, no implementation/admission/review verdict', 'files': members})
manifest = file_record(ROOT / 'SHA256-MANIFEST.json')
write('SEAL.json', {'manifest': manifest, 'members': len(members), 'payloadBytes': sum(x['bytes'] for x in members), 'report': file_record(report), 'sourceHead': EXPECTED_HEAD, 'sourceTree': EXPECTED_TREE, 'sameSourceIndexCommonMetadata': True, 'sealedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()})
for m in members:
    p = ROOT / m['path']
    assert len(p.read_bytes()) == m['bytes'] and sha(p.read_bytes()) == m['sha256']
print(json.dumps({'members': len(members), 'payloadBytes': sum(x['bytes'] for x in members), 'manifestSha256': manifest['sha256'], 'sealSha256': sha((ROOT/'SEAL.json').read_bytes()), 'reportSha256': sha(report.read_bytes()), 'sourceUnchanged': True}))
