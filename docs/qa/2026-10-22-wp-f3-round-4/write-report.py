from pathlib import Path
import hashlib
import json
import re
import subprocess

root = Path(__file__).resolve().parent
repo = root.parents[2]
baseline = json.loads((root / 'baseline.json').read_text())

invariants = {
 'apps/api/src/version-migration.test.ts': 'Keep main: pending migrations equal removed ledger rows, independent of the appended migration count.',
 'apps/web/src/runs/RunInspectorPage.tsx': 'Keep main history/event and delivery panels; add F3 RunLimits import and card before the wait panel.',
 'docs/05-execution-engine.md': 'Keep main ranked provenance/persistence rules; retain nullable visits/passes, pinned limits, no default deadline and absolute authored deadlines.',
 'docs/06-harness-integration.md': 'Keep main trigger-start/readiness/sign-out rules; retain F3 typed failures and the execution/storage cutoff audit.',
 'docs/guide/03-run-and-observe.md': 'Keep main JSON POST and delivery guidance; retain F3 Unlimited controls, no-default deadline and typed error guidance.',
 'docs/reference/nodes.md': 'Regenerate nullable gate passes from merged contracts.',
 'packages/api-client/openapi.json': 'Regenerate from the merged API: retain main retry provenance, readiness and delivery fields plus F3 nullable limits and typed errors.',
 'packages/api-client/src/generated/schema.ts': 'Regenerate the matching typed client; preserve all merged API contract fields.',
 'packages/contracts/src/run.ts': 'Keep main retry provenance; retain F3 typed transport/output/deadline errors and required pinned execution limits.',
 'packages/engine/src/handlers/claude.test.ts': 'Output resource overflow remains the typed, non-resumable HARNESS_OUTPUT_LIMIT.',
 'packages/engine/src/handlers/inference.ts': 'Keep main evidence fold, acceptance guard and fallible-intent reconciliation; allow one positively unsubmitted retriable transport retry only after successful cleanup and recording, with the exact task/turn re-recorded as uncertain before invocation.',
 'packages/infrastructure/drizzle/meta/0015_snapshot.json': 'Restore main D2 webhook-journal snapshot; F3 data-only snapshot moves to 0017.',
 'packages/infrastructure/drizzle/meta/_journal.json': 'Retain main entries 0000 through 0016 exactly, then append contiguous idx 17 with a later timestamp.',
 'packages/infrastructure/src/claude/harness.test.ts': 'Retain main sign-out diagnostic isolation tests; assert no turn-count/billing options and null inference timeout.',
 'packages/infrastructure/src/claude/harness.ts': 'Retain main structured/text sign-out readiness and authority rules; remove only F3 turn-count and independent turn-timeout options.',
 'packages/infrastructure/src/claude/process.ts': 'Retain main fixed no-turn sign-out metadata; null timeout creates no watchdog while probes retain finite timeouts.',
 'packages/infrastructure/src/sqlite/catalog.test.ts': 'Keep main dynamic shipped-count expectations for historical fixtures.',
 'packages/infrastructure/src/sqlite/classifiers.test.ts': 'Keep main dynamic shipped-count expectations for historical fixtures.',
 'packages/infrastructure/src/sqlite/storage.test.ts': 'Keep main dynamic shipped-count expectations for historical fixtures.',
 'packages/infrastructure/src/sqlite/template-retirement.test.ts': 'Keep main ledger count derived from the actual migration list.',
 'packages/infrastructure/drizzle/0017_run_execution_limits.sql': 'Same SQL as original F3 0015, with no content change.',
 'packages/infrastructure/drizzle/meta/0017_snapshot.json': 'Data-only migration: schema identical to 0016, fresh id and prevId equal to 0016 id.',
 'packages/engine/src/handlers/inference-failure.ts': 'Extend main ordinary typed evidence with output overflow; preserve transport/output codes and original F3 resumability without changing the rank table.',
 'packages/engine/src/testing/inference-failures.ts': 'Update shared matrix expectations for the restored typed transport code and adapter retriability.',
 'packages/engine/src/unlimited.test.ts': 'Retain F3 coverage; add acceptance-after-transport and unconfirmed-cleanup retry negatives through public fake ports.',
 'packages/infrastructure/src/sqlite/definition-pins.test.ts': 'Read renamed 0017 SQL in the existing authored-null/5, damaged-JSON and idempotency checks.',
 'packages/infrastructure/src/sqlite/history-summaries.test.ts': 'Locate the actual index migration and rewind from its timestamp, so later migrations do not invalidate the upgrade regression.',
 'docs/07-api-and-streaming.md': 'Document pinned defaults, immutable effective limits, queue exclusion, deadline child cancellation, and observation-only client/MCP timeouts.',
 'CHANGELOG.md': 'Union retained; the #243 upgrade note now names SQL 0017 and still promises no default deadline on existing runs.',
}

resolutions = []
for name, invariant in invariants.items():
    path = repo / name
    original = subprocess.run(['git', 'show', 'MERGE_HEAD:' + name], cwd=repo, capture_output=True)
    exists = original.returncode == 0
    diff = subprocess.check_output(['git', 'diff', '--no-ext-diff', '--unified=0', 'MERGE_HEAD', '--', name], cwd=repo).decode()
    ranges = []
    for start, count in re.findall(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', diff, re.M):
        n = int(count or 1)
        ranges.append([int(start), int(start) + max(0, n - 1)])
    equal = exists and original.stdout.replace(b'\r\n', b'\n') == path.read_bytes().replace(b'\r\n', b'\n')
    if not ranges:
        ranges = [[1, len(path.read_text(encoding='utf-8-sig').splitlines())]]
    resolutions.append({'file': name, 'lines': ranges, 'mainIdentical': equal, 'newSinceMain': not exists, 'invariant': invariant})
(root / 'changed-line-ranges.json').write_text(json.dumps(resolutions, indent=2) + '\n', encoding='utf-8', newline='\n')
table = '| File | Resolved lines | Invariant |\n| --- | --- | --- |\n'
for row in resolutions:
    ranges = ', '.join(str(a) if a == b else f'{a}-{b}' for a, b in row['lines'])
    table += f"| {row['file']} | {ranges} | {row['invariant']}" + (' Main-identical file; range covers the whole file.' if row['mainIdentical'] else '') + ' |\n'
(root / 'resolutions.md').write_text('# Resolutions and shared-file ranges\n\nRanges describe the final working tree against MERGE_HEAD. New/main-identical files use their whole-file range. All original conflict paths are included.\n\n' + table, encoding='utf-8', newline='\n')

gates = [json.loads(p.read_text(encoding='utf-8-sig')) | {'record': p.name} for p in root.glob('*-result.json')]
gates.sort(key=lambda g: g['startedAt'])
gate_table = '| Capture | Exact command | Exit | Result |\n| --- | --- | --- | --- |\n'
for gate in gates:
    link = f"[{gate['captureName']}]({gate['captureName']})" if gate['kept'] else f"{gate['captureName']} (not kept; D-034)"
    gate_table += f"| {link}; [{gate['record']}]({gate['record']}) | `{gate['command']}` | {gate['exitCode']} | {'PASS' if gate['exitCode'] == 0 else 'FAIL'} |\n"
coverage = '| Package | Result/counts | Lines | Branches |\n| --- | --- | --- | --- |\n'
for package in ['infrastructure', 'engine', 'api', 'web', 'contracts', 'api-client']:
    name = 'coverage-' + package
    if package == 'infrastructure' and (root / 'coverage-infrastructure-final-result.json').exists():
        name += '-final'
    log = root / (name + '.log.txt')
    meta = root / (name + '-result.json')
    if not meta.exists():
        coverage += f'| {package} | Not yet collected | Not yet collected | Not yet collected |\n'
        continue
    record = json.loads(meta.read_text())
    text = log.read_text(encoding='utf-8') if log.exists() else ''
    def field(pattern, fallback):
        match = re.search(pattern, text, re.M)
        return match.group(1).strip().replace('|', '/') if match else fallback
    counts = field(r'^\s*Tests\s+([^\n]+)', 'See retained capture or NOT-KEPT record')
    lines = field(r'^Lines\s*:\s*([^\n]+)', 'Not emitted on failed command')
    branches = field(r'^Branches\s*:\s*([^\n]+)', 'Not emitted on failed command')
    coverage += f"| {package} | {'PASS' if record['exitCode'] == 0 else 'FAIL'}; {counts} | {lines} | {branches} |\n"

proof = json.loads((root / 'migration-proof-results.json').read_text())
assert len(proof['checks']) == 5 and all(c['pass'] for c in proof['checks'])
chain = json.loads((root / 'migration-chain.json').read_text())
text = f'''# WP-F3 / #243 implementer round 4

## 1. Branch and worktree

Branch `codex-wp-f3-unlimited-mode`; worktree `.claude/worktrees/codex-wp-f3-unlimited-mode`.
HEAD `{baseline['head']}`; MERGE_HEAD `{baseline['mergeHead']}`.
Worktree files are resolved; Git's unmerged index entries intentionally remain for the orchestrator to stage. No commit, staging, merge, reset, branch switch or publication was performed. Uncommitted; ready for orchestrator review and commit.

## 2. Per bolt

#243: all twenty remaining conflict-marked paths resolved, preserving main F1/F4/G2/D2 behavior and F3 limits. Exact ranges and invariants are in [resolutions](resolutions.md) and [machine-readable ranges](changed-line-ranges.json). Additional test-fixture changes are explicitly included there.

The migration is now 0017_run_execution_limits. The [chain check](migration-chain.json) verifies unchanged SQL, main's journal prefix and 0015/0016 artifacts, and a data-only snapshot with prevId `{chain['prevId']}`. The [Drizzle gate](check-migrations.log.txt) reports a no-op.

The [public-component disk proof](migration-proof.mjs), [final capture](migration-proof-final.log.txt), and [results](migration-proof-results.json) passed five checks: main SQL through 0016 gives 17 ledger entries; candidate startup applies 0017 for 18; omitted pins become 10/null; explicit 4/5 and null/null survive in the run, queued event and both saved admission pins; reopen is idempotent; a fresh database applies all 18 migrations. This uses actual main SQL and public SQLite components, not an archived main application build. The older replay kit retains its historical migration numbering and counts on its stated heads; this round's migration proof is the current 0016/0017 replay.

## 3. Files changed

The [resolution table](resolutions.md) lists every conflict and additional production/test/doc edit by package. Main-identical resolutions retain their full main content. The limits SQL is renamed, not changed. Generated node/API references and client artifacts were regenerated from the merged source.

Only this directory contains new round-4 evidence. [Baseline](baseline.json), [resolution procedure record](resolution-plan.json), and [closing boundary](boundary.json) distinguish this work from the orchestrator's already-staged mechanical merge resolutions. The index and protected C6 test are verified unchanged at the closing boundary.

## 4. Tests and coverage

The final focused engine run passed **111 tests** across three files; the two new public-port cases prove accepted transport work is never resent and unconfirmed cleanup prevents retry. The shared ranked-evidence matrix passed **872 tests**. [Focused capture](engine-focused-final.log.txt), [matrix capture](evidence-matrix.log.txt).

The initial infrastructure gate failed **9 / 767** (758 passed): eight D-015 native termination/readiness-stop/locked-cleanup cases and one separate history-index fixture failure. Before correction, the fixture failed with `DatabaseUpgradeRequiredError: Stored indexes are incomplete: runs`. It incorrectly removed only the newest ledger row after 0017 was appended. It now identifies its own index migration and rewinds from that timestamp; the focused regression passed **16 tests**. [Original failures](infrastructure-initial-failures.json), [original capture](coverage-infrastructure.log.txt), [regression capture](history-index-regression.log.txt). No original failure is converted into a pass.

{coverage}
Any final infrastructure run with reportOnFailure retains FAIL as the gate outcome even when it emits coverage. No thresholds or exclusions were changed. No before/after failure claim is made for the two added retry negatives; the history-index regression did fail before its fixture correction.

## 5. Gates

Node **22.14.0**, PowerShell, pnpm.cmd. The frozen/prefer-offline install failed with ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK (access denied); existing dependencies were present and the subsequent gates used them. It was not retried with another store or checkout link. An initial direct script invocation was refused because the script was unsigned, before pnpm ran; the retained helper was interpreted in PowerShell without changing execution policy.

{gate_table}
The first formatter changed exactly the [four recorded files](format-changed-files.json). The closing formatter's exact result and further changed files are retained in [closing format result](format-final-result.json), [closing format log](format-final.log.txt), and [closing formatting changes](format-final-changed-files.json).

The carried-record checker output is quoted verbatim:

> {(root / 'carried-checker.log.txt').read_text().strip()}

[Carried checker capture](carried-checker.log.txt); [all twelve tracked/readable carried text logs](carried-logs.json). The supplied checker over this new directory is run last and quoted in the final handoff; it does not rerun historical observations.

## 6. Docs

Numbered doc 05 retains nullable visits/passes, pinned values, no default deadline and absolute authored deadlines; main's ranked failure/persistence documentation is retained. Numbered doc 07 now explicitly describes the same API pins, queue exclusion, deadline child cancellation and the distinction from client/MCP observation deadlines. The #243 CHANGELOG upgrade bullet now names SQL 0017 and still states no existing run or loop gains a deadline. Doc 06, the run guide, generated references and generated client retain both sides' contracts. ADR-0047's no-default decision is unchanged.

## 7. Decisions and parameters

The data-only snapshot is copied from 0016 with a new id and correctly chained prevId; no physical schema change is invented. The one retry consults F4's existing ranked evidence, never weakens acceptance, refuses after recording faults, cancels before retry, and establishes the exact uninvoked intent before its fallible append. Transport/output codes remain typed. No new cutoff, cost, usage, token or provider-turn parameter was added.

Captured text is sanitized; captures above 1,000,000 bytes are omitted under D-034 with name/size/SHA-256 in [NOT-KEPT](NOT-KEPT.md). Raw QA scripts/results are excluded from repository formatting by main's existing ignore rules.

## 8. Caveats and open items

The install failure remains a failure. D-015 failures remain host-qualified failures, not passes. The history-index failure was a distinct corrected fixture issue. The Linux subloop-restart C6 race remains outside this round, unchanged and owner-gated in PR #375; a Windows gate cannot close that Linux blocker. Fable review, orchestrator staging/merge commit and audit round 2 of 3 remain pending.

The first conflict-marker replacement pass was discarded after a file-length check; affected files were reconstructed from main and F3's original semantic hunks were reapplied before the passing checks. The merge index was never modified.

Two migration-proof fixture attempts failed and are retained in [first failure](migration-proof.log.txt), [second failure](migration-proof-fixed.log.txt), and [preserved fixture error](migration-proof-fixture-error.json). The corrected proof authors the historical definition before publication, respecting immutable snapshots. Windows native handles required database-file cleanup after the proof process exited; [parent cleanup](cleanup-proof.ps1) and [cleanup result](migration-cleanup.json) verify zero database files remain. Three empty SQL fixture directories and their empty meta children are preserved because this thread must not delete directories. Native failed-test directories named in the infrastructure captures are inventoried separately in [native fixture inventory](native-failure-directories.json); none was deleted. No owner app/store or paid provider turn was used; this proof started no listener.

Complete retained capture metadata and hashes are in [manifest](manifest.json). All failures, including setup/fixture failures, remain visible in the gate table and captures.
'''
(root / 'README.md').write_text(text, encoding='utf-8', newline='\n')
