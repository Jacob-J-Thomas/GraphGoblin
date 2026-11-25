import hashlib,json,re
from pathlib import Path
from zipfile import ZipFile
from datetime import datetime,timezone
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
Q=Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents')
OUT=E/'i5-d242-capped-completion-01'
CI=Q/'i5-564-head847f-target0f6c-ci-01'
NATIVE=Q/'i5-564-head847f-target0f6c-ci-01-windows'
def sha(data): return hashlib.sha256(data).hexdigest()
def save(name,data):
    with (OUT/name).open('x',encoding='utf-8',newline='\n') as f: json.dump(data,f,indent=2);f.write('\n')
c=json.loads((CI/'verified.json').read_text()); n=json.loads((NATIVE/'verified.json').read_text())
assert c['head']=='847f0750cc354cd4510707c9faa2fda060b4c301' and c['target']=='0f6c325becf3e3e0562ae69dfae2c42bcf1d7129'
assert c['attempt']==1 and len(c['jobs'])==6 and all(v['conclusion']=='success' and not v['failedOrCancelledSteps'] for v in c['jobs'].values())
assert len(c['coverage']['members'])==13 and sha((CI/'coverage.zip').read_bytes())==c['coverage']['sha256']
with ZipFile(CI/'coverage.zip') as z:
    assert set(x.filename for x in z.infolist() if not x.is_dir())==set(c['coverage']['members'])
    for name,pin in c['coverage']['members'].items():
        raw=z.read(name); assert sha(raw)==pin['sha256']
        totals=json.loads(raw)['total']
        for metric in ['lines','branches','functions','statements']: assert totals[metric]['pct']==pin[metric]
        assert totals['lines']['pct']>=90 and totals['branches']['pct']>=90
assert n['head']==c['head'] and n['base']==c['target'] and n['run']==c['run'] and n['merge']==c['testedMerge'] and n['sourceTree']==c['testedTree']
assert n['canonicalReplay'] and n['records']==338 and n['artifact'] in c['otherArtifactIds']
assert sha((NATIVE/'archive.zip').read_bytes())==n['digest'] and (NATIVE/'archive.zip').stat().st_size==n['bytes']
with ZipFile(NATIVE/'archive.zip') as z:
    assert len(z.namelist())==3 and set(z.namelist())==set(n['files'])
    for name,pin in n['files'].items(): assert sha(z.read(name))==pin
browser=(CI/'browser.log').read_text(encoding='utf-8-sig')
skip_lines=[l.strip() for l in browser.splitlines() if re.search(r'\b1 skipped\b',l)]
assert skip_lines
receipt=dict(utc=datetime.now(timezone.utc).isoformat(),ciMonitorSession=59856,ciMonitorExit=0,nativeVerifierExit=0,head=c['head'],target=c['target'],run=c['run'],attempt=1,testedMerge=c['testedMerge'],testedTree=c['testedTree'],ciVerifiedSha256=sha((CI/'verified.json').read_bytes()),nativeVerifiedSha256=sha((NATIVE/'verified.json').read_bytes()),coverageMembersRehashed=13,allLinesAndBranchesAtLeast90=True,nativeMembersRehashed=3,nativeRecords=338,unitPassed=c['unitPassed'],unitSkipped=c['unitSkipped'],browserPassed=c['browserPassed'],browserSkipSummary=skip_lines,nativeWindowsPassed=c['nativeWindowsPassed'],audit=c['audit'],formalReview=False)
save('ROOT-CI-NATIVE-READBACK.json',receipt)
draft=(OUT/'REPORT.pending-ci.md').read_text(encoding='utf-8')
draft=draft.replace('# PR #564 coordinator completion — UNARMED pending current CI','# PR #564 — coordinator capped completion')
draft=draft.replace('This is an unpublished preparation. Browser CI, complete artifact verification, the final coordinator decision and signed merge are still pending. Do not use this file as a completion report or merge input.','The coordinator accepts the known D242 correction and its applicable engineering checks for the exact candidate below. No known in-scope blocker remains. This is completion under the already adopted capped route, not a replacement Astra sign-off. Live premerge and independently verified signed delivery remain separate required steps.')
draft=draft.replace('attempt 1, remains incomplete.','attempt 1, passed all six jobs with no failed/cancelled steps. Root independently rehashed the 13 coverage summaries and all three canonical Windows archive members after the existing collectors completed successfully.')
old='Future final report must insert the actual complete CI result, all 13 coverage summaries, canonical native replay and evidence hashes. Only then may the coordinator issue completion and publish this disposition as an exact-byte PR comment. The unchanged batch premerge verifier must pass immediately before an expected-head merge; independent postmerge verification must establish the valid signature, ordered target/head parents, tested tree, current main, closed #416/#420 and open owner trackers #448/#459.'
new=f"Current CI reports {c['unitPassed']:,} unit passes and {c['unitSkipped']} declared skips, {c['browserPassed']} browser passes and one declared live-provider skip, and {c['nativeWindowsPassed']} Windows launcher checks. All 13 V8 summaries exceed the unchanged 90% line/branch thresholds; hosted web coverage is 98.68% lines and 94.45% branches, separately from the local result above. Audit remains {c['audit']}, with no high/critical findings. The canonical Windows replay verifies 338 records from artifact {n['artifact']} (SHA-256 `{n['digest']}`), bound to the exact run, head, target, tested merge and tree. CI verification SHA-256: `{receipt['ciVerifiedSha256']}`; native verification SHA-256: `{receipt['nativeVerifiedSha256']}`.\n\nThe coordinator issues this capped completion and will publish it as an exact-byte PR comment. The unchanged batch premerge verifier must pass immediately before an expected-head merge; independent postmerge verification must establish the valid signature, ordered target/head parents, tested tree, current main, closed #416/#420 and open owner trackers #448/#459. Expected head is an atomic merge condition; target/tree are checked immediately before and independently after, not claimed as an atomic base fence."
assert old in draft;draft=draft.replace(old,new)
assert 'UNARMED' not in draft and 'Future final report' not in draft
with (OUT/'REPORT.md').open('x',encoding='utf-8',newline='\n') as f:f.write(draft)
save('REPORT-PIN.json',dict(bytes=len((OUT/'REPORT.md').read_bytes()),sha256=sha((OUT/'REPORT.md').read_bytes())))
print(json.dumps(receipt,indent=2));print('Completion report prepared: '+sha((OUT/'REPORT.md').read_bytes()))
