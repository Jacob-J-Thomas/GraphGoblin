// Check 2, orchestrator case (a): filesystem aliases in the artifacts tree. Small stores (below
// the ADR-0060 artifact proof budget) so unaliased approved artifacts ARE reclaimed (control).
// Variants: the transcript kind directory replaced by a junction to an outside location holding
// the same files; the artifacts root replaced by a junction; a hard link to an approved
// artifact from outside; and the whole data directory reached through a junction.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { startServer, client, setCapacity, ADEQUATE, PRESSURE, workLoop, temp, join, Evidence, sleep } from './qa-lib.mjs';

const ev = new Evidence('16-artifact-alias');
const root = join(temp, 'gg-qa-e3r-art');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const PORT = 6582;
const sha = (text) => createHash('sha256').update(text).digest('hex');

function tree(dir) {
  const out = {};
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      const rel = p.slice(dir.length + 1).replaceAll('\\', '/');
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) out[rel] = 'link';
      else if (st.isDirectory()) {
        out[rel + '/'] = 'dir';
        walk(p);
      } else out[rel] = `${st.size}:${sha(fs.readFileSync(p)).slice(0, 16)}`;
    }
  };
  walk(dir);
  return out;
}
const diff = (a, b) => ({
  removed: Object.keys(a).filter((k) => !(k in b)),
  changed: Object.keys(a).filter((k) => k in b && a[k] !== b[k]),
  added: Object.keys(b).filter((k) => !(k in a)),
});

async function waitSettled(api, prev) {
  const deadline = Date.now() + 150_000;
  for (;;) {
    const s = await api.storage();
    if (s.checkedAt !== prev && !s.cleaning) return s;
    if (Date.now() > deadline) throw new Error('no pass observed');
    await sleep(250);
  }
}

/** Populate a store: approved runs owning unique transcripts, retained runs, and a shared transcript. */
async function populate(dir, name, dataDirArg) {
  fs.mkdirSync(dir, { recursive: true });
  const capacityFile = join(dir, 'capacity.json');
  setCapacity(capacityFile, ADEQUATE);
  const server = await startServer({ dataDir: dataDirArg, port: PORT, capacityFile, logFile: join(dir, 'server.log'), env: { QA_LOG_LEVEL: 'warn' } });
  const api = client(server.url);
  const W = await api.createLoop(workLoop(`${name} work`));
  const approved = [];
  const retained = [];
  for (let i = 0; i < 3; i++) approved.push((await api.startRun(W, { text: `${name} approved ${i}`, files: 1, bytes: 10 })).id);
  const sharedOwner = (await api.startRun(W, { text: `${name} shared`, files: 1, bytes: 10 })).id;
  for (const id of [...approved, sharedOwner]) await api.waitFinal(id);
  approved.push(sharedOwner);
  for (let i = 0; i < 3; i++) retained.push((await api.startRun(W, { text: `${name} retained ${i}`, files: 1, bytes: 10 })).id);
  retained.push((await api.startRun(W, { text: `${name} shared`, files: 1, bytes: 10 })).id);
  for (const id of retained) await api.waitFinal(id);
  const marked = await api.mark(approved);
  if (marked.status !== 200) throw new Error('mark ' + marked.text);
  const refs = {};
  for (const id of [...approved, ...retained]) {
    const th = (await api.get(`/runs/${id}/thread`)).json;
    const a = th.artifacts[0];
    const got = await api.get(`/runs/${id}/artifacts/${a.id}`);
    refs[id] = { artifact: a.id, ref: a.ref, file: a.ref.replace('artifact:transcript/', ''), sha: sha(got.text), status: got.status };
  }
  return { server, api, capacityFile, W, approved, retained, refs };
}

async function underPressure(dir, dataDirArg, capacityFile, passes = 2) {
  setCapacity(capacityFile, PRESSURE);
  const server = await startServer({ dataDir: dataDirArg, port: PORT, capacityFile, logFile: join(dir, 'server.log'), env: { QA_LOG_LEVEL: 'warn' } });
  const api = client(server.url);
  let s = await api.storage();
  for (let i = 0; s.cleaning && i < 600; i++) {
    await sleep(100);
    s = await api.storage();
  }
  const statuses = [{ startup: true, state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources }];
  for (let i = 0; i < passes; i++) {
    s = await waitSettled(api, s.checkedAt);
    statuses.push({ pass: i + 1, state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources });
  }
  return { server, api, statuses };
}

async function retainedReadable(api, store) {
  const out = [];
  for (const id of store.retained) {
    const r = store.refs[id];
    const got = await api.get(`/runs/${id}/artifacts/${r.artifact}`);
    out.push({ id, status: got.status, same: got.status === 200 && sha(got.text) === r.sha });
  }
  return out;
}

try {
  // ------------------------------------------------------------ control + hard link from outside
  {
    const dir = join(root, 'control');
    const dataDir = join(dir, 'data');
    fs.mkdirSync(join(dir, 'outside'), { recursive: true });
    const store = await populate(dir, 'control', dataDir);
    await store.server.stop();
    const hardTarget = store.refs[store.approved[2]].file;
    fs.linkSync(join(dataDir, 'artifacts', 'transcript', hardTarget), join(dir, 'outside', 'hard-copy'));
    const outsideBefore = tree(join(dir, 'outside'));
    const p = await underPressure(dir, dataDir, store.capacityFile);
    ev.log('control statuses', p.statuses);
    const files = store.approved.map((id) => [id, fs.existsSync(join(dataDir, 'artifacts', 'transcript', store.refs[id].file))]);
    ev.log('control: approved artifact files present after pressure', files);
    ev.check('control: unaliased, unshared approved artifacts are reclaimed in a small store', !files[0][1] && !files[1][1]);
    ev.check('control: approved artifact hard-linked from outside is kept; outside link untouched', files[2][1] && JSON.stringify(tree(join(dir, 'outside'))) === JSON.stringify(outsideBefore));
    ev.check('control: shared transcript (approved owner, retained user) kept', files[3][1]);
    const readable = await retainedReadable(p.api, store);
    ev.check('control: every retained artifact readable and identical', readable.every((r) => r.same), readable);
    await p.server.stop();
  }

  // ------------------------------------------------------------ kind directory replaced by a junction
  {
    const dir = join(root, 'kind');
    const dataDir = join(dir, 'data');
    const store = await populate(dir, 'kind', dataDir);
    await store.server.stop();
    const real = join(dir, 'outside-transcript');
    fs.renameSync(join(dataDir, 'artifacts', 'transcript'), real);
    fs.symlinkSync(real, join(dataDir, 'artifacts', 'transcript'), 'junction');
    fs.writeFileSync(join(real, 'unrelated.txt'), 'outside, unrelated');
    const before = tree(real);
    const p = await underPressure(dir, dataDir, store.capacityFile);
    ev.log('kind-junction statuses', p.statuses);
    const d = diff(before, tree(real));
    ev.check('kind junction: nothing in the outside location removed or changed', d.removed.length === 0 && d.changed.length === 0, d);
    ev.check('kind junction: approved runs deleted', (await Promise.all(store.approved.map(async (id) => (await p.api.get(`/runs/${id}`)).status))).every((st) => st === 404));
    const readable = await retainedReadable(p.api, store);
    ev.check('kind junction: every retained artifact readable and identical', readable.every((r) => r.same), readable);
    const fresh = (await p.api.startRun(store.W, { text: 'kind fresh after junction', files: 1, bytes: 1 })).id;
    const run = await p.api.waitFinal(fresh);
    ev.log('kind junction: a new run that publishes a transcript', { status: run.status, failure: run.failure ?? null });
    await p.server.stop();
  }

  // ------------------------------------------------------------ artifacts root replaced by a junction
  {
    const dir = join(root, 'rootj');
    const dataDir = join(dir, 'data');
    const store = await populate(dir, 'rootj', dataDir);
    await store.server.stop();
    const real = join(dir, 'outside-artifacts');
    fs.renameSync(join(dataDir, 'artifacts'), real);
    fs.symlinkSync(real, join(dataDir, 'artifacts'), 'junction');
    const before = tree(real);
    const p = await underPressure(dir, dataDir, store.capacityFile);
    ev.log('root-junction statuses', p.statuses);
    const d = diff(before, tree(real));
    ev.check('artifacts-root junction: nothing in the outside location removed or changed', d.removed.length === 0 && d.changed.length === 0, d);
    const readable = await retainedReadable(p.api, store);
    ev.check('artifacts-root junction: every retained artifact readable and identical', readable.every((r) => r.same), readable);
    const workspacesLeft = store.approved.filter((id) => fs.existsSync(join(dataDir, 'workspaces', id))).length;
    ev.log('artifacts-root junction: approved workspaces still on disk', workspacesLeft, 'of', store.approved.length);
    await p.server.stop();
  }

  // ------------------------------------------------------------ data directory reached through a junction
  {
    const dir = join(root, 'dataj');
    const real = join(dir, 'data-real');
    const link = join(dir, 'data-link');
    fs.mkdirSync(real, { recursive: true });
    fs.symlinkSync(real, link, 'junction');
    const capacityFile = join(dir, 'capacity.json');
    setCapacity(capacityFile, ADEQUATE);
    const server = await startServer({ dataDir: link, port: PORT, capacityFile, logFile: join(dir, 'server.log'), env: { QA_LOG_LEVEL: 'warn' } });
    const api = client(server.url);
    const W = await api.createLoop(workLoop('dataj work'));
    const id = (await api.startRun(W, { text: 'dataj run', files: 1, bytes: 10 })).id;
    const run = await api.waitFinal(id);
    ev.log('data directory through a junction: temp-workspace run with a transcript', { status: run.status, failure: run.failure ?? null });
    const plain = await api.createLoop({
      schemaVersion: 4,
      name: 'dataj trigger-exit',
      settings: { workingDirectory: { kind: 'temp' } },
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        { id: 'done', kind: 'exit', label: 'Done', config: { outcome: 'success' } },
      ],
      edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done', port: 'in' } }],
    });
    const id2 = (await api.startRun(plain, {})).id;
    ev.log('data directory through a junction: trigger-exit run (no workspace, no artifact)', (await api.waitFinal(id2)).status);
    ev.check('data directory through a junction: a run that uses a temp workspace and a transcript succeeds', run.status === 'succeeded', run.failure ?? null);
    await server.stop();
    const serverLog = fs.readFileSync(join(dir, 'server.log'), 'utf8');
    ev.log('server log lines mentioning a link', serverLog.split('\n').filter((l) => /link/i.test(l)).slice(0, 5));
  }
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  ev.log('failures', ev.failures ?? 0);
}
