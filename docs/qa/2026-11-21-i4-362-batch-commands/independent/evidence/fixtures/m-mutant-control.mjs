// #362 independent QA, tier M: DISCRIMINATING MUTANT CONTROL (not production, not a fix).
// Generates an untracked copy of the BUILT runner with only the synchronous spawn try/catch removed
// (the pre-PR375 shape for that point), then runs the same native .cmd fixture through it directly
// and through the CURRENT built engine. Purpose: show the fixtures distinguish the fix from its
// absence using the real native EINVAL (no injected error).
// Usage: node m-mutant-control.mjs <repoRoot> <qaRoot> <workDir> <outJson> <mutantPath>
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const [repoArg, qaRootArg, workArg, outArg, mutantArg] = process.argv.slice(2);
if (!repoArg || !qaRootArg || !workArg || !outArg || !mutantArg) throw new Error('usage');
const repo = path.resolve(repoArg);
const qaRoot = path.resolve(qaRootArg);
const work = path.resolve(workArg);
const inside = (p) => {
  const rel = path.relative(qaRoot, path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
for (const p of [work, outArg, mutantArg]) if (!inside(p)) throw new Error(`refusing path outside ${qaRoot}: ${p}`);
if (fs.existsSync(work)) throw new Error(`work dir already exists: ${work}`);
fs.mkdirSync(work, { recursive: true });

const builtPath = path.join(repo, 'packages/infrastructure/dist/process/scripts.js');
const built = fs.readFileSync(builtPath, 'utf8');
const importFrom = "import { BoundedOutputCapture } from './output-capture.js';";
const importTo = `import { BoundedOutputCapture } from '${pathToFileURL(path.join(repo, 'packages/infrastructure/dist/process/output-capture.js')).href}';`;
const tryOpen = '            let child;\n            try {\n                child = this.spawnImpl(';
const tryOpenTo = '            let child;\n            {\n                child = this.spawnImpl(';
const catchBlock = `            catch {
                // Node rejects some commands synchronously (notably .cmd/.bat with EINVAL).
                resolve({
                    ...notStarted,
                    stderr: request.maxStderrBytes === undefined ? 'spawn failed: PROCESS_START_FAILED' : '',
                });
                return;
            }
`;
const normalized = built.replace(/\r\n/g, '\n');
const count = (s, needle) => s.split(needle).length - 1;
const counts = { importFrom: count(normalized, importFrom), tryOpen: count(normalized, tryOpen), catchBlock: count(normalized, catchBlock) };
if (counts.importFrom !== 1 || counts.tryOpen !== 1 || counts.catchBlock !== 1) throw new Error(`mutation anchors not unique: ${JSON.stringify(counts)}`);
const mutant = `// MUTANT CONTROL generated from ${builtPath} (sha256 ${crypto.createHash('sha256').update(built).digest('hex')}); sync spawn catch removed. NOT PRODUCTION.\n${normalized.replace(importFrom, importTo).replace(tryOpen, tryOpenTo).replace(catchBlock, '')}`;
fs.writeFileSync(mutantArg, mutant);

const dist = (p) => pathToFileURL(path.join(repo, p)).href;
const { ProcessScripts: MutantScripts } = await import(pathToFileURL(path.resolve(mutantArg)).href);
const { RunManager } = await import(dist('packages/engine/dist/index.js'));
const { createTestEngine, singleNodeLoop } = await import(dist('packages/engine/dist/testing/index.js'));

function batch(dir, file, marker) {
  const full = path.join(dir, file);
  fs.writeFileSync(full, `@echo effect>"${marker}"\r\n@exit /b 0\r\n`);
  return full;
}
const results = [];
// M1: mutant runner directly with the native .cmd.
{
  const d = path.join(work, 'm1-direct'); fs.mkdirSync(d); const m = path.join(d, 'marker.txt');
  const command = batch(d, 'refused.cmd', m);
  const obs = { name: 'M1-mutant-runner-direct-cmd' };
  try {
    const p = new MutantScripts().run({ command, args: [], cwd: d, env: {}, signal: new AbortController().signal });
    obs.returnedPromise = p instanceof Promise;
    obs.result = await p;
    obs.settled = 'resolved';
  } catch (error) {
    obs.settled = 'rejected';
    obs.rejection = { name: error?.name, message: error?.message, code: error?.code, errno: error?.errno, syscall: error?.syscall };
  }
  await sleep(1500);
  obs.markerExists = fs.existsSync(m);
  results.push(obs);
}
// M2: mutant runner through the CURRENT built engine.
{
  const d = path.join(work, 'm2-engine'); fs.mkdirSync(d); const m = path.join(d, 'marker.txt');
  const command = batch(d, 'refused.cmd', m);
  const e = await createTestEngine();
  e.manager.stop();
  const v = e.publish(singleNodeLoop('m-cmd', { id: 'script', kind: 'script', label: 'Mutant', config: { command, cwd: d } }));
  const queued = await e.start(v.loopId);
  const manager = new RunManager({ ...e.ports, scripts: new MutantScripts() }, e.settings);
  try {
    await manager.start();
    await manager.waitForIdle();
    await sleep(1500);
    const run = await e.ports.runs.get(queued.id);
    const snap = await manager.getSnapshot(queued.id);
    results.push({
      name: 'M2-mutant-runner-through-current-engine-cmd',
      status: run.status,
      failure: run.failure,
      recoveryResume: snap.recovery.resume,
      scriptConsent: snap.recovery.scriptConsent ?? null,
      eventTypes: e.events(queued.id).map((ev) => `${ev.seq}:${ev.type}`),
      markerExists: fs.existsSync(m),
    });
  } finally {
    manager.stop();
  }
}
fs.writeFileSync(outArg, `${JSON.stringify({ meta: { tier: 'M-mutant-discriminating-control', node: process.version, builtPath, builtSha256: crypto.createHash('sha256').update(built).digest('hex'), mutantPath: path.resolve(mutantArg), mutantSha256: crypto.createHash('sha256').update(mutant).digest('hex'), anchorCounts: counts }, results }, null, 2)}\n`);
for (const r of results) console.log(JSON.stringify(r));
