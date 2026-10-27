// D1 re-check across both cursors: more approved roots than one pass takes (20), more owned
// resources than one pass inventories (32), three shared resources that must stay kept, and a
// late approval of an OLDER run after the root cursor has moved. After every timer pass the
// status must not claim "no-eligible" while approved history or removable owned files remain,
// and the kept count must not alternate between passes.
import fs from 'node:fs';
import { startServer, client, setCapacity, ADEQUATE, PRESSURE, workLoop, temp, join, Evidence, sleep } from './qa-lib.mjs';

const ev = new Evidence('03-d1-cursors');
const base = join(temp, 'gg-qa-412f-a-d1c');
// Fixture is unique. Leave all directories for the orchestrator.
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
const dataDir = join(base, 'data');
setCapacity(capacityFile, ADEQUATE);
const server = await startServer({ dataDir, port: 6624, capacityFile, logFile: join(base, 'server.log.txt'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
const nextPass = async (prev) => {
  const deadline = Date.now() + 150_000;
  for (;;) {
    const s = await api.storage();
    if (s.checkedAt !== prev && !s.cleaning) return s;
    if (Date.now() > deadline) throw new Error('no pass observed');
    await sleep(250);
  }
};
const quarantine = () => (fs.existsSync(join(dataDir, 'cleanup-pending')) ? fs.readdirSync(join(dataDir, 'cleanup-pending')) : []);
try {
  const W = await api.createLoop(workLoop('D1 cursors'));
  // Retained runs first, so the oldest IDs are retained (one of them is approved late).
  const retained = [];
  for (let i = 0; i < 6; i++) retained.push((await api.startRun(W, { text: `retained ${i}`, files: 2, bytes: 100 })).id);
  for (const id of retained) await api.waitFinal(id);
  // Approved runs that own a transcript a retained run later reuses: those artifacts stay kept.
  const shared = [];
  for (let i = 0; i < 3; i++) {
    const owner = (await api.startRun(W, { text: `shared ${i}`, files: 1, bytes: 10 })).id;
    await api.waitFinal(owner);
    shared.push(owner);
    const user = (await api.startRun(W, { text: `shared ${i}`, files: 1, bytes: 10 })).id;
    await api.waitFinal(user);
    retained.push(user);
  }
  const approved = [...shared];
  for (let i = 0; i < 38; i++) approved.push((await api.startRun(W, { text: `approved ${i}`, files: 2, bytes: 100 })).id);
  for (const id of approved) await api.waitFinal(id, 120_000);
  const marked = await api.mark(approved);
  ev.check(`${approved.length} approved roots (more than one 20-root pass), ${retained.length} retained`, marked.status === 200, marked.status);
  const late = [...retained].sort()[0];
  ev.log('late-approval candidate (oldest retained run)', late);
  let s = await api.storage();
  setCapacity(capacityFile, PRESSURE);
  const seen = [];
  let lateApproved = false;
  let noEligibleStreak = 0;
  for (let pass = 1; pass <= 14 && noEligibleStreak < 2; pass++) {
    s = await nextPass(s.checkedAt);
    const presentApproved = [];
    for (const id of [...approved, ...(lateApproved ? [late] : [])]) if ((await api.get(`/runs/${id}`)).status === 200) presentApproved.push(id);
    const removableDirs = [...approved, late].filter((id) => !(id === late && !lateApproved)).filter((id) => fs.existsSync(join(dataDir, 'workspaces', id)));
    const q = quarantine();
    const row = { pass, state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources, approvedPresent: presentApproved.length, approvedWorkspacesOnDisk: removableDirs.length, quarantine: q.length };
    seen.push(row);
    ev.log('after pass', row);
    ev.check(`pass ${pass}: no "no-eligible" while approved history or approved owned workspaces remain`, !(s.state === 'no-eligible' && (presentApproved.length > 0 || removableDirs.length > 0 || q.length > 0)), row);
    if (pass === 1) {
      const r = await api.mark([late]);
      lateApproved = r.status === 200;
      ev.check('late approval of the oldest retained run after pass 1 (behind the root cursor)', lateApproved, r.status);
    }
    noEligibleStreak = s.state === 'no-eligible' ? noEligibleStreak + 1 : 0;
  }
  const lateStatus = (await api.get(`/runs/${late}`)).status;
  ev.check('late-approved older run deleted', lateStatus === 404, lateStatus);
  for (const id of approved) if ((await api.get(`/runs/${id}`)).status !== 404) ev.check(`approved ${id} deleted`, false);
  ev.check('every approved run deleted', true);
  const kept = retained.filter((id) => id !== late);
  let keptOk = 0;
  for (const id of kept) if ((await api.get(`/runs/${id}`)).status === 200 && fs.existsSync(join(dataDir, 'workspaces', id))) keptOk++;
  ev.check('every retained run and its workspace kept', keptOk === kept.length, { keptOk, kept: kept.length });
  ev.check('approved, unshared workspaces all reclaimed', [...approved, late].every((id) => !fs.existsSync(join(dataDir, 'workspaces', id))));
  const finals = seen.filter((r) => r.state === 'no-eligible');
  ev.check('kept count stable once nothing is removable (no alternation)', new Set(finals.map((r) => r.preserved)).size <= 1, finals.map((r) => r.preserved));
  ev.check('final kept count is the three shared transcripts', finals.at(-1)?.preserved === 3, finals.at(-1));
  ev.log('sum of removedFileBytes over passes', seen.reduce((a, r) => a + r.removedFileBytes, 0));
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  ev.log('server stop', await server.stop());
  ev.log('failures', ev.failures ?? 0);
}
