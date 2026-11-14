import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const worktree = await realpath(process.argv[2]);
const expected = '6fff3987068059ca5d9d798c61224bf5e555d711';
const parent = '934971a3f3dd0a17489883907127721c12752b18';
const marker = '.graphgoblin-plugin-output.json';
const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8' }).trim();
assert.equal(process.platform, 'win32');
assert.equal(git('rev-parse', 'HEAD'), expected);
assert.equal(git('rev-parse', 'HEAD^'), parent);
assert.equal(git('status', '--porcelain=v1'), '');
const evidence = await realpath(dirname(fileURLToPath(import.meta.url)));
const fromRepo = relative(worktree, evidence);
assert(fromRepo.startsWith('..' + sep) || isAbsolute(fromRepo), 'Use an external evidence directory');
const scratch = await mkdtemp(join(evidence, 'A1 disposable '));
const outputParent = join(scratch, 'output [set] & owner' + "'s" + ' 漢 é $!');
const packageDir = join(scratch, 'copied package');
const caller = join(scratch, 'neutral cwd');
const inspectorTemp = join(scratch, 'inspector temp');
const sourceApp = join(worktree, 'apps', 'plugin-codex');
const cli = join(packageDir, 'dist', 'cli.js');
const tooling = join(packageDir, 'node_modules', '@graphgoblin', 'tooling');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hash = async (file) => sha(await readFile(file));
const binding = {};
const commands = [];
const scenarios = [];
const scanSecret = 'synthetic-' + randomUUID();
const streamName = 'foreign-' + randomUUID();
const baselineEntry = join(scratch, 'MCP [begin] & é $.js');
const nextEntry = join(scratch, 'MCP [replacement] & new 漢 $.js');
const env = { ...process.env, GG_API_KEY: scanSecret, TEMP: inspectorTemp, TMP: inspectorTemp };
delete env.NODE_OPTIONS;
const clean = () => {
  assert.equal(git('rev-parse', 'HEAD'), expected);
  assert.equal(git('status', '--porcelain=v1'), '');
};
const namesOfCopiedSources = [
  'apps/plugin-codex/package.json',
  'apps/plugin-codex/dist/cli.js',
  'apps/plugin-codex/dist/assemble.js',
  'apps/plugin-codex/dist/manifest.js',
  'tooling/package.json',
  'tooling/plugin-output.mjs',
  'tooling/plugin-output-metadata.mjs',
  'tooling/windows-plugin-streams.ps1',
  'tooling/linux-plugin-attributes.py',
];

for (const dir of [dirname(cli), caller, tooling, outputParent, inspectorTemp]) await mkdir(dir, { recursive: true });
for (const path of namesOfCopiedSources) {
  const cwd = path.startsWith('tooling/') ? tooling : packageDir;
  const name = path.replace(/^(tooling|apps\/plugin-codex)\//, '');
  const copy = join(cwd, name);
  await cp(join(worktree, path), copy);
  binding[path] = await hash(copy);
  assert.equal(binding[path], await hash(join(worktree, path)));
}
await cp(join(sourceApp, 'plugin'), join(packageDir, 'plugin'), { recursive: true });
await cp(await realpath(join(sourceApp, 'node_modules', 'zod')), join(packageDir, 'node_modules', 'zod'), { recursive: true });
await writeFile(baselineEntry, '/* disposable MCP fixture */\n');
await writeFile(nextEntry, '/* independent rebuild fixture */\n');

async function snapshot(root, findings = [], prefix = '') {
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) {
      findings.push({ name, directory: true });
      await snapshot(path, findings, name + '/');
    } else {
      assert(entry.isFile());
      const bytes = await readFile(path);
      assert(!bytes.includes(Buffer.from(scanSecret)), 'Fixture key appeared in output');
      findings.push({ name, bytes: bytes.length, sha256: sha(bytes) });
    }
  }
  return findings;
}

async function invoke(label, out, entry, exit, message) {
  const resolvedParent = await realpath(dirname(out));
  assert.equal(resolvedParent, await realpath(outputParent));
  if (await stat(out).catch((error) => error.code === 'ENOENT' ? undefined : Promise.reject(error)))
    assert.equal(await realpath(out), resolve(out));
  const lock = join(outputParent, '.' + relative(outputParent, out) + '.graphgoblin-build');
  assert(!(await stat(lock).catch((error) => error.code === 'ENOENT' ? undefined : Promise.reject(error))));
  const started = Date.now();
  const child = spawn(process.execPath, [cli, '--out', out, '--mcp-entry', entry], {
    cwd: caller, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 25_000,
    killSignal: 'SIGKILL',
  });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', (part) => { stdout += part; });
  child.stderr.setEncoding('utf8').on('data', (part) => { stderr += part; });
  const { code, signal } = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => accept({ code, signal }));
  });
  const secretLeak = [scanSecret, streamName].some((secret) => stdout.includes(secret) || stderr.includes(secret));
  commands.push({
    label, pid: child.pid, startedUtc: new Date(started).toISOString(),
    elapsedMs: Date.now() - started, code, signal, out: relative(scratch, out),
    mcpEntry: relative(scratch, entry), stdout: secretLeak ? '[suppressed]' : stdout.trim(),
    stderr: secretLeak ? '[suppressed]' : stderr.trim(), secretLeak,
  });
  assert.equal(secretLeak, false);
  assert.equal(signal, null);
  assert.match(stderr, message);
  assert.equal(code, exit);
  if (exit !== 0) {
    assert(stderr.includes(out), 'Refusal omitted literal output destination');
    assert.doesNotMatch(stderr, /Assembled graphgoblin/);
  }
  assert(!(await stat(lock).catch((error) => error.code === 'ENOENT' ? undefined : Promise.reject(error))),
    'Unexpected surviving build staging directory');
}

const ok = /Assembled graphgoblin@graphgoblin-local/;
const metadataRefusal = /Unowned alternate data stream found/;
const generatedSkill = join('plugins', 'graphgoblin', 'skills', 'design-loop', 'SKILL.md');
const config = join('plugins', 'graphgoblin', '.mcp.json');
const windowsHelper = join(tooling, 'windows-plugin-streams.ps1');
const helperBytes = await readFile(windowsHelper);

let failure;
try {
  const cleanOutput = join(outputParent, 'A clean output');
  await mkdir(cleanOutput);
  await invoke('initial takeover of genuinely empty root', cleanOutput, baselineEntry, 0, ok);
  const first = await snapshot(cleanOutput);
  assert.equal(JSON.parse(await readFile(join(cleanOutput, config), 'utf8')).mcpServers.graphgoblin.args[0], baselineEntry);
  await invoke('owned artifact rebuild with changed MCP path', cleanOutput, nextEntry, 0, ok);
  const second = await snapshot(cleanOutput);
  assert.equal(JSON.parse(await readFile(join(cleanOutput, config), 'utf8')).mcpServers.graphgoblin.args[0], nextEntry);
  const changed = second.filter((record, index) => record.sha256 !== first[index]?.sha256).map(({ name }) => name);
  assert.deepEqual(changed.sort(), [marker, config.split(sep).join('/')].sort());
  scenarios.push({ case: 'clean rebuild', changed, initial: first, rebuilt: second });

  const cases = [
    { scope: 'empty root', object: '', payload: Buffer.from([1, 0, 255, 12]) },
    { scope: 'owned root', object: '', payload: Buffer.from(scanSecret) },
    { scope: 'generated file', object: generatedSkill, payload: Buffer.from([127, 0, 20, 219, 255]) },
    { scope: 'generated subdirectory', object: dirname(generatedSkill), payload: Buffer.from('literal é 漢 data') },
    { scope: 'ownership marker zero-length named stream', object: marker, payload: Buffer.alloc(0) },
  ];
  for (const [index, { scope, object, payload }] of cases.entries()) {
    const output = join(outputParent, 'B' + index + ' ' + scope);
    if (index === 0) await mkdir(output);
    else await invoke('assemble fixture ' + index, output, baselineEntry, 0, ok);
    const ordinaryBefore = await snapshot(output);
    const target = join(output, object);
    const stream = target + (payload.length === 0 ? ':$DATA:$DATA' : ':' + streamName + ':$DATA');
    await writeFile(stream, payload);
    const before = await readFile(stream);
    assert.deepEqual(before, payload);
    assert.deepEqual(await snapshot(output), ordinaryBefore);
    await invoke('preserve stream at ' + scope, output, nextEntry, 1, metadataRefusal);
    const after = await readFile(stream);
    assert.deepEqual(after, before);
    assert.deepEqual(await snapshot(output), ordinaryBefore);
    scenarios.push({
      case: scope, object, namedStream: payload.length === 0 ? '$DATA' : '[withheld]',
      streamBefore: { bytes: before.length, sha256: sha(before) },
      streamAfter: { bytes: after.length, sha256: sha(after) },
      ordinaryTreeDigest: sha(JSON.stringify(ordinaryBefore)),
      ordinaryEntryCount: ordinaryBefore.length,
      treeAndStreamPreserved: true,
    });
  }

  // Substitute only the copied Windows inspector to exercise the public CLI's fail-closed handling.
  // It answers both inspections, then fails when stdin closes, after the incumbent was quarantined.
  const failureOutput = join(outputParent, 'C inspector close failure');
  await invoke('assemble intact fault-control artifact', failureOutput, baselineEntry, 0, ok);
  const before = await snapshot(failureOutput);
  const beforeInode = (await stat(failureOutput, { bigint: true })).ino.toString();
  const fault = `
[Console]::ReadLine() | Out-Null
[Console]::WriteLine('ok')
[Console]::ReadLine() | Out-Null
[Console]::WriteLine('ok')
[Console]::ReadLine() | Out-Null
[IO.File]::WriteAllText([IO.Path]::Combine($env:TEMP, 'fault-helper.pid'), [string]$PID)
[Console]::Error.WriteLine('${scanSecret}')
exit 7
`;
  try {
    await writeFile(windowsHelper, fault);
    await invoke('inspection failure after both acknowledgements', failureOutput, nextEntry, 1,
      /Output metadata inspection did not finish successfully/);
    assert.deepEqual(await snapshot(failureOutput), before);
    const afterInode = (await stat(failureOutput, { bigint: true })).ino.toString();
    assert.equal(afterInode, beforeInode);
    const helperPid = Number((await readFile(join(inspectorTemp, 'fault-helper.pid'), 'utf8')).trim());
    assert(Number.isSafeInteger(helperPid) && helperPid > 0);
    let helperAlive = true;
    try { process.kill(helperPid, 0); } catch (error) {
      assert.equal(error.code, 'ESRCH');
      helperAlive = false;
    }
    assert.equal(helperAlive, false);
    scenarios.push({
      case: 'inspection finishes nonzero after quarantine', beforeInode, afterInode,
      ordinaryTreeDigest: sha(JSON.stringify(before)), inspectionHelperPid: helperPid,
      helperAliveAtReturn: helperAlive, ordinaryTreePreserved: true,
    });
  } finally {
    await writeFile(windowsHelper, helperBytes);
  }
  await invoke('fresh probe after restoring exact inspector bytes', failureOutput, nextEntry, 0, ok);

  const sourceAssets = await snapshot(join(sourceApp, 'plugin'));
  assert.deepEqual(await snapshot(join(packageDir, 'plugin')), sourceAssets);
  for (const [path, digest] of Object.entries(binding)) assert.equal(await hash(join(worktree, path)), digest);
  assert.equal(await hash(windowsHelper), binding['tooling/windows-plugin-streams.ps1']);
  clean();
} catch (error) {
  failure = error;
  throw error;
} finally {
  const report = {
    runtime: process.version, windows: process.getBuiltinModule('node:os').release(), platform: process.platform,
    arch: process.arch, expected, parent, headAfter: git('rev-parse', 'HEAD'),
    statusAfter: git('status', '--porcelain=v1'), sourceAssetHashes: await snapshot(join(sourceApp, 'plugin')),
    fingerprintedSources: binding, commands, scenarios,
    outputParentEntries: await readdir(outputParent),
    inspectorTempEntries: await readdir(inspectorTemp),
    scratch: relative(evidence, scratch),
    failure: failure ? failure.message.replaceAll(scanSecret, '[suppressed]').replaceAll(streamName, '[suppressed]') : null,
  };
  await writeFile(join(scratch, 'windows-independent.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(join(scratch, 'windows-independent.json'));
}
