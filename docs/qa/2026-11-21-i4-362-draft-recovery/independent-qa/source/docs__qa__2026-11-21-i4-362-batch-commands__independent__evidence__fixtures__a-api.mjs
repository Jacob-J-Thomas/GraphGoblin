// #362 independent QA, tier A: built API (apps/api/dist/main.js) over HTTP, real SQLite in a
// disposable data dir, random loopback port, minimal env (no owner secrets, Ollama disabled,
// no inference nodes so no provider/harness is invoked).
// Usage: node a-api.mjs <repoRoot> <qaRoot> <workDir> <outJson> <serverLog>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const [repoArg, qaRootArg, workArg, outArg, logArg] = process.argv.slice(2);
if (!repoArg || !qaRootArg || !workArg || !outArg || !logArg) throw new Error('usage: <repo> <qaRoot> <work> <out> <serverLog>');
const repo = path.resolve(repoArg);
const qaRoot = path.resolve(qaRootArg);
const work = path.resolve(workArg);
const inside = (p) => {
  const rel = path.relative(qaRoot, path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
for (const p of [work, outArg, logArg]) if (!inside(p)) throw new Error(`refusing path outside ${qaRoot}: ${p}`);
if (fs.existsSync(work)) throw new Error(`work dir already exists: ${work}`);
fs.mkdirSync(work, { recursive: true });

const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const cmdExe = path.join(system32, 'cmd.exe');
const dataDir = path.join(work, 'data');
const home = path.join(work, 'home');
const temp = path.join(work, 'temp');
for (const d of [dataDir, home, temp, path.join(home, 'AppData', 'Roaming'), path.join(home, 'AppData', 'Local')]) fs.mkdirSync(d, { recursive: true });

async function randomLoopbackPort() {
  for (let i = 0; i < 20; i++) {
    const server = createServer();
    const port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    await new Promise((resolve) => server.close(resolve));
    if (port !== 4747 && port !== 4748) return port;
  }
  throw new Error('no port');
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
  ComSpec: cmdExe,
  PATHEXT: process.env.PATHEXT,
  TEMP: temp,
  TMP: temp,
  USERPROFILE: home,
  HOME: home,
  APPDATA: path.join(home, 'AppData', 'Roaming'),
  LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
  GG_DATA_DIR: dataDir,
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
const meta = { tier: 'A-built-api-http', node: process.version, apiPid: child.pid, port, origin, dataDir, startedAt: new Date().toISOString(), envKeys: Object.keys(env).sort() };

async function http(method, url, body) {
  const response = await fetch(`${origin}${url}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: response.status, json, ...(json === undefined ? { text } : {}) };
}
const transcript = [];
async function call(method, url, body) {
  const r = await http(method, url, body);
  transcript.push({ at: new Date().toISOString(), method, url, ...(body !== undefined ? { body } : {}), status: r.status, response: r.json ?? r.text });
  return r;
}

const ready = Date.now() + 60_000;
let health;
while (Date.now() < ready) {
  if (child.exitCode !== null) throw new Error(`API exited early ${child.exitCode}`);
  health = await fetch(`${origin}/healthz`).catch(() => undefined);
  if (health?.ok) break;
  await sleep(100);
}
if (!health?.ok) throw new Error('API not ready');
meta.readyMs = Date.now() - t0;
meta.healthz = { status: health.status, instance: health.headers.get('x-graphgoblin-instance') };
meta.version = (await call('GET', '/version')).json;

const TERMINAL = new Set(['failed', 'succeeded', 'exhausted', 'cancelled']);
async function settle(runId, afterSeq = 0) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const r = await http('GET', `/runs/${runId}`);
    if (r.status === 200 && TERMINAL.has(r.json.status) && r.json.lastEventSeq > afterSeq) {
      transcript.push({ at: new Date().toISOString(), method: 'GET', url: `/runs/${runId}`, status: r.status, response: r.json });
      return r.json;
    }
    if (Date.now() > deadline) throw new Error(`run ${runId} did not settle: ${JSON.stringify(r.json)}`);
    await sleep(100);
  }
}
async function events(runId) {
  return (await call('GET', `/runs/${runId}/events?after=0&limit=1000`)).json.items;
}
function caseDir(name) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir);
  return dir;
}
function batch(dir, file, marker) {
  const full = path.join(dir, file);
  fs.writeFileSync(full, `@echo effect>"${marker}"\r\n@exit /b 0\r\n`);
  return full;
}
const nodeMarkerArgs = (marker) => ['-e', 'require("node:fs").appendFileSync(process.argv[1], "effect\\r\\n")', marker];
function definition(name, config) {
  return {
    schemaVersion: 4,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'script', kind: 'script', label: 'Script under test', config },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'script' } },
      { id: 'e2', from: { node: 'script', port: 'out' }, to: { node: 'done' } },
    ],
  };
}
function summarize(snapshot, evs, marker) {
  const markerExists = fs.existsSync(marker);
  return {
    status: snapshot.status,
    failure: snapshot.failure ?? null,
    recoveryResume: snapshot.recovery.resume,
    scriptConsent: snapshot.recovery.scriptConsent ?? null,
    replayScript: snapshot.recovery.replay.find((n) => n.nodeId === 'script')?.action ?? null,
    observedSeq: snapshot.recovery.observedSeq,
    lastEventSeq: snapshot.lastEventSeq,
    eventTypes: evs.map((e) => `${e.seq}:${e.type}${e.nodeId ? `(${e.nodeId})` : ''}`),
    dispatches: evs.filter((e) => e.type === 'script.dispatched').map((e) => ({ seq: e.seq, visitId: e.visitId, dispatchId: e.dispatchId })),
    scriptProgress: evs.filter((e) => e.type === 'node.progress' && e.nodeId === 'script'),
    scriptFinished: evs.filter((e) => e.type === 'node.finished' && e.nodeId === 'script').length,
    runFailed: evs.filter((e) => e.type === 'run.failed').map((e) => ({ seq: e.seq, failure: e.failure })),
    markerExists,
    markerContent: markerExists ? fs.readFileSync(marker, 'utf8') : null,
  };
}
async function createPublishRun(name, config) {
  const created = await call('POST', '/loops', { definition: definition(name, config) });
  const loopId = created.json?.loop?.id;
  const published = await call('POST', `/loops/${loopId}/publish`);
  const started = await call('POST', `/loops/${loopId}/runs`, {});
  return { loopId, statuses: { create: created.status, publish: published.status, run: started.status }, createIssues: created.json?.issues, publishIssues: published.json?.issues, runId: started.json?.run?.id };
}
async function resume(runId, observedSeq, extra = {}) {
  return call('POST', `/runs/${runId}/resume`, { observedSeq, ...extra });
}

const results = [];
try {
  // A1 .cmd: first failure, plain explicit Resume, stale resume refusal, Replay without consent.
  {
    const d = caseDir('a1-cmd'); const m = path.join(d, 'marker.txt');
    const command = batch(d, 'refused.cmd', m);
    const r = await createPublishRun('QA362 A1 cmd refusal', { command, cwd: d });
    const first = await settle(r.runId);
    await sleep(1000);
    const s1 = summarize(first, await events(r.runId), m);
    const res = await resume(r.runId, first.recovery.observedSeq);
    const second = await settle(r.runId, first.lastEventSeq);
    await sleep(1000);
    const s2 = summarize(second, await events(r.runId), m);
    const stale = await resume(r.runId, first.recovery.observedSeq);
    await sleep(500);
    const afterStale = await call('GET', `/runs/${r.runId}`);
    const rep = await call('POST', `/runs/${r.runId}/replay`, { nodeId: 'script', observedSeq: second.recovery.observedSeq });
    const replayRun = rep.json?.run?.id ? await settle(rep.json.run.id) : undefined;
    await sleep(1000);
    const s3 = replayRun ? summarize(replayRun, await events(replayRun.id), m) : null;
    results.push({ name: 'A1-cmd', command, ...r, first: s1, resumeStatus: res.status, afterResume: s2, staleResume: { status: stale.status, body: stale.json, lastEventSeqAfter: afterStale.json?.lastEventSeq }, replay: { status: rep.status, runId: rep.json?.run?.id, replayOf: replayRun?.recovery?.replayOf ?? null, result: s3 } });
  }
  // A2 .bat: first failure, plain explicit Resume.
  {
    const d = caseDir('a2-bat'); const m = path.join(d, 'marker.txt');
    const command = batch(d, 'refused.bat', m);
    const r = await createPublishRun('QA362 A2 bat refusal', { command, cwd: d });
    const first = await settle(r.runId);
    await sleep(1000);
    const s1 = summarize(first, await events(r.runId), m);
    const res = await resume(r.runId, first.recovery.observedSeq);
    const second = await settle(r.runId, first.lastEventSeq);
    await sleep(1000);
    results.push({ name: 'A2-bat', command, ...r, first: s1, resumeStatus: res.status, afterResume: summarize(second, await events(r.runId), m) });
  }
  // A3 missing executable control, then the owner places a real executable and explicitly Resumes.
  {
    const d = caseDir('a3-missing-then-repaired'); const m = path.join(d, 'marker.txt');
    const command = path.join(d, 'later.exe');
    const r = await createPublishRun('QA362 A3 missing then repaired', { command, args: nodeMarkerArgs(m), cwd: d });
    const first = await settle(r.runId);
    await sleep(500);
    const s1 = summarize(first, await events(r.runId), m);
    fs.copyFileSync(process.execPath, command);
    const res = await resume(r.runId, first.recovery.observedSeq);
    const second = await settle(r.runId, first.lastEventSeq);
    await sleep(500);
    const s2 = summarize(second, await events(r.runId), m);
    // Remove only the copied executable (single file, verified inside the QA root).
    let removed = false;
    if (inside(command) && path.basename(command) === 'later.exe') { fs.unlinkSync(command); removed = !fs.existsSync(command); }
    results.push({ name: 'A3-missing-then-repaired-resume', command, ...r, first: s1, resumeStatus: res.status, afterResume: s2, copiedExecutableRemoved: removed });
  }
  // A4 native Node success control.
  {
    const d = caseDir('a4-node-marker'); const m = path.join(d, 'marker.txt');
    const r = await createPublishRun('QA362 A4 node success', { command: process.execPath, args: nodeMarkerArgs(m), cwd: d });
    const first = await settle(r.runId);
    await sleep(500);
    results.push({ name: 'A4-node-marker', ...r, first: summarize(first, await events(r.runId), m) });
  }
  // A5 explicit author shell: cmd.exe /d /c <the same kind of .cmd file>.
  {
    const d = caseDir('a5-cmdexe-explicit-shell'); const m = path.join(d, 'marker.txt');
    const f = batch(d, 'refused.cmd', m);
    const r = await createPublishRun('QA362 A5 explicit shell', { command: cmdExe, args: ['/d', '/c', f], cwd: d });
    const first = await settle(r.runId);
    await sleep(500);
    results.push({ name: 'A5-cmdexe-explicit-shell', ...r, first: summarize(first, await events(r.runId), m) });
  }
} finally {
  // Graceful drain; fall back to the exact child PID only.
  const drain = await http('POST', '/system/shutdown', { action: 'drain' }).catch((error) => ({ status: 'error', text: String(error) }));
  meta.shutdownRequest = { status: drain.status, phase: drain.json?.phase };
  const exited = await Promise.race([childExit, sleep(60_000).then(() => undefined)]);
  if (!exited) {
    meta.forcedKillOfExactPid = child.pid;
    child.kill();
    meta.exit = await childExit;
  } else meta.exit = exited;
  await sleep(500);
  meta.portFreeAfterExit = await portFree(port);
  meta.healthAfterExit = await fetch(`${origin}/healthz`).then((r) => r.status).catch((error) => `unreachable:${error.cause?.code ?? error.message}`);
  meta.finishedAt = new Date().toISOString();
  await new Promise((resolve) => log.end(resolve));
  fs.writeFileSync(outArg, `${JSON.stringify({ meta, results, transcript }, null, 2)}\n`);
}

for (const r of results) {
  const line = (label, s) => s && console.log(`${r.name} [${label}] status=${s.status} code=${s.failure?.code ?? '-'} resumable=${s.failure?.resumable ?? '-'} node=${s.failure?.nodeId ?? '-'} script=${JSON.stringify(s.failure?.script ?? null)} msg=${JSON.stringify(s.failure?.message ?? null)} details=${s.failure?.details !== undefined && s.failure !== null} dispatches=${JSON.stringify(s.dispatches.map((x) => x.dispatchId.slice(-6) + '@' + x.visitId.split(':')[1]))} progress=${s.scriptProgress.length} runFailed=${s.runFailed.length} resume=${JSON.stringify(s.recoveryResume)} consent=${JSON.stringify(s.scriptConsent)} replay(script)=${JSON.stringify(s.replayScript)} marker=${s.markerExists}:${JSON.stringify(s.markerContent)}`);
  console.log(`${r.name} http create/publish/run=${JSON.stringify(r.statuses)} resume=${r.resumeStatus ?? '-'}`);
  line('first', r.first);
  line('after-resume', r.afterResume);
  if (r.staleResume) console.log(`${r.name} staleResume=${JSON.stringify(r.staleResume)}`);
  if (r.replay) { console.log(`${r.name} replay status=${r.replay.status} replayOf=${JSON.stringify(r.replay.replayOf)}`); line('replay-run', r.replay.result); }
  if (r.copiedExecutableRemoved !== undefined) console.log(`${r.name} copiedExecutableRemoved=${r.copiedExecutableRemoved}`);
}
console.log(`meta ${JSON.stringify({ apiPid: meta.apiPid, port: meta.port, readyMs: meta.readyMs, version: meta.version, shutdown: meta.shutdownRequest, exit: meta.exit, forced: meta.forcedKillOfExactPid ?? null, portFreeAfterExit: meta.portFreeAfterExit, healthAfterExit: meta.healthAfterExit })}`);
