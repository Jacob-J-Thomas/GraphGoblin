from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

P = Path(__file__).resolve().parent
E = P.parent
ledger = E / 'i5-416-420-review-ledger.json'
old = ledger.read_bytes()
data = json.loads(old)
assert data['formalReviewPassesConsumed'] == 2 and data['generalScansConsumed'] == 1
assert data['head'] == 'd8bc84937363bbde1d24b561efdcd9e8601a48a7'
qa = E / 'i5-d241-session-feedback-corrected-qa-01'
seal = json.loads((qa / 'MANIFEST.json').read_text())
assert sha256((qa / 'MANIFEST.json').read_bytes()).hexdigest() == 'b31905b24208733035596450cc488fc6efa3bf1e5fee056703c43a38b69e460d'
for member in seal['members']:
    b = (qa / member['path']).read_bytes()
    assert len(b) == member['bytes'] and sha256(b).hexdigest() == member['sha256']
closure = json.loads((qa / 'CLOSURE.json').read_text())
assert closure['freshSelection']['passed'] == 2 and closure['fullSelection']['passed'] == 63
with (P / 'review-ledger.before.json').open('xb') as f:
    f.write(old)
data['head'] = closure['sourceHead']
data['tree'] = closure['sourceTree']
data['boundedCorrectionHistory'] = data.get('boundedCorrectionHistory', []) + [data['latestBoundedCorrection']]
data['latestBoundedCorrection'] = {
    'utc': datetime.now(timezone.utc).isoformat(), 'source': data['head'],
    'decision': 'i5-d241-session-feedback-correction-admission-01/DECISION.md',
    'actualAuthor': 'Ordinary Claude Max Opus 5.5/xhigh completed; 65 paired tools, no pending tools, exit0; six bounded authored paths. No API route.',
    'authorEvidence': 'i5-d241-session-feedback-correction-admission-01/AUTHOR-ROOT-READBACK.json',
    'focusedChecks': '233/233 in14files, all229 prior names retained; typecheck/lint pass, scoped formatting correction and passing recheck retained.',
    'independentQa': 'Unchanged exact55 fixture: fresh2=2pass/61filtered, then separate full63=63pass. All8 commands exit0; source/index/dependencies unchanged. Original failures retained.',
    'qaReport': 'i5-d241-session-feedback-corrected-qa-01/REPORT.md',
    'qaManifestSha256': 'b31905b24208733035596450cc488fc6efa3bf1e5fee056703c43a38b69e460d',
    'observations': 'All4 captures pending disabled; full63 key-change removed original header/button, replacement disabled before old release, strict immediate NotSent visible, zero oldPOST and exactly one newly chosen POST with failureSeq3.',
    'rootDisposition': 'Known B1 and subsequent same-visit session feedback lifetime corrected under these bounded component schedules. This root evidence readback does not rewrite earlier CHANGES REQUIRED reviews or constitute final independent acceptance.',
    'remaining': 'Fresh browser12 including strict G1, current whole-web coverage, full repository/current-target CI and native artifact proof, reserved third independent Astra MAX audit, signed merge, owner decisions/QA separately.',
    'formalPassConsumed': False, 'gateWaived': False
}
blob = (json.dumps(data, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
ledger.write_bytes(blob)
with (P / 'review-ledger.after.json').open('xb') as f:
    f.write(blob)
report = {'utc': datetime.now(timezone.utc).isoformat(), 'source': data['head'], 'qaMembersRehashed': len(seal['members']),
          'beforeSha256': sha256(old).hexdigest(), 'afterSha256': sha256(blob).hexdigest(),
          'formalPassesRemain': '2/3 consumed; final fresh independent Astra MAX reserved',
          'historicalReviewRecordsUnchanged': json.loads(old)['reviews'] == data['reviews']}
with (P / 'RECEIPT.json').open('x', encoding='utf-8') as f:
    json.dump(report, f, indent=2)
    f.write('\n')
print(json.dumps(report, indent=2))
