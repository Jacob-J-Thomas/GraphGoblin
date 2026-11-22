"""Two ordinary merges in the EXISTING #486 delivery worktree, after root dispatch.

Preparation/preflight are read-only. execute requires the new evidence child and
an explicit root-admitted D209 configuration. No author/QA/publication checkout is
opened or written; immutable objects are read through the delivery repository.
No fetch/push/GitHub/provider/build/test/review/main mutation or payload snapshots.
"""
from pathlib import Path
import argparse
import datetime
import difflib
import hashlib
import json
import os
import subprocess
import sys

OUT = Path(__file__).resolve().parent
E = Path('G:/ggq/delivery-evidence/2026-11-17-five-intents').resolve()
REPO = Path('G:/ggq/gg-i4-486-delivery/GraphGoblin').resolve()
INITIAL = 'd1177f105bd008fc084ccbbc086ee70e14d13e2f'
CORRECTION = '4d982162ca60e885d5af22f66076383a048215db'
BASE633 = '633d9ac72c10fe4b8d76f7ba50221f9ed8557cb9'
BASE02A = '02a0000998fa119be7553ddc06a60b63fbde1e31'
TARGET = 'a60843a9050b3a203726db84f6abf1f45b8bc694'
BRANCH = 'codex/gg-i4-486-delivery'
ARCHIVE = 'docs/qa/2026-11-21-i4-486-authored-failures/'
DOCS = {'CHANGELOG.md', 'docs/04-node-catalog.md', 'docs/06-harness-integration.md', 'docs/guide/03-run-and-observe.md'}
POLICIES = {'.gitattributes', '.prettierignore'}
COMBINED = DOCS | POLICIES
ENV = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}
sha = lambda b: hashlib.sha256(b).hexdigest()

def require(ok, message):
    if not ok:
        raise ValueError(message)

def put(name, value):
    path = (OUT / name).resolve()
    require(path.is_relative_to(OUT), 'Evidence path escapes new G: integration directory')
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = value if isinstance(value, bytes) else (json.dumps(value, indent=2) + '\n').encode()
    with path.open('xb') as stream:
        stream.write(raw)

def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO, env=ENV, stderr=subprocess.PIPE)

def run_mutation(label, *args, allowed=(0,)):
    require(REPO == Path('G:/ggq/gg-i4-486-delivery/GraphGoblin').resolve(), 'Mutation checkout guard failed')
    require(git('branch', '--show-current').decode().strip() == BRANCH, 'Delivery branch changed')
    start = datetime.datetime.now(datetime.timezone.utc).isoformat()
    proc = subprocess.run(['git', *args], cwd=REPO, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    put('execution/' + label + '.stdout', proc.stdout)
    put('execution/' + label + '.stderr', proc.stderr)
    put('execution/' + label + '.json', {'argv': ['git', *args], 'cwd': str(REPO), 'startedUtc': start,
        'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exitCode': proc.returncode,
        'stdoutBytes': len(proc.stdout), 'stdoutSha256': sha(proc.stdout), 'stderrBytes': len(proc.stderr), 'stderrSha256': sha(proc.stderr)})
    require(proc.returncode in allowed, 'Git operation failed: ' + label)
    return proc.stdout

def tree(ref):
    raw = git('ls-tree', '-r', '-z', '--full-tree', ref)
    result = {}
    for line in raw.split(b'\0')[:-1]:
        meta, path = line.split(b'\t', 1)
        mode, kind, oid = meta.decode().split()
        require(kind == 'blob', 'Unexpected tracked non-blob')
        result[path.decode()] = (mode, oid)
    return result

def blob(ref, path):
    return git('show', ref + ':' + path)

def snapshot():
    index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
    status = git('status', '--porcelain=v1', '-z', '--untracked-files=all')
    return {'head': git('rev-parse', 'HEAD').decode().strip(), 'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
        'branch': git('branch', '--show-current').decode().strip(), 'clean': not status, 'statusSha256': sha(status),
        'indexPath': str(index), 'indexBytes': index.stat().st_size, 'indexSha256': sha(index.read_bytes()),
        'stageListingSha256': sha(git('ls-files', '--stage', '-z'))}

def target_guard():
    actual = git('rev-parse', 'refs/remotes/origin/main').decode().strip()
    require(actual == TARGET, 'origin/main moved; stop for root retargeting without changing local main')
    require(git('rev-parse', TARGET + '^{commit}').decode().strip() == TARGET, 'Pinned main object missing/different')

def changes(base, changed):
    matcher = difflib.SequenceMatcher(a=base, b=changed, autojunk=False)
    return [(a, b, changed[c:d]) for tag, a, b, c, d in matcher.get_opcodes() if tag != 'equal']

def combine(base_raw, ours_raw, theirs_raw):
    """Combine disjoint edits and additive inserts; refuse substantive overlaps."""
    if ours_raw == theirs_raw or theirs_raw == base_raw:
        return ours_raw
    if ours_raw == base_raw:
        return theirs_raw
    base, ours, theirs = [x.decode('utf-8').splitlines(keepends=True) for x in [base_raw, ours_raw, theirs_raw]]
    left, right = changes(base, ours), changes(base, theirs)
    edits = []
    for a, b, replacement in left:
        edits.append((a, b, replacement, 'ours'))
    for a, b, replacement in right:
        exact = [x for x in edits if x[:3] == (a, b, replacement)]
        if exact:
            continue
        for c, d, other, side in edits:
            overlap = max(a, c) < min(b, d)
            insertion_inside = (a == b and c < a < d) or (c == d and a < c < b)
            require(not overlap and not insertion_inside, 'Substantive overlapping text edits need root choice')
        edits.append((a, b, replacement, 'theirs'))
    edits.sort(key=lambda x: (x[0], 0 if x[0] == x[1] else 1, 0 if x[3] == 'ours' else 1))
    result, cursor = [], 0
    for a, b, replacement, side in edits:
        require(a >= cursor, 'Overlapping edit ordering needs root choice')
        result += base[cursor:a] + replacement
        cursor = b
    result += base[cursor:]
    return ''.join(result).encode('utf-8')

def policy_subsequence(parent_raw, final_raw):
    expected = [x for x in parent_raw.decode().splitlines() if x.strip()]
    actual = final_raw.decode().splitlines()
    cursor = 0
    for line in expected:
        cursor = actual.index(line, cursor) + 1

def qualification(path, raw, cfg):
    if path not in cfg['documentationQualification']['replacements']:
        return raw
    item = cfg['documentationQualification']['replacements'][path]
    old, new = item['old'].encode(), item['proposed'].encode()
    require(raw.count(old) == 1, 'Qualification old sentence is not unique: ' + path)
    return raw.replace(old, new, 1)

def combined_files(base, ours, theirs, phase, cfg):
    expected, proof = {}, []
    for path in sorted(COMBINED):
        a, b, c = blob(base, path), blob(ours, path), blob(theirs, path)
        merged = combine(a, b, c)
        if phase == 'main':
            merged = qualification(path, merged, cfg)
        require(not any(line.startswith((b'<<<<<<< ', b'=======', b'>>>>>>> ')) for line in merged.splitlines()), 'Conflict marker in proposed combined file')
        if path in POLICIES:
            policy_subsequence(b, merged); policy_subsequence(c, merged)
            detail = {'bothParentNonemptyLineOrdersPreserved': True}
        elif phase == 'main':
            source_edits = changes(a.decode().splitlines(keepends=True), b.decode().splitlines(keepends=True))
            require(all(start == end for start, end, value in source_edits), 'Expected additive #486 document hunks only')
            restored = merged
            inserts = []
            for start, end, value in source_edits:
                original_insert = ''.join(value).encode()
                expected_insert = qualification(path, original_insert, cfg) if path in cfg['documentationQualification']['replacements'] else original_insert
                require(restored.count(expected_insert) == 1, 'Combined document lost/duplicated a #486 source hunk: ' + path)
                restored = restored.replace(expected_insert, b'', 1)
                inserts.append({'baseLine': start + 1, 'sourceSha256': sha(original_insert), 'combinedSha256': sha(expected_insert), 'qualifiedOnlyByRootD209': original_insert != expected_insert})
            require(restored == c, 'Subtracting #486 hunks does not reconstruct exact current-main doc: ' + path)
            detail = {'sourceInsertionHunks': inserts, 'subtractSourceHunksReconstructsMainExactly': True}
        else:
            detail = {'ordinaryAdditiveParentCombination': True}
        expected[path] = merged
        proof.append({'path': path, 'baseSha256': sha(a), 'oursSha256': sha(b), 'theirsSha256': sha(c), 'expectedSha256': sha(merged), **detail})
    return expected, proof

def verify_tree(base, ours, theirs, final, expected_combined, source_paths):
    maps = {key: tree(ref) for key, ref in [('base', base), ('ours', ours), ('theirs', theirs), ('final', final), ('corrected', CORRECTION)]}
    digest, count, archive_count, changed = hashlib.sha256(), 0, 0, []
    paths = sorted(set().union(*(set(maps[k]) for k in ['base', 'ours', 'theirs', 'final'])))
    for path in paths:
        b, o, t, f = [maps[key].get(path) for key in ['base', 'ours', 'theirs', 'final']]
        if path in COMBINED:
            require(o and t and f and o[0] == t[0] == f[0], 'Combined file mode changed')
            require(blob(final, path) == expected_combined[path], 'Combined index bytes differ: ' + path)
            continue
        if o == t or t == b:
            expected = o
        elif o == b:
            expected = t
        else:
            raise ValueError('Unapproved non-combined parent conflict: ' + path)
        require(f == expected, 'Non-combined blob/mode changed: ' + path)
        if path.startswith('docs/qa/'):
            require((o is None or f == o) and (t is None or f == t), 'Old archive member changed/deleted: ' + path)
            archive_count += 1
        if f != o:
            changed.append({'path': path, 'modeAndBlob': f, 'source': 'incoming parent'})
        digest.update((json.dumps([path, b, o, t, f, expected], separators=(',', ':')) + '\n').encode())
        count += 1
    exact = []
    for path in source_paths:
        if path not in DOCS:
            require(maps['final'].get(path) == maps['corrected'].get(path), 'Corrected #486 source blob/mode not preserved: ' + path)
            exact.append({'path': path, 'modeAndBlob': maps['final'][path]})
    return {'checkedNonCombinedEntries': count, 'canonicalAllEntryComparisonSha256': digest.hexdigest(), 'archiveEntriesExact': archive_count,
        'incomingDeltaEntries': changed, 'exactCorrectionSourceEntries': exact, 'combinedDocs': sorted(DOCS),
        'replay': 'Recompute every path from pinned base/ours/theirs/final trees with this script; no archive payload or repeated full-tree dump stored'}

def evidence_admission(evidence):
    require(git('rev-parse', evidence + '^').decode().strip() == CORRECTION, 'Evidence commit must be a direct child of frozen4d')
    before, after = tree(CORRECTION), tree(evidence)
    modified = []
    for path in sorted(set(before) | set(after)):
        if before.get(path) == after.get(path):
            continue
        require(path.startswith(ARCHIVE) or path in POLICIES, 'Evidence commit changes source outside archive/policies: ' + path)
        if path.startswith(ARCHIVE):
            require(path not in before, 'Evidence commit rewrites an old archive member')
        else:
            require(before[path][0] == after[path][0], 'Evidence policy mode changed')
            policy_subsequence(blob(CORRECTION, path), blob(evidence, path))
        modified.append({'path': path, 'modeAndBlob': after.get(path)})
    require(any(x['path'].startswith(ARCHIVE) for x in modified), 'Evidence child has no archive payload')
    return {'evidenceHead': evidence, 'parent': CORRECTION, 'tree': git('rev-parse', evidence + '^{tree}').decode().strip(), 'changedEntries': modified}

def merge_phase(name, ours, theirs, base, cfg, source_paths):
    target_guard()
    require(snapshot()['head'] == ours and snapshot()['clean'], 'Owned delivery head/index is not the admitted clean phase input')
    require(git('merge-base', ours, theirs).decode().strip() == base, 'Actual merge base differs')
    expected, doc_proof = combined_files(base, ours, theirs, name, cfg)
    run_mutation(name + '-merge', 'merge', '--no-ff', '--no-commit', theirs, allowed=(0, 1))
    require(git('rev-parse', 'MERGE_HEAD').decode().strip() == theirs, 'Merge did not enter expected owned state')
    conflicts = git('diff', '--name-only', '--diff-filter=U').decode().splitlines()
    put('execution/' + name + '-conflicts.json', {'paths': conflicts, 'allowedOnly': sorted(COMBINED)})
    require(set(conflicts) <= COMBINED, 'Substantive/unapproved conflict; preserve state and report root')
    for path, raw in expected.items():
        require((REPO / path).resolve().is_relative_to(REPO), 'Combined write escaped owned checkout')
        if (REPO / path).read_bytes() != raw:
            (REPO / path).write_bytes(raw)
    run_mutation(name + '-stage-combined-only', 'add', '--', *sorted(COMBINED))
    require(not git('ls-files', '--unmerged') and not git('diff', '--name-only'), 'Unexpected unresolved or unstaged state')
    run_mutation(name + '-diff-check', 'diff', '--cached', '--check')
    final_tree = run_mutation(name + '-write-tree', 'write-tree').decode().strip()
    proof = verify_tree(base, ours, theirs, final_tree, expected, source_paths)
    put('execution/' + name + '-combined-doc-proof.json', doc_proof)
    put('execution/' + name + '-parent-combination-proof.json', {'base': base, 'ours': ours, 'theirs': theirs, 'tree': final_tree, **proof})
    target_guard()
    run_mutation(name + '-merge-commit', 'commit', '-m', 'Merge #486 corrective evidence into delivery' if name == 'evidence' else 'Merge current main into authored execution failure delivery')
    new = snapshot()
    require(new['clean'] and new['tree'] == final_tree, 'Post-merge checkout not exact/clean')
    require(git('show', '-s', '--format=%P', new['head']).decode().split() == [ours, theirs], 'Merge parents differ')
    put('execution/' + name + '-receipt.json', {**new, 'parents': [ours, theirs], 'base': base, 'proof': proof, 'testsBuildsProvidersPushPerformed': False})
    return new['head']

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['preflight', 'execute'])
    parser.add_argument('--config', required=True)
    parser.add_argument('--evidence-head')
    args = parser.parse_args()
    require(OUT.parent == E and OUT.name == 'i4-486-main-a608-integration-01', 'Unexpected explicit G: integration root')
    config_path = Path(args.config).resolve()
    require(config_path.parent == OUT, 'Root-admitted configuration must stay in this owned integration directory')
    cfg = json.loads(config_path.read_bytes())
    require(set(cfg['documentationQualification']['replacements']) == {'CHANGELOG.md', 'docs/guide/03-run-and-observe.md'}, 'Only the two selected D209 sentences may be qualified')
    source_paths = cfg['sourcePaths']
    require(len(source_paths) == 54, 'Actual frozen source union must contain54 paths')
    initial = snapshot()
    require(initial['head'] == INITIAL and initial['branch'] == BRANCH and initial['clean'], 'Existing delivery no longer exact clean d117')
    require(initial['indexSha256'] == cfg['initialDeliveryIndexSha256'], 'Delivery index bytes changed before integration admission')
    target_guard()
    result = {'delivery': initial, 'main': TARGET, 'sourceCorrection': CORRECTION, 'sourcePaths': len(source_paths),
        'evidenceHead': args.evidence_head, 'executionAuthorizedByConfig': cfg.get('rootExecutionAuthorized', False), 'documentationDecisionRecorded': cfg['documentationQualification'].get('rootApproved', False)}
    if args.evidence_head:
        result['evidenceAdmission'] = evidence_admission(args.evidence_head)
    if args.action == 'preflight':
        print(json.dumps(result, indent=2)); return
    require(args.evidence_head and cfg.get('rootExecutionAuthorized') is True, 'Root must provide evidence commit and explicitly authorize execution')
    require(cfg['documentationQualification'].get('rootApproved') is True and cfg['documentationQualification'].get('decisionPath') and cfg['documentationQualification'].get('decisionSha256'), 'Root D209 qualification/coverage decision is required')
    decision = Path(cfg['documentationQualification']['decisionPath'])
    require(sha(decision.read_bytes()) == cfg['documentationQualification']['decisionSha256'], 'D209 decision hash differs')
    require(not (OUT / 'execution').exists(), 'Execution evidence already exists; no replay/overwrite')
    put('execution/admission.json', result)
    first = merge_phase('evidence', INITIAL, args.evidence_head, BASE633, cfg, source_paths)
    second = merge_phase('main', first, TARGET, BASE02A, cfg, source_paths)
    put('execution/completion.json', {'firstMerge': first, 'integratedHead': second, 'tree': snapshot()['tree'], 'target': TARGET,
        'clean': True, 'sourcePathCount': len(source_paths), 'boundedClaudeDocDeltaReview': 'Pending actual provider after quota reset, separate from general3',
        'remaining': ['Current CI/coverage and canonical native verification', 'Actual bounded Claude review of the two qualified sentences', 'Independent static document QA', 'Fresh independent Astra MAX general3', 'Signed merge and separate owner gates'],
        'noPushGitHubMainAuthorQAOrPublicationWorktreeMutation': True})
    print(json.dumps({'firstMerge': first, 'head': second, 'target': TARGET, 'clean': True}))

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(json.dumps({'status': 'STOPPED_WITHOUT_ROLLBACK', 'reason': str(error), 'ownedMergeStateRetainedIfStarted': True}), file=sys.stderr)
        sys.exit(2)
