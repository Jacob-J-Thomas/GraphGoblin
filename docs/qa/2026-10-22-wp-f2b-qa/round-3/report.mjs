import { readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const folder = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const expectedHead = '541fddd4e7d0ff87408b0427b86721345f604f4d';
const load = async (name) => JSON.parse(await readFile(join(folder, name), 'utf8'));
const save = async (name, value) =>
  writeFile(join(folder, name), JSON.stringify(value, null, 2) + '\n');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const served = await load('served-checks.json'),
  collector = await load('collector-checks.json'),
  edge = await load('edge-results.json'),
  coverage = await load('coverage-results.json'),
  gates = await load('gates.json');
const cleanupAudit = await load('cleanup-preflight.json');
if (process.argv.includes('--cleanup-blocked')) {
  await save('cleanup.json', {
    status: 'BLOCKED_BY_AUTOMATIC_APPROVAL_REVIEW',
    reason: 'Native PowerShell recursive cleanup rejected before execution: blocked by policy.',
    alternateDeletionAttempted: false,
    processes: cleanupAudit.processes,
    directories: cleanupAudit.directories.map((d) => ({ ...d, removed: false })),
    auxiliaryTemporaryFiles: (await readdir(tmpdir())).filter(
      (name) =>
        name.startsWith('gg-qa-204-r3-') &&
        !cleanupAudit.directories.some((d) => d.directory === name),
    ),
  });
}
const cleanup = await load('cleanup.json');
cleanup.auxiliaryTemporaryFiles = (await readdir(tmpdir())).filter(
  (name) =>
    name.startsWith('gg-qa-204-r3-') && !cleanup.directories.some((d) => d.directory === name),
);
await save('cleanup.json', cleanup);
const head = git('rev-parse', 'HEAD');
const diff = git('diff', '--name-only'),
  index = git('diff', '--cached', '--name-only');
const productChanged = git('diff', '--name-only', '18890113b69b33cdd8c04c2b05db83130c1b1fbe', head)
  .split('\n')
  .filter(Boolean)
  .some((p) => !p.startsWith('docs/qa/2026-10-22-wp-f2b-qa/'));
const components = gates.find((g) => g.stage === 'Components');
const firstLoadWithinSecond =
  served.checks.find((c) => c.id === 'B3-first-load').actual.mountResponseToSwitchMs < 1000;
const allStageHeadsMatch = gates.every((g) => g.head === head);
const passed =
  firstLoadWithinSecond &&
  allStageHeadsMatch &&
  gates.length === 6 &&
  gates.filter((g) => g.stage !== 'Edge').every((g) => g.exitCode === 0) &&
  head === expectedHead &&
  !productChanged &&
  !diff &&
  !index &&
  served.summary.passed === 26 &&
  served.summary.failed === 0 &&
  collector.summary.passed === 16 &&
  collector.summary.requestsMatched === 14 &&
  edge.baselineMatches &&
  components?.exitCode === 0 &&
  coverage.exitCode === 0 &&
  coverage.coverage.lines.pct > 90 &&
  coverage.coverage.branches.pct > 90;
const compact = (v) => JSON.stringify(v);
const cell = (v) =>
  String(v ?? '')
    .replaceAll('|', '/')
    .replaceAll('\n', ' ');
const details = (c) => {
  const a = c.actual;
  if (c.id === 'cached-catalog-failure')
    return (
      a.during.status +
      '; Publish disabled=' +
      a.during.publishDisabled +
      '; ' +
      a.during.model +
      '/' +
      a.during.effort +
      '; lookup counts ' +
      compact(a.before) +
      ' unchanged by switch; retry ' +
      compact(a.recovery.counts) +
      '; same warning; API save ' +
      a.apiSave.status +
      '.'
    );
  if (c.id === 'api-publication-defense')
    return (
      'Validate publishable=' +
      a.validation.body.publishable +
      '; save ' +
      a.save.status +
      '; publish ' +
      a.publish.status +
      ' / ' +
      a.publish.body.errors.map((x) => x.code).join(',') +
      '; published version created=' +
      a.publishedVersionCreated +
      '.'
    );
  if (c.id === 'server-check-only-failure')
    return (
      'Default tooltip retained; Publish enabled=' +
      a.publishEnabled +
      '; publish requests=' +
      a.after.publishes +
      '; published version ' +
      a.published +
      '.'
    );
  if (a.config)
    return (
      'Saved ' +
      compact({
        harness: a.config.harness,
        model: a.config.model ?? '(inherited)',
        effort: a.config.effort ?? '(inherited)',
        policy: a.config.harnessOptions,
      }) +
      '; reopened ' +
      compact(a.reopened) +
      '; CLI ' +
      compact(a.requests) +
      '.'
    );
  const s = compact(a);
  return s.length > 500 ? s.slice(0, 500) + ' ... (full actual in served-checks.json)' : s;
};
const lines = [];
const add = (...s) => lines.push(...s);
add(
  '# Independent QA round 3: replayable WP-F2b / #204 evidence',
  '',
  '**Verdict: ' +
    (passed ? 'PASS for #204' : 'FAIL') +
    ' on ' +
    head +
    '.** QA-204-01 remains closed by fresh served Edge/API evidence. Cleanup status: ' +
    cleanup.status +
    '.',
  '',
  'Worktree codex-qa-wp-f2b, detached HEAD; round-3 evidence is uncommitted for orchestrator curation. This round creates fresh replacement evidence for the lost round-2 artifacts. It does not reconstruct old raw observations as if they survived. The product tree matches 18890113; the new HEAD adds the curated QA evidence only. Prior-round files are untouched. No product/tracked-file edit, index operation, commit, owner app/store access, or port 4747/4748 use.',
  '',
  'Node ' +
    gates[0].node +
    ', pnpm.cmd from PowerShell, Windows, built API/web, headless Microsoft Edge ' +
    served.checks.find((c) => c.id === 'environment').actual.edge +
    '. Served/collector use 5880 sequentially; Edge uses 5881, control 5882, extra apps 5883/5884. All app stores use gg-qa-204-r3- beneath TEMP. Native CLIs come only from tooling/fixtures/model-switch-cli.cs; Edge uses existing in-process engine fakes. No paid/provider turns.',
  '',
  'D-023 governs loop, Settings, then catalog ecosystemDefault precedence and preserved inheritance. D-024 supersedes historical owner-acceptance wording; no owner gate is introduced.',
  '',
  '## Replay',
  '',
  'From <repo>, run PowerShell with:',
  '',
  '    powershell.exe -NoProfile -ExecutionPolicy Bypass -File docs/qa/2026-10-22-wp-f2b-qa/round-3/replay.ps1',
  '',
  'The default invocation selects Node22, builds, runs served/collector/Edge/component/coverage stages, captures command metadata plus redacted logs, attempts guarded cleanup and generates this report. A stage can be selected with -Stage Build, Served, Collector, Edge, Components or Coverage. Edge itself exits 1 for the four known #205 failures; the result parser independently checks that exact baseline. When selecting individual stages, run cleanup.ps1 without -Remove to inventory, or with -Remove for guarded cleanup, then node report.mjs to refresh this report and audit. If automatic review blocks deletion, node report.mjs --cleanup-blocked records that limitation.',
  '',
  'No script depends on an earlier QA folder or an absolute checkout location. Paths derive from import.meta.url, PSScriptRoot or the current TEMP environment. All required scripts and results are linked in the artifact inventory below. The specialized Edge server supports only the model-picker control endpoints and has no live-provider route.',
  '',
  '## QA-204-01 and validation paths',
  '',
  'The original reproduction is repeated: cached valid Codex Astra/minimal, 2.1-second freshness wait, failed normal visibility-triggered refetch, then explicit Claude switch. The toolbar shows Validation unavailable and disables Publish. Both title tooltips are exactly:',
  '',
  '> A model catalog could not be loaded. Retry its lookup before publishing.',
  '',
  'Authored model/effort and the switch notice remain. The switch adds no catalog, Settings or preflight requests. Retry model catalog restores Ready to publish for the unchanged saved Codex draft, with the incompatible open form and its warning unchanged. The API reports publishable=false and rejects incompatible admission with 400 / MODEL_HARNESS_MISMATCH.',
  '',
  'Because API admission already prevents that invalid stored draft, the final-publication defense seeds the exact API-normalized rejected definition into only the owned disposable draft row, calls real POST /publish, and restores the row. It refuses 422 / LOOP_INVALID / MODEL_HARNESS_MISMATCH with no published version. This storage-fault fixture is disclosed separately from normal authoring.',
  '',
  'The server-check-only case blocks only POST /validate: the default server-check tooltip remains and Publish stays enabled. One POST /publish reruns real server validation and publishes version 1 while background /validate remains deliberately blocked. Cached classifier-catalog failure independently produces the catalog gate and recovers after unblock/reload.',
  '',
  '## Served checks',
  '',
  'All 26 cases passed in one invocation. Every row is indexed by ID in [served-checks.json](served-checks.json), including complete actual response bodies and counts. [served.log](served.log) preserves the run output.',
  '',
  '| Check | Steps | Expected | Actual | Verdict |',
  '| --- | --- | --- | --- | --- |',
);
for (const c of served.checks.filter((c) => c.id !== 'environment'))
  add('| ' + [c.id, c.steps, c.expected, details(c), c.verdict].map(cell).join(' | ') + ' |');
add(
  '',
  '## Collector checks',
  '',
  'GG_SWITCH_PORT=5880 and GG_SWITCH_EXPECT_FIXED=1. All 16 scenarios pass; 14 nonfailure cases save, publish, reopen and execute with exact native fake-CLI request matches. Each row has complete per-case steps/expected/actual in [collector-checks.json](collector-checks.json); output is [collector.log](collector.log). No observation-only pass is represented as publication evidence.',
  '',
  '| Direction / scenario | Steps | Expected | Actual | Verdict |',
  '| --- | --- | --- | --- | --- |',
);
for (const c of collector.checks)
  add(
    '| ' +
      [
        c.from + ' to ' + c.to + ' / ' + c.scenario,
        c.steps,
        c.expected,
        (c.model || '(inherited model)') +
          '/' +
          (c.effort || '(inherited effort)') +
          '; ' +
          (c.request ? 'CLI ' + compact(c.request) : c.notices.join(' ')),
        c.verdict,
      ]
        .map(cell)
        .join(' | ') +
      ' |',
  );
add(
  '',
  '## Edge model-picker',
  '',
  'Unchanged repository assertions; one worker, retries zero, msedge channel, served build. Expected exactly four known #205 failures. Actual ' +
    edge.stats.expected +
    ' passes and ' +
    edge.stats.unexpected +
    ' failures; baselineMatches=' +
    edge.baselineMatches +
    '. Full test errors, steps, expected, actual, durations and verdicts: [edge-results.json](edge-results.json). Full redacted JSON-reporter output: [edge.log](edge.log).',
  '',
  '| Line / case | Expected | Actual | Verdict |',
  '| --- | --- | --- | --- |',
);
for (const c of edge.checks)
  add(
    '| ' +
      [
        c.line + ' / ' + c.name,
        c.known205 ? 'Known #205 primary-field visibility failure' : 'Pass',
        c.verdict === 'PASS'
          ? 'All assertions passed'
          : c.line === 36
            ? 'Empty model selection instead of picker fixture'
            : c.line === 102
              ? 'Catalog Settings link hidden under collapsed Advanced'
              : 'Retry button hidden under collapsed Advanced; original timeout',
        c.verdict + (c.known205 ? ' (known #205)' : ''),
      ]
        .map(cell)
        .join(' | ') +
      ' |',
  );
add(
  '',
  'The cached-catalog regression at :418 passes. The four failures at :36 dark/light, :102 and :159 are retained as failures, not counted as passes for #204. Full claude-harness/readiness specs and API coverage were not requested again in this replay round.',
  '',
  '## Commands, components and coverage',
  '',
  'Expected: build and component tests pass; model-picker matches the known baseline; original web coverage thresholds remain above 90% lines/branches. Actual fresh web coverage: ' +
    coverage.testsPassed +
    ' tests / ' +
    coverage.filesPassed +
    ' files; lines ' +
    coverage.coverage.lines.pct +
    '% (' +
    coverage.coverage.lines.covered +
    '/' +
    coverage.coverage.lines.total +
    '), branches ' +
    coverage.coverage.branches.pct +
    '% (' +
    coverage.coverage.branches.covered +
    '/' +
    coverage.coverage.branches.total +
    '), statements ' +
    coverage.coverage.statements.pct +
    '%, functions ' +
    coverage.coverage.functions.pct +
    '%. One invocation, two workers, no threshold/exclusion/timeout change. Coverage results and full output are linked below.',
  '',
  '| Stage / steps | Expected | Actual | Verdict |',
  '| --- | --- | --- | --- |',
);
for (const g of gates)
  add(
    '| ' +
      [
        g.stage + ': ' + g.command,
        g.stage === 'Edge' ? 'Exactly four known #205 failures' : 'Exit 0',
        g.exitCode + '; ' + g.elapsedSeconds + ' seconds',
        g.stage === 'Edge'
          ? edge.baselineMatches
            ? 'PASS baseline; command exits 1'
            : 'FAIL'
          : g.exitCode === 0
            ? 'PASS'
            : 'FAIL',
      ]
        .map(cell)
        .join(' | ') +
      ' |',
  );
add(
  '',
  'Both harness-switch files passed 41 tests, unchanged. The served harness resets Settings to its stated fixture before each case to avoid ordering dependence. Output location and command metadata are separate, and path redaction is applied after capture; these are evidence-harness changes only. Full coverage is fresh replacement evidence, not recovered historical output. No API/full-repository gate is implied. The D-015 readiness boundary and previous load-class caveats remain historical context; this round records its own command results.',
  '',
  '## Defects and host limitations',
  '',
  '- QA-204-01, minor: CLOSED on this head by the cached-error UI/API checks.',
  '- Known #205 primary-field visibility, minor within this QA scope: OPEN outside #204; exactly the four known Edge failures.',
  '- No new product defect found in the performed checks. Fake-only execution does not qualify real provider authentication, turns, live model availability, OS/network enforcement or Linux/container behavior.',
  '- Unsigned local PS scripts require the per-process ExecutionPolicy argument shown above; no persistent policy change is made.',
  '',
  '## Cleanup',
  '',
  'Every store-owning process has recorded exit and a direct Get-Process absence check before deletion. Cleanup scope is only the recorded roots beneath TEMP with gg-qa-204-r3- prefix; previous rounds and owner data are excluded. See [cleanup-preflight.json](cleanup-preflight.json) and [cleanup.json](cleanup.json).',
  '',
  cleanup.status === 'BLOCKED_BY_AUTOMATIC_APPROVAL_REVIEW'
    ? 'Automatic approval review rejected native PowerShell recursive removal before execution with blocked by policy. No alternate deletion mechanism or elevated retry was attempted.'
    : 'Guarded native PowerShell cleanup results are recorded below.',
  '',
  '| Directory relative to TEMP | Kind | Removed |',
  '| --- | --- | --- |',
);
for (const d of cleanup.directories)
  add(
    '| ' +
      [d.directory, d.kind, d.removed === true ? 'yes' : 'no; retained'].map(cell).join(' | ') +
      ' |',
  );
add(
  '',
  'Small auxiliary TEMP scripts/raw logs are listed in the cleanup manifest when retained; no absolute local user paths or secrets are copied into this evidence folder.',
  '',
  '## Artifact inventory',
  '',
  'Every file to preserve has a Markdown link here. The manifest records hashes and the final audit checks link closure, HEAD, source/index state and local-path redaction. Historical initial/observation-only outputs cannot be recovered and are not fabricated as new artifacts.',
  '',
);
await writeFile(join(folder, 'README.md'), lines.join('\n') + '\n');
let names = await readdir(folder);
for (const name of ['artifact-manifest.json', 'final-audit.json'])
  if (!names.includes(name)) names.push(name);
names.sort();
await writeFile(
  join(folder, 'README.md'),
  lines.join('\n') + '\n' + names.map((n) => '- [' + n + '](' + n + ')').join('\n') + '\n',
);
const manifest = [];
for (const name of names)
  if (!['artifact-manifest.json', 'final-audit.json'].includes(name)) {
    const data = await readFile(join(folder, name));
    manifest.push({
      name,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
  }
await save('artifact-manifest.json', { head, artifacts: manifest });
const readme = await readFile(join(folder, 'README.md'), 'utf8');
const linked = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);
const unlinked = names.filter((n) => !linked.includes(n)),
  missing = linked.filter((n) => !names.includes(n));
const localPathMatches = [];
for (const name of names)
  if (!['artifact-manifest.json', 'final-audit.json'].includes(name)) {
    const text = await readFile(join(folder, name), 'utf8');
    if (/[\\/]+Users[\\/]+[^\\/\s]+/i.test(text)) localPathMatches.push(name);
  }
await save('final-audit.json', {
  head,
  pinnedHeadMatches: head === expectedHead,
  productMatchesPreviousHead: !productChanged,
  allStageHeadsMatch,
  firstLoadWithinSecond,
  trackedDiff: diff,
  indexDiff: index,
  status: git('status', '--short'),
  files: names.length,
  unlinkedArtifacts: unlinked,
  missingLinkedArtifacts: missing,
  localUserPathMatches: localPathMatches,
  productVerdict: passed ? 'PASS' : 'FAIL',
});
console.log(
  'Report: ' +
    (passed ? 'PASS' : 'FAIL') +
    '; files ' +
    names.length +
    '; unlinked ' +
    unlinked.length +
    '; missing links ' +
    missing.length +
    '; local paths ' +
    localPathMatches.length,
);
if (!passed || unlinked.length || missing.length || localPathMatches.length) process.exitCode = 1;
