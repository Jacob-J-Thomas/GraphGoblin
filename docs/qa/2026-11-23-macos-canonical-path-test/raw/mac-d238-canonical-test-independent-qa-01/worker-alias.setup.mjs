import { afterAll, inject } from 'file:///G:/ggq/gg-mac-d238-alias-qa/GraphGoblin/node_modules/vitest/dist/index.js';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const config = inject('d238Alias');
const native = { mkdtemp: promises.mkdtemp, rm: promises.rm, realpath: promises.realpath, lstat: promises.lstat, writeFile: promises.writeFile, readFile: promises.readFile, spawn: childProcess.spawn };
const lower = (value) => path.resolve(value).toLowerCase();
const inside = (root, value) => { const relative = path.relative(lower(root), lower(value)); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); };
const original = { TEMP: process.env.TEMP, TMP: process.env.TMP, tmpdir: os.tmpdir() };
const fixtureDirectories = [];
const children = [];
const pendingReads = [];
if (!process.env.VITEST_WORKER_ID) throw new Error('Alias setup must execute in the selected actual worker.');
const physical = await native.realpath(config.target);
const aliasPhysical = await native.realpath(config.alias);
if (lower(physical) !== lower(aliasPhysical) || lower(config.alias) === lower(physical)) throw new Error('Real alias/target precondition failed.');
process.env.TEMP = config.alias;
process.env.TMP = config.alias;
const actualTmpdir = os.tmpdir();
if (lower(actualTmpdir) !== lower(config.alias) || lower(await native.realpath(actualTmpdir)) !== lower(physical)) throw new Error('Worker tmpdir did not actually use the real junction.');
promises.mkdtemp = async (...args) => {
  const result = await native.mkdtemp(...args);
  if (inside(config.alias, result)) {
    const resolved = await native.realpath(result);
    if (!inside(physical, resolved)) throw new Error('Actual fixture directory escaped owned physical target.');
    fixtureDirectories.push({ alias: result, physical: resolved, prefix: String(args[0]) });
  }
  return result;
};
promises.rm = async (...args) => {
  const record = fixtureDirectories.find((row) => lower(row.alias) === lower(String(args[0])));
  if (record) {
    const resolved = await native.realpath(record.alias).catch((error) => { if (error.code === 'ENOENT') return record.physical; throw error; });
    if (lower(resolved) !== lower(record.physical) || !inside(physical, resolved)) throw new Error('Refusing fixture cleanup after physical target changed.');
  }
  return native.rm(...args);
};
childProcess.spawn = (...args) => {
  const [executable, argv, options] = args;
  let actualArgs = args;
  let record;
  if (Array.isArray(argv) && argv[0] && lower(argv[0]) === lower(config.entry)) {
    if (lower(fs.realpathSync(executable)) !== lower(fs.realpathSync(process.execPath))) throw new Error('Unexpected API executable.');
    if (lower(fs.realpathSync(argv[0])) !== lower(fs.realpathSync(config.entry))) throw new Error('Unexpected built entry.');
    const env = options?.env;
    const owned = fixtureDirectories.find((row) => lower(row.alias) === lower(env?.GG_DATA_DIR ?? ''));
    const port = Number(env?.GG_PORT);
    if (!owned || lower(fs.realpathSync(owned.alias)) !== lower(owned.physical) || !Number.isInteger(port) || port < 1 || port > 65535 || [4747,4748,11434].includes(port) || env.GG_HOST !== '127.0.0.1') throw new Error('API child did not bind an actual owned fixture/port.');
    const childEnv = { ...env, GG_OLLAMA_ENABLED: 'false' };
    const childOptions = { ...options, env: childEnv };
    if (!Object.entries(env).every(([name,value]) => name === 'GG_OLLAMA_ENABLED' || childEnv[name] === value) || !Object.entries(options).every(([name,value]) => name === 'env' || childOptions[name] === value)) throw new Error('Unexpected child option/environment delta.');
    actualArgs = [executable, argv, childOptions];
    record = { executable, entry: argv[0], keyCli: argv.includes('--create-api-key'), dataDir: env.GG_DATA_DIR, database: env.GG_DB_URL, port, environmentDelta: { name: 'GG_OLLAMA_ENABLED', before: env.GG_OLLAMA_ENABLED ?? null, after: 'false' }, spawnUtc: new Date().toISOString(), close: null };
  }
  const child = native.spawn(...actualArgs);
  if (record) {
    record.pid = child.pid;
    children.push(record);
    child.once('close', (code,signal) => { record.close = { code, signal, utc: new Date().toISOString() }; });
    if (!record.keyCli) {
      let witnessed = false;
      child.stdout?.on('data', (chunk) => {
        if (witnessed || !String(chunk).includes('GraphGoblin API listening')) return;
        witnessed = true;
        pendingReads.push(native.readFile(path.join(record.dataDir,'graphgoblin.lock'),'utf8').then((text) => { const row = JSON.parse(text); if (row.pid === record.pid) record.ownerRecordIdentity = { pid: row.pid, windowsCreationTime: row.windowsCreationTime ?? null }; }).catch(() => undefined));
      });
    }
  }
  return child;
};
syncBuiltinESMExports();
afterAll(async () => {
  await Promise.all(pendingReads);
  promises.mkdtemp = native.mkdtemp;
  promises.rm = native.rm;
  childProcess.spawn = native.spawn;
  syncBuiltinESMExports();
  for (const name of ['TEMP','TMP']) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; }
  const absence = await Promise.all(fixtureDirectories.map(async (row) => ({ ...row, absent: await native.lstat(row.alias).then(() => false, (error) => { if (error.code === 'ENOENT') return true; throw error; }) })));
  const result = { stage: config.stage, workerPid: process.pid, workerId: process.env.VITEST_WORKER_ID, platform: process.platform, node: process.version, coordinator: config.coordinator, workerBefore: original, workerControlled: { TEMP: config.alias, TMP: config.alias, tmpdir: actualTmpdir, realpath: aliasPhysical }, workerRestored: { TEMP: process.env.TEMP ?? null, TMP: process.env.TMP ?? null, tmpdir: os.tmpdir() }, alias: config.alias, physical, entry: config.entry, entrySha256: createHash('sha256').update(fs.readFileSync(config.entry)).digest('hex'), originalEntrySha256: config.entrySha256, fixtureDirectories: absence, children, allChildrenClosed: children.length === 3 && children.every((row) => row.close !== null), allFixtureDirectoriesAbsent: absence.length === 2 && absence.every((row) => row.absent), environmentAmendment: config.environmentAmendment, networkPacketTrace: false };
  await native.writeFile(path.join(config.evidence,config.stage + '.worker.json'), JSON.stringify(result,null,2) + '\n');
  if (!result.allChildrenClosed || !result.allFixtureDirectoriesAbsent || result.entrySha256 !== result.originalEntrySha256) throw new Error('Owned resource/source closure failed; retain worker evidence.');
});
