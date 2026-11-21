// #362 independent QA, tier N1: built ProcessScripts (real node:child_process.spawn, no injection).
// Usage: node n1-process-scripts.mjs <repoRoot> <qaRoot> <workDir> <outJson>
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const [repoArg, qaRootArg, workArg, outArg] = process.argv.slice(2);
if (!repoArg || !qaRootArg || !workArg || !outArg) throw new Error('usage: <repo> <qaRoot> <work> <out>');
const qaRoot = path.resolve(qaRootArg);
const work = path.resolve(workArg);
const inside = (p) => {
  const rel = path.relative(qaRoot, path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
if (!inside(work) || !inside(outArg)) throw new Error(`refusing paths outside ${qaRoot}`);
if (fs.existsSync(work)) throw new Error(`work dir already exists: ${work}`);
fs.mkdirSync(work, { recursive: true });

const distUrl = pathToFileURL(path.join(path.resolve(repoArg), 'packages/infrastructure/dist/process/index.js'));
const { ProcessScripts } = await import(distUrl.href);
const cmdExe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
const handles = () => process.getActiveResourcesInfo().slice().sort();

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

async function runCase(name, request, marker, { settleMs = 1500 } = {}) {
  const scripts = new ProcessScripts();
  const before = handles();
  const t0 = process.hrtime.bigint();
  const obs = { name, request: { ...request, signal: request.signal.aborted ? 'aborted' : 'live' } };
  let promise;
  try {
    promise = scripts.run(request);
    obs.returnedPromise = promise instanceof Promise;
  } catch (error) {
    obs.syncThrowFromRun = { name: error?.name, message: error?.message, code: error?.code };
  }
  if (promise) {
    try {
      obs.result = await promise;
      obs.settled = 'resolved';
    } catch (error) {
      obs.settled = 'rejected';
      obs.rejection = { name: error?.name, message: error?.message, code: error?.code };
    }
  }
  obs.elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  obs.activeResourcesImmediatelyAfter = handles();
  await sleep(settleMs);
  obs.markerExists = fs.existsSync(marker);
  obs.markerContent = obs.markerExists ? fs.readFileSync(marker, 'utf8') : null;
  obs.activeResourcesBefore = before;
  obs.activeResourcesAfterSettle = handles();
  return obs;
}

const results = [];
const meta = {
  tier: 'N1-built-ProcessScripts-real-spawn',
  node: process.version,
  platform: process.platform,
  distModule: distUrl.href,
  startedAt: new Date().toISOString(),
  work,
};
const live = () => new AbortController().signal;

{
  const d = caseDir('cmd'); const m = path.join(d, 'marker.txt');
  results.push(await runCase('N1-cmd', { command: batch(d, 'refused.cmd', m), args: [], cwd: d, env: {}, signal: live() }, m));
}
{
  const d = caseDir('bat'); const m = path.join(d, 'marker.txt');
  results.push(await runCase('N1-bat', { command: batch(d, 'refused.bat', m), args: [], cwd: d, env: {}, signal: live() }, m));
}
{
  const d = caseDir('cmd-upper'); const m = path.join(d, 'marker.txt');
  results.push(await runCase('N1-cmd-upper', { command: batch(d, 'REFUSED.CMD', m), args: [], cwd: d, env: {}, signal: live() }, m));
}
{
  const d = caseDir('cmd-maxstderr0'); const m = path.join(d, 'marker.txt');
  results.push(await runCase('N1-cmd-maxStderrBytes0', { command: batch(d, 'refused.cmd', m), args: [], cwd: d, env: {}, signal: live(), maxStderrBytes: 0 }, m));
}
{
  const d = caseDir('cmd-timeout-stdin'); const m = path.join(d, 'marker.txt');
  results.push(await runCase('N1-cmd-timeout30s-stdin', { command: batch(d, 'refused.cmd', m), args: ['a'], cwd: d, env: { GG362: '1' }, stdin: '{"x":1}', timeoutMs: 30_000, signal: live() }, m));
}
{
  const d = caseDir('missing-exe'); const m = path.join(d, 'marker.txt');
  results.push(await runCase('N1-missing-exe-timeout30s', { command: path.join(d, 'gg362-missing.exe'), args: [], cwd: d, env: {}, timeoutMs: 30_000, signal: live() }, m));
}
{
  const d = caseDir('cmdexe-cmd'); const m = path.join(d, 'marker.txt');
  const f = batch(d, 'refused.cmd', m);
  results.push(await runCase('N1-cmdexe-cmd', { command: cmdExe, args: ['/d', '/c', f], cwd: d, env: {}, signal: live() }, m));
}
{
  const d = caseDir('node-marker'); const m = path.join(d, 'marker.txt');
  results.push(await runCase('N1-node-marker', { command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync(process.argv[1], "effect\\r\\n")', m], cwd: d, env: {}, signal: live() }, m));
}
{
  const d = caseDir('preaborted-node-marker'); const m = path.join(d, 'marker.txt');
  const c = new AbortController(); c.abort(new Error('already cancelled'));
  results.push(await runCase('N1-preaborted-node-marker', { command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync(process.argv[1], "effect\\r\\n")', m], cwd: d, env: {}, signal: c.signal }, m));
}
// Repeated refusals: every result identical, no accumulated active resources, process exits.
{
  const d = caseDir('cmd-repeat'); const m = path.join(d, 'marker.txt');
  const command = batch(d, 'refused.cmd', m);
  const scripts = new ProcessScripts();
  const before = handles();
  const rss0 = process.memoryUsage().rss;
  const t0 = process.hrtime.bigint();
  const shapes = new Set();
  for (let i = 0; i < 200; i++) {
    const r = await scripts.run({ command, args: [], cwd: d, env: {}, signal: live(), timeoutMs: 60_000 });
    shapes.add(JSON.stringify(r));
  }
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  await sleep(1500);
  results.push({
    name: 'N1-cmd-repeat-200',
    distinctResultShapes: [...shapes].map((s) => JSON.parse(s)),
    elapsedMs,
    rssDeltaBytes: process.memoryUsage().rss - rss0,
    activeResourcesBefore: before,
    activeResourcesAfterSettle: handles(),
    markerExists: fs.existsSync(m),
  });
}

meta.finishedAt = new Date().toISOString();
meta.finalActiveResources = handles();
fs.writeFileSync(outArg, `${JSON.stringify({ meta, results }, null, 2)}\n`);
for (const r of results) {
  if (r.result || r.rejection || r.syncThrowFromRun)
    console.log(`${r.name}: settled=${r.settled ?? 'sync-throw'} state=${r.result?.state} exit=${r.result?.exitCode} stderr=${JSON.stringify(r.result?.stderr)} marker=${r.markerExists} ms=${r.elapsedMs.toFixed(1)} afterSettle=${JSON.stringify(r.activeResourcesAfterSettle)}`);
  else console.log(`${r.name}: shapes=${r.distinctResultShapes.length} ${JSON.stringify(r.distinctResultShapes)} ms=${r.elapsedMs.toFixed(1)} marker=${r.markerExists} afterSettle=${JSON.stringify(r.activeResourcesAfterSettle)}`);
}
console.log(`final active resources: ${JSON.stringify(meta.finalActiveResources)}`);
