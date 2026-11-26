import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const preparation = dirname(fileURLToPath(import.meta.url));
const worktree = resolve('G:/ggq/gg-fu-538/GraphGoblin');
const packet = join(preparation, 'native-author-evidence-01');
const bytes = await readFile(join(preparation, 'AUTHOR-CONTRACT.json'));
const admission = JSON.parse(await readFile(join(preparation, 'ROOT-ADMISSION.json'), 'utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const contract = JSON.parse(bytes);
if (process.argv.length !== 2 || process.platform !== 'win32' || process.versions.node !== '22.23.4' ||
    admission.state !== 'ROOT_ADMITTED_ACTUAL_AUTHOR' || admission.decision !== 'FUP083' ||
    admission.contractSha256 !== hash(bytes) || admission.head !== contract.expectedHead)
  throw new Error('unbound #538 author native evidence');
const head = execFileSync('git', ['--no-optional-locks', 'rev-parse', 'HEAD'], {
  cwd: worktree, encoding: 'utf8', windowsHide: true,
}).trim();
if (head !== contract.expectedHead) throw new Error('candidate source head changed');
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(GG_|ANTHROPIC_|OPENAI_|JEV_|CODEX_|NODE_OPTIONS$|NODE_PATH$)/i.test(name),
));
const beforeSources = await sourceWitness();
await mkdir(packet);
const owned = await mkdtemp(join(packet, 'native-wal-'));
const scratch = join(owned, 'temp');
await mkdir(scratch);
Object.assign(env, { TEMP: scratch, TMP: scratch, TMPDIR: scratch });

async function sourceWitness() {
  const output = {};
  for (const [path, expected] of Object.entries(contract.protectedSourceSha256)) {
    if (hash(await readFile(join(worktree, path))) !== expected) throw new Error('protected source drift: ' + path);
  }
  for (const path of contract.writePaths) output[path] = hash(await readFile(join(worktree, path)));
  for (const path of ['apps/api/dist/reset/reset.js', 'apps/api/dist/main.js'])
    output[path] = hash(await readFile(join(worktree, path)));
  return output;
}
const worker = spawnSync(process.execPath, [
  '--import', 'tsx', '--conditions=development', 'src/reset/__fixtures__/seed-stores.ts', join(owned, 'seed'),
], { cwd: join(worktree, 'apps/api'), env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
if (worker.status !== 0 || worker.stdout !== 'seeded') throw new Error(JSON.stringify({
  status: worker.status, signal: worker.signal, stdout: worker.stdout, stderr: worker.stderr,
}));

const sha = hash;
async function facts(path) {
  const info = await lstat(path, { bigint: true });
  return {
    identity: `${info.dev}:${info.ino}`,
    nlink: String(info.nlink),
    sha256: sha(await readFile(path)),
  };
}
async function snapshot(path, prefix = '') {
  const entries = {};
  for (const name of (await readdir(path)).sort()) {
    const full = join(path, name);
    const label = prefix + name;
    if ((await lstat(full)).isDirectory()) {
      entries[label] = { directory: true };
      Object.assign(entries, await snapshot(full, label + '/'));
    } else entries[label] = await facts(full);
  }
  return entries;
}

const databaseName = 'graphgoblin.db';
const workspaceName = '01JRESETRUNAAAAAAAAAAAAAAA';
const cases = [];
for (const [label, alias, nested] of [
  ['ordinary', undefined, false],
  ['early-hardlink', '00-unrelated-wal', false],
  ['late-hardlink', 'zz-unrelated-wal', true],
]) {
  const store = join(owned, label);
  const dbDir = nested ? join(store, 'nested') : store;
  const filename = join(dbDir, databaseName);
  const relative = nested ? 'nested/' + databaseName : databaseName;
  const realWal = filename + '-wal';
  await mkdir(dbDir, { recursive: true });
  for (const suffix of ['', '-wal']) {
    await copyFile(join(owned, 'seed', 'format-3', databaseName + suffix), filename + suffix);
  }
  if (alias) await link(realWal, join(dbDir, alias));
  await mkdir(join(store, 'workspaces', workspaceName), { recursive: true });
  await writeFile(join(store, 'workspaces', workspaceName, 'sentinel.txt'), 'owned run');
  await writeFile(join(store, 'master.key'), 'synthetic master key');
  await writeFile(join(store, 'notes.txt'), 'unrelated notes');
  const before = await snapshot(store);
  const calls = [];
  for (const args of [['--reset'], ['--reset', '--yes', '--data-dir', store]]) {
    const child = spawnSync(process.execPath, ['apps/api/dist/main.js', ...args], {
      cwd: worktree,
      env: {
        ...env,
        GG_DATA_DIR: store, GG_DB_URL: pathToFileURL(filename).href,
      },
      encoding: 'utf8', timeout: 60_000, windowsHide: true,
    });
    calls.push({
      code: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr,
      errorCode: child.error?.code,
      after: await snapshot(store), privateCopyResidue: await readdir(scratch),
    });
  }
  const relativeAlias = alias ? (nested ? 'nested/' : '') + alias : undefined;
  const [preview, confirmed] = calls;
  const observed = {
    kernelLinkWitness: relativeAlias
      ? before[relativeAlias]?.identity === before[relative + '-wal']?.identity
        && before[relativeAlias]?.nlink === '2'
      : before[relative + '-wal']?.nlink === '1',
    previewUnchanged: JSON.stringify(before) === JSON.stringify(preview.after),
    previewReadFormat3: preview.stdout.includes('format 3'),
    confirmedReadFormat3: confirmed.stdout.includes('format 3'),
    recordedWorkspaceRemoved: !(('workspaces/' + workspaceName) in confirmed.after),
    intendedPresentAfter: (relative + '-wal') in confirmed.after,
    aliasPresentAfter: relativeAlias ? relativeAlias in confirmed.after : null,
    keptAliasBytesAndIdentity: relativeAlias
      ? before[relativeAlias]?.sha256 === confirmed.after[relativeAlias]?.sha256 &&
        before[relativeAlias]?.identity === confirmed.after[relativeAlias]?.identity
      : null,
    keepBytes: ['master.key', 'notes.txt'].every(name => before[name].sha256 === confirmed.after[name]?.sha256),
  };
  cases.push({ label, relative, relativeAlias, before, calls, observed });
}
function manifestHas(out, section, path) {
  const body = out.split(section + ':\n')[1]?.split('\n\n')[0] ?? '';
  return body.split('\n').some(line => line.trimStart().split(/\s{2,}/)[0] === path);
}

const afterSources = await sourceWitness();
const sourceUntouched = JSON.stringify(beforeSources) === JSON.stringify(afterSources);
const verified = sourceUntouched && cases.every(({ label, relative, relativeAlias, calls, observed }) =>
  calls.every(call => call.code === 0 && call.stderr === '' && call.privateCopyResidue.length === 0 &&
    manifestHas(call.stdout, 'Removes', relative + '-wal') &&
    (label !== 'early-hardlink' || manifestHas(call.stdout, 'Keeps', relativeAlias))) &&
  observed.kernelLinkWitness && observed.previewUnchanged && observed.previewReadFormat3 &&
  observed.confirmedReadFormat3 && observed.recordedWorkspaceRemoved && observed.keepBytes &&
  !observed.intendedPresentAfter &&
  (!relativeAlias || (observed.aliasPresentAfter && observed.keptAliasBytesAndIdentity)));
const evidence = {
  head, platform: process.platform, osRelease: release(), node: process.version, owned, verified,
  sourceUntouched, beforeSources, afterSources, seed: { stdout: worker.stdout, stderr: worker.stderr }, cases,
};
await writeFile(join(packet, 'NATIVE-CANDIDATE-RESULT.json'), JSON.stringify(evidence, null, 2) + '\n',
  { flag: 'wx' });
process.stdout.write(JSON.stringify({ verified, sourceUntouched, cases: cases.length,
  rawResult: 'native-author-evidence-01/NATIVE-CANDIDATE-RESULT.json' }) + '\n');
if (!verified) process.exitCode = 1;
