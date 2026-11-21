// GraphGoblin #459 independent QA setup exploration (not product code): which enclosing-job
// setting actually prevents nesting on this host, verified from inside the job by the witness's
// --nest-probe mode. Usage: node nest-explore.mjs <QaWitness.exe> <output dir>
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
const KILL_ON_CLOSE = 0x2000;
const ACTIVE_PROCESS = 0x8;
// [name, outer limit flags, outer UI flags, inner (nested) UI flags, outer active-process limit]
const variants = [
  ['none', KILL_ON_CLOSE, 0, 0, 0],
  ['exitwindows', KILL_ON_CLOSE, 0x80, 0, 0],
  ['desktop', KILL_ON_CLOSE, 0x40, 0, 0],
  ['handles', KILL_ON_CLOSE, 0x1, 0, 0],
  ['globalatoms', KILL_ON_CLOSE, 0x20, 0, 0],
  ['readclipboard', KILL_ON_CLOSE, 0x2, 0, 0],
  ['writeclipboard', KILL_ON_CLOSE, 0x4, 0, 0],
  ['systemparameters', KILL_ON_CLOSE, 0x8, 0, 0],
  ['displaysettings', KILL_ON_CLOSE, 0x10, 0, 0],
  ['all-ui', KILL_ON_CLOSE, 0xff, 0, 0],
  ['all-ui-no-kill', 0, 0xff, 0, 0],
  ['inner-ui-under-plain', KILL_ON_CLOSE, 0, 0x80, 0],
  ['inner-ui-under-ui', KILL_ON_CLOSE, 0x80, 0x80, 0],
  ['active-process-1', KILL_ON_CLOSE | ACTIVE_PROCESS, 0, 0, 1],
];
const results = [];
for (const [name, limits, ui, innerUi, active] of variants) {
  const job = `explore-${name}`;
  const made = await call('job', job, limits, ui, active);
  const report = join(outDir, `probe-${name}.json`);
  const spec = Buffer.from(
    JSON.stringify({
      app: witnessExe,
      args: ['--nest-probe', report, String(innerUi)],
      cwd: outDir,
      env,
      stdoutPath: join(outDir, `probe-${name}.stdout.bin`),
      stderrPath: join(outDir, `probe-${name}.stderr.bin`),
    }),
  ).toString('base64');
  const spawned = await call('jobspawn', `probe-${name}`, job, spec);
  let state = spawned;
  for (let i = 0; i < 200 && state.alive; i++) {
    await sleep(50);
    state = await call('state', `probe-${name}`);
  }
  const accounting = await call('jobquery', job);
  await call('jobclose', job);
  results.push({
    variant: name,
    outerLimitFlags: limits,
    outerUiFlags: ui,
    innerUiFlags: innerUi,
    outerActiveProcessLimit: active,
    jobReadBack: made.readBack ?? made,
    spawn: {
      ok: spawned.ok,
      preAssignInAnyJob: spawned.preAssignInAnyJob,
      assigned: spawned.assigned,
      inHarnessJob: spawned.inHarnessJob,
      createError: spawned.createError ?? null,
      assignError: spawned.assignError ?? null,
    },
    probeExit: state.exitCode ?? null,
    probe: existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null,
    accounting: accounting.accounting,
  });
}
witness.stdin.end();
writeFileSync(join(outDir, 'nest-explore.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n');
for (const result of results)
  console.log(
    JSON.stringify({
      v: result.variant,
      readBack: result.jobReadBack,
      ownUi: result.probe?.ownJobUiRestrictions,
      jobList: result.probe?.jobListCreateProcess,
      jobListErr: result.probe?.jobListCreateProcessError ?? null,
      assignFresh: result.probe?.assignToFreshJob,
      assignErr: result.probe?.assignToFreshJobError ?? null,
      total: result.accounting?.totalProcesses,
    }),
  );
