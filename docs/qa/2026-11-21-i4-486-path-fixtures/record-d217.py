from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess

Q = Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents')
E = Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
packet = E / 'i4-486-d216-independent-01'
out = E / 'd217-root-admission-01'
out.mkdir(exist_ok=False)
seal_raw = (packet / 'ORCHESTRATION-SHA256SUMS.json').read_bytes()
assert sha256(seal_raw).hexdigest() == '439bb296ad757dfe59ee4dc61962c05269178cb92c6230c1a3c96b4d753a3394'
seal = json.loads(seal_raw)
assert len(seal['files']) == 42
for row in seal['files']:
    p = (packet / row['path']).resolve()
    assert p.is_relative_to(packet.resolve())
    raw = p.read_bytes()
    assert len(raw) == row['bytes'] and sha256(raw).hexdigest() == row['sha256'], row['path']
readback = json.loads((packet / 'ORCHESTRATION-READBACK.json').read_bytes())
events = [json.loads(x) for x in (packet / 'provider/events.jsonl').read_bytes().splitlines() if x.strip()]
terminal = [x for x in events if x.get('type') == 'result']
assert len(terminal) == 1
result = terminal[0]
assert result['is_error'] is True and result['modelUsage'] == {}
assert result['api_error'] == 'usage_limit_reached'
assert result['result'].encode() == (packet / 'provider/provider-final-message.md').read_bytes()
assert not [b for x in events for b in x.get('message', {}).get('content', []) if isinstance(b, dict) and b.get('type') == 'tool_use']
assert readback['providerExit'] == readback['wrapperExit'] == 1
assert readback['resetEpoch'] == 1795417200 and readback['rateLimit']['isUsingOverage'] is False
assert readback['sourceBefore'] == readback['sourceAfter']
repo = 'G:/ggq/gg-i4-486-d216-qa/GraphGoblin'
def git(*args):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', repo, *args]).decode().strip()
assert git('rev-parse', 'HEAD') == readback['head']
assert git('rev-parse', 'HEAD^{tree}') == readback['tree']
assert not git('status', '--porcelain')
index = Path(readback['sourceAfter']['index']['source']).read_bytes()
assert sha256(index).hexdigest() == readback['sourceAfter']['index']['sha256']
main = subprocess.check_output(['gh', 'api', 'repos/Jacob-J-Thomas/GraphGoblin/git/ref/heads/main', '--jq', '.object.sha']).decode().strip()
assert main == 'a60843a9050b3a203726db84f6abf1f45b8bc694'
decision = '''# D217 — Continue independent intent 4 delivery through the weekly Claude reset

The actual D216 Opus QA attempt stopped before any tools or tests with a weekly quota rejection. Its literal result subtype is `success`, but `is_error=true`, HTTP 429, empty model usage and exit 1 establish failure. No e630 QA verdict exists. Root read the original report and provider events, verified all 42 sealed members and checked that the frozen source and index are unchanged. The reset is November 23, 2026 at 07:00 UTC / 01:00 America/Chicago (epoch 1795417200). No paid overage was used.

Preserve the required actual Claude Opus 5.5/xhigh independent native QA. Prepare a session-owned reset controller with fresh source checks and a new attempt directory; dispatch once at or after the reported reset, with a bounded execution deadline. Do not substitute models or accounts, enable overages, call again before the reset, overwrite the failed attempt or treat older 6de QA as an e630 result. Controller preparation is not evidence that it is running; record the actual launch separately.

D207 selected #486 before #364 as a coordinator scheduling decision when #364 was waiting for Claude. That wait has ended: #364 has its actual Fable correction acceptance and independent Opus QA. The approved register permits independent units within an admitted intent to overlap. Select #364 integration against actual current main before #486, contingent on source proof that no pending #486 implementation is needed. Main is currently a60843a9050b3a203726db84f6abf1f45b8bc694. Prepare and admit new exact contracts for that real target; preserve the old post-#486 contracts and do not fabricate their required signed-merge fields. Root will inspect the source and combined-document proof before authorizing an ordinary integration. Use the independent G object store for new work to avoid exhausting C; preserve the old clean #364 worktree and every raw archive byte.

This changes only the two independent units' delivery order inside intent 4. The five-intent sequence is unchanged. #364 still needs current-head/current-target CI, native artifact verification, explicit capped completion and a verified signed merge. All three general scans remain consumed; no fourth scan or renewed Astra approval is claimed. #486 retains its original negative final scan, bounded accepted Fable correction, required independent new-head QA, integration against then-current main, fresh CI/native verification, capped completion and signed merge. Intent 5 remains unadmitted until intent 4 engineering delivery is complete.

## Alternatives not selected

- Stop the chat and wait for another owner trigger: rejected because all five intents remain authorized and the owner explicitly requested continuous completion.
- Leave independent #364 delivery idle behind #486's quota wait: rejected because that dependency was a coordinator schedule, not a product dependency; source verification remains required.
- Reuse the old post-#486 integration admission with invented future fields: rejected because it would misrepresent the target and invalidate integration proof.
- Waive actual Claude QA, substitute GPT, change account or enable paid overages: rejected because model, independence and cost boundaries remain intact.
- Admit intent 5 early: rejected because the approved register explicitly requires intent 4 engineering delivery first.

The consolidated owner decision catalogue must include this schedule change, the original quota failure and actual retry outcome. Owner acceptance, deployment, Mac #501 and held #460 remain separate; this decision is not a declaration of completed delivery.
'''
with (Q / 'decision-217.md').open('x', encoding='utf-8', newline='\n') as f:
    f.write(decision)
(out / 'decision-217.md').write_bytes((Q / 'decision-217.md').read_bytes())
receipt = {'at': datetime.now(timezone.utc).isoformat(), 'verifiedQuotaMembers': 42, 'sealSha256': sha256(seal_raw).hexdigest(), 'providerToolsExecuted': 0, 'qaVerdict': None, 'resetEpoch': 1795417200, 'main': main, 'sourceHead': readback['head'], 'sourceTree': readback['tree'], 'sourceIndexUnchanged': True, 'decisionSha256': sha256(decision.encode()).hexdigest(), 'controllerLaunched': False, 'integrationAdmitted': False}
(out / 'verification.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
entry = '\n\n### D217\n\nWeekly Opus quota stopped e630 QA before any tools/tests; original 42-member packet verified, no QA verdict. Preserve actual Opus5.5/xhigh and prepare a fresh guarded continuation for Nov23 07:00UTC/01:00Chicago; no paid overage/model substitution. Within admitted intent4, advance independent #364 against real current main a608 before #486, contingent on exact source/target proof and all existing technical gates. Old post486 contracts stay immutable; new G object-store integration. No fourth general scan. Intent5 still waits for intent4 engineering. Full reasons and rejected alternatives: decision-217.md. No controller or integration launch is inferred from this entry.\n'
for name in ('OWNER-DECISIONS.md', 'QA-SIGN-OFF.md', 'RESUME.md'):
    with (Q / name).open('a', encoding='utf-8', newline='\n') as f:
        f.write(entry)
print(json.dumps(receipt))
