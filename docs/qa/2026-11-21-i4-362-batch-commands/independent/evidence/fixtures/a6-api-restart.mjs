// #362 independent QA, tier A6: restart the built API over the SAME disposable store used by
// a-api.mjs and confirm recovery does not re-dispatch recorded proven refusals.
// Usage: node a6-api-restart.mjs <repoRoot> <qaRoot> <aWorkDir> <aJson> <outJson> <serverLog>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const [repoArg, qaRootArg, aWorkArg, aJsonArg, outArg, logArg] = process.argv.slice(2);
if (!repoArg || !qaRootArg || !aWorkArg || !aJsonArg || !outArg || !logArg) throw new Error('usage');
const repo = path.resolve(repoArg);
const qaRoot = path.resolve(qaRootArg);
const aWork = path.resolve(aWorkArg);
const inside = (p) => {
  const rel = path.relative(qaRoot, path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
for (const p of [aWork, aJsonArg, outArg, logArg]) if (!inside(p)) throw new Error(`refusing path outside ${qaRoot}: ${p}`);
const prior = JSON.parse(fs.readFileSync(aJsonArg, 'utf8'));
const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const home = path.join(aWork, 'home');

async function randomLoopbackPort() {
  for (;;) {
    const server = createServer();
    const port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    await new Promise((resolve) => server.close(resolve));
    if (port !== 4747 && port !== 4748 && port !== prior.meta.port) return port;
  }
}
async function portFree(port) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    await new Promise((resolve) => server.close(resolve));
    return true;
  } catch (error) {
    return error.code;
  }
}

const port = await randomLoopbackPort();
const origin = `http://127.0.0.1:${port}`;
const env = {
  PATH: `${path.dirname(process.execPath)};${system32};${path.dirname(system32)}`,
  SystemRoot: process.env.SystemRoot,
  windir: process.env.windir,
  ComSpec: path.join(system32, 'cmd.exe'),
  PATHEXT: process.env.PATHEXT,
  TEMP: path.join(aWork, 'temp'),
  TMP: path.join(aWork, 'temp'),
  USERPROFILE: home,
  HOME: home,
  APPDATA: path.join(home, 'AppData', 'Roaming'),
  LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
  GG_DATA_DIR: path.join(aWork, 'data'),
  GG_HOST: '127.0.0.1',
  GG_PORT: String(port),
  GG_REQUIRE_API_KEY: 'false',
  GG_SWAGGER_UI: 'false',
  GG_OLLAMA_ENABLED: 'false',
  GG_WEB_DIST: '',
  GG_GOBLIN_DIST: '',
  GG_LOG_LEVEL: 'info',
  GG_TIMER_POLL_MS: '200',
  GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const log = fs.createWriteStream(logArg);
const t0 = Date.now();
const child = spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
const childExit = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal, atMs: Date.now() - t0 })));
const meta = { tier: 'A6-built-api-restart-same-store', apiPid: child.pid, port, dataDir: env.GG_DATA_DIR, startedAt: new Date().toISOString() };
const get = async (url) => {
  const r = await fetch(`${origin}${url}`);
  return { status: r.status, json: await r.json() };
};
const results = [];
try {
  const ready = Date.now() + 60_000;
  let ok = false;
  while (Date.now() < ready) {
    if (child.exitCode !== null) throw new Error('API exited early');
    const h = await fetch(`${origin}/healthz`).catch(() => undefined);
    if (h?.ok) { ok = true; break; }
    await sleep(100);
  }
  if (!ok) throw new Error('API not ready');
  meta.readyMs = Date.now() - t0;
  await sleep(5000); // allow startup recovery and timer polling to act if they were going to
  const runIds = [];
  for (const r of prior.results) {
    runIds.push([r.name, r.runId]);
    if (r.replay?.runId) runIds.push([`${r.name}-replay`, r.replay.runId]);
  }
  for (const [name, id] of runIds) {
    const snap = await get(`/runs/${id}`);
    const evs = (await get(`/runs/${id}/events?after=0&limit=1000`)).json.items;
    const before = prior.transcript.filter((t) => t.method === 'GET' && t.url === `/runs/${id}` && t.status === 200).at(-1)?.response;
    results.push({
      name,
      runId: id,
      before: before ? { status: before.status, lastEventSeq: before.lastEventSeq, failureCode: before.failure?.code ?? null, dispatchId: before.failure?.script?.dispatchId ?? null } : null,
      after: { httpStatus: snap.status, status: snap.json.status, lastEventSeq: snap.json.lastEventSeq, failureCode: snap.json.failure?.code ?? null, dispatchId: snap.json.failure?.script?.dispatchId ?? null, resume: snap.json.recovery.resume, scriptConsent: snap.json.recovery.scriptConsent ?? null },
      dispatchCount: evs.filter((e) => e.type === 'script.dispatched').length,
      runFailedCount: evs.filter((e) => e.type === 'run.failed').length,
      lastEventType: evs.at(-1)?.type,
    });
  }
  meta.markers = Object.fromEntries(
    ['a1-cmd', 'a2-bat', 'a3-missing-then-repaired', 'a4-node-marker', 'a5-cmdexe-explicit-shell'].map((c) => {
      const m = path.join(aWork, c, 'marker.txt');
      return [c, fs.existsSync(m) ? fs.readFileSync(m, 'utf8') : null];
    }),
  );
} finally {
  meta.shutdownRequest = await fetch(`${origin}/system/shutdown`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'drain' }) })
    .then(async (r) => ({ status: r.status, phase: (await r.json()).phase }))
    .catch((error) => ({ status: 'error', text: String(error) }));
  let timer;
  const exited = await Promise.race([childExit, new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), 60_000); })]);
  clearTimeout(timer);
  if (!exited) {
    meta.forcedKillOfExactPid = child.pid;
    child.kill();
    meta.exit = await childExit;
  } else meta.exit = exited;
  await sleep(500);
  meta.portFreeAfterExit = await portFree(port);
  meta.finishedAt = new Date().toISOString();
  await new Promise((resolve) => log.end(resolve));
  fs.writeFileSync(outArg, `${JSON.stringify({ meta, results }, null, 2)}\n`);
}
for (const r of results) console.log(JSON.stringify(r));
console.log(JSON.stringify(meta));
