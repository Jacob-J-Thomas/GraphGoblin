// #362 independent QA, tier H (adjacent pre-existing check): heartbeat script probe with a native
// .cmd through the built engine and the real built ProcessScripts. Only the workspace port's
// resolve() is overridden so the probe cwd is an owned, existing directory.
// Usage: node h-heartbeat-probe.mjs <repoRoot> <qaRoot> <workDir> <outJson>
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const [repoArg, qaRootArg, workArg, outArg] = process.argv.slice(2);
const repo = path.resolve(repoArg);
const qaRoot = path.resolve(qaRootArg);
const work = path.resolve(workArg);
const inside = (p) => {
  const rel = path.relative(qaRoot, path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
for (const p of [work, outArg]) if (!inside(p)) throw new Error(`refusing path outside ${qaRoot}: ${p}`);
if (fs.existsSync(work)) throw new Error(`work dir already exists: ${work}`);
fs.mkdirSync(work, { recursive: true });
const dist = (p) => pathToFileURL(path.join(repo, p)).href;
const { RunManager } = await import(dist('packages/engine/dist/index.js'));
const { createTestEngine, singleNodeLoop } = await import(dist('packages/engine/dist/testing/index.js'));
const { ProcessScripts } = await import(dist('packages/infrastructure/dist/process/index.js'));

const d = path.join(work, 'h1'); fs.mkdirSync(d);
const marker = path.join(d, 'marker.txt');
const command = path.join(d, 'refused.cmd');
fs.writeFileSync(command, `@echo effect>"${marker}"\r\n@exit /b 0\r\n`);
const e = await createTestEngine();
e.manager.stop();
const v = e.publish(singleNodeLoop('h-heartbeat', {
  id: 'beat', kind: 'heartbeat', label: 'Heartbeat probe',
  config: { intervalSeconds: 1, probe: { kind: 'script', command, args: [], timeoutSeconds: 10 }, until: 'true', record: 'full' },
}));
const queued = await e.start(v.loopId);
const ws = e.ports.workspace;
const workspace = new Proxy(ws, { get(t, k) { if (k === 'resolve') return async () => d; const val = t[k]; return typeof val === 'function' ? val.bind(t) : val; } });
const calls = [];
const real = new ProcessScripts();
const scripts = { async run(request) { const r = await real.run(request); calls.push({ command: request.command, cwd: request.cwd, result: r }); return r; } };
const manager = new RunManager({ ...e.ports, scripts, workspace }, e.settings);
let out;
try {
  await manager.start();
  await manager.waitForIdle();
  await sleep(1500);
  const run = await e.ports.runs.get(queued.id);
  const thread = await manager.getThread(queued.id);
  const events = e.events(queued.id);
  out = {
    name: 'H1-heartbeat-script-probe-cmd',
    status: run.status,
    failure: run.failure ?? null,
    eventTypes: events.map((ev) => `${ev.seq}:${ev.type}`),
    beats: events.filter((ev) => ev.type === 'heartbeat.beat'),
    lastOutput: thread.lastOutput ?? null,
    runnerCalls: calls,
    markerExists: fs.existsSync(marker),
  };
} finally {
  manager.stop();
}
fs.writeFileSync(outArg, `${JSON.stringify({ meta: { tier: 'H-adjacent-heartbeat-probe', node: process.version }, results: [out] }, null, 2)}\n`);
console.log(JSON.stringify({ status: out.status, failure: out.failure, beats: out.beats.map((b) => b.result), lastOutput: out.lastOutput, markerExists: out.markerExists, events: out.eventTypes }));
