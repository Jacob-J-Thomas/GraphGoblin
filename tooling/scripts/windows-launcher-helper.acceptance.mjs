// #458 helper allowance and diagnostics (ADR-0092) through the public native launcher CLI:
// disposable stub checkouts, helpers, stores and loopback ports; no installed app or owner store.
// The native suite (`windows-launcher.acceptance.mjs`) owns the strict ownership protocol, held
// recheck budgets, helper job containment and the real built helper; this file adds only the
// configured cold-start allowance, output pressure, hung/failed/malformed/descendant helpers,
// measured diagnostics and the slow-success note.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const native = process.platform === 'win32';
/** Every inherited GG_* and JEV_API_KEY spelling is removed, as in the native suite. */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => {
    const upper = key.toUpperCase();
    return (
      !upper.startsWith('GG_') && !['JEV_API_KEY', 'NODE_OPTIONS', 'NODE_DEBUG'].includes(upper)
    );
  }),
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const canary = 'PRIVATE_HELPER_CANARY';
const launchDigest = `v1:${'c'.repeat(64)}`;
const instance = 'a'.repeat(64);
const freeLine = '{"state":"free"}\n';
/** The stub helper's enrollment for the store the launcher passes it. */
const enrollmentLine = (dataDir) =>
  JSON.stringify({ version: '1', launch: launchDigest, instance, dataDir, database: 'non-file' }) +
  '\n';
/** Shared helper prelude: the launcher's mode argument and both valid protocol responses. */
const prelude = `import fs from 'node:fs';
const mode = process.argv[2];
const enrollment = JSON.stringify({version:'1',launch:${JSON.stringify(launchDigest)},instance:${JSON.stringify(instance)},dataDir:process.env.GG_DATA_DIR,database:'non-file'})+'\\n';
const free = ${JSON.stringify(freeLine)};
`;
/** One measured helper observation: stage, fixed outcome and launcher-measured integers. */
const observation =
  /\((enrollment|ownership) check (.+?) after (\d+) ms of its (\d+) ms allowance; stdout (\d+) bytes, stderr (\d+) bytes\)/;

let base;
let install;
let exe;
let pipeHolder;

function measured(text) {
  const match = observation.exec(text);
  assert.ok(match, 'The refusal must carry a measured helper observation.');
  const [, stage, outcome, elapsed, allowance, stdout, stderr] = match;
  return {
    stage,
    outcome,
    elapsed: Number(elapsed),
    allowance: Number(allowance),
    stdout: Number(stdout),
    stderr: Number(stderr),
  };
}

const firstLine = (text) => String(text).split(/\r?\n/, 1)[0];

async function compile(source, out, target) {
  await execute(
    join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      `/target:${target}`,
      '/platform:x64',
      '/reference:System.Windows.Forms.dll',
      '/reference:System.Web.Extensions.dll',
      `/out:${out}`,
      source,
    ],
    { windowsHide: true },
  );
}

/** launcher.log is written only into a private root (ADR-0081). */
async function privateDirectory(path) {
  await mkdir(path, { recursive: true });
  const system = (tool) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', tool);
  const sid = /"(S-1-[0-9-]+)"/.exec(
    (await execute(system('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { windowsHide: true }))
      .stdout,
  )?.[1];
  assert.ok(sid, 'The current user SID must be known.');
  await execute(
    system('icacls.exe'),
    [
      path,
      '/inheritance:r',
      '/grant:r',
      `*${sid}:(OI)(CI)F`,
      '*S-1-5-18:(OI)(CI)F',
      '*S-1-5-32-544:(OI)(CI)F',
    ],
    { windowsHide: true },
  );
  return path;
}

/** Independent implementation of the launcher's documented gateway-input encoding. */
function gatewayInputsDigest({ Repo, Node, DataDir, Port, Environment = {} }) {
  const hash = createHash('sha256');
  const field = (value) => {
    const bytes = Buffer.from(String(value), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length).update(bytes);
  };
  const names = Object.keys(Environment).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  field('graphgoblin-launcher-gateway-inputs/v1');
  for (const value of [Repo, Node, DataDir, Port, names.length]) field(value);
  for (const name of names) {
    field(name);
    field(Environment[name]);
  }
  return hash.digest('hex');
}

/** A loopback port that was free a moment ago; nothing in this file binds it except a stub gateway. */
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

/** A gateway entry that records its start and exits 75 without listening. */
const refusedMain = (spawned) =>
  `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(spawned)},String(process.pid));process.exit(75);`;

/** A gateway entry that serves the enrolled identity until the test stops it. */
const servingMain = (spawned) => `import fs from 'node:fs';import {createServer} from 'node:http';
fs.writeFileSync(${JSON.stringify(spawned)},String(process.pid));
const headers={'x-graphgoblin-launch-identity':${JSON.stringify(launchDigest)},'x-graphgoblin-instance':${JSON.stringify(instance)},'x-graphgoblin-pid':String(process.pid),'x-graphgoblin-phase':'running'};
const server=createServer((request,response)=>{
  if(request.url==='/healthz'){response.writeHead(200,headers);response.end('{"status":"ok"}');}
  else if(request.url==='/app/'){response.writeHead(200);response.end('<html></html>');}
  else if(request.url==='/fixture-stop'){response.end('stopping',()=>process.exit(0));}
  else{response.writeHead(404);response.end();}
});
server.listen(Number(process.env.GG_PORT),'127.0.0.1');
setTimeout(()=>process.exit(0),60000).unref();`;

/**
 * A stub checkout, an existing store and an enrolled launcher configuration in the private install
 * folder. The enrollment is computed for these exact inputs, so no helper runs before the click.
 */
async function fixture(name, { helper, main = refusedMain, timeout = 1, node, environment = {} }) {
  const repo = join(base, `${name} checkout`);
  const spawned = join(base, `${name} gateway started`);
  for (const [file, contents] of [
    ['package.json', '{"type":"module"}'],
    ['apps/api/dist/main.js', `export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;\n${main(spawned)}`],
    ['apps/api/dist/instance-identity.js', helper],
    ['apps/api/dist/windows-log/guard.js', ''],
    ['apps/web/dist/index.html', '<html></html>'],
  ]) {
    await mkdir(dirname(join(repo, file)), { recursive: true });
    await writeFile(join(repo, file), contents);
  }
  const dataDir = join(base, `${name} store`);
  await mkdir(dataDir);
  const config = {
    Repo: repo,
    Node: node ?? process.execPath,
    DataDir: dataDir,
    Port: await freePort(),
    Environment: environment,
    StartupTimeoutSeconds: timeout,
    WindowTimeoutSeconds: 1,
  };
  config.Enrollment = {
    Version: 1,
    Launch: launchDigest,
    DataDir: dataDir,
    Database: 'non-file',
    Inputs: gatewayInputsDigest(config),
  };
  const path = join(install, `${name}.json`);
  await writeFile(path, JSON.stringify(config));
  return { config, path, repo, dataDir, spawned };
}

/** Launcher records appended since `offset` bytes of launcher.log. */
async function recordsSince(offset) {
  const bytes = await readFile(join(install, 'launcher.log')).catch((error) => {
    if (error.code === 'ENOENT') return Buffer.alloc(0);
    throw error;
  });
  return bytes
    .subarray(offset)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function logOffset() {
  return (await stat(join(install, 'launcher.log')).catch(() => ({ size: 0 }))).size;
}

/** One public click; the result also carries the click's own launcher.log records. */
async function click({ path }, watchdog = 30_000) {
  const offset = await logOffset();
  const started = performance.now();
  const result = await execute(exe, ['--config', path, '--ensure-gateway'], {
    cwd: root,
    env,
    windowsHide: true,
    timeout: watchdog,
  }).then(
    (value) => ({ code: 0, ...value }),
    (error) => error,
  );
  const elapsed = performance.now() - started;
  assert.notEqual(result.killed, true, 'The launcher must finish before the test watchdog.');
  return { ...result, elapsed, records: await recordsSince(offset) };
}

/** A refused click: one closed helper record, no helper output anywhere, no gateway start. */
async function assertHelperRefusal(result, f, code) {
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.ok(!result.stderr.includes(canary), 'Helper output reached the dialog text.');
  assert.ok(
    !JSON.stringify(result.records).includes(canary),
    'Helper output reached launcher.log.',
  );
  // A preceding check that happened to take five seconds may add only its slow-check note.
  const refusals = result.records.filter((record) => record.outcome !== 'slow-check');
  assert.deepEqual(
    refusals.map((record) => [record.outcome, record.stage, record.code]),
    [['refused', 'gateway', code]],
  );
  assert.equal(refusals[0].message, firstLine(result.stderr));
  await assert.rejects(readFile(f.spawned), { code: 'ENOENT' }, 'No gateway may start.');
  return measured(firstLine(result.stderr));
}

before(async () => {
  if (!native) return;
  await mkdir(join(root, '.tmp'), { recursive: true });
  base = await mkdtemp(join(root, '.tmp', 'windows-launcher-helper-'));
  install = await privateDirectory(join(base, 'install α'));
  exe = join(install, 'GraphGoblin.exe');
  await compile(join(root, 'apps/windows-launcher/Launcher.cs'), exe, 'winexe');
  pipeHolder = join(base, 'PipeHolder.exe');
  await compile(
    join(root, 'tooling/scripts/__fixtures__/launcher-pipe-holder.cs'),
    pipeHolder,
    'exe',
  );
});

after(async () => {
  // Only the fresh directory returned by mkdtemp belongs to this suite.
  if (base) await rm(base, { recursive: true, force: true, maxRetries: 10 });
});

test(
  '#458 baseline: 16-second enrollment and ownership checks succeed within a 25-second startup timeout',
  { skip: !native, timeout: 90_000 },
  async () => {
    // Before ADR-0092 each cold check stopped at a fixed 15 seconds; both now get 25.
    const f = await fixture('slow success', {
      helper: `${prelude}if(mode==='--launch-enrollment')setTimeout(()=>process.stdout.write(enrollment),16000);
else if(mode==='--store-state')setTimeout(()=>process.stdout.write(free),16000);`,
      main: servingMain,
      timeout: 25,
    });
    let gateway;
    try {
      const result = await click(f, 70_000);
      assert.deepEqual([result.code, result.stdout, result.stderr], [0, '', '']);
      gateway = Number(await readFile(f.spawned, 'utf8'));
      assert.ok(result.elapsed >= 32_000, `elapsed ${result.elapsed}`);
      // Exactly one closed slow-success note per check, and no refusal record.
      assert.deepEqual(
        result.records.map((record) => [record.outcome, record.stage, record.check]),
        [
          ['slow-check', 'gateway', 'enrollment'],
          ['slow-check', 'gateway', 'ownership'],
        ],
      );
      for (const [record, stdout] of [
        [result.records[0], Buffer.byteLength(enrollmentLine(f.dataDir))],
        [result.records[1], Buffer.byteLength(freeLine)],
      ]) {
        assert.deepEqual(Object.keys(record).sort(), [
          'allowanceMs',
          'check',
          'elapsedMs',
          'message',
          'outcome',
          'pid',
          'stage',
          'stderrBytes',
          'stdoutBytes',
          'time',
        ]);
        assert.ok(record.elapsedMs >= 16_000 && record.elapsedMs < 25_000, `${record.elapsedMs}`);
        assert.deepEqual(
          [record.allowanceMs, record.stdoutBytes, record.stderrBytes, record.message],
          [25_000, stdout, 0, `The read-only ${record.check} check succeeded slowly.`],
        );
      }
    } finally {
      const pid = gateway ?? Number(await readFile(f.spawned, 'utf8').catch(() => 0));
      if (pid) {
        await fetch(`http://127.0.0.1:${f.config.Port}/fixture-stop`, {
          signal: AbortSignal.timeout(3000),
        }).catch(() => undefined);
        for (let tries = 0; alive(pid) && tries < 50; tries++) await sleep(100);
        assert.equal(alive(pid), false, 'The stub gateway must stop.');
      }
    }
  },
);

test(
  'output pressure: flooded stderr still succeeds and oversized stdout is refused by counts only',
  { skip: !native, timeout: 60_000 },
  async () => {
    // Both checks block on about 256 KiB of stderr, 32 times the pipe buffer, before their valid
    // answer; the launcher drains it concurrently and reaches the spawn (whose stub exits 75).
    const flood = await fixture('stderr flood', {
      helper: `${prelude}fs.writeSync(2,${JSON.stringify(canary)}.repeat(12500));
process.stdout.write(mode==='--store-state'?free:enrollment);`,
    });
    const flooded = await click(flood);
    assert.equal(flooded.code, 1);
    assert.match(firstLine(flooded.stderr), /^GraphGoblin failed during startup, and no startup/);
    assert.deepEqual(
      flooded.records.filter((record) => record.outcome === 'refused').map((record) => record.code),
      ['startup-failed-unlogged'],
    );
    assert.ok(
      !flooded.stderr.includes(canary) && !JSON.stringify(flooded.records).includes(canary),
    );
    assert.ok(
      Number(await readFile(flood.spawned, 'utf8')) > 0,
      'Both checks must have succeeded.',
    );

    // A valid line padded beyond the 256 KiB stdout cap: refused without deadlock or content.
    const oversized = await fixture('stdout oversized', {
      helper: `${prelude}fs.writeSync(1,enrollment+' '.repeat(300000)+${JSON.stringify(canary)});`,
    });
    const refused = await click(oversized);
    const seen = await assertHelperRefusal(refused, oversized, 'helper-invalid');
    assert.match(
      firstLine(refused.stderr),
      /^The read-only launcher check returned an invalid or oversized response \(enrollment check returned invalid or oversized output after \d+ ms of its 15000 ms allowance; stdout \d+ bytes, stderr 0 bytes\)\. No gateway was started\.$/,
    );
    const written = Buffer.byteLength(enrollmentLine(oversized.dataDir)) + 300_000 + canary.length;
    assert.ok(seen.stdout > 262_144 && seen.stdout <= written, `stdout ${seen.stdout}`);
    assert.ok(refused.elapsed < 10_000, `elapsed ${refused.elapsed}`);
  },
);

test(
  'a hung ownership helper is stopped at the 15-second floor with measured diagnostics',
  { skip: !native, timeout: 60_000 },
  async () => {
    const pidFile = join(base, 'hung helper pid');
    // A valid answer followed by a hang: the check needs exit as well as output.
    const f = await fixture('hung ownership', {
      helper: `${prelude}if(mode==='--store-state'){fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
process.stderr.write(${JSON.stringify(canary)});process.stdout.write(free);setInterval(()=>{},1000);}
else process.stdout.write(enrollment);`,
    });
    const result = await click(f);
    const seen = await assertHelperRefusal(result, f, 'helper-timeout');
    assert.match(
      firstLine(result.stderr),
      /^The read-only ownership check exceeded its work budget \(ownership check timed out after \d+ ms of its 15000 ms allowance; stdout 17 bytes, stderr 21 bytes\)\. Check PowerShell and Windows Management Instrumentation availability\. No gateway was started\.$/,
    );
    assert.ok(seen.elapsed >= 15_000 && seen.elapsed < 17_000, `measured ${seen.elapsed}`);
    assert.ok(result.elapsed >= 15_000 && result.elapsed < 22_000, `elapsed ${result.elapsed}`);
    // The helper's private job was terminated before the launcher returned.
    assert.equal(alive(Number(await readFile(pidFile, 'utf8'))), false);
  },
);

test(
  'a descendant holding the helper pipes is collected and the enrollment check refused',
  { skip: !native, timeout: 60_000 },
  async () => {
    const marker = join(base, 'inherited pipes.txt');
    // The root answers and exits 0; its descendant keeps both pipe writers open far longer.
    const f = await fixture('inherited pipes', {
      helper: '',
      node: pipeHolder,
      environment: { GG_QA_PIPE_MARKER: marker, GG_QA_PIPE_HOLD_MS: '30000' },
    });
    const result = await click(f);
    const seen = await assertHelperRefusal(result, f, 'helper-timeout');
    assert.match(
      firstLine(result.stderr),
      /^The read-only enrollment check exceeded its work budget \(enrollment check timed out after \d+ ms of its 15000 ms allowance; stdout \d+ bytes, stderr 0 bytes\)\./,
    );
    // The fixture writes ASCII JSON, escaping every non-ASCII unit of the store path.
    const ascii = enrollmentLine(f.dataDir).replace(
      /[\u007f-\uffff]/g,
      (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    assert.equal(seen.stdout, ascii.length);
    assert.ok(seen.elapsed >= 15_000 && result.elapsed < 22_000, `elapsed ${result.elapsed}`);
    const opened = /^opened (\d+)\n$/.exec(await readFile(marker, 'utf8'));
    assert.ok(opened, 'The descendant must have held the pipes and never closed them itself.');
    assert.equal(alive(Number(opened[1])), false, 'The descendant must be collected with the job.');
  },
);

test(
  'a failed ownership helper reports its exit code and byte counts, never its output',
  { skip: !native, timeout: 60_000 },
  async () => {
    const f = await fixture('failed ownership', {
      helper: `${prelude}if(mode==='--store-state'){process.stderr.write(${JSON.stringify(canary)});
process.stdout.write(${JSON.stringify(canary)});process.exitCode=7;}
else process.stdout.write(enrollment);`,
    });
    const result = await click(f);
    const seen = await assertHelperRefusal(result, f, 'helper-refused');
    assert.match(
      firstLine(result.stderr),
      /^The Node 22 runtime, launcher configuration or store ownership could not be checked \(ownership check exited with code 7 after \d+ ms of its 15000 ms allowance; stdout 21 bytes, stderr 21 bytes\)\. Check the configured runtime/,
    );
    assert.equal(result.records.at(-1).childExit, 7);
    assert.ok(seen.elapsed < 15_000);
  },
);

test(
  'a malformed enrollment response is refused with its stage and counts only',
  { skip: !native, timeout: 60_000 },
  async () => {
    const f = await fixture('malformed enrollment', {
      helper: `${prelude}process.stdout.write(mode==='--store-state'?free:'{'+${JSON.stringify(canary)}+'}\\n');`,
    });
    const result = await click(f);
    await assertHelperRefusal(result, f, 'helper-invalid');
    assert.match(
      firstLine(result.stderr),
      /^The read-only launcher check returned an invalid or oversized response \(enrollment check returned invalid or oversized output after \d+ ms of its 15000 ms allowance; stdout 24 bytes, stderr 0 bytes\)\. No gateway was started\.$/,
    );
  },
);

test(
  'a failed recheck keeps the last held result and adds its measured observation',
  { skip: !native, timeout: 60_000 },
  async () => {
    const samples = join(base, 'recheck samples');
    const f = await fixture('failed recheck', {
      helper: `${prelude}if(mode==='--store-state'){
const count=fs.existsSync(${JSON.stringify(samples)})?Number(fs.readFileSync(${JSON.stringify(samples)},'utf8')):0;
fs.writeFileSync(${JSON.stringify(samples)},String(count+1));
if(count===0)process.stdout.write(JSON.stringify({state:'held',path:process.env.GG_DATA_DIR+'\\\\graphgoblin.lock',detail:'another GraphGoblin process holds this store'})+'\\n');
else{process.stderr.write(${JSON.stringify(canary)});process.exitCode=7;}}
else process.stdout.write(enrollment);`,
      // Six seconds leave room for one retry inside the release window less its reserve.
      timeout: 6,
    });
    const result = await click(f);
    assert.equal(result.code, 1);
    assert.equal(await readFile(samples, 'utf8'), '2', 'A retry must follow the held sample.');
    const lock = join(f.dataDir, 'graphgoblin.lock');
    const line = firstLine(result.stderr);
    assert.ok(
      line.startsWith(
        `another GraphGoblin process holds this store; check its port/configuration or let startup/shutdown finish: ${lock}. No second gateway was started. Do not stop an unrelated process or delete an unverified lock. The last ownership recheck was inconclusive (ownership check exited with code 7 after `,
      ),
      line,
    );
    assert.match(line, /; the last verified held result was retained\.$/);
    const seen = measured(line);
    assert.deepEqual([seen.stdout, seen.stderr], [0, canary.length]);
    // The retry's window ended at the release window less the two-second cleanup reserve.
    assert.ok(seen.allowance > 0 && seen.allowance <= 4000, `allowance ${seen.allowance}`);
    assert.deepEqual(
      result.records
        .filter((record) => record.outcome !== 'slow-check')
        .map((record) => [record.code, record.lock]),
      [['store-held', lock]],
    );
    assert.ok(!result.stderr.includes(canary) && !JSON.stringify(result.records).includes(canary));
    await assert.rejects(readFile(f.spawned), { code: 'ENOENT' });
  },
);
