import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const qa = dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''));
const repository = 'G:/ggq/gg-i4-363-structured/GraphGoblin';
const scratch = 'G:/ggq/qa-scratch/i4-363-marker/replay-02';
await mkdir(scratch); // Refuse to overwrite an earlier attempt.
const schema = {
  type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false,
};
const envKeys = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && envKeys.test(key)));
const ownedPids = [];
const rows = [];
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function waitUntil(predicate, label, milliseconds = 3000) {
  const deadline = Date.now() + milliseconds;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert(predicate(), label);
}
function launch(driver, config, env) {
  const child = spawn(process.execPath, [driver, config], { env, windowsHide: true });
  ownedPids.push(child.pid);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let exit;
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => { exit = { code, signal }; resolve(exit); });
  });
  const timer = setTimeout(() => child.kill(), 6000);
  timer.unref();
  return { child, exited, exit: () => exit, output: () => ({ stdout, stderr }), clear: () => clearTimeout(timer) };
}
async function configuration(name, mode, long = false, controls = {}) {
  const root = join(scratch, name);
  let temp = join(root, 'temp');
  if (long) {
    while (temp.length + 42 < 226) temp = join(temp, 'segment'.repeat(5));
    temp = join(temp, 'x'.repeat(226 - temp.length - 1));
    assert.equal(temp.length, 226);
  }
  const home = join(root, 'home');
  await mkdir(temp, { recursive: true });
  await mkdir(home);
  for (const sentinel of ['gg-schema-KEEP00', 'gg-structured-keep']) {
    await mkdir(join(temp, sentinel));
    await writeFile(join(temp, sentinel, 'keep'), mode);
  }
  await writeFile(join(temp, 'unrelated.txt'), 'Keep this file');
  const config = { mode, schema, workingDirectory: root, recordFile: join(root, 'record.json'), stateFile: join(root, 'state.json'), ...controls };
  const configFile = join(root, 'case.json');
  await writeFile(configFile, JSON.stringify(config));
  const env = { ...baseEnv, TEMP: temp, TMP: temp, TMPDIR: temp, HOME: home, CODEX_HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home };
  return { root, temp, config, configFile, env };
}
try {
  const correctedCases = [
    ...['short', '226-character'].flatMap((label) => ['success', 'error', 'abort'].map((mode) => ({ name: `${label}-${mode}`, mode, long: label !== 'short' }))),
    { name: 'publication-window', mode: 'abort', controls: { publicationBarrier: true } },
    { name: 'observer-read', mode: 'abort', controls: { observerFault: 'read' } },
    { name: 'observer-parse', mode: 'abort', controls: { observerFault: 'parse' } },
  ];
  if (!process.argv.includes('--old-only')) for (const item of correctedCases) {
    const c = await configuration(item.name, item.mode, item.long, item.controls);
    const beforeEnv = { TEMP: process.env.TEMP, TMP: process.env.TMP, CODEX_HOME: process.env.CODEX_HOME, HOME: process.env.HOME };
    const run = launch(join(repository, 'packages/adapter-codex/src/fixtures/sdk-schema-case.mjs'), c.configFile, c.env);
    const exit = await run.exited;
    run.clear();
    const output = run.output();
    await writeFile(join(qa, `${item.name}-stdout.log`), output.stdout);
    await writeFile(join(qa, `${item.name}-stderr.log`), output.stderr);
    const rawState = await readFile(c.config.stateFile);
    await writeFile(join(qa, `${item.name}-state.json`), rawState);
    const state = JSON.parse(rawState);
    ownedPids.push(state.record.pid);
    assert.equal(exit.code, item.controls?.observerFault ? 1 : 0);
    assert.equal(state.workSettled, true);
    assert.equal(state.childAliveAfter, false);
    assert.equal(alive(state.record.pid), false);
    assert.equal(state.schemaDirectoryExistsAfter, false);
    assert.deepEqual(state.record.schema, schema);
    assert.equal(state.record.schemaText, JSON.stringify(schema));
    assert.equal(dirname(state.record.schemaDirectory), c.temp);
    if (item.long) { assert.equal(state.record.schemaDirectory.length, 243); assert.equal(state.record.schemaPath.length, 255); }
    if (item.mode === 'success') assert.deepEqual(state.outcome, { kind: 'resolved', finalResponse: '{"ok":true}' });
    else if (item.mode === 'error') assert.match(state.outcome.message, /Controlled schema fixture failure/);
    else assert.equal(state.outcome.name, 'AbortError');
    if (item.controls?.publicationBarrier) {
      assert.deepEqual([state.publicationWindow.finalMarkerExists, state.publicationWindow.observerWaiting, state.publicationWindow.workSettled, state.publicationWindow.pendingFileExistsAfter], [false, true, false, false]);
      assert.deepEqual(state.publicationWindow.pendingRecord, state.record);
      assert.equal(state.schemaPresentAtAbort, true);
    }
    if (item.controls?.observerFault) {
      assert(output.stderr.includes(state.observationError.message));
      if (item.controls.observerFault === 'read') assert.equal(state.observationError.code, 'ENOENT');
      else assert.equal(state.observationError.name, 'SyntaxError');
    } else assert.equal(output.stderr, '');
    assert.deepEqual(state.entriesAfter, state.entriesBefore);
    for (const sentinel of ['gg-schema-KEEP00', 'gg-structured-keep']) assert.equal(await readFile(join(c.temp, sentinel, 'keep'), 'utf8'), item.mode);
    assert.equal(await readFile(join(c.temp, 'unrelated.txt'), 'utf8'), 'Keep this file');
    assert.deepEqual({ TEMP: process.env.TEMP, TMP: process.env.TMP, CODEX_HOME: process.env.CODEX_HOME, HOME: process.env.HOME }, beforeEnv);
    rows.push({ name: item.name, driverPid: run.child.pid, childPid: state.record.pid, exit, pass: true });
  }
  else for (const item of correctedCases) {
    const state = JSON.parse(await readFile(join(qa, `${item.name}-state.json`), 'utf8'));
    assert.equal(state.workSettled, true);
    assert.equal(state.childAliveAfter, false);
    assert.equal(alive(state.record.pid), false);
    ownedPids.push(state.record.pid);
    rows.push({ name: item.name, childPid: state.record.pid, pass: true, provenance: 'Native case executed once in replay-01; retained state read again, SDK not re-executed.' });
  }

  // One controlled old-fixture counterfactual. Only module resolution and the writer's open/write
  // scheduling are adapted. The original observer bytes, including the unguarded parse, are intact.
  const oldRoot = join(scratch, 'old-controlled');
  await mkdir(oldRoot);
  const sdkUrl = pathToFileURL(join(repository, 'packages/adapter-codex/node_modules/@openai/codex-sdk/dist/index.js')).href;
  const originalDriver = await readFile(join(qa, 'before/sdk-schema-case.mjs'), 'utf8');
  const originalCli = await readFile(join(qa, 'before/schema-cli.mjs'), 'utf8');
  const oldDriver = originalDriver.replace("from '@openai/codex-sdk'", `from '${sdkUrl}'`);
  const hook = `
import { openSync, closeSync, existsSync, renameSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
async function controlledWrite(file, contents) {
  const descriptor = openSync(file, 'w');
  try {
    const witness = file + '.old-pause';
    writeFileSync(witness + '.pending', JSON.stringify({ pid: process.pid, parentPid: process.ppid }), { flag: 'wx' });
    renameSync(witness + '.pending', witness);
    const deadline = Date.now() + 5000;
    while (!existsSync(file + '.old-release') && Date.now() < deadline) await delay(10);
    writeFileSync(descriptor, contents);
  } finally { closeSync(descriptor); }
}
`;
  assert.equal((originalCli.match(/writeFileSync\(/g) ?? []).length, 1);
  const oldCli = hook + originalCli.replace('writeFileSync(', 'await controlledWrite(');
  await writeFile(join(oldRoot, 'sdk-schema-case.mjs'), oldDriver);
  await writeFile(join(oldRoot, 'schema-cli.mjs'), oldCli);
  await writeFile(join(qa, 'old-controlled-sdk-schema-case.mjs'), oldDriver);
  await writeFile(join(qa, 'old-controlled-schema-cli.mjs'), oldCli);
  const c = await configuration('old-controlled-case', 'abort');
  const run = launch(join(oldRoot, 'sdk-schema-case.mjs'), c.configFile, c.env);
  let oldPid;
  try {
    await waitUntil(() => existsSync(c.config.recordFile + '.old-pause'), 'old writer reached open-before-write barrier');
    const witness = JSON.parse(await readFile(c.config.recordFile + '.old-pause', 'utf8'));
    oldPid = witness.pid;
    ownedPids.push(oldPid);
    assert.equal((await readFile(c.config.recordFile)).length, 0);
    await waitUntil(() => run.exit() !== undefined, 'original observer fails within existing deadline');
    const exit = await run.exited;
    assert.equal(exit.code, 1);
    const output = run.output();
    await writeFile(join(qa, 'old-controlled-stdout.log'), output.stdout);
    await writeFile(join(qa, 'old-controlled-stderr.log'), output.stderr);
    assert.match(output.stderr, /SyntaxError: Unexpected end of JSON input/);
    assert.equal(existsSync(c.config.stateFile), false);
    const childAliveBeforeOuterCleanup = alive(oldPid);
    rows.push({ name: 'old-controlled-counterfactual', driverPid: run.child.pid, childPid: oldPid, exit, emptyFinalMarkerObserved: true, childAliveBeforeOuterCleanup, sourceObserverUnchanged: true, expectedFailure: true });
  } finally {
    if (oldPid && alive(oldPid)) process.kill(oldPid);
    if (alive(run.child.pid)) run.child.kill();
    run.clear();
    if (oldPid) await waitUntil(() => !alive(oldPid), 'owned old child absent after outer cleanup');
  }
  const hashes = Object.fromEntries(await Promise.all(['schema-cli.mjs', 'sdk-schema-case.mjs', '../sdk-schema.test.ts'].map(async (file) => {
    const path = join(repository, 'packages/adapter-codex/src/fixtures', file);
    return [path, createHash('sha256').update(await readFile(path)).digest('hex')];
  })));
  await writeFile(join(qa, 'replay-results.json'), JSON.stringify({ node: process.version, sdkSha256: createHash('sha256').update(readFileSync(join(repository, 'packages/adapter-codex/node_modules/@openai/codex-sdk/dist/index.js'))).digest('hex'), sourceHashes: hashes, rows, ownedPids, pidsAliveAfter: ownedPids.filter(alive), evidenceLimit: 'Controlled native-FS scheduling and observer faults. No naturally occurring race or orphan is claimed. No provider ran.' }, null, 2));
  assert.deepEqual(ownedPids.filter(alive), []);
  process.stdout.write(JSON.stringify({ passed: rows.length, ownedPids, pidsAliveAfter: [] }) + '\n');
} finally {
  // Last-resort ownership cleanup, never a command-line or global process-name kill.
  for (const pid of ownedPids) if (alive(pid)) process.kill(pid);
}
