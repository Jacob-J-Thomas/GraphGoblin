// Round-4 evidence capture. Run from the worktree root with Node 22 on PATH.
// No source/test changes, directory deletion, or retry of a command occurs here.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';

const head = '113953db00d0f82f8e5ee9c0371eb44f2198191e';
const cwd = process.cwd();
if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== head)
  throw new Error('Unexpected HEAD');
if (!process.version.startsWith('v22.')) throw new Error('Node 22 required');
const out = path.join(cwd, 'docs/qa/2026-10-22-wp-d1-uncertain-scripts');
const temporaryBase = os.tmpdir();
const root = fs.mkdtempSync(path.join(temporaryBase, 'gg-wp-d1-r4-'));
const profileParts = process.env.USERPROFILE.split(/[\\/]/);
const username = profileParts.at(-1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Also cover file URLs, JSON-escaped backslashes, and pnpm's wrapped error paths.
const localPrefix = new RegExp(
  `C:(?:[\\\\/]|[\\r\\n │]){1,30}Users(?:[\\\\/]|[\\r\\n │]){1,30}${username}`,
  'gi',
);
const sanitize = (value) => value.replace(localPrefix, '<local>');
const display = (value) => sanitize(value.replaceAll(root, `%TEMP%/${path.basename(root)}`));
const write = (name, data) =>
  fs.writeFileSync(path.join(out, name), sanitize(JSON.stringify(data, null, 2)) + '\n');
const directories = new Map([[root, new Date().toISOString()]]);
const pids = new Map();
let events = 0;
const seen = (absolute) => {
  try {
    if (fs.statSync(absolute).isDirectory()) {
      if (!directories.has(absolute)) directories.set(absolute, new Date().toISOString());
    } else {
      const name = path.basename(absolute);
      let pid;
      if (/^marker\.active-\d+$/.test(name)) pid = Number(name.split('-').at(-1));
      if (/\.pid$|^graphgoblin\.lock$/.test(name)) {
        const text = fs.readFileSync(absolute, 'utf8');
        try {
          const parsed = JSON.parse(text);
          pid = typeof parsed === 'number' ? parsed : parsed.pid;
        } catch {
          if (/^\d+\s*$/.test(text)) pid = Number(text.trim());
        }
      }
      if (Number.isSafeInteger(pid) && pid > 0)
        pids.set(pid, { pid, evidence: display(absolute), observedAt: new Date().toISOString() });
    }
  } catch {
    // Windows can deliver a rename event after a short-lived fixture has gone.
  }
};
const watcher = fs.watch(root, { recursive: true }, (_event, name) => {
  events++;
  if (name) seen(path.join(root, String(name)));
});
const scan = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    seen(absolute);
    if (entry.isDirectory() && !entry.isSymbolicLink()) scan(absolute);
  }
};

// Resource-only Vite transforms: the asserted behavior and coverage policy are unchanged.
const config = (name, base) => {
  const filename = path.join(root, `${name}.config.mjs`);
  fs.writeFileSync(
    filename,
    `import base from ${JSON.stringify(path.join(cwd, base).replaceAll('\\', '/'))};
export default { ...base, plugins: [...(base.plugins ?? []), {
  name: 'round4-disposable-resources', enforce: 'pre',
  transform(code, id) {
    if (!/\\.test\\.tsx?$|api-subprocess\\.ts$|test-app\\.ts$|global-setup\\.ts$/.test(id.split('?')[0])) return;
    return code.replaceAll("'gg-", "'gg-wp-d1-r4-")
      .replaceAll('[5600, 5699]', '[5690, 5699]')
      .replaceAll('[5910, 5919]', '[5690, 5694]')
      .replaceAll('[5930, 5939]', '[5695, 5699]');
  }
}] };
`,
  );
  return filename;
};
const infraConfig = config('infrastructure', 'packages/infrastructure/vitest.config.ts');
const apiConfig = config('api', 'apps/api/vitest.config.ts');
const commands = [
  ['build', 'pnpm.cmd build', 'round4-build.log.txt'],
  [
    'contracts',
    'pnpm.cmd --filter @graphgoblin/contracts test:coverage --maxWorkers=2',
    'contracts-coverage.log.txt',
  ],
  [
    'engine',
    'pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=2',
    'engine-coverage-final.log.txt',
  ],
  [
    'infrastructure',
    `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --config '${infraConfig}' --maxWorkers=1 --coverage.reportOnFailure`,
    'infrastructure-coverage-final.log.txt',
  ],
  [
    'api',
    `pnpm.cmd --filter @graphgoblin/api test:coverage --config '${apiConfig}' --maxWorkers=1 --coverage.reportOnFailure`,
    'api-coverage-final.log.txt',
  ],
  ['docs', 'pnpm.cmd docs:generate', 'docs-generate.log.txt'],
  ['client', 'pnpm.cmd --filter @graphgoblin/api-client generate', 'client-generate.log.txt'],
];
const results = [];
const startedAt = new Date().toISOString();
const runRecord = () =>
  write('round4-run-record.json', {
    on: head,
    startedAt,
    node: process.version,
    temporaryRoot: display(root),
    policy:
      'One execution per command; only resource prefixes/port ranges and worker limits differ. No threshold or exclusion changes.',
    runs: results,
  });
runRecord();
for (const [name, command, log] of commands) {
  const start = new Date().toISOString();
  const destination = path.join(out, log);
  const stream = fs.createWriteStream(destination, { flags: 'wx' });
  stream.write(
    `Round 4; HEAD ${head}; Node ${process.version}\nCommand: ${display(command)}\nStarted: ${start}\n\n`,
  );
  process.stdout.write(`START ${name}: ${display(command)}\n`);
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); & ${command}; exit $LASTEXITCODE`,
    ],
    {
      cwd,
      env: { ...process.env, TEMP: root, TMP: root, NO_COLOR: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (chunk) => stream.write(chunk));
  child.stderr.on('data', (chunk) => stream.write(chunk));
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  stream.write(`\nFinished: ${new Date().toISOString()}; exitCode: ${exitCode}\n`);
  await new Promise((resolve) => stream.end(resolve));
  fs.writeFileSync(destination, sanitize(fs.readFileSync(destination, 'utf8')));
  const record = {
    name,
    command: display(command),
    log,
    pid: child.pid,
    startedAt: start,
    finishedAt: new Date().toISOString(),
    exitCode,
  };
  const coverage = {
    contracts: 'packages/contracts',
    engine: 'packages/engine',
    infrastructure: 'packages/infrastructure',
    api: 'apps/api',
  }[name];
  if (coverage) {
    const summary = path.join(cwd, coverage, 'coverage/coverage-summary.json');
    if (fs.existsSync(summary) && fs.statSync(summary).mtimeMs >= Date.parse(start))
      record.coverage = JSON.parse(fs.readFileSync(summary, 'utf8')).total;
  }
  results.push(record);
  scan(root);
  runRecord();
  process.stdout.write(`END ${name}: exit ${exitCode}\n`);
}
scan(root);
watcher.close();
const created = [...directories].map(([directory, observedAt]) => ({
  path: display(directory),
  observedAt,
  existsNow: fs.existsSync(directory),
}));
const observedProcesses = [...pids.values()].map((record) => {
  let running;
  try {
    process.kill(record.pid, 0);
    running = true;
  } catch (error) {
    running = error.code === 'EPERM' ? 'unknown: permission denied' : false;
  }
  return { ...record, runningAtInventory: running };
});
write('cleanup-inventory.json', {
  on: head,
  round: 4,
  observedAt: new Date().toISOString(),
  temporaryRoot: display(root),
  provenance:
    'Actual round-4 recursive filesystem observation plus final scan and PID-file liveness probes. Not a reconstruction of the lost original inventory.',
  observationLimits:
    'Filesystem events may miss directories created and removed before stat; no claim of complete descendant-process discovery. No machine-wide process is attributed to this round without a fixture PID record.',
  filesystemEvents: events,
  created,
  removed: created
    .filter((entry) => !entry.existsNow)
    .map((entry) => ({
      ...entry,
      reason: 'Removed by the invoked command/fixture teardown; no manual directory deletion.',
    })),
  remaining: created
    .filter((entry) => entry.existsNow)
    .map((entry) => ({
      ...entry,
      reason: 'Retained for orchestrator cleanup: round rules prohibit manual directory deletion.',
    })),
  processes: {
    commandRunners: results.map(({ name, pid, exitCode }) => ({
      name,
      pid,
      exitCode,
      exited: true,
    })),
    fixturePidObservations: observedProcesses,
    remaining: observedProcesses.filter((entry) => entry.runningAtInventory !== false),
  },
  manuallyDeletedDirectories: 0,
  ownerAppOrStoreUsed: false,
});
process.stdout.write('DONE: six requested commands executed once; inventory retained.\n');
