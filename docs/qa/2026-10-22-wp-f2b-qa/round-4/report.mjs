import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = fileURLToPath(new URL('.', import.meta.url)),
  root = fileURLToPath(new URL('../../../../', import.meta.url));
const load = async (n) => JSON.parse(await readFile(join(dir, n), 'utf8'));
const served = await load('served-checks.json'),
  docs = await load('documentation-check.json'),
  integrity = await load('integrity-verification.json'),
  analysis = await load('failure-analysis.json'),
  cleanup = await load('cleanup.json'),
  components = await load('components-command.json');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (head !== '492b283b49747e91470d94dca7028caa4eeb6c3d') throw Error('Pinned HEAD differs');
const n1 = served.checks.find((c) => c.id === 'pending-prompt-edit'),
  n2 = served.checks.find((c) => c.id === 'B1-all-failed');
const verdict =
  served.failed || docs.verdict !== 'PASS' || integrity.verdict !== 'PASS' || components.exitCode
    ? 'FAIL'
    : 'PASS';
const cell = (s) =>
  String(s ?? '')
    .replaceAll('|', '/')
    .replaceAll('\n', ' ');
function actual(c) {
  if (c.verdict === 'FAIL')
    return (
      (c.actual.error ?? 'Failure')
        .split('\n')
        .filter((s) => s && !s.startsWith('    at'))
        .slice(0, 8)
        .join(' ') + '. Further assertions after the failure were not established.'
    );
  const s = JSON.stringify(c.actual);
  return s.length > 700 ? s.slice(0, 700) + ' ... (full values in served-checks.json)' : s;
}
const text = [];
const add = (...s) => text.push(...s);
add(
  '# Independent QA round 4: WP-F2b / #204',
  '',
  '**Verdict: ' +
    verdict +
    ' on ' +
    head +
    '.** The full served replay ran once, with no retries: **' +
    served.passed +
    ' passed, ' +
    served.failed +
    ' failed, 27 cases**. N1, N2 and N4 pass their specific checks; the required full-file replay fails. All 43 focused component tests pass. The evidence-record repair passes for the 41 committed round-3 files.',
  '',
  'Worktree codex-qa-wp-f2b, detached HEAD; evidence changes only, uncommitted. No production code or Git index change, commit, owner app/store access, real-provider turn, or use of the implementer/audit port ranges. Node22 is first on PATH; pnpm.cmd is called from PowerShell. Built API/web and headless Microsoft Edge are used. Native served traffic is on **5860** only, with an owned TEMP store prefixed gg-qa-f2b-. No other QA agent was spawned.',
  '',
  '## Defects',
  '',
  '### QA-F2B-R4-01 — major verification blocker: required served replay fails',
  '',
  'Steps: build this head, invoke the committed round-3 served-checks.mjs once with QA_PORT=5860, QA_OUTPUT_DIR=<round-4> and QA_TEMP_PREFIX=gg-qa-f2b-r4-served-, without QA_ONLY. Expected: the entire replay passes on the integrated F1/F2b head. Actual: 15 failures remain as failures. Cases timed out waiting for selected model/effort, a completed harness action, publication readiness or their existing lookup assertions. Some snapshots still show the first-load waiting notice or Checking.',
  '',
  'Captured API timing shows GET /harness/preflight reaching 9003 ms (10 responses over 5000 ms), POST /validate reaching 7891 ms (4 over 5000 ms), and POST /publish reaching 6350 ms (1 over 5000 ms). The component run took 199.42 seconds, including 83.60 seconds transforming modules. Components overlapped the first part of the served run. These are host/load-class timing observations; product attribution remains unresolved. They do not waive or convert a failed assertion. No retry, timeout change or test repair was made. D-015 is not used as a waiver.',
  '',
  'Evidence: [served-checks.json](served-checks.json), [served.log.txt](served.log.txt), [failure-analysis.json](failure-analysis.json), [components.log.txt](components.log.txt). QA-204-01 is not requalified by this run: its cached-catalog case stopped at the initial Ready-to-publish precondition, before the failed-refetch reproduction. The earlier closure remains historical evidence, not a current pass.',
  '',
  '## Coverage of round-4 criteria',
  '',
  '| Criterion | Steps / expected | Actual | Result / evidence |',
  '| --- | --- | --- | --- |',
);
add('| Head admission | git rev-parse HEAD must equal the requested pin | ' + head + ' | PASS |');
add(
  '| Evidence record | Inventory the committed round-3 tree, resolve preserved log names, withdraw nonexistent historical references, hash actual final bytes | 41 committed artifacts linked; 40 hashes in manifest including final-audit; manifest self-hash in external anchor; 47 on-disk files hash-checked including six ignored aliases; zero mismatches/missing committed links | PASS, [integrity-verification.json](integrity-verification.json), [round-3-integrity.json](round-3-integrity.json) |',
);
add(
  '| N1 served cancellation | Hold Settings, select Claude, edit prompt, release response; waiting promise clears and authored values persist/reopen | ' +
    cell(JSON.stringify(n1.actual)) +
    ' | ' +
    n1.verdict +
    ', [served-checks.json](served-checks.json) |',
);
add(
  '| N1 components | Run both harness-switch test files, including concurrent-edit cancellation and preserving a newer notice | 43 tests / 2 files pass, command exits 0 | PASS, [components.log.txt](components.log.txt) |',
);
add(
  '| N2 settled failure counts | Wait for all first failed lookups before capturing counts; switch inheriting node both directions with no new lookups | ' +
    cell(JSON.stringify(n2.actual)) +
    ' | ' +
    n2.verdict +
    ', [served-checks.json](served-checks.json) |',
);
add(
  '| N4 Upgrade note | Compare CHANGELOG #204 to generated GET /model-catalog client/OpenAPI/API response schema | Upgrade says rebuild API and web together with regenerated client; ecosystemDefault is required boolean; no store migration/reset | ' +
    docs.verdict +
    ', [documentation-check.json](documentation-check.json) |',
);
add(
  '| Full served replay | Full committed file once, no retries | ' +
    served.passed +
    ' pass / ' +
    served.failed +
    ' fail | FAIL, [served-command.json](served-command.json) |',
);
add(
  '',
  '### Every served check',
  '',
  'Every record below links by its ID to the complete steps, expected, actual and pass/fail data in [served-checks.json](served-checks.json); raw captured records are [served-results.json](served-results.json). Failure rows retain their failures without subsequent executions.',
  '',
  '| Check | Steps | Expected | Actual | Verdict |',
  '| --- | --- | --- | --- | --- |',
);
for (const c of served.checks.filter((c) => c.id !== 'environment'))
  add('| ' + [c.id, c.steps, c.expected, actual(c), c.verdict].map(cell).join(' | ') + ' |');
add(
  '',
  '## Evidence-record repair and provenance',
  '',
  'The initial audit is preserved in [evidence-repair-before.json](evidence-repair-before.json). It found stale hashes for README, cleanup/replay scripts and the subsequently updated served script; six old manifest log names were not committed; the tracked log-text copies and the integrity metadata were absent from that old manifest.',
  '',
  'The [round-3 README](../round-3/README.md) now dates the repair to this head and explains why it was needed. The [regenerated manifest](../round-3/artifact-manifest.json) hashes every other committed round-3 file, including the [regenerated final audit](../round-3/final-audit.json). Its own hash lives outside that directory in [round-3-integrity.json](round-3-integrity.json), avoiding a circular self-hash. The anchor also records every on-disk round-3 file and distinguishes committed artifacts from ignored duplicate aliases.',
  '',
  'The six ignored .log files are byte-identical to their committed .log.txt copies; removal was rejected by automatic approval review with blocked by policy. They remain explicitly reported as working-copy aliases, not curation targets or missing committed evidence. The preserved .log.txt files are linked from the round-3 README. The old initial/observation and format/helper-copy references were reworded as unavailable historical artifacts rather than invented or relabelled as later runs. Only evidence READMEs and integrity metadata were repaired; no historical result, log-text copy or replay script was regenerated in place.',
  '',
  'Formatting was completed before sealing the round-3 files. Any later formatting or path stripping must be followed by the documented repair verifier/seal. This round does not present the integrity audit as a rerun of the historical round-3 tests.',
  '',
  '## Commands and gates',
  '',
  '| Command | Actual | Result |',
  '| --- | --- | --- |',
  '| pnpm.cmd build | exit 0, served assets/runtime built at the pin | PASS, [build.log.txt](build.log.txt) |',
  '| [replay.ps1](replay.ps1) -Stage Served | one invocation, exit 1; 12 pass / 15 fail | FAIL |',
  '| pnpm.cmd --filter @graphgoblin/web exec vitest run src/editor/harness-switch.test.tsx src/forms/fields/harness-switch.test.tsx --maxWorkers=1 | exit 0, 43 pass | PASS |',
  '| [check-docs.mjs](check-docs.mjs) | all eight Upgrade/client/schema checks true | PASS |',
  '| [repair-evidence.mjs](repair-evidence.mjs) seal / verify | committed inventory and hashes verified | PASS |',
  '| pnpm.cmd exec prettier --write (edited evidence only, before seal) | exit 0 | PASS, [format.log.txt](format.log.txt) |',
  '',
  'Full coverage, head-wide typecheck/lint/layer/dependency gates, and the model-picker/Claude/readiness Edge specs were not rerun in this bounded round. No head-wide green gate or fresh #205 result is claimed.',
  '',
  '## Cleanup and host limitations',
  '',
  'The owned API process exited and its recorded PID is absent. The current QA-COMMON instruction says Codex QA workers never delete directories and list them for the orchestrator, so the store is retained: **' +
    cleanup.retainedStore +
    '**, relative to TEMP. Its fake CLI binaries, API timing log and disposable data are inside it. See [cleanup.json](cleanup.json) and [served-lifecycle.json](served-lifecycle.json). No directory deletion was attempted this round.',
  '',
  'Automatic approval review separately rejected file removal of the six ignored duplicate logs with blocked by policy. No alternate removal mechanism was attempted. The ignored aliases and retained store are explicitly recorded; no owner or prior-round store was touched. All delivered text is scanned for local user paths. Fake-only checks do not qualify live provider behavior.',
  '',
  '## Report path and evidence folder',
  '',
  'Report: docs/qa/2026-10-22-wp-f2b-qa/round-4/README.md. Evidence folder: this round-4 directory; repaired historical integrity record: sibling round-3. All retained artifacts in this directory are linked below.',
  '',
  '## Observations outside scope',
  '',
  'F1 round-8 behavior is included in the built app, but these failures do not isolate an F1 production regression. The required replay is still FAIL. Known #205 failures and prior coverage results remain historical and were not reclassified. Current API latency and the overlap with the component workload are documented for the orchestrator; no production fix or acceptance waiver is proposed here.',
  '',
  '## Artifact inventory',
  '',
);
await writeFile(join(dir, 'README.md'), text.join('\n') + '\n');
let names = (await readdir(dir, { withFileTypes: true }))
  .filter((f) => f.isFile())
  .map((f) => f.name);
if (!names.includes('final-audit.json')) names.push('final-audit.json');
names.sort();
await writeFile(
  join(dir, 'README.md'),
  text.join('\n') + '\n' + names.map((n) => '- [' + n + '](' + n + ')').join('\n') + '\n',
);
const readme = await readFile(join(dir, 'README.md'), 'utf8');
const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);
const unlinked = names.filter((n) => !links.includes(n));
const local = [];
for (const n of names.filter((n) => n !== 'final-audit.json'))
  if (/[A-Z]:[\\/]+Users[\\/]+/i.test(await readFile(join(dir, n), 'utf8'))) local.push(n);
const changed = execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
const productChanges = changed.filter((n) => !n.startsWith('docs/qa/2026-10-22-wp-f2b-qa/'));
await writeFile(
  join(dir, 'final-audit.json'),
  JSON.stringify(
    {
      head,
      verdict,
      servedInvocations: 1,
      servedRetries: 0,
      servedPassed: served.passed,
      servedFailed: served.failed,
      n1: n1.verdict,
      n2: n2.verdict,
      n4: docs.verdict,
      committedRound3Integrity: integrity.verdict,
      files: names.length,
      unlinkedArtifacts: unlinked,
      localUserPathMatches: local,
      productFilesChanged: productChanges,
      indexDiff: execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Report ' +
    verdict +
    '; artifacts ' +
    names.length +
    '; unlinked ' +
    unlinked.length +
    '; local paths ' +
    local.length +
    '; product files changed ' +
    productChanges.length,
);
if (unlinked.length || local.length || productChanges.length) process.exitCode = 1;
