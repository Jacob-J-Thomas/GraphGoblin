"""Fail-closed external miniarchive candidate preparation after actual Fable.

No provider dispatch, Git/index/source write, final archive seal, publication,
test or build. Current task may inspect metadata only; root must explicitly
authorize finalization and admit the dynamic final selection after Fable closes.
"""
from pathlib import Path, PurePosixPath
import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

E = Path('G:/ggq/delivery-evidence/2026-11-17-five-intents').resolve()
OUT = Path(__file__).resolve().parent
REPO = Path('G:/ggq/gg-i4-486-delivery/GraphGoblin').resolve()
HEAD = '29e165e14fdda138300ba2a34585ddd47268b475'
TREE = 'd50fb576f1ef4498cb30e52521198575d6d0ebd4'
TARGET = 'a60843a9050b3a203726db84f6abf1f45b8bc694'
RESET = 1795294800
ENV = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}
PATTERNS = [('github_token', rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,})'),
    ('provider_key', rb'sk-(?:proj-)?[A-Za-z0-9_-]{32,}'), ('aws_access_key', rb'AKIA[A-Z0-9]{16}'),
    ('private_key', rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    ('graphgoblin_generated_token', rb'(?<![A-Za-z0-9_-])gg_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])'),
    ('literal_bearer_value', rb'(?i)Bearer\s+([A-Za-z0-9_.-]{20,})')]

def require(ok, message):
    if not ok:
        raise ValueError(message)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def record(source_path, **extra):
    path = Path(source_path).resolve()
    require(path.is_file() and not path.is_symlink(), 'Not a regular original: ' + str(path))
    value = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return {'source': str(path), 'bytes': path.stat().st_size, 'sha256': value.hexdigest(), **extra}

def read(path):
    return json.loads(Path(path).read_bytes())

def verify(item):
    actual = record(item['source'])
    require(actual['sha256'] == item['sha256'] and actual['bytes'] == item['bytes'], 'Original changed: ' + item['source'])

def files(root):
    paths = []
    for path in sorted(Path(root).rglob('*')):
        require(not path.is_symlink(), 'Symlink not admitted: ' + str(path))
        if path.is_file():
            paths.append(path)
    return paths

def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO, env=ENV, stderr=subprocess.PIPE)

def source_state():
    require(git('rev-parse', 'HEAD').decode().strip() == HEAD and git('rev-parse', 'HEAD^{tree}').decode().strip() == TREE, 'Delivery must remain frozen at clean29e until actual Fable')
    require(not git('status', '--porcelain=v1', '-z', '--untracked-files=all'), 'Current delivery is no longer clean')
    index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
    return {'head': HEAD, 'tree': TREE, 'index': record(index), 'stageSha256': sha(git('ls-files', '--stage', '-z')), 'clean': True}

def future_fable(config, inventory):
    root = Path(config['requiredActualFable']['root'])
    provider = root / 'provider'
    if not provider.is_dir():
        return None, [], ['Actual Fable01 provider records and accepted verdict are missing']
    for item in inventory['futureFableInitialFiles']:
        verify(item)
    for name in ['launch.json', 'exit.json', 'result.json', 'events.jsonl', 'provider-final-message.md']:
        require((provider / name).is_file(), 'Provider closure record missing: ' + name)
    launch, exit_value, result = read(provider / 'launch.json'), read(provider / 'exit.json'), read(provider / 'result.json')
    require(launch['model'] == 'claude-fable-5-2' and launch['effort'] == 'xhigh' and Path(launch['cwd']).resolve() == REPO, 'Wrong actual Fable model/effort/source')
    started = datetime.datetime.fromisoformat(launch['startedAt'].replace('Z', '+00:00')).timestamp()
    require(started >= RESET, 'Provider invocation predates announced quota reset')
    require(type(exit_value['code']) is int and exit_value['code'] == 0 and result.get('is_error') is False and result.get('subtype') == 'success' and result.get('terminal_reason') == 'completed', 'Actual provider failed or has an error envelope')
    events = [json.loads(line) for line in (provider / 'events.jsonl').read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    finals = [item for item in events if item.get('type') == 'result']
    require(len(finals) == 1 and finals[0] == result, 'Expected one exact accepted terminal envelope')
    require(set(result.get('modelUsage', {})) == {'claude-fable-5-2'}, 'Actual terminal model differs')
    final = provider / 'provider-final-message.md'
    require(final.read_bytes() == result['result'].encode('utf-8') and result['result'].strip(), 'Provider final message bytes differ')
    readiness = read(root / 'dispatch-readiness.json')
    require(readiness['quotaResetReached'] is True and readiness['cleanHead'] == HEAD and readiness['target'] == TARGET and readiness['actualModel'] == 'claude-fable-5-2' and readiness['effort'] == 'xhigh', 'Root dispatch guard binding differs')
    # Read completed small receipts only AFTER the actual closed invocation exists.
    ci_path = Path(readiness['CIRecord']).resolve()
    require(ci_path == E / 'i4-553-head29e-targeta608-ci/verified.json', 'Unexpected source-head CI record path')
    ci = read(ci_path)
    require(ci['head'] == HEAD and ci['target'] == TARGET and ci['headTree'] == ci['testedTree'] == TREE and ci['attempt'] == 1, 'Source-head CI does not match actual dispatch')
    require(len(ci['jobs']) == 6 and all(x['conclusion'] == 'success' and not x['failedOrCancelledSteps'] for x in ci['jobs'].values()), 'Source-head CI incomplete/failed')
    native_path = E / 'i4-553-head29e-targeta608-ci-windows/verified.json'
    native = read(native_path)
    require(native['head'] == HEAD and native['base'] == TARGET and native['sourceTree'] == TREE and native['canonicalReplay'] is True and native['records'] == 338 and native['run'] == ci['run'], 'Source-head native receipt differs')
    all_future = [record(p, archivePath='actual-fable01/' + p.relative_to(root).as_posix()) for p in files(root)]
    all_future += [record(ci_path, archivePath='preliminary-source-head-ci/verified.json'), record(native_path, archivePath='preliminary-source-head-ci/native-verified.json')]
    admission = config['requiredActualFable']['acceptedCompletion']
    missing = []
    if not admission.get('rootAssessedAccepted') or admission.get('verdict') != 'ACCEPT FIX' or admission.get('reportSha256') != record(final)['sha256']:
        missing.append('Root exact original Fable report/verdict acceptance is pending')
    else:
        lines = final.read_text(encoding='utf-8-sig').splitlines()
        n = admission.get('verdictLine')
        require(type(n) is int and 1 <= n <= len(lines), 'Root must bind the exact accepted verdict line')
        text = lines[n-1].upper().replace('_', ' ')
        require('ACCEPT FIX' in text and not re.search(r'CHANGES?\s+REQUIRED|CONDITIONAL|\bFAIL(?:ED)?\b', text), 'Provider verdict line is not an accepted fix')
    return {'model': 'claude-fable-5-2', 'effort': 'xhigh', 'sessionId': result['session_id'], 'report': record(final), 'verdict': admission.get('verdict'),
            'sourceHeadCIWillBePreliminaryAfterMiniarchiveCommit': True}, all_future, missing

def inspect(config_path):
    require(OUT.parent == E and OUT.name == 'i4-486-doc-correction-archive-preparation-01', 'Wrong explicit new G: preparation root')
    config_path = Path(config_path).resolve()
    require(config_path.parent == OUT, 'Root configuration must be in this new preparation directory')
    config = read(config_path)
    require(config['schema'] == 'graphgoblin-486-doc-miniarchive-preparation/1', 'Wrong configuration')
    for entry in config['fixedPreparationMetadata']:
        require(sha((OUT / entry['file']).read_bytes()) == entry['sha256'], 'Preparation metadata changed: ' + entry['file'])
    inventory = read(OUT / config['inventory'])
    state = source_state()
    require(state == inventory['sourceSnapshot'], 'Frozen source/index changed since this preparation')
    for item in inventory['allExistingInputFiles']:
        verify(item)
    for root in inventory['completeExistingRoots']:
        require({p.relative_to(Path(root['source'])).as_posix() for p in files(root['source'])} == set(root['relativeFiles']), 'Sealed/current complete root membership changed')
    fable, future, missing = future_fable(config, inventory)
    copies = inventory['proposedExactCopies'] + future
    require(len({x['archivePath'] for x in copies}) == len(copies), 'Archive destination collision')
    selection = sha(json.dumps({'copies': copies, 'localReferences': inventory['localReferences']}, sort_keys=True, separators=(',', ':')).encode())
    candidates = []
    for item in copies:
        raw = Path(item['source']).read_bytes()
        for name, pattern in PATTERNS:
            for match in re.finditer(pattern, raw):
                candidates.append({'archivePath': item['archivePath'], 'source': item['source'], 'pattern': name, 'offset': match.start(), 'candidateSha256': sha(match.group())})
    privacy = config['rootFinalizationAdmission']
    if not privacy.get('authorized'):
        missing.append('Root finalization authorization has not been given')
    if not privacy.get('privacyApproved') or privacy.get('exactSelectionSha256') != selection or not privacy.get('rootDecision'):
        missing.append('Root privacy/exact dynamic final selection admission is pending')
    if not {x['candidateSha256'] for x in candidates} <= set(privacy.get('approvedCandidateHashes', [])):
        missing.append('Bounded private-pattern candidates require explicit root dispositions')
    return config, inventory, copies, {'status': 'INCOMPLETE_WAITING_FOR_ACTUAL_FABLE_AND_ROOT_ADMISSION' if missing else 'READY_FOR_ROOT_AUTHORIZED_EXTERNAL_MINIARCHIVE_CANDIDATE',
        'source': state, 'actualFable': fable, 'proposedCopyCount': len(copies), 'localReferenceCount': len(inventory['localReferences']),
        'selectionSha256': selection, 'patternCandidates': candidates, 'missingInputs': missing,
        'remainingAfterEvidenceOnlyCommit': config['remainingAfterEvidenceOnlyCommit'], 'archiveOrCandidateFinalSealCreated': False,
        'currentCITouchedDuringPreparation': False, 'futureSourceCIReceiptsReadOnlyAfterClosedActualFable': True}

def safe(name):
    path = PurePosixPath(name)
    require(name and not path.is_absolute() and '..' not in path.parts and ':' not in name and '\\' not in name, 'Unsafe candidate path')
    return str(path)

def write_new(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = data if isinstance(data, bytes) else (json.dumps(data, indent=2) + '\n').encode()
    with path.open('xb') as stream:
        stream.write(raw)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['inspect', 'prepare-candidate', 'finalize'])
    parser.add_argument('--config', required=True)
    parser.add_argument('--output')
    args = parser.parse_args()
    require(args.action != 'finalize', 'Final archive sealing, repository/index/commit and publication remain root-owned')
    config, inventory, copies, report = inspect(args.config)
    if args.action == 'inspect':
        print(json.dumps(report, indent=2)); return 2 if report['missingInputs'] else 0
    require(not report['missingInputs'], 'Future actual report/root admission is incomplete')
    target = Path(args.output or '').resolve()
    require(args.output and target.parent == E and target.name.startswith('i4-486-doc-correction-candidate-') and not target.exists(), 'Use a NEW named external candidate directly under configured E')
    target.mkdir()
    write_new(target / 'COPY-STARTED.json', {'event': 'UNSEALED_EXTERNAL_COPY_STARTED', 'source': HEAD})
    verified = []
    for item in copies:
        verify(item)
        destination = target / safe(item['archivePath'])
        destination.parent.mkdir(parents=True, exist_ok=True)
        require(not destination.exists(), 'Candidate destination collision')
        shutil.copyfile(item['source'], destination)
        require(record(destination)['sha256'] == item['sha256'], 'Copied bytes differ')
        verified.append(item)
    for name in ['README.draft.md', 'input-inventory.json', 'seal-and-reference-resolution.json', 'bounded-privacy-context.json']:
        destination = 'README.md' if name == 'README.draft.md' else name
        write_new(target / destination, (OUT / name).read_bytes())
    _, _, after_copies, final = inspect(args.config)
    require(not final['missingInputs'] and after_copies == copies and final['selectionSha256'] == report['selectionSha256'], 'Inputs/source/admission changed during copy')
    write_new(target / 'copy-verification.json', {'originalCopies': verified, 'localOriginalReferences': inventory['localReferences'], 'allBytesExact': True,
              'actualFableRecord': final['actualFable'], 'futureDataWasNotPreapproved': True})
    write_new(target / 'candidate-unsealed.json', {**final, 'status': 'EXTERNAL_MINIARCHIVE_CANDIDATE_UNSEALED',
        'READMEPendingStatementsMustBeUpdatedByRootFromActualAcceptedReport': True, 'rootOwnsFormatSealCommitAndFreshHeadGates': True})
    print(json.dumps({'output': str(target), 'status': 'EXTERNAL_MINIARCHIVE_CANDIDATE_UNSEALED', 'originalCopies': len(copies)})); return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(json.dumps({'status': 'REFUSED', 'reason': str(error), 'repositoryMutation': False}), file=sys.stderr)
        sys.exit(2)
