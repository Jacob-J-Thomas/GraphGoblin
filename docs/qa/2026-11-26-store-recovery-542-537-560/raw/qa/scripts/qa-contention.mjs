// Independent QA: bounded native ordinary contention through the built API's public startup.
// Each round races N `node apps/api/dist/main.js` processes on one fresh store (same data directory
// and database file, ephemeral ports, providers disabled). Exactly one may listen; the others must
// refuse with an ownership explanation. The winner is drained through its control route and every
// process must have exited with the store left free of lock records, guards and staging.
// Usage: node qa-contention.mjs <repo> <raw-output-dir> <runs-root> [rounds=4] [contenders=5]
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoArg, rawArg, runsArg, roundsArg = '4', contendersArg = '5'] = process.argv.slice(2);
const repo = resolve(repoArg);
const raw = resolve(rawArg);
const entry = join(repo, 'apps/api/dist/main.js');
const locks = await import(pathToFileURL(join(repo, 'apps/api/dist/data-dir-lock.js')).href);
const rounds = Number(roundsArg);
const contenders = Number(contendersArg);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = join(resolve(runsArg), 'contention-' + stamp);
await fs.mkdir(root, { recursive: true });
await fs.mkdir(raw, { recursive: true });

const clean = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(SystemRoot|Windir|ComSpec|Path|PathExt|UserProfile|AppData|LocalAppData|OS)$/i.test(key),
  ),
);
clean.TEMP = clean.TMP = 'G:\\ggq\\tmp\\rq-542-qa';

function start(env, index) {
  const child = spawn(process.execPath, [entry], { cwd: repo, env, windowsHide: true });
  const row = { index, pid: child.pid, stdout: '', stderr: '', listening: undefined };
  const exit = new Promise((done, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => done({ code, signal }));
  });
  let resolveListen;
  const listen = new Promise((done) => {
    resolveListen = done;
  });
  child.stdout.on('data', (chunk) => {
    row.stdout += chunk.toString();
    const at = row.stdout.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);
    if (at && !row.listening) {
      row.listening = at[1];
      resolveListen(at[1]);
    }
  });
  child.stderr.on('data', (chunk) => {
    row.stderr += chunk.toString();
  });
  return { child, row, exit, settled: Promise.race([listen.then(() => 'listening'), exit.then(() => 'exited')]) };
}

async function drain(base) {
  const response = await fetch(base + '/system/shutdown', { signal: AbortSignal.timeout(5000) });
  const { controlToken } = await response.json();
  const drained = await fetch(base + '/system/shutdown', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-graphgoblin-shutdown-token': controlToken },
    body: JSON.stringify({ action: 'drain' }),
    signal: AbortSignal.timeout(5000),
  });
  return drained.status;
}

const refusal = /^(another GraphGoblin process holds |Store ownership could not be verified )/;
const report = { node: process.version, venue: process.platform, entry, contenders, rounds: [] };
for (let round = 1; round <= rounds; round++) {
  const dir = join(root, 'round-' + round);
  await fs.mkdir(join(dir, 'data'), { recursive: true });
  const dataDir = realpathSync.native(join(dir, 'data'));
  const db = join(dataDir, 'store.db');
  const env = {
    ...clean,
    GG_HOST: '127.0.0.1',
    GG_PORT: '0',
    GG_DB_URL: pathToFileURL(db).href,
    GG_DATA_DIR: dataDir,
    GG_MASTER_KEY: Buffer.alloc(32, 8).toString('base64'),
    GG_OLLAMA_ENABLED: 'false',
    GG_OLLAMA_URL: 'http://127.0.0.1:1',
    GG_CODEX_BINARY: join(dir, 'absent-codex.exe'),
    GG_CLAUDE_BINARY: join(dir, 'absent-claude.exe'),
    GG_WEB_DIST: '',
    GG_GOBLIN_DIST: '',
    GG_SWAGGER_UI: 'false',
  };
  const started = Date.now();
  const procs = Array.from({ length: contenders }, (_, index) => start(env, index));
  const timer = setTimeout(() => {
    for (const { child } of procs) if (child.exitCode === null && child.signalCode === null) child.kill();
  }, 90000);
  const result = { round, dataDir, checks: [] };
  const check = (what, ok, detail) => result.checks.push({ what, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  try {
    const states = await Promise.all(procs.map((p) => p.settled));
    result.settleMs = Date.now() - started;
    const winners = procs.filter((p) => p.row.listening);
    check('exactly one contender listened', winners.length === 1, states);
    const losers = procs.filter((p) => !p.row.listening);
    const loserExits = await Promise.all(losers.map((p) => p.exit));
    check('every other contender exited with code 1', loserExits.every((e) => e.code === 1), loserExits);
    const refusals = losers.map((p) => p.row.stderr.replace(/\r?\n$/, ''));
    check('every refusal is one ownership explanation line', refusals.every((text) => refusal.test(text) && !text.includes('\n')), refusals);
    check('no loser printed a stack or filesystem failure', refusals.every((text) => !/^\s+at |Store ownership [a-z-]+ failed/m.test(text)));
    if (winners.length === 1) {
      const [winner] = winners;
      const record = JSON.parse(await fs.readFile(join(dataDir, 'graphgoblin.lock'), 'utf8'));
      check('the directory lock record names the listening process', record.pid === winner.row.pid, { record: record.pid, winner: winner.row.pid });
      const dbRecord = JSON.parse(await fs.readFile(db + '.graphgoblin.lock', 'utf8'));
      check('the database lock record names the listening process', dbRecord.pid === winner.row.pid);
      const state = await locks.dataDirLockState(dataDir);
      check('read-only status reports the store held', state.state === 'held', state);
      result.drainStatus = await drain(winner.row.listening);
      const winnerExit = await winner.exit;
      check('winner drained and exited 0', result.drainStatus === 202 && winnerExit.code === 0, { drain: result.drainStatus, exit: winnerExit });
    }
    await Promise.all(procs.map((p) => p.exit));
    const alive = procs.filter(({ row }) => {
      try {
        process.kill(row.pid, 0);
        return true;
      } catch (error) {
        return error.code !== 'ESRCH';
      }
    });
    check('all contender processes settled (no live PID remains)', alive.length === 0, alive.map((p) => p.row.pid));
    const remaining = await fs.readdir(dataDir);
    result.remaining = remaining;
    check('no lock record, guard or staging left', remaining.every((name) => !/graphgoblin\.lock|\.tmp$/.test(name)), remaining);
    check('store is free afterwards', (await locks.dataDirLockState(dataDir)).state === 'free');
    result.outcomes = procs.map(({ row }) => ({
      index: row.index,
      pid: row.pid,
      listened: Boolean(row.listening),
      stderr: row.stderr,
      stdoutLines: row.stdout.split('\n').filter(Boolean).length,
    }));
  } catch (error) {
    check('round completed without harness error', false, String(error?.stack ?? error));
  } finally {
    clearTimeout(timer);
    for (const { child } of procs) if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.allSettled(procs.map((p) => p.exit));
  }
  result.pass = result.checks.every((c) => c.ok);
  report.rounds.push(result);
  console.log((result.pass ? 'PASS' : 'FAIL') + ' round ' + round + ' ' + JSON.stringify(result.outcomes?.map((o) => (o.listened ? 'OWNER' : o.stderr.split(';')[0]))));
}
report.pass = report.rounds.every((r) => r.pass);
await fs.writeFile(join(raw, 'contention-' + stamp + '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ rounds: report.rounds.length, passed: report.rounds.filter((r) => r.pass).length }));
