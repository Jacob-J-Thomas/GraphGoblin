// S2 driver: probe 63800-63819 -> start foreign listeners outside Vitest (127.0.0.1:63806, 0.0.0.0:63805)
// -> run ACTUAL apps/api Vitest (env range 63804/3, TEMP redirected) -> verify foreigns still answer -> stop them -> probe.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, readdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
const EV = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-ports-407-independent-claude-qa';
const QA = 'C:/Users/98jak/.codex/worktrees/gg-20261117-ports-407-qa/GraphGoblin';
const run = process.argv[2];
const work = join(QA, '.tmp', 'qa407', run);
if (!run || existsSync(work)) { console.error('missing run name or work dir exists'); process.exit(91); }
const out = join(EV, run);
mkdirSync(join(work, 'tmp'), { recursive: true }); mkdirSync(join(work, 'sync'), { recursive: true }); mkdirSync(out, { recursive: true });
const probe = (label) => { try { return { exit: 0, json: execFileSync(process.execPath, [join(EV, 'scripts/probe-assigned-ports-v2.mjs'), label], { encoding: 'utf8' }) }; } catch (e) { return { exit: e.status, json: e.stdout }; } };
const before = probe(`${run}-before`); writeFileSync(join(out, 'ports-before.json'), before.json);
if (before.exit !== 0) { console.error('assigned ports not free'); process.exit(92); }
const receipt = { run, steps: [] };
const foreign = [];
for (const [port, host] of [[63806, '127.0.0.1'], [63805, '0.0.0.0']]) {
  const ready = join(work, `foreign-${port}.ready`);
  const child = spawn(process.execPath, [join(EV, 'scripts/foreign-listener.mjs'), String(port), host, ready], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  await new Promise((res, rej) => { const t = setInterval(() => { if (existsSync(ready)) { clearInterval(t); res(); } }, 20); child.once('exit', () => { clearInterval(t); rej(new Error('foreign exited early')); }); });
  foreign.push({ port, host, pid: child.pid, child, exited });
}
receipt.foreignStarted = foreign.map(({ port, host, pid }) => ({ port, host, pid }));
const ask = async (port) => { try { const r = await fetch(`http://127.0.0.1:${port}/`); return `${r.status}:${await r.text()}`; } catch (e) { return `ERR:${e.cause?.code}`; } };
receipt.foreignAnswersBeforeVitest = { 63806: await ask(63806), 63805: await ask(63805) };
const args = ['exec', 'vitest', 'run', '--reporter=verbose', '--maxWorkers=1', 'src/qa407/qa407-s2'];
const env = { ...process.env, TEMP: join(work, 'tmp'), TMP: join(work, 'tmp'), GG_TEST_PORT_START: '63804', GG_TEST_PORT_COUNT: '3', QA407_SYNC: join(work, 'sync'), QA407_OUT: out };
const log = createWriteStream(join(out, 'vitest.log'));
const startedAt = new Date().toISOString();
const vitest = spawn('pnpm.cmd', args, { cwd: join(QA, 'apps/api'), env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
vitest.stdout.pipe(log, { end: false }); vitest.stderr.pipe(log, { end: false });
const vexit = await new Promise((r) => vitest.once('close', (code) => r(code)));
log.end();
receipt.vitest = { command: ['pnpm.cmd', ...args], cwd: join(QA, 'apps/api'), env: { GG_TEST_PORT_START: '63804', GG_TEST_PORT_COUNT: '3', TEMP: env.TEMP }, startedAt, endedAt: new Date().toISOString(), exit: vexit };
receipt.foreignAnswersAfterVitest = { 63806: await ask(63806), 63805: await ask(63805) };
for (const f of foreign) f.child.stdin.end();
receipt.foreignExits = await Promise.all(foreign.map(async (f) => ({ port: f.port, ...(await f.exited) })));
receipt.tempEntriesAfter = readdirSync(join(work, 'tmp'));
const after = probe(`${run}-after`); writeFileSync(join(out, 'ports-after.json'), after.json); receipt.portsAfterExit = after.exit;
try { receipt.nodeProcessesAfter = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(EV, 'scripts/children-v2.ps1')], { encoding: 'utf8' }).replace(/^\uFEFF/, '')); } catch (e) { receipt.nodeProcessesAfter = String(e); }
writeFileSync(join(out, 'driver-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ vitestExit: vexit, foreignAnswersAfterVitest: receipt.foreignAnswersAfterVitest, foreignExits: receipt.foreignExits, tempEntriesAfter: receipt.tempEntriesAfter, portsAfterExit: after.exit, nodeProcs: receipt.nodeProcessesAfter?.count }));
process.exitCode = vexit;
