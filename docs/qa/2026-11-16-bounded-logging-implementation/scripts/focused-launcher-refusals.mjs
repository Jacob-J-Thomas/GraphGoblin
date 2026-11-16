// Focused native check of the compiled candidate launcher's pre-spawn refusals (#438).
// No build, gateway, port or owner resource: every case refuses before networking.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const [exe, workParent, node] = process.argv.slice(2);
const system = (tool) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', tool);
const base = await mkdtemp(join(workParent, 'refusals-'));
const folder = join(base, 'private launcher folder');
await mkdir(folder);
const sid = /"(S-1-[0-9-]+)"/.exec(
  (await execute(system('whoami.exe'), ['/user', '/fo', 'csv', '/nh'])).stdout,
)[1];
await execute(system('icacls.exe'), [
  folder,
  '/inheritance:r',
  '/grant:r',
  `*${sid}:(OI)(CI)F`,
  '*S-1-5-18:(OI)(CI)F',
  '*S-1-5-32-544:(OI)(CI)F',
]);
const repo = join(base, 'fake checkout');
const files = {
  'apps/api/dist/main.js': 'export const legacyEntry = true;\n',
  'apps/api/dist/instance-identity.js': 'process.stdout.write("GG_HELPER_CANARY not a digest\\n");\n',
  'apps/api/dist/windows-log/guard.js': '// orphaned current guard module\n',
  'apps/web/dist/index.html': '<html></html>',
};
for (const [file, contents] of Object.entries(files)) {
  await mkdir(dirname(join(repo, file)), { recursive: true });
  await writeFile(join(repo, file), contents);
}
const config = join(folder, 'GraphGoblin.exe.json');
await writeFile(
  config,
  JSON.stringify({
    Repo: repo,
    Node: node,
    DataDir: join(base, 'store'),
    Port: 4899,
    Environment: {},
    StartupTimeoutSeconds: 5,
    WindowTimeoutSeconds: 2,
  }),
);
const run = (args) =>
  execute(exe, args, { windowsHide: true, timeout: 30_000 }).then(
    (result) => ({ code: 0, ...result }),
    (error) => error,
  );
const results = [];
async function refusal(name, args, pattern) {
  const result = await run(args);
  results.push({ name, code: result.code, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.code, 1, name);
  assert.equal(result.stdout, '', name);
  assert.match(result.stderr, pattern, name);
  assert.doesNotMatch(result.stderr, /CANARY|Exception|   at /, name);
  assert.ok(result.stderr.includes(`Configuration: ${config}`), name);
}
await refusal(
  'stale entry beside current guard',
  ['--config', config, '--ensure-gateway'],
  /built gateway does not match this launcher/,
);
await writeFile(join(repo, 'apps/api/dist/main.js'), 'export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;\n');
await refusal(
  'current entry with invalid helper output',
  ['--config', config, '--ensure-gateway'],
  /could not be checked/,
);
// Quiet mode only: without --ensure-gateway an interactive refusal shows the existing dialog.
await refusal(
  'unknown argument',
  ['--config', config, '--ensure-gateway', '--surprise'],
  /^Unknown launcher argument\./,
);
await unlink(join(repo, 'apps/api/dist/windows-log/guard.js'));
await refusal(
  'missing guard module',
  ['--config', config, '--ensure-gateway'],
  /not built: apps\/api\/dist\/windows-log\/guard\.js/,
);
const log = await readFile(join(folder, 'launcher.log'));
const records = new TextDecoder('utf-8', { fatal: true })
  .decode(log)
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
assert.deepEqual(
  records.map((record) => [record.stage, record.code]),
  [
    ['configuration', 'configuration-refused'],
    ['gateway', 'helper-refused'],
    ['arguments', 'invalid-argument'],
    ['configuration', 'configuration-refused'],
  ],
);
for (const line of log.toString('utf8').split('\n').filter(Boolean))
  assert.ok(Buffer.byteLength(line) + 1 <= 4096);
assert.doesNotMatch(log.toString('utf8'), /CANARY/);
console.log(JSON.stringify({ evidence: 'focused-launcher-refusals', base, results, records }));
