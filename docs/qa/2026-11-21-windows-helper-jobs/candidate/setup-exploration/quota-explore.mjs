// GraphGoblin #459 independent QA setup exploration (not product code): does an active-process
// limit refuse nested creation when it is set at job creation versus after members joined?
// Usage: node quota-explore.mjs <QaWitness.exe> <output dir>
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [witnessExe, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const witness = spawn(witnessExe, [], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
let buffer = '';
let seq = 0;
const pending = new Map();
witness.stdout.setEncoding('utf8');
witness.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const reply = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    pending.get(Number(reply.seq))?.(reply);
  }
});
const call = (...parts) =>
  new Promise((done) => {
    const id = ++seq;
    pending.set(id, done);
    witness.stdin.write(`${id} ${parts.join(' ')}\n`);
  });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const env = Object.fromEntries(
  ['SystemRoot', 'windir', 'TEMP', 'TMP', 'Path']
    .filter((key) => process.env[key] ?? process.env[key.toUpperCase()])
    .map((key) => [key, process.env[key] ?? process.env[key.toUpperCase()]]),
);
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
const KILL = 0x2000;
const ACTIVE = 0x8;
// [name, limit at creation (0 = none), late limit (0 = none, -1 = active+1)]
const variants = [
  ['upfront-3', 3, 0],
  ['late-3', 0, 3],
  ['late-active-plus-one', 0, -1],
  ['upfront-2', 2, 0],
];
const results = [];
for (const [name, upfront, late] of variants) {
  const job = `quota-${name}`;
  const made = await call('job', job, upfront ? KILL | ACTIVE : KILL, 0, upfront);
  const sibling = await call('jobspawn', `sib-${name}`, job, b64({
    app: process.execPath, args: ['-e', 'setTimeout(()=>{},15000)'], cwd: outDir, env,
    stdoutPath: join(outDir, `${name}.sib.out`), stderrPath: join(outDir, `${name}.sib.err`),
  }));
  await sleep(800);
  const occupied = await call('jobquery', job);
  let limited = null;
  if (late) {
    const limit = late === -1 ? occupied.accounting.activeProcesses + 1 : late;
    limited = await call('joblimit', job, KILL | ACTIVE, limit);
  }
  const report = join(outDir, `${name}.probe.json`);
  const probe = await call('jobspawn', `probe-${name}`, job, b64({
    app: witnessExe, args: ['--nest-probe', report], cwd: outDir, env,
    stdoutPath: join(outDir, `${name}.probe.out`), stderrPath: join(outDir, `${name}.probe.err`),
  }));
  let state = probe;
  for (let i = 0; i < 200 && state.alive; i++) {
    await sleep(25);
    state = await call('state', `probe-${name}`);
  }
  const after = await call('jobquery', job);
  results.push({
    variant: name,
    madeReadBack: made.readBack,
    siblingOk: sibling.ok,
    occupied: { total: occupied.accounting.totalProcesses, active: occupied.accounting.activeProcesses, pids: occupied.accounting.activePids.length },
    lateLimit: limited ? { ok: limited.ok, readBack: limited.readBack, win32: limited.win32 ?? null } : null,
    probeSpawn: { ok: probe.ok, assigned: probe.assigned ?? null, assignError: probe.assignError ?? null, createError: probe.createError ?? null },
    probeExit: state.exitCode ?? null,
    probe: existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null,
    after: { total: after.accounting.totalProcesses, active: after.accounting.activeProcesses },
  });
  await call('jobclose', job);
}
witness.stdin.end();
writeFileSync(join(outDir, 'quota-explore.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n');
for (const result of results) console.log(JSON.stringify(result));
