// #362 independent QA, tier N0: native Node spawn shape on this host. No GraphGoblin code.
// Usage: node n0-node-spawn-shape.mjs <qaRoot> <workDir> <outJson>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const [qaRootArg, workArg, outArg] = process.argv.slice(2);
if (!qaRootArg || !workArg || !outArg) throw new Error('usage: <qaRoot> <workDir> <outJson>');
const qaRoot = path.resolve(qaRootArg);
const work = path.resolve(workArg);
const inside = (p) => {
  const rel = path.relative(qaRoot, path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
if (!inside(work) || !inside(outArg)) throw new Error(`refusing paths outside ${qaRoot}`);
if (fs.existsSync(work)) throw new Error(`work dir already exists: ${work}`);
fs.mkdirSync(work, { recursive: true });

const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const cmdExe = path.join(system32, 'cmd.exe');

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
const handles = () => process.getActiveResourcesInfo().slice().sort();

async function attempt(name, command, args, options, marker) {
  const before = handles();
  const obs = {
    name,
    command,
    args,
    shell: options.shell ?? false,
    syncThrow: null,
    spawnEvent: false,
    errorEvent: null,
    exit: null,
    pid: null,
    markerExists: null,
    markerContent: null,
    elapsedMs: null,
  };
  const t0 = process.hrtime.bigint();
  let child;
  try {
    child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false, ...options });
  } catch (error) {
    obs.syncThrow = {
      name: error?.name,
      message: error?.message,
      code: error?.code,
      errno: error?.errno,
      syscall: error?.syscall,
      path: error?.path,
      spawnargs: error?.spawnargs,
    };
  }
  if (child) {
    obs.pid = child.pid ?? null;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        obs.exit = 'TIMEOUT-10s';
        try { child.kill(); } catch { /* recorded below */ }
        resolve();
      }, 10_000);
      child.once('spawn', () => { obs.spawnEvent = true; });
      child.once('error', (error) => {
        obs.errorEvent = { code: error?.code, errno: error?.errno, syscall: error?.syscall, message: error?.message };
        if (!obs.spawnEvent) { clearTimeout(timer); resolve(); }
      });
      child.once('close', (code, signal) => { obs.exit = { code, signal }; clearTimeout(timer); resolve(); });
      child.stdin?.end();
    });
  }
  obs.elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  // Give any batch interpreter that might have been started time to write its marker.
  await sleep(1500);
  obs.markerExists = fs.existsSync(marker);
  obs.markerContent = obs.markerExists ? fs.readFileSync(marker, 'utf8') : null;
  obs.activeResourcesBefore = before;
  obs.activeResourcesAfter = handles();
  return obs;
}

const results = [];
const meta = {
  tier: 'N0-native-node-spawn',
  node: process.version,
  execPath: process.execPath,
  platform: process.platform,
  arch: process.arch,
  pid: process.pid,
  startedAt: new Date().toISOString(),
  qaRoot,
  work,
};

// Refusal shapes: absolute .cmd/.bat and case/suffix variants.
{
  const d = caseDir('cmd-abs'); const m = path.join(d, 'marker.txt');
  results.push(await attempt('N0-cmd-abs', batch(d, 'refused.cmd', m), [], { cwd: d }, m));
}
{
  const d = caseDir('bat-abs'); const m = path.join(d, 'marker.txt');
  results.push(await attempt('N0-bat-abs', batch(d, 'refused.bat', m), [], { cwd: d }, m));
}
{
  const d = caseDir('cmd-upper'); const m = path.join(d, 'marker.txt');
  results.push(await attempt('N0-cmd-upper', batch(d, 'REFUSED.CMD', m), [], { cwd: d }, m));
}
{
  const d = caseDir('bat-mixed'); const m = path.join(d, 'marker.txt');
  results.push(await attempt('N0-bat-mixed', batch(d, 'Refused.Bat', m), [], { cwd: d }, m));
}
{
  const d = caseDir('cmd-trailing-dot'); const m = path.join(d, 'marker.txt');
  results.push(await attempt('N0-cmd-trailing-dot', `${batch(d, 'refused.cmd', m)}.`, [], { cwd: d }, m));
}
{
  const d = caseDir('cmd-trailing-space'); const m = path.join(d, 'marker.txt');
  results.push(await attempt('N0-cmd-trailing-space', `${batch(d, 'refused.cmd', m)} `, [], { cwd: d }, m));
}
{
  const d = caseDir('cmd-with-args'); const m = path.join(d, 'marker.txt');
  results.push(await attempt('N0-cmd-with-args', batch(d, 'refused.cmd', m), ['one', 'two & echo x'], { cwd: d }, m));
}
// Extensionless name whose only file on disk is NAME.cmd.
{
  const d = caseDir('shim-extensionless'); const m = path.join(d, 'marker.txt');
  batch(d, 'gg362shim.cmd', m);
  results.push(
    await attempt('N0-shim-extensionless', 'gg362shim', [], {
      cwd: d,
      env: { SystemRoot: process.env.SystemRoot, PATH: `${d};${system32}`, PATHEXT: process.env.PATHEXT },
    }, m),
  );
}
// Missing executable control.
{
  const d = caseDir('missing-exe'); const m = path.join(d, 'marker.txt');
  results.push(await attempt('N0-missing-exe', path.join(d, 'gg362-missing.exe'), [], { cwd: d }, m));
}
// Positive controls: the same batch bodies are effective when actually interpreted.
{
  const d = caseDir('cmdexe-cmd'); const m = path.join(d, 'marker.txt');
  const f = batch(d, 'refused.cmd', m);
  results.push(await attempt('N0-cmdexe-cmd', cmdExe, ['/d', '/c', f], { cwd: d }, m));
}
{
  const d = caseDir('cmdexe-bat'); const m = path.join(d, 'marker.txt');
  const f = batch(d, 'refused.bat', m);
  results.push(await attempt('N0-cmdexe-bat', cmdExe, ['/d', '/c', f], { cwd: d }, m));
}
{
  const d = caseDir('node-marker'); const m = path.join(d, 'marker.txt');
  results.push(
    await attempt('N0-node-marker', process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], "effect\\r\\n")', m], { cwd: d }, m),
  );
}

meta.finishedAt = new Date().toISOString();
meta.finalActiveResources = handles();
fs.writeFileSync(outArg, `${JSON.stringify({ meta, results }, null, 2)}\n`);
for (const r of results)
  console.log(
    `${r.name}: syncThrow=${r.syncThrow ? `${r.syncThrow.code}/${r.syncThrow.errno}/${r.syscall ?? r.syncThrow.syscall}` : 'no'} spawn=${r.spawnEvent} error=${r.errorEvent?.code ?? '-'} exit=${JSON.stringify(r.exit)} marker=${r.markerExists} ms=${r.elapsedMs.toFixed(1)}`,
  );
console.log(`final active resources: ${JSON.stringify(meta.finalActiveResources)}`);
