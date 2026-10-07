// Authorized REST starts/observation. Never invokes gh or edits the API-owned scratch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../../../.tmp/aidlc-control');
const round = process.env.AIDLC_ROUND;
if (round && !/^[a-z0-9-]+$/.test(round)) throw new Error('ROUND_INVALID');
const ledgerFile = path.join(
  dir,
  round ? `aidlc-live-ledger-${round}.json` : 'aidlc-live-ledger.json',
);
const limits = ['safety', 'hardened-acceptance'].includes(round)
  ? { workers: 12, jev: 10 }
  : { workers: 30, jev: 30 };
const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile)) : { roots: [] };
async function api(route, method = 'GET', body) {
  const r = await fetch(`http://127.0.0.1:4747${route}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(`${method} ${route}: ${JSON.stringify(value)}`);
  return value;
}
async function tree(id, records = []) {
  const run = await api(`/runs/${id}`);
  let events = [],
    after = 0;
  for (let n = 0; n < 100; n++) {
    const page = await api(`/runs/${id}/events?after=${after}&limit=1000`);
    events.push(...page.items);
    if (page.items.length < 1000) break;
    after = page.nextAfter;
  }
  const thread = await api(`/runs/${id}/thread`);
  records.push({ run, events, thread });
  for (const e of events.filter((e) => e.type === 'child_run.started'))
    await tree(e.childRunId, records);
  return records;
}
if (process.argv[2] === 'register') {
  const id = process.argv[3];
  if (!ledger.roots.some((x) => x.id === id))
    ledger.roots.push({ id, scenario: process.argv[4], registeredAt: new Date().toISOString() });
  fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
}
let records = [];
for (const root of ledger.roots) records.push(...(await tree(root.id)));
records = [...new Map(records.map((x) => [x.run.id, x])).values()];
let workers = 0,
  repairs = 0,
  jev = 0;
for (const item of records) {
  workers += item.events.filter((e) => e.type === 'harness.session' && e.mode === 'fresh').length;
  repairs += item.events.filter((e) => e.type === 'harness.session' && e.mode !== 'fresh').length;
  // Published versions are immutable. Retain helper versions before deleting its loop.
  const versionFile = path.join(dir, `aidlc-version-${item.run.versionId}.json`);
  const version = fs.existsSync(versionFile)
    ? JSON.parse(fs.readFileSync(versionFile))
    : await api(`/loops/${item.run.loopId}/versions/${item.run.versionId}`);
  if (process.argv[2] === 'collect')
    fs.writeFileSync(versionFile, JSON.stringify(version, null, 2));
  const choiceNodes = new Set(
    version.definition.nodes
      .filter((n) => n.kind === 'decision' && n.config.strategy.includes('jev'))
      .map((n) => n.id),
  );
  jev += item.events.filter((e) => e.type === 'node.started' && choiceNodes.has(e.nodeId)).length;
}
ledger.counts = { workerStarts: workers, resumedOrRepairTurns: repairs, jevAttempts: jev };
ledger.updatedAt = new Date().toISOString();
fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
if (process.argv[2] === 'start') {
  if (
    records.some((x) => !['succeeded', 'failed', 'cancelled', 'exhausted'].includes(x.run.status))
  )
    throw new Error('Previous acceptance run is active');
  if (workers + repairs + 2 > limits.workers || jev + 1 > limits.jev)
    throw new Error('Acceptance budget exhausted');
  const input = JSON.parse(fs.readFileSync(process.argv[4]));
  const loops = (await api('/loops')).items;
  const matches = loops.filter((x) => x.name === process.argv[3]);
  if (matches.length !== 1) throw new Error('Loop missing or ambiguous');
  const started = await api(`/loops/${matches[0].id}/runs`, 'POST', {
    triggerNodeId: 'start',
    input,
  });
  ledger.roots.push({
    id: started.run.id,
    scenario: process.argv[5],
    registeredAt: new Date().toISOString(),
  });
  fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
  console.log(JSON.stringify(started));
} else {
  if (process.argv[2] === 'collect') {
    for (const item of records) {
      fs.writeFileSync(
        path.join(dir, `aidlc-run-${item.run.id}.json`),
        JSON.stringify(item, null, 2),
      );
      for (const artifact of item.thread.artifacts.filter((a) => a.kind === 'transcript')) {
        const r = await fetch(`http://127.0.0.1:4747/runs/${item.run.id}/artifacts/${artifact.id}`);
        if (!r.ok) throw new Error('Transcript download failed');
        fs.writeFileSync(
          path.join(dir, `aidlc-transcript-${item.run.id}-${artifact.id}.json`),
          await r.text(),
        );
      }
    }
  }
  console.log(
    JSON.stringify({
      counts: ledger.counts,
      runs: records.map(({ run, events }) => ({
        id: run.id,
        parent: run.parentRunId,
        status: run.status,
        node: run.currentNodeId,
        failure: run.failure,
        result: run.result
          ? {
              status: run.result.status ?? run.result.verdict ?? run.result.qa?.verdict,
              headSha: run.result.headSha ?? run.result.reviewedHeadSha ?? run.result.executionSha,
              mergeSha: run.result.mergeSha,
              prUrl: run.result.prUrl,
              issueUrl: run.result.issueUrl,
              summary: run.result.summary,
            }
          : undefined,
        lastProgress: events
          .filter((e) => ['node.progress', 'decision.made', 'harness.session'].includes(e.type))
          .slice(-2),
      })),
    }),
  );
}
