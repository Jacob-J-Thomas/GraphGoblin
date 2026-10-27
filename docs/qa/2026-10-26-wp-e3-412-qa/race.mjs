// Concurrency: replay, withdrawal and resume requests racing a timer cleanup pass on approved
// runs. Each run must end either deleted (and nothing references it) or retained (and no longer
// approved); no fork may point at a deleted source; a 200 withdrawal must leave the run present.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { startServer, client, setCapacity, ADEQUATE, PRESSURE, workLoop, temp, join, here, Evidence, sleep } from './qa-lib.mjs';

const ev = new Evidence('10-race');
const base = join(temp, 'gg-qa-e3-race');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
const dataDir = join(base, 'data');
setCapacity(capacityFile, ADEQUATE);
const server = await startServer({ dataDir, port: 6482, capacityFile, logFile: join(base, 'server.log'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
try {
  const W = await api.createLoop(workLoop('Race work'));
  const replayTargets = [];
  const withdrawTargets = [];
  for (let i = 0; i < 20; i++) {
    replayTargets.push((await api.startRun(W, { text: `race replay ${i} [[items=1500]]`, files: 20, bytes: 100 })).id);
    withdrawTargets.push((await api.startRun(W, { text: `race withdraw ${i} [[items=1500]]`, files: 20, bytes: 100 })).id);
  }
  for (const id of [...replayTargets, ...withdrawTargets]) await api.waitFinal(id, 300_000);
  ev.check('mark 40 racing runs', (await api.mark([...replayTargets, ...withdrawTargets])).status === 200);
  // Next timer tick: 60 s after the latest pass marker.
  const lastPass = server.passTimes.at(-1);
  const nextTick = lastPass + 60_000 * Math.ceil((Date.now() - lastPass + 1500) / 60_000);
  setCapacity(capacityFile, PRESSURE);
  const waitMs = nextTick - Date.now() - 400;
  ev.log(`firing requests from ${waitMs} ms from now, around the timer pass`);
  await sleep(Math.max(0, waitMs));
  const results = { replay: [], withdraw: [] };
  const deadline = Date.now() + 4000;
  const replayLoop = async (id) => {
    while (Date.now() < deadline) {
      const r = await api.post(`/runs/${id}/replay`, { nodeId: 'files' });
      results.replay.push({ id, status: r.status, code: r.json?.code, detail: r.json?.detail, fork: r.json?.run?.id });
      if (r.status === 202 || r.status === 404) return;
      await sleep(20);
    }
  };
  const withdrawLoop = async (id) => {
    while (Date.now() < deadline) {
      const p = await api.preview([id]);
      const r = p.status === 200 ? await api.confirm([id], p.json.token, 'withdraw') : p;
      results.withdraw.push({ id, status: r.status, code: r.json?.code });
      if (r.status === 200) return;
      if (r.status === 409 && r.json?.code === 'DELETION_SELECTION_MISSING') return;
      await sleep(20);
    }
  };
  await Promise.all([...replayTargets.map(replayLoop), ...withdrawTargets.map(withdrawLoop)]);
  ev.log('pass markers', server.passTimes.slice(-2).map((t) => new Date(t).toISOString()));
  let s = await api.storage();
  for (let i = 0; i < 30 && s.cleaning; i++) {
    await sleep(500);
    s = await api.storage();
  }
  ev.log('storage after racing pass', s);
  const summary = { replayWon: 0, cleanupWonReplay: 0, withdrawWon: 0, cleanupWonWithdraw: 0, other: [] };
  for (const id of replayTargets) {
    const last = results.replay.filter((r) => r.id === id).at(-1);
    const present = (await api.get(`/runs/${id}`)).status === 200;
    if (last?.status === 202) {
      const fork = await api.run(last.fork);
      const ok = present && !(await api.run(id)).deletionApproval && fork.id;
      ok ? summary.replayWon++ : summary.other.push({ id, last, present });
    } else if (!present && (last?.status === 404 || last?.status === 409)) {
      // Refused (404, or 409 when the source vanished mid-admission) and removed by cleanup.
      summary.cleanupWonReplay++;
      summary.refusals = [...(summary.refusals ?? []), `${last.status} ${last.code}: ${last.detail}`];
    }
    else summary.other.push({ id, last, present });
  }
  for (const id of withdrawTargets) {
    const last = results.withdraw.filter((r) => r.id === id).at(-1);
    const present = (await api.get(`/runs/${id}`)).status === 200;
    if (last?.status === 200) present && !(await api.run(id)).deletionApproval ? summary.withdrawWon++ : summary.other.push({ id, last, present });
    else if (!present) summary.cleanupWonWithdraw++;
    else summary.other.push({ id, last, present });
  }
  ev.log('race outcomes', summary);
  ev.check('every racing run ended in exactly one consistent outcome', summary.other.length === 0, summary.other);
  await server.stop();
  const db = JSON.parse(execFileSync('python', ['-I', join(here, 'inspect-db.py'), dataDir], { encoding: 'utf8' }));
  ev.check('no fork references a deleted replay source; no orphan rows; integrity ok', db.danglingReplaySources === 0 && db.orphanEvents === 0 && db.integrity === 'ok', { ...db, pendingQuarantineNames: db.pendingQuarantineNames.length });
  ev.log('request status counts', {
    replay: results.replay.reduce((a, r) => ({ ...a, [`${r.status} ${r.code ?? ''}`.trim()]: (a[`${r.status} ${r.code ?? ''}`.trim()] ?? 0) + 1 }), {}),
    withdraw: results.withdraw.reduce((a, r) => ({ ...a, [`${r.status} ${r.code ?? ''}`.trim()]: (a[`${r.status} ${r.code ?? ''}`.trim()] ?? 0) + 1 }), {}),
  });
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  await server.kill().catch(() => undefined);
} finally {
  ev.log('failures', ev.failures ?? 0);
}
