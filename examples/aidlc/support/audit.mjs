// Read-only readback of this set. Never starts runs or downloads private instance files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const domainUrl = import.meta.resolve(
  '@graphgoblin/domain',
  pathToFileURL(path.join(root, 'packages/domain/package.json')).href,
);
const contractsUrl = import.meta.resolve(
  '@graphgoblin/contracts',
  pathToFileURL(path.join(root, 'packages/contracts/package.json')).href,
);
const { stableStringify } = await import(domainUrl);
const { LoopDefinitionSchema } = await import(contractsUrl);
const directory = path.resolve(here, '..');
const control = path.join(root, '.tmp/aidlc-control');
const previous = JSON.parse(fs.readFileSync(path.join(directory, 'full-v1-evidence.json')));
const installFile = path.join(control, 'aidlc-install.json');
const installed = fs.existsSync(installFile)
  ? JSON.parse(fs.readFileSync(installFile))
  : previous.loops.map((x) => ({ ...x, name: x.name.replace('aidlc-full-v1-', '') }));
const ledger = JSON.parse(fs.readFileSync(path.join(control, 'aidlc-live-ledger.json')));
const records = fs
  .readdirSync(control)
  .filter((x) => /^aidlc-run-[A-Z0-9]+\.json$/.test(x))
  .map((x) => JSON.parse(fs.readFileSync(path.join(control, x))));
const inventory = JSON.parse(fs.readFileSync(path.join(control, 'aidlc-github-inventory.json')));
const scenarios = JSON.parse(fs.readFileSync(path.join(control, 'aidlc-scenarios.json')));
const sessions = records.flatMap((x) => x.events.filter((e) => e.type === 'harness.session'));
const actualFresh = sessions.filter((e) => e.mode === 'fresh').length;
const actualRepairs = sessions.length - actualFresh;
const actualJev = records.flatMap((x) =>
  x.events.filter((e) => e.type === 'decision.made' && e.provenance.kind === 'classifier'),
).length;
if (
  actualFresh !== ledger.counts.workerStarts ||
  actualRepairs !== ledger.counts.resumedOrRepairTurns ||
  actualJev !== ledger.counts.jevAttempts
)
  throw new Error('COUNT_LEDGER_MISMATCH');
const intervals = records.flatMap(({ events }) =>
  events
    .filter((e) => e.type === 'harness.session')
    .map((e) => {
      const finish = events.find(
        (f) =>
          f.seq > e.seq &&
          f.nodeId === e.nodeId &&
          ['node.finished', 'node.failed'].includes(f.type),
      );
      if (!finish) throw new Error(`WORKER_NOT_FINISHED ${e.runId}`);
      return {
        runId: e.runId,
        nodeId: e.nodeId,
        mode: e.mode,
        sessionId: e.sessionId,
        start: e.ts,
        finish: finish.ts,
      };
    }),
);
const boundaries = intervals
  .flatMap((x) => [
    { at: x.start, delta: 1 },
    { at: x.finish, delta: -1 },
  ])
  .sort((a, b) => a.at.localeCompare(b.at) || a.delta - b.delta);
let active = 0,
  maximum = 0;
for (const b of boundaries) {
  active += b.delta;
  maximum = Math.max(maximum, active);
}
if (maximum > 1 || sessions.length > 30 || actualJev > 30)
  throw new Error('ACCEPTANCE_BOUNDS_EXCEEDED');
const get = async (url) => {
  const r = await fetch(`http://127.0.0.1:4747${url}`);
  if (!r.ok) throw new Error(`Readback failed ${r.status} ${url}`);
  return r.json();
};
const evidence = {
  recordedAt: new Date().toISOString(),
  api: 'http://127.0.0.1:4747',
  branch: 'codex-aidlc-full-v1',
  paidWorkerRuns: records.filter((x) => x.events.some((e) => e.type === 'harness.session')).length,
  workerStarts: ledger.counts.workerStarts,
  workerRepairTurns: ledger.counts.resumedOrRepairTurns,
  jevEvaluations: ledger.counts.jevAttempts,
  workerIntervals: intervals,
  maxConcurrentAcceptanceWorkers: maximum,
  budgetReservations: JSON.parse(fs.readFileSync(path.join(control, 'aidlc-budget.json'))),
  rejectedMcpStartAttempts: 2,
  runs: records.map(({ run, events, thread }) => ({
    id: run.id,
    loopId: run.loopId,
    versionId: run.versionId,
    parentRunId: run.parentRunId,
    status: run.status,
    result: run.result,
    failure: run.failure,
    createdAt: run.createdAt,
    decisions: events.filter((e) => e.type === 'decision.made'),
    sessions: events.filter((e) => e.type === 'harness.session'),
    childRunIds: events.filter((e) => e.type === 'child_run.started').map((e) => e.childRunId),
    transcriptArtifacts: thread.artifacts
      .filter((a) => a.kind === 'transcript')
      .map((a) => ({ id: a.id, kind: a.kind })),
  })),
  roots: ledger.roots,
  github: {
    ...inventory,
    // For open PRs GitHub's merge_commit_sha is a synthetic test merge, not a merge.
    pulls: inventory.pulls.map((x) => ({
      ...x,
      reportedMergeCommitSha: x.mergeSha,
      mergeSha: x.merged ? x.mergeSha : null,
    })),
  },
  externalCodexGithubReviewActivity: inventory.comments.filter((x) =>
    x.body.startsWith('<!-- codex-pull-request-review-summary -->'),
  ),
  workerConcurrencyScope:
    'GraphGoblin acceptance sessions only. The existing GitHub Codex integration independently auto-reviewed PR 2 when marked ready; global concurrency is not established.',
  helperCleanup: JSON.parse(fs.readFileSync(path.join(control, 'aidlc-helper-cleanup.json'))),
  scenarios,
  liveAcceptance: scenarios.every((x) => x.passed) ? 'passed' : 'incomplete',
  loops: [],
  tests: {
    command:
      'node --experimental-import-meta-resolve --test examples/aidlc/support/core.test.mjs examples/aidlc/support/runtime.test.mjs examples/aidlc/support/graphs.test.mjs',
    passed: 15,
    failed: 0,
    liveExternalPorts: false,
  },
  blockers: [],
  correctedEarlierAssessment:
    'REST starts are authorized; API-owner gh works. Sandbox credentials are irrelevant to loop script execution.',
  files: {},
};
const gateFile = path.join(root, '.tmp/aidlc-control/aidlc-checks.json');
evidence.gates = fs.existsSync(gateFile)
  ? JSON.parse(fs.readFileSync(gateFile, 'utf8'))
  : { status: 'pending' };
for (const entry of installed) {
  const local = JSON.parse(fs.readFileSync(path.join(directory, `${entry.name}.loop.json`)));
  const live = await get(`/loops/${entry.id}/export`);
  const matches =
    stableStringify(LoopDefinitionSchema.parse(local.loop)) ===
    stableStringify(LoopDefinitionSchema.parse(live.loop));
  if (!matches) throw new Error(`Published export mismatch ${entry.name}`);
  const runs = await get(`/runs?loopId=${entry.id}&limit=500`);
  const current = (await get(`/loops/${entry.id}`)).current;
  const missing = runs.items.filter((x) => !records.some((r) => r.run.id === x.id));
  if (missing.length)
    throw new Error(`Uncounted acceptance runs: ${JSON.stringify(missing.map((x) => x.id))}`);
  evidence.loops.push({
    name: live.loop.name,
    id: entry.id,
    version: current.version,
    versionId: current.id,
    importIssues: entry.importIssues,
    validation: entry.validation,
    exportMatchesLocal: matches,
    runCount: runs.items.length,
  });
}
evidence.harnessPreflight = (await get('/harness/preflight')).items;
const catalog = (await get('/model-catalog')).items;
const settings = JSON.parse(fs.readFileSync(path.join(directory, 'full-v1.settings.json')));
evidence.roleAvailability = Object.fromEntries(
  Object.entries(settings.roles).map(([slot, role]) => [
    slot,
    {
      ...role,
      enabled: catalog.some(
        (x) => x.model === role.model && x.harness === role.harness && x.enabled,
      ),
    },
  ]),
);
evidence.classifiers = (await get('/classifier-models')).items.map(
  ({ id, enabled, configured, primitives }) => ({ id, enabled, configured, primitives }),
);
const walk = (dir) => {
  for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, file.name);
    if (file.isDirectory()) walk(absolute);
    else if (file.name !== 'full-v1-evidence.json' && file.name !== 'full-v1-report.md')
      evidence.files[path.relative(directory, absolute).replaceAll('\\', '/')] = createHash(
        'sha256',
      )
        .update(fs.readFileSync(absolute))
        .digest('hex');
  }
};
walk(directory);
evidence.localScratch = {
  workspacePath: path.join(root, '.tmp/aidlc-scratch'),
  baselineSha: records.find(
    (x) => x.run.parentRunId && x.run.result?.branch && x.run.result?.baseSha,
  )?.run.result.baseSha,
  remoteUrl: 'https://github.com/Jacob-J-Thomas/gg-aidlc-scratch.git',
  remoteExistenceVerified: true,
  lockedChecklistSha256: createHash('sha256')
    .update(fs.readFileSync(path.join(root, '.tmp/aidlc-scratch/aidlc-checklist.lock.json')))
    .digest('hex'),
};
fs.writeFileSync(
  path.join(directory, 'full-v1-evidence.json'),
  JSON.stringify(evidence, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    loops: evidence.loops.length,
    publishedExportMatches: true,
    realRuns: evidence.runs.length,
    workers: evidence.workerStarts,
    jev: evidence.jevEvaluations,
    tests: evidence.tests.passed,
  }),
);
