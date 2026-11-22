"""Metadata-only miniarchive preparation; never dispatch or capture active CI."""
from pathlib import Path
import ast
import datetime
import hashlib
import json
import runpy

OUT = Path(__file__).resolve().parent
E = OUT.parent
Q = Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents').resolve()
ns = runpy.run_path(str(OUT / 'prepare-after-fable.py'), run_name='miniarchive_definitions')
record, read, verify, require, files = (ns[k] for k in ['record', 'read', 'verify', 'require', 'files'])
require(OUT.name == 'i4-486-doc-correction-archive-preparation-01' and E == ns['E'], 'Wrong configured G: preparation directory')
require(not (OUT / 'preparation-report.json').exists(), 'Preparation exists; no overwrite')
def put(name, value):
    path = (OUT / name).resolve()
    require(path.is_relative_to(OUT), 'Output escaped this new preparation directory')
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = value if isinstance(value, bytes) else (json.dumps(value, indent=2) + '\n').encode()
    with path.open('xb') as stream:
        stream.write(raw)
def selected(root, destination, names=None, complete=False):
    root = Path(root).resolve()
    paths = files(root) if names is None else [root / name for name in names]
    return {'source': str(root), 'archiveRoot': destination, 'complete': complete,
        'relativeFiles': [p.relative_to(root).as_posix() for p in paths],
        'files': [record(p, archivePath=destination + '/' + p.relative_to(root).as_posix()) for p in paths]}
before = ns['source_state']()
qa = E / 'i4-486-d209-doc-independent-01'
qa_manifest = read(qa / 'SHA256SUMS.json')
require(record(qa / 'SHA256SUMS.json')['sha256'] == '90dba86c467d078249a88ace0ede22e3a82e9e314f0d6c7d7151cedcf47facff' and len(qa_manifest['files']) == 13, 'Independent static QA seal differs')
require(record(qa / 'REPORT.md')['sha256'] == '21bfa30f7fb740e7d447c1761990bb0b366a268fb86a87e97d6c2eaf73a589e5', 'Static QA report differs')
for item in qa_manifest['files']:
    verify({'source': str(qa / item['path']), 'bytes': item['bytes'], 'sha256': item['sha256']})
require({p.relative_to(qa).as_posix() for p in files(qa)} == {x['path'] for x in qa_manifest['files']} | {'SHA256SUMS.json'}, 'Static QA physical membership differs')
qa_public = E / 'i4-486-d209-doc-root-readback-01'
qav, qac = read(qa_public / 'verification.json'), read(qa_public / 'comment.json')
require(qav['exactBytes'] and qav['membersVerified'] == 13 and qav['reportSHA256'] == record(qa / 'REPORT.md')['sha256'] and qac['id'] == 7067143342, 'Static QA public readback differs')
require(hashlib.sha256(qac['body'].encode()).hexdigest() == qav['reportSHA256'], 'Static QA comment body is not exact')
roots = [selected(qa, 'independent-static-qa', complete=True), selected(qa_public, 'public-readbacks/static-qa', complete=True)]
for number in [209, 211]:
    path = E / ('i4-486-d' + str(number) + '-publication-readback-01')
    verification, comment = read(path / 'verification.json'), read(path / 'comment.json')
    require(verification['exactBytes'] and verification['sha256'] == record(Q / ('decision-' + str(number) + '.md'))['sha256'], 'Decision public readback hash differs')
    require(hashlib.sha256(comment['body'].encode()).hexdigest() == verification['sha256'], 'Decision comment body not exact')
    roots.append(selected(path, 'public-readbacks/D' + str(number), complete=True))
integration = E / 'i4-486-main-a608-integration-01'
execution_files = [p.relative_to(integration).as_posix() for p in files(integration / 'execution')]
integration_names = execution_files + [
    'agent-final-receipt-handoff.json', 'root-execution-admission-01.json', 'root-live-target-readback.json', 'root-proof-replay.json', 'root-proof-replay-attempt1-correction.json',
    'integrate.py', 'integrate-sparse-01.py', 'derive-sparse-revision.py', 'sparse-revision.patch', 'sparse-revision-report.json', 'SPARSE-REVISION-SHA256.json',
    'integration-config-root-admitted-01.json', 'integration-config-D209.draft.json', 'source-path-mode-reference.json',
    'bounded-doc-review/BRIEF-D209-D211.md', 'bounded-doc-review/FINAL-SNIPPETS-D209-D211.json', 'bounded-doc-review/FINAL-REVIEW-HANDOFF.md',
    'bounded-doc-review/source-excerpts.json', 'bounded-doc-review/FINAL-REVIEW-HANDOFF.md']
integration_names = sorted(set(integration_names))
roots.append(selected(integration, 'integration', integration_names))
publication = E / 'i4-486-final-root-publication-01'
publication_names = [p.relative_to(publication).as_posix() for p in files(publication) if p.name != 'prior-archive-tree.txt']
roots.append(selected(publication, 'publication-attempts-and-repairs', publication_names))
local_references = [record(publication / 'prior-archive-tree.txt', reason='Large historical full-tree proof remains one canonical original under D202; not copied into miniarchive', publicVerificationRequiresOriginal=True)]
original_publisher = Q / 'i4-publish-evidence.py'
derivation = read(publication / 'sparse-resume-decision.json')
require(record(original_publisher)['sha256'] == derivation['originalHelperSHA256'], 'Shared original publisher hash differs')
require(record(publication / 'publisher-explicit-sparse-resume.py')['sha256'] == derivation['derivedHelperSHA256'], 'D210 derivative helper hash differs')
roots.append(selected(Q, 'decisions', ['decision-209.md', 'decision-210.md', 'decision-211.md', 'decision-209-entry.json', 'decision-210-entry.json', 'decision-211-entry.json']))
roots.append(selected(Q, 'publication-tooling', ['i4-publish-evidence.py']))
roots.append(selected(E, 'dispatch-preparation', ['dispatch-486-doc-correction-review-01.py', 'finish-486-archive-D211.py']))
future_root = E / 'i4-486-d209-d211-fable-review-01'
require(not (future_root / 'provider').exists(), 'Actual provider is no longer absent; root must re-admit the new observation boundary')
future_initial = [record(future_root / name, archivePath='actual-fable01/' + name) for name in ['BRIEF.md', 'spec.json']]
spec = read(future_root / 'spec.json')
require(spec['model'] == 'claude-fable-5-2' and spec['effort'] == 'xhigh' and spec['readOnly'] is True and Path(spec['cwd']).resolve() == ns['REPO'], 'Future review dispatch binding differs')
copies = [item for root in roots for item in root['files']]
# Future initial prompt/spec are inventoried now, then copied only as part of the
# later complete actual role packet; they are not a completed role selection.
require(len({x['archivePath'] for x in copies}) == len(copies), 'Proposed destination collision')
all_inputs = list({x['source']: x for x in copies + local_references + future_initial}.values())
source_binding = {'snapshot': before, 'fixedHead': ns['HEAD'], 'fixedTree': ns['TREE'], 'target': ns['TARGET'],
    'miniarchiveSourceOnlyChild': 'Future evidence-only commit must preserve all source29e code/doc/policy bytes except new raw-evidence path policy; root publisher verifies actual child',
    'noOriginal1534PayloadArchiveCopied': True, 'existingFeatureArchive': {'publicationHead': 'edf7f70560be12153b3ef581f582eb95143e4516', 'prefix': 'docs/qa/2026-11-21-i4-486-authored-failures', 'archiveBlobs': 1534},
    'currentSourceHeadCI': {'run': 44934348117, 'head': ns['HEAD'], 'target': ns['TARGET'], 'statusAtTaskAdmission': 'Running under root; not queried or captured by preparation',
       'afterMiniarchiveCommit': 'Preliminary source-head evidence only; fresh final-head CI/native required'},
    'activeCIProcessAccessed': False}
put('source-and-CI-boundary.json', source_binding)
inventory = {'status': 'EXISTING_INPUT_SNAPSHOT_FUTURE_FABLE_NOT_SELECTED', 'roots': roots,
    'completeExistingRoots': [{'source': r['source'], 'relativeFiles': r['relativeFiles']} for r in roots if r['complete']],
    'allExistingInputFiles': all_inputs, 'proposedExactCopies': copies, 'localReferences': local_references, 'futureFableInitialFiles': future_initial,
    'sourceSnapshot': before, 'existingFeatureArchivePayloadCopied': False, 'originalTestKeysOrStoresCopied': False,
    'futureFilesNeedCompleteDynamicInventoryAndRootAdmission': True}
put('input-inventory.json', inventory)
put('proposed-copy-and-reference-map.json', {'status': 'PROPOSED_EXISTING_INPUTS_ONLY_NOT_FINAL_SELECTION', 'copies': copies, 'localReferences': local_references,
    'futureCompleteFableRoot': str(future_root), 'futureProviderAndVerdictMissing': True, 'newLargePayloadsUseG': True})
seal_maps = [{'manifest': record(qa / 'SHA256SUMS.json'), 'archivePath': 'independent-static-qa/SHA256SUMS.json', 'members': [
    {'path': 'independent-static-qa/' + x['path'], 'sha256': x['sha256'], 'bytes': x['bytes'], 'source': str(qa / x['path'])} for x in qa_manifest['files']]}]
integration_manifest = read(integration / 'execution/INTEGRATION-SHA256.json')
for item in integration_manifest['files']:
    verify({'source': str(integration / item['path']), 'bytes': item['bytes'], 'sha256': item['sha256']})
seal_maps.append({'manifest': record(integration / 'execution/INTEGRATION-SHA256.json'), 'archivePath': 'integration/execution/INTEGRATION-SHA256.json',
    'memberBaseArchiveRoot': 'integration', 'members': [{'path': 'integration/' + x['path'], 'sha256': x['sha256'], 'bytes': x['bytes'], 'source': str(integration / x['path'])} for x in integration_manifest['files']]})
for item in read(integration / 'SPARSE-REVISION-SHA256.json')['files']:
    verify({'source': str(integration / item['path']), 'bytes': item['bytes'], 'sha256': item['sha256']})
seal_maps.append({'manifest': record(integration / 'SPARSE-REVISION-SHA256.json'), 'archivePath': 'integration/SPARSE-REVISION-SHA256.json',
    'members': [{'path': 'integration/' + x['path'], 'sha256': x['sha256'], 'bytes': x['bytes'], 'source': str(integration / x['path'])} for x in read(integration / 'SPARSE-REVISION-SHA256.json')['files']]})
put('seal-and-reference-resolution.json', {'seals': seal_maps, 'existingStaticQAMembers': 13, 'allSelectedSealedLayoutsPhysical': True,
    'futureFable': 'Entire completed actual role folder including provider/ will be inventoried and copied verbatim only after success/accepted verdict/root authorization',
    'localOnlyReferenceLimit': 'The large historical prior-archive-tree.txt cannot be verified from public miniarchive bytes without its explicit local original; exact path, size and hash retained',
    'original1534FeatureArchive': 'Referenced by exact immutable publication/source records; not recopied'})
scan = []
for item in copies:
    raw = Path(item['source']).read_bytes()
    for name, pattern in ns['PATTERNS']:
        for match in __import__('re').finditer(pattern, raw):
            scan.append({'source': item['source'], 'archivePath': item['archivePath'], 'pattern': name, 'offset': match.start(), 'candidateSha256': hashlib.sha256(match.group()).hexdigest()})
put('bounded-privacy-context.json', {'status': 'ROOT_FINAL_DYNAMIC_SELECTION_PRIVACY_ADMISSION_PENDING', 'patterns': [{'name': n, 'regex': p.decode()} for n,p in ns['PATTERNS']],
    'existingProposedFilesScanned': len(copies), 'candidateCount': len(scan), 'candidates': scan, 'valuesPrinted': False,
    'context': ['Current miniarchive contains metadata/static documentation QA and publication/integration records, not original QA test-key logs, runtime stores or the1534-file payload archive',
        'Original D208 disposable keys remain explicitly not revoked and their original stores retired; this preparation neither touches nor recopies them',
        'Original developer paths/session identifiers in exact records remain disclosed; root final privacy decision is required',
        'Future actual Fable/provider and completed source-head CI/native records are absent/unscanned now; dynamic selection must scan them after closure'],
    'limits': 'Six bounded patterns and stated context, not exhaustive assurance or automatic approval; no current CI/process/model access'})
readme = '''# D209 and D211 correction evidence

This proposed miniarchive preserves the bounded correction review, independent static documentation QA, and the publication/integration records for the two recovery instructions and one exact historical-artifact attribute. The current source is clean29e165e14fdda138300ba2a34585ddd47268b475, tree d50fb576f1ef4498cb30e52521198575d6d0ebd4, target a60843a9050b3a203726db84f6abf1f45b8bc694. This preparation changes no source or index.

Independent static QA passed its bounded scope. Its original report SHA256 is21bfa30f7fb740e7d447c1761990bb0b366a268fb86a87e97d6c2eaf73a589e5; all13 sealed members and the checksum file remain complete. It independently traced the ordinary published API default, explicit editable-draft versionId/allowDraft:true path, UI publication boundary and unchanged Resume/Replay pinning. It verified50 exact noncombined source blobs/modes, all four source-hunk subtraction proofs, six retained D197 paragraphs and the1534 feature-archive blobs. Its prior19 D197 public-method/Fastify cases remain historical, not new runtime, browser or native execution. Exact public readback7067143342 is retained.

Actual Fable5.2/xhigh bounded D209/D211 acceptance is PENDING at this preparation cutoff. Only its original brief/spec are inventoried; no provider verdict, successful invocation or future selection is invented. The dispatcher requires the announced21:00UTC reset, clean29e, completed source-head CI/native and completed independent static QA. It must not be executed early or substituted by GPT. A future actual report must retain one successful correct-model terminal and exact final-message bytes, plus root's explicit accepted-verdict interpretation. This bounded correction check consumes no new general scan; general cycles1 and2 remain complete and fresh Astra MAX general3 is reserved.

D210 retains the first publication failure when Git refused the explicit archive outside sparse scope, and the separately derived helper that resumes only the two owned staged policy files plus the named archive with --sparse. D211 retains the second failure from historical seven-character markers and the one exact conflict-marker-size=32 rule. The187030-byte artifact stays SHA25698047f736843b54ebcf2918f8369be0b7383a7959c8f3a5394000bc577db3d8b; ordinary source marker attributes remain unspecified. The third attempt passed the full staged check without exclusions and committed evidenceedf. Raw stdout/stderr, helper derivation, effective attributes and verification records remain exact.

Both subsequent delivery merges preserve their parent/source/archive proofs. Root's proof replay and its outer tuple/list comparison erratum remain separate: substantive checks passed, then normalized JSON comparison corrected the outer comparison without changing source or receipts. Root's scoped Prettier check passed after pnpm installed801 existing-lock packages fromG with downloaded0. That root check is not described as install-free. Integration-agent execution performed no install/build/test/provider/GitHub operation.

The original1534-file feature archive, original disposable-key logs and runtime stores are not copied into this miniarchive. D208's original test keys remain explicitly not revoked and their original stores retired. One large historical full-tree dump remains a local absolute-path/size/hash reference under D202; public verification of that raw dump requires its original. Current static-QA and integration sealed layouts are preserved in full, with explicit member-root resolution. New large evidence stays onG. Pattern counts are bounded and do not approve privacy or future provider content.

Source-head CI44934348117 at29e/a608 was running when preparation was assigned; this task does not inspect or claim its result. If it completes for the later Fable dispatch, it will be retained as preliminary source-head evidence after the evidence-only miniarchive commit changes HEAD. Root still needs fresh final-head/current-target CI, numerical coverage, canonical native verification and reserved fresh Astra MAX general3 after that commit. Those downstream gates are not circular prerequisites to prepare the miniarchive. Root owns final dynamic selection/privacy admission, accepted actual review, assembly, formatting, archive seal, authorized commit, push and remaining delivery/owner gates.
'''
# Keep the new narrative plain and readable without editing old raw records.
for old,new in [('clean29e','clean 29e'),('is21b','is 21b'),('all13','all 13'),('verified50','verified 50'),('the1534','the 1534'),('prior19','prior 19'),('readback706','readback 706'),('Fable5.2','Fable 5.2'),('announced21:00','announced 21:00'),('The187030','The 187030'),('SHA256980','SHA256 980'),('evidenceedf','evidence edf'),('installed801','installed 801'),('fromG','from G'),('downloaded0','downloaded 0'),('original1534','original 1534'),('stays onG','stays on G'),('CI44934348117','CI 44934348117'),('at29e/a608','at 29e/a608')]:
    readme=readme.replace(old,new)
put('README.draft.md', readme.encode('utf-8'))
config = {'schema': 'graphgoblin-486-doc-miniarchive-preparation/1', 'status': 'INCOMPLETE_PREPARATION_ONLY', 'archivePrefixProposed': 'docs/qa/2026-11-21-i4-486-doc-correction',
    'inventory': 'input-inventory.json', 'requiredActualFable': {'root': str(future_root), 'model': 'claude-fable-5-2', 'effort': 'xhigh', 'sourceHead': ns['HEAD'],
        'acceptedCompletion': {'rootAssessedAccepted': False, 'verdict': None, 'reportSha256': None, 'verdictLine': None}},
    'rootFinalizationAdmission': {'authorized': False, 'privacyApproved': False, 'exactSelectionSha256': None, 'rootDecision': None, 'approvedCandidateHashes': []},
    'fixedPreparationMetadata': [{'file': name, 'sha256': hashlib.sha256((OUT/name).read_bytes()).hexdigest()} for name in ['input-inventory.json','source-and-CI-boundary.json','seal-and-reference-resolution.json','bounded-privacy-context.json','README.draft.md']],
    'remainingAfterEvidenceOnlyCommit': ['Root final README/formatting/archive seal and evidence-only source-preservation proof', 'Fresh final-head/current-target CI and numerical coverage', 'Fresh canonical native artifact verification', 'Reserved fresh independent Astra MAX general3', 'Signed delivery and separately retained owner acceptance'],
    'noFutureDataPreapproval': True, 'noSourceHeadChangeBeforeActualFable': True, 'futureSourceHeadCIClassifiedPreliminaryAfterMiniarchiveCommit': True}
put('ready-after-fable-config.draft.json', config)
put('ROOT-HANDOFF.md', ('''# Ready-after-Fable preparation handoff

This is incomplete metadata preparation only. The current clean29e checkout must stay frozen until actual Fable after the reset. No provider, CI directory or running root process was accessed. Existing complete static-QA13+checksum, current integration layouts and narrow snippets, root proof replay/tuple-list erratum, decision/public readbacks and all three publication attempt records are inventoried. The1534 feature payload and original key/store data are not recopied; the large historical tree proof remains a disclosed local reference.

After the root dispatcher has completed the actual Fable01 invocation, root reads its full verdict and original envelope. Use a NEW root-completed configuration derived from ready-after-fable-config.draft.json: bind the exact ACCEPT FIX report hash/line, root interpretation, explicit finalization authorization, privacy decision and dynamic final selection hash. No success is inferred from subtype alone, a brief, a CI run or a missing report. The helper refuses error/nonzero/wrong-model/multiple-terminal/unaccepted data and any changed source/index/original bytes.

`python -B prepare-after-fable.py inspect --config <config>` reads/hashes only. Initially it returns incomplete without reading active CI. Only after a genuine closed provider exists does it read the completed source-head CI/native receipts referenced by the dispatch guard, dynamically capture the COMPLETE actual review folder and scan every new byte. Root then admits that exact dynamic selection. No input is approved now on behalf of a future result.

After root explicitly authorizes finalization, prepare-candidate may copy to a NEW E/i4-486-doc-correction-candidate-<unique> directory. It preserves complete physical packet paths, rechecks all source/input hashes before/after, and emits an UNSEALED candidate only. Existing destinations and finalize are refused. Root must update pending README statements from the actual accepted report, format only new editorial text, create the final archive seal and own all source/index/commit/push actions. No Git write or provider action exists in the helper. Fresh final-head CI/native/Astra3 follow the miniarchive commit; a prior29e pass is preliminary after HEAD changes.
''').encode())
ast.parse((OUT / 'prepare-after-fable.py').read_text())
after = ns['source_state']()
require(after == before, 'Metadata preparation changed frozen source/index')
for item in all_inputs:
    verify(item)
_, _, _, status = ns['inspect'](OUT / 'ready-after-fable-config.draft.json')
require(status['status'].startswith('INCOMPLETE') and status['actualFable'] is None, 'Preparation must remain incomplete without provider')
put('read-only-incomplete-check.json', status)
report = {'status': 'INCOMPLETE_METADATA_PREPARATION_WAITING_FOR_ACTUAL_FABLE_AFTER_RESET', 'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'sourceHead': ns['HEAD'], 'sourceTree': ns['TREE'], 'sourceCleanAndIndexUnchanged': True, 'staticQAReportSha256': record(qa/'REPORT.md')['sha256'], 'staticQAMembersVerified': 13,
    'selectedExistingOriginals': len(copies), 'allExistingInputFilesVerifiedUnchanged': len(all_inputs), 'localLargeReferences': len(local_references),
    'sealedPacketGroupsMapped': len(seal_maps), 'futureFableProviderExists': False, 'futureActualVerdict': None, 'finalSelectionOrPrivacyApproved': False,
    'proposedExistingByteCopies': sum(x['bytes'] for x in copies), 'boundedPatternCandidates': len(scan), 'original1534FeaturePayloadCopied': False,
    'currentCIRootExec28877Touched': False, 'sourceHeadCIResultClaimed': False, 'modelProviderTestBuildAssemblyOrRepositoryMutation': False,
    'helperVerification': 'AST parse and read/hash-only incomplete inspection; future successful path/copy not exercised', 'rootStillOwnsFinalizationAfterActualReport': True}
put('preparation-report.json', report)
manifest = []
for path in files(OUT):
    raw=path.read_bytes();manifest.append({'path':path.relative_to(OUT).as_posix(),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
put('PREPARATION-METADATA-SHA256.json', {'meaning':'Preparation metadata checksums only; not final archive seal or future approval; self excluded','files':manifest})
print(json.dumps({'directory':str(OUT),**report,'hashes':{name:hashlib.sha256((OUT/name).read_bytes()).hexdigest() for name in ['preparation-report.json','input-inventory.json','ready-after-fable-config.draft.json','prepare-after-fable.py','PREPARATION-METADATA-SHA256.json']}}))
