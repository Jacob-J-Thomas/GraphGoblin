// Independent QA for #538 through the built API CLI (`node apps/api/dist/main.js --reset`), with
// the default private-copy store reader and real disposable NTFS hard links. Read-only towards the
// worktree; every fixture lives under the run root given on the command line.
// Usage: node qa-538-cli.mjs <worktree> <runRoot> <outJson>
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [worktree, runRoot, outJson] = process.argv.slice(2).map((p) => resolve(p));
if (!worktree || !runRoot || !outJson) throw new Error('usage: qa-538-cli.mjs <worktree> <runRoot> <outJson>');
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const readerTemp = join(runRoot, 'temp-reader');
const seedTemp = join(runRoot, 'temp-seed');
const seedRoot = join(runRoot, 'seed');
await mkdir(readerTemp, { recursive: true });
await mkdir(seedTemp, { recursive: true });

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !/^(GG_|ANTHROPIC_|OPENAI_|JEV_|CODEX_|NODE_OPTIONS$|NODE_PATH$)/i.test(name),
  ),
);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const head = execFileSync('git', ['--no-optional-locks', 'rev-parse', 'HEAD'], {
  cwd: worktree,
  encoding: 'utf8',
}).trim();
const distHashes = {};
for (const p of ['apps/api/dist/main.js', 'apps/api/dist/reset/reset.js', 'apps/api/dist/reset/tree.js'])
  distHashes[p] = sha(await readFile(join(worktree, p)));

// Seed one real format-3 store (database plus committed WAL) with the repository's own fixture
// seeder. Its TEMP is separate from the reader TEMP checked for residue below.
const seed = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--conditions=development', 'src/reset/__fixtures__/seed-stores.ts', seedRoot],
  {
    cwd: join(worktree, 'apps/api'),
    env: { ...baseEnv, TEMP: seedTemp, TMP: seedTemp, TMPDIR: seedTemp },
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  },
);
if (seed.status !== 0 || seed.stdout !== 'seeded')
  throw new Error('seed failed ' + JSON.stringify({ status: seed.status, stdout: seed.stdout, stderr: seed.stderr }));
const SEED_DB = join(seedRoot, 'format-3', 'graphgoblin.db');
const SEED_WAL = SEED_DB + '-wal';
const RUN = '01JRESETRUNAAAAAAAAAAAAAAA';
const DEAD = (token) => JSON.stringify({ pid: 2147483644, token });

async function snapshot(root, prefix = '') {
  const out = {};
  for (const name of (await readdir(root)).sort()) {
    const full = join(root, name);
    const rel = prefix + name;
    const st = await lstat(full, { bigint: true });
    const id = `${st.dev}:${st.ino}`;
    if (st.isSymbolicLink()) out[rel] = { kind: 'link', id, target: await readlink(full) };
    else if (st.isDirectory()) {
      out[rel] = { kind: 'dir', id };
      Object.assign(out, await snapshot(full, rel + '/'));
    } else if (st.isFile())
      out[rel] = { kind: 'file', id, nlink: String(st.nlink), size: String(st.size), sha256: sha(await readFile(full)) };
    else out[rel] = { kind: 'other', id };
  }
  return out;
}
function hardlinks(path) {
  const r = spawnSync('fsutil', ['hardlink', 'list', path], { encoding: 'utf8', windowsHide: true });
  return { code: r.status, lines: (r.stdout || '').split(/\r?\n/).filter(Boolean), err: (r.stderr || '').trim() };
}
function cli(dataDir, dbFile, args, envExtra = {}) {
  const started = new Date().toISOString();
  const r = spawnSync(process.execPath, ['apps/api/dist/main.js', ...args], {
    cwd: worktree,
    env: {
      ...baseEnv,
      TEMP: readerTemp,
      TMP: readerTemp,
      TMPDIR: readerTemp,
      GG_DATA_DIR: dataDir,
      ...(dbFile ? { GG_DB_URL: pathToFileURL(dbFile).href } : {}),
      ...envExtra,
    },
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });
  return { args, started, code: r.status, signal: r.signal, error: r.error?.code, stdout: r.stdout, stderr: r.stderr };
}
function section(out, title) {
  const lines = out.split(/\r?\n/);
  const start = lines.indexOf(title);
  if (start < 0) return null;
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line === '') break;
    if (line.startsWith('  Browser device drafts')) continue;
    const m = /^ {2}(\S+)\s+(.*)$/.exec(line);
    rows.push(m ? { path: m[1], rest: m[2].trim() } : { path: line.trim(), rest: '' });
  }
  return rows;
}
async function residue() {
  return (await readdir(readerTemp)).filter((n) => n.startsWith('gg-reset-store-'));
}

/** A store like one a stopped server leaves: database plus WAL, a recorded run workspace, a kept
 * workspace, master.key and an owner note. */
async function makeStore(dataDir, { dbDir = '', dbName = 'graphgoblin.db', walName, wal = true } = {}) {
  const dir = join(dataDir, ...(dbDir ? dbDir.split('/') : []));
  await mkdir(dir, { recursive: true });
  await copyFile(SEED_DB, join(dir, dbName));
  if (wal) await copyFile(SEED_WAL, join(dir, walName ?? dbName + '-wal'));
  await mkdir(join(dataDir, 'workspaces', RUN), { recursive: true });
  await writeFile(join(dataDir, 'workspaces', RUN, 'sentinel.txt'), 'owned run');
  await mkdir(join(dataDir, 'workspaces', 'not-a-run'), { recursive: true });
  await writeFile(join(dataDir, 'workspaces', 'not-a-run', 'keep.txt'), 'kept workspace');
  await writeFile(join(dataDir, 'master.key'), 'synthetic master key');
  await writeFile(join(dataDir, 'notes.txt'), 'owner notes');
  return dir;
}

const results = [];
function checker() {
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail }) });
  };
  return { checks, check };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lockRows = (dbRel) => [`${dbRel}.graphgoblin.lock`, 'graphgoblin.lock'];
const anotherName = (s) => `another name for ${s}; the file stays under this name`;

/**
 * A success case. `removes` is the exact expected Removes column; `keeps` maps each expected Keeps
 * path to its reason (or null to skip the reason check). `survivors` maps each linked survivor to
 * the sidecar it shares with; `gone` lists paths that must be gone after confirmation.
 */
async function successCase(spec) {
  const dataDir = join(runRoot, spec.id);
  const ctx = await spec.build(dataDir);
  const { checks, check } = checker();
  const before = await snapshot(dataDir);
  const linksBefore = {};
  for (const p of spec.linked ?? []) linksBefore[p] = hardlinks(join(dataDir, ...p.split('/')));
  const listing = {};
  for (const d of spec.listDirs ?? ['']) listing[d || '.'] = await readdir(join(dataDir, ...(d ? d.split('/') : [])));
  const dry = cli(dataDir, ctx.dbFile, ['--reset'], ctx.env);
  const afterDry = await snapshot(dataDir);
  const residueDry = await residue();
  const confirmed = cli(dataDir, ctx.dbFile, ['--reset', '--yes', '--data-dir', dataDir], ctx.env);
  const after = await snapshot(dataDir);
  const residueConfirmed = await residue();
  const linksAfter = {};
  for (const p of spec.survivors ? Object.keys(spec.survivors) : [])
    linksAfter[p] = hardlinks(join(dataDir, ...p.split('/')));

  check('dry exit 0 and empty stderr', dry.code === 0 && dry.stderr === '', { code: dry.code, stderr: dry.stderr });
  const dryRemoves = section(dry.stdout, 'Removes:')?.map((r) => r.path);
  check('dry Removes exact', same(dryRemoves, spec.removes), { got: dryRemoves, want: spec.removes });
  const dryKeeps = section(dry.stdout, 'Keeps:');
  const wantKeeps = Object.keys(spec.keeps).sort((a, b) => (a < b ? -1 : 1));
  check('dry Keeps paths exact', same(dryKeeps?.map((r) => r.path), wantKeeps), { got: dryKeeps, want: wantKeeps });
  for (const [p, why] of Object.entries(spec.keeps))
    if (why !== null) {
      const row = dryKeeps?.find((r) => r.path === p);
      check(`dry Keeps reason for ${p}`, row?.rest === why, { got: row?.rest, want: why });
    }
  if (spec.storeLine) check('dry store line', dry.stdout.includes(spec.storeLine), { want: spec.storeLine });
  check('dry run changed nothing (names, ids, nlink, bytes)', same(before, afterDry), { before, afterDry });
  check('no private-copy residue after dry run', residueDry.length === 0, residueDry);
  check('confirmed exit 0, empty stderr, Reset complete', confirmed.code === 0 && confirmed.stderr === '' && confirmed.stdout.includes('Reset complete.'), {
    code: confirmed.code,
    stderr: confirmed.stderr,
  });
  const confRemoves = section(confirmed.stdout, 'Removes:')?.map((r) => r.path);
  const confKeeps = section(confirmed.stdout, 'Keeps:');
  check('confirmed Removes equals dry Removes', same(confRemoves, dryRemoves), { confRemoves, dryRemoves });
  check('confirmed Keeps equals dry Keeps', same(confKeeps, dryKeeps), { confKeeps, dryKeeps });
  for (const s of spec.removedSidecars ?? [])
    check(`confirmed printed removal of ${s}`, new RegExp(`\\n {2}removed ${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(1 file,`).test(confirmed.stdout), {});
  for (const g of spec.gone) check(`gone after confirm: ${g}`, !(g in after), {});
  for (const [p, sidecar] of Object.entries(spec.survivors ?? {})) {
    const b = before[p];
    const a = after[p];
    check(`survivor ${p} kept bytes and identity`, a && b && a.sha256 === b.sha256 && a.id === b.id, { before: b, after: a });
    check(`survivor ${p} identity was the sidecar ${sidecar}'s`, b && before[sidecar] && b.id === before[sidecar].id, {
      survivor: b,
      sidecar: before[sidecar],
    });
    check(`survivor ${p} nlink dropped by exactly one`, a && b && BigInt(a.nlink) === BigInt(b.nlink) - 1n, { before: b?.nlink, after: a?.nlink });
  }
  const wantAfter = Object.keys(before).filter((p) => !spec.gone.some((g) => p === g || p.startsWith(g + '/')));
  check('exactly the expected entries remain', same(Object.keys(after).sort(), wantAfter.sort()), { after: Object.keys(after), want: wantAfter });
  for (const p of wantAfter)
    if (before[p]?.kind === 'file' && !(spec.survivors ?? {})[p])
      check(`unrelated ${p} unchanged`, after[p] && after[p].sha256 === before[p].sha256 && after[p].id === before[p].id, {
        before: before[p],
        after: after[p],
      });
  check('no private-copy residue after confirm', residueConfirmed.length === 0, residueConfirmed);
  if (spec.extra) spec.extra({ check, before, after, dry, confirmed, listing });
  results.push({
    id: spec.id,
    group: spec.group,
    description: spec.description,
    pass: checks.every((c) => c.ok),
    listing,
    linksBefore,
    linksAfter,
    before,
    calls: [{ ...dry, after: afterDry, residue: residueDry }, { ...confirmed, after, residue: residueConfirmed }],
    checks,
  });
}

/** A refusal case: both the dry run and the confirmed reset refuse with `err` and change nothing. */
async function refusalCase(spec) {
  const dataDir = join(runRoot, spec.id);
  const ctx = await spec.build(dataDir);
  const { checks, check } = checker();
  const before = await snapshot(dataDir);
  const linksBefore = {};
  for (const p of spec.linked ?? []) linksBefore[p] = hardlinks(join(dataDir, ...p.split('/')));
  const calls = [];
  try {
    if (ctx.beforeCalls) await ctx.beforeCalls();
    for (const args of [['--reset'], ['--reset', '--yes', '--data-dir', dataDir]]) {
      const call = cli(dataDir, ctx.dbFile, args, ctx.env);
      const now = await snapshot(dataDir);
      const res = await residue();
      calls.push({ ...call, after: now, residue: res });
      const label = args.length === 1 ? 'dry' : 'confirmed';
      check(`${label} exit 1 with empty stdout`, call.code === 1 && call.stdout === '', { code: call.code, stdout: call.stdout });
      const want = typeof spec.err === 'function' ? spec.err(dataDir) : spec.err;
      if (want instanceof RegExp) check(`${label} refusal text`, want.test(call.stderr), { got: call.stderr, want: String(want) });
      else check(`${label} refusal text exact`, call.stderr === want, { got: call.stderr, want });
      check(`${label} says nothing in the data directory changed`, call.stderr.endsWith('Nothing in the data directory was changed.\n'), {});
      check(`${label} changed nothing (names, ids, nlink, bytes)`, same(before, now), { before, now });
      check(`${label} left no private-copy residue`, res.length === 0, res);
    }
  } finally {
    if (ctx.afterCalls) await ctx.afterCalls();
  }
  results.push({
    id: spec.id,
    group: spec.group,
    description: spec.description,
    pass: checks.every((c) => c.ok),
    linksBefore,
    before,
    calls,
    checks,
  });
}

const W = ['-wal', 'SQLite write-ahead log'];
const SUFFIXES = [W, ['-shm', 'SQLite shared memory'], ['-journal', 'SQLite rollback journal']];
const ROOT_KEEPS = { 'master.key': 'secret-store key; kept so the secrets in a backup of this store stay readable', 'notes.txt': 'not part of the store', 'workspaces/not-a-run': 'not a stored run ID' };
const FORMAT3 = '(format 3; this build requires format 4)';

// P1-P18: suffix x layout x other-link position, real hard links, real seeded WAL.
for (const [suffix, what] of SUFFIXES)
  for (const layout of ['root', 'nested'])
    for (const alias of ['none', '00-unrelated', 'zz-unrelated']) {
      const dbDir = layout === 'root' ? '' : 'nested';
      const pre = dbDir ? dbDir + '/' : '';
      const dbRel = pre + 'graphgoblin.db';
      const sidecarRel = dbRel + suffix;
      const aliasRel = pre + alias;
      const removes = ['workspaces/' + RUN, dbRel, dbRel + '-wal', ...(suffix === '-wal' ? [] : [sidecarRel]), ...lockRows(dbRel)];
      const keeps = { ...ROOT_KEEPS };
      if (alias !== 'none' && layout === 'root') keeps[alias] = anotherName(sidecarRel);
      await successCase({
        id: `P-${layout}${suffix}-${alias}`,
        group: 'positive hard-link matrix (built CLI, default reader, real seeded WAL)',
        description: `${layout} ${suffix} sidecar, other hard link: ${alias}`,
        listDirs: [dbDir],
        linked: alias === 'none' ? [] : [aliasRel],
        build: async (dataDir) => {
          const dir = await makeStore(dataDir, { dbDir });
          if (suffix !== '-wal') await writeFile(join(dir, 'graphgoblin.db' + suffix), `synthetic ${suffix} bytes`);
          if (alias !== 'none') await link(join(dir, 'graphgoblin.db' + suffix), join(dir, alias));
          return { dbFile: join(dir, 'graphgoblin.db') };
        },
        removes,
        keeps,
        storeLine: FORMAT3,
        removedSidecars: [sidecarRel],
        gone: ['workspaces/' + RUN, dbRel, dbRel + '-wal', sidecarRel],
        survivors: alias === 'none' ? {} : { [aliasRel]: sidecarRel },
        extra: ({ check, listing }) => {
          if (alias === 'none') return;
          const names = listing[dbDir || '.'];
          const ai = names.indexOf(alias);
          const si = names.indexOf('graphgoblin.db' + suffix);
          check(`native listing puts ${alias} ${alias.startsWith('00') ? 'before' : 'after'} the sidecar`, alias.startsWith('00') ? ai < si : ai > si, { names });
        },
      });
    }

// P19-P21: a nested sidecar with a top-level hard link.
for (const [suffix] of SUFFIXES) {
  const sidecarRel = 'nested/graphgoblin.db' + suffix;
  const ext = `00-root-link${suffix}`;
  await successCase({
    id: `P-nested${suffix}-rootlink`,
    group: 'nested sidecar with a top-level other name',
    description: `nested ${suffix} sidecar hard-linked at the data-directory root as ${ext}`,
    linked: [ext],
    build: async (dataDir) => {
      const dir = await makeStore(dataDir, { dbDir: 'nested' });
      if (suffix !== '-wal') await writeFile(join(dir, 'graphgoblin.db' + suffix), `synthetic ${suffix} bytes`);
      await link(join(dir, 'graphgoblin.db' + suffix), join(dataDir, ext));
      return { dbFile: join(dir, 'graphgoblin.db') };
    },
    removes: ['workspaces/' + RUN, 'nested/graphgoblin.db', 'nested/graphgoblin.db-wal', ...(suffix === '-wal' ? [] : [sidecarRel]), ...lockRows('nested/graphgoblin.db')],
    keeps: { ...ROOT_KEEPS, [ext]: anotherName(sidecarRel) },
    storeLine: FORMAT3,
    removedSidecars: [sidecarRel],
    gone: ['workspaces/' + RUN, 'nested/graphgoblin.db', 'nested/graphgoblin.db-wal', sidecarRel],
    survivors: { [ext]: sidecarRel },
  });
}

// P22: one WAL with an earlier, a later and a nested-directory name at once.
await successCase({
  id: 'P-root-wal-three-other-names',
  group: 'several other names',
  description: 'root WAL with 00-unrelated, zz-unrelated and keep-dir/inner-link names (nlink 4)',
  linked: ['graphgoblin.db-wal'],
  build: async (dataDir) => {
    const dir = await makeStore(dataDir);
    await mkdir(join(dataDir, 'keep-dir'));
    for (const n of ['00-unrelated', 'zz-unrelated', 'keep-dir/inner-link']) await link(join(dir, 'graphgoblin.db-wal'), join(dataDir, ...n.split('/')));
    return { dbFile: join(dir, 'graphgoblin.db') };
  },
  removes: ['workspaces/' + RUN, 'graphgoblin.db', 'graphgoblin.db-wal', ...lockRows('graphgoblin.db')],
  keeps: { ...ROOT_KEEPS, '00-unrelated': anotherName('graphgoblin.db-wal'), 'zz-unrelated': anotherName('graphgoblin.db-wal'), 'keep-dir': 'not part of the store' },
  storeLine: FORMAT3,
  removedSidecars: ['graphgoblin.db-wal'],
  gone: ['workspaces/' + RUN, 'graphgoblin.db', 'graphgoblin.db-wal'],
  survivors: { '00-unrelated': 'graphgoblin.db-wal', 'zz-unrelated': 'graphgoblin.db-wal', 'keep-dir/inner-link': 'graphgoblin.db-wal' },
  extra: ({ check, before, after }) => {
    check('nlink 4 before, 3 after', before['00-unrelated'].nlink === '4' && after['00-unrelated'].nlink === '3', {});
  },
});

// P23-P25: the WAL is listed only under another letter case; alone, with an earlier and a later link.
for (const alias of ['none', '00-unrelated', 'zz-unrelated'])
  await successCase({
    id: `P-spelled-wal-${alias}`,
    group: 'non-exact sidecar spelling (real NTFS case alias; native final path when several links)',
    description: `WAL listed only as GRAPHGOBLIN.DB-WAL for database graphgoblin.db; other hard link: ${alias}`,
    linked: alias === 'none' ? [] : [alias],
    build: async (dataDir) => {
      const dir = await makeStore(dataDir, { walName: 'GRAPHGOBLIN.DB-WAL' });
      if (alias !== 'none') await link(join(dir, 'GRAPHGOBLIN.DB-WAL'), join(dir, alias));
      return { dbFile: join(dir, 'graphgoblin.db') };
    },
    removes: ['workspaces/' + RUN, 'graphgoblin.db', 'GRAPHGOBLIN.DB-WAL', ...lockRows('graphgoblin.db')],
    keeps: { ...ROOT_KEEPS, ...(alias === 'none' ? {} : { [alias]: anotherName('GRAPHGOBLIN.DB-WAL') }) },
    storeLine: FORMAT3,
    removedSidecars: ['GRAPHGOBLIN.DB-WAL'],
    gone: ['workspaces/' + RUN, 'graphgoblin.db', 'GRAPHGOBLIN.DB-WAL'],
    survivors: alias === 'none' ? {} : { [alias]: 'GRAPHGOBLIN.DB-WAL' },
  });

// P26: configured name differs from the listed one only in letter case, with another hard link:
// both sidecar spellings are resolved; the configured one needs the native final path.
await successCase({
  id: 'P-configured-case-alias-with-link',
  group: 'configured and stored names differ (real case alias)',
  description: 'GG_DB_URL names GraphGoblin.db; directory lists graphgoblin.db, graphgoblin.db-wal and 00-unrelated (WAL link)',
  linked: ['00-unrelated'],
  build: async (dataDir) => {
    const dir = await makeStore(dataDir);
    await link(join(dir, 'graphgoblin.db-wal'), join(dir, '00-unrelated'));
    return { dbFile: join(dir, 'GraphGoblin.db') };
  },
  removes: ['workspaces/' + RUN, 'graphgoblin.db', 'graphgoblin.db-wal', ...lockRows('graphgoblin.db')],
  keeps: { ...ROOT_KEEPS, '00-unrelated': anotherName('graphgoblin.db-wal') },
  storeLine: FORMAT3,
  removedSidecars: ['graphgoblin.db-wal'],
  gone: ['workspaces/' + RUN, 'graphgoblin.db', 'graphgoblin.db-wal'],
  survivors: { '00-unrelated': 'graphgoblin.db-wal' },
});

// P27: real Greek Unicode alias (NTFS upcase table) for the configured name, with another link.
await successCase({
  id: 'P-unicode-alias-with-link',
  group: 'configured and stored names differ (real NTFS Unicode alias)',
  description: 'GG_DB_URL names οσ-1.db; directory lists ΟΣ-1.DB, ΟΣ-1.DB-WAL and 00-unrelated (WAL link)',
  linked: ['00-unrelated'],
  build: async (dataDir) => {
    const dir = await makeStore(dataDir, { dbName: 'ΟΣ-1.DB', walName: 'ΟΣ-1.DB-WAL' });
    await link(join(dir, 'ΟΣ-1.DB-WAL'), join(dir, '00-unrelated'));
    return { dbFile: join(dir, 'οσ-1.db') };
  },
  removes: ['workspaces/' + RUN, 'ΟΣ-1.DB', 'ΟΣ-1.DB-WAL', ...lockRows('ΟΣ-1.DB')],
  keeps: { ...ROOT_KEEPS, '00-unrelated': anotherName('ΟΣ-1.DB-WAL') },
  storeLine: FORMAT3,
  removedSidecars: ['ΟΣ-1.DB-WAL'],
  gone: ['workspaces/' + RUN, 'ΟΣ-1.DB', 'ΟΣ-1.DB-WAL'],
  survivors: { '00-unrelated': 'ΟΣ-1.DB-WAL' },
  extra: ({ check, before }) => {
    check('fixture: the alias opens the listed WAL', before['ΟΣ-1.DB-WAL'] !== undefined, {});
  },
});

// P28: a Kelvin-sign look-alike of the WAL name is a distinct file and is kept.
await successCase({
  id: 'P-kelvin-lookalike',
  group: 'look-alike names',
  description: 'database K.db with WAL K.db-wal; a distinct file named K.db-wal (Kelvin sign) is kept',
  build: async (dataDir) => {
    const dir = await makeStore(dataDir, { dbName: 'K.db' });
    await writeFile(join(dir, 'K.db-wal'), 'not a sidecar');
    return { dbFile: join(dir, 'K.db') };
  },
  removes: ['workspaces/' + RUN, 'K.db', 'K.db-wal', ...lockRows('K.db')],
  keeps: { ...ROOT_KEEPS, 'K.db-wal': 'not part of the store' },
  storeLine: FORMAT3,
  removedSidecars: ['K.db-wal'],
  gone: ['workspaces/' + RUN, 'K.db', 'K.db-wal'],
  extra: ({ check, before }) => {
    check('fixture: Kelvin name is a distinct file', before['K.db-wal'] && before['K.db-wal'] && before['K.db-wal'].id !== before['K.db-wal'].id, {});
  },
});

// P29: a same-bytes copy is not another name.
await successCase({
  id: 'P-copy-not-link',
  group: 'copy versus link',
  description: 'a byte-identical copy of the WAL (different identity) is kept as not part of the store',
  build: async (dataDir) => {
    const dir = await makeStore(dataDir);
    await copyFile(join(dir, 'graphgoblin.db-wal'), join(dir, '00-copy'));
    return { dbFile: join(dir, 'graphgoblin.db') };
  },
  removes: ['workspaces/' + RUN, 'graphgoblin.db', 'graphgoblin.db-wal', ...lockRows('graphgoblin.db')],
  keeps: { ...ROOT_KEEPS, '00-copy': 'not part of the store' },
  storeLine: FORMAT3,
  removedSidecars: ['graphgoblin.db-wal'],
  gone: ['workspaces/' + RUN, 'graphgoblin.db', 'graphgoblin.db-wal'],
  extra: ({ check, before }) => {
    check('fixture: copy has same bytes, other identity, nlink 1', before['00-copy'].sha256 === before['graphgoblin.db-wal'].sha256 && before['00-copy'].id !== before['graphgoblin.db-wal'].id && before['00-copy'].nlink === '1', {});
  },
});

// P30: a link deep inside a kept workspace directory is not listed and survives.
await successCase({
  id: 'P-wal-link-inside-kept-workspace',
  group: 'other names below kept directories',
  description: 'root WAL hard-linked as workspaces/not-a-run/copy-wal (inside a kept workspace)',
  linked: ['workspaces/not-a-run/copy-wal'],
  build: async (dataDir) => {
    const dir = await makeStore(dataDir);
    await link(join(dir, 'graphgoblin.db-wal'), join(dataDir, 'workspaces', 'not-a-run', 'copy-wal'));
    return { dbFile: join(dir, 'graphgoblin.db') };
  },
  removes: ['workspaces/' + RUN, 'graphgoblin.db', 'graphgoblin.db-wal', ...lockRows('graphgoblin.db')],
  keeps: { ...ROOT_KEEPS },
  storeLine: FORMAT3,
  removedSidecars: ['graphgoblin.db-wal'],
  gone: ['workspaces/' + RUN, 'graphgoblin.db', 'graphgoblin.db-wal'],
  survivors: { 'workspaces/not-a-run/copy-wal': 'graphgoblin.db-wal' },
});

// ---- Refusals -------------------------------------------------------------------------------
const UNCHANGED = 'Nothing in the data directory was changed.\n';
const shared = (sidecar, what, other, role) =>
  `reset refused: ${sidecar} (${what}) is the same file as ${other}, ${role}; a reset cannot remove a file under one name while it owns another, so verify that no GraphGoblin process uses this store, then move ${other} yourself\n${UNCHANGED}`;

// R1-R4: a sidecar that is also a lock file holding a valid stale (dead-PID) record.
for (const [id, dbDir, suffix, what, other, role] of [
  ['R-root-wal-as-datadir-lock', '', '-wal', 'SQLite write-ahead log', 'graphgoblin.lock', 'the data-directory lock'],
  ['R-root-shm-as-db-lock', '', '-shm', 'SQLite shared memory', 'graphgoblin.db.graphgoblin.lock', 'the database lock'],
  ['R-nested-journal-as-db-lock', 'nested', '-journal', 'SQLite rollback journal', 'nested/graphgoblin.db.graphgoblin.lock', 'the database lock'],
  ['R-nested-wal-as-datadir-lock', 'nested', '-wal', 'SQLite write-ahead log', 'graphgoblin.lock', 'the data-directory lock'],
]) {
  const pre = dbDir ? dbDir + '/' : '';
  await refusalCase({
    id,
    group: 'overlap with reset ownership roles (stale lock record)',
    description: `${pre}graphgoblin.db${suffix} is a hard link of ${other}, which holds a dead-PID lock record`,
    linked: [other],
    build: async (dataDir) => {
      const dir = await makeStore(dataDir, { dbDir, wal: suffix !== '-wal' });
      await writeFile(join(dir, 'graphgoblin.db' + suffix), DEAD('qa stale lock shared with a sidecar'));
      await link(join(dir, 'graphgoblin.db' + suffix), join(dataDir, ...other.split('/')));
      return { dbFile: join(dir, 'graphgoblin.db') };
    },
    err: shared(pre + 'graphgoblin.db' + suffix, what, other, role),
  });
}

// R5-R7: a sidecar that is also a reserved top-level name.
for (const [name, role] of [
  ['workspaces', 'the reserved name of the run workspaces directory'],
  ['artifacts', 'the reserved name of the artifacts directory'],
  ['chat-audio', 'the reserved name of the private chat audio directory'],
])
  await refusalCase({
    id: `R-wal-as-${name}`,
    group: 'overlap with reset ownership roles (reserved top-level names)',
    description: `root WAL hard-linked as a top-level file named ${name}`,
    linked: [name],
    build: async (dataDir) => {
      const dir = join(dataDir);
      await mkdir(dir, { recursive: true });
      await copyFile(SEED_DB, join(dir, 'graphgoblin.db'));
      await copyFile(SEED_WAL, join(dir, 'graphgoblin.db-wal'));
      await writeFile(join(dataDir, 'master.key'), 'synthetic master key');
      await writeFile(join(dataDir, 'notes.txt'), 'owner notes');
      await link(join(dir, 'graphgoblin.db-wal'), join(dataDir, name));
      return { dbFile: join(dir, 'graphgoblin.db') };
    },
    err: shared('graphgoblin.db-wal', 'SQLite write-ahead log', name, role),
  });

// R8: a sidecar that is also the data-directory lock's .reclaim guard name (a guard is a directory).
await refusalCase({
  id: 'R-wal-as-datadir-guard',
  group: 'overlap with reset ownership roles (guard name)',
  description: 'root WAL hard-linked as graphgoblin.lock.reclaim (the guard must be a directory)',
  linked: ['graphgoblin.lock.reclaim'],
  build: async (dataDir) => {
    const dir = await makeStore(dataDir);
    await link(join(dir, 'graphgoblin.db-wal'), join(dataDir, 'graphgoblin.lock.reclaim'));
    return { dbFile: join(dir, 'graphgoblin.db') };
  },
  err: /^reset refused: .*graphgoblin\.lock\.reclaim.*\n/s,
});

// R9: a sidecar that is also a lock name, holding no lock record: the earlier read-only lock check.
await refusalCase({
  id: 'R-wal-as-lock-no-record',
  group: 'earlier lock refusal preserved',
  description: 'root WAL (real WAL bytes) hard-linked as graphgoblin.lock',
  linked: ['graphgoblin.lock'],
  build: async (dataDir) => {
    const dir = await makeStore(dataDir);
    await link(join(dir, 'graphgoblin.db-wal'), join(dataDir, 'graphgoblin.lock'));
    return { dbFile: join(dir, 'graphgoblin.db') };
  },
  err: (dataDir) =>
    `reset refused: Store ownership could not be verified (malformed or incomplete owner record): ${join(dataDir, 'graphgoblin.lock')}; verify ownership before resetting\n${UNCHANGED}`,
});

// R10-R12: held locks (a live child process holds the lock through the built lock module).
async function holdLock(kind, target) {
  const child = spawn(process.execPath, [join(scriptsDir, 'hold-lock.mjs'), worktree, kind, target], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...baseEnv, TEMP: readerTemp, TMP: readerTemp },
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('hold-lock did not start: ' + out + err)), 30_000);
    child.stdout.on('data', () => {
      if (out.includes('held')) {
        clearTimeout(t);
        res();
      }
    });
    child.on('exit', (c) => {
      clearTimeout(t);
      rej(new Error(`hold-lock exited ${c}: ${out}${err}`));
    });
  });
  return {
    release: async () => {
      child.removeAllListeners('exit');
      const done = new Promise((res) => child.on('exit', (code) => res(code)));
      child.stdin.end('release\n');
      const code = await done;
      return { code, out, err };
    },
  };
}
const holds = [];
for (const [id, kind, extraLink] of [
  ['R-held-datadir-lock-with-wal-link', 'data', '00-unrelated'],
  ['R-held-db-lock-with-wal-link', 'database', '00-unrelated'],
  ['R-held-datadir-lock-shared-with-wal', 'data', null],
]) {
  let holder;
  await refusalCase({
    id,
    group: 'held locks',
    description:
      kind === 'data'
        ? extraLink
          ? 'a live process holds the data-directory lock; the WAL has another hard link 00-unrelated'
          : 'a live process holds the data-directory lock, and graphgoblin.db-wal is a hard link of that live lock file'
        : 'a live process holds the database lock; the WAL has another hard link 00-unrelated',
    build: async (dataDir) => {
      const dir = await makeStore(dataDir, { wal: extraLink !== null });
      if (extraLink) await link(join(dir, 'graphgoblin.db-wal'), join(dir, extraLink));
      holder = await holdLock(kind, kind === 'data' ? dataDir : join(dir, 'graphgoblin.db'));
      if (!extraLink) await link(join(dataDir, 'graphgoblin.lock'), join(dir, 'graphgoblin.db-wal'));
      return {
        dbFile: join(dir, 'graphgoblin.db'),
        afterCalls: async () => holds.push({ id, ...(await holder.release()) }),
      };
    },
    err: (dataDir) =>
      `reset refused: another GraphGoblin process holds this store; check its port/configuration or let startup/shutdown finish: ${kind === 'data' ? join(dataDir, 'graphgoblin.lock') : join(dataDir, 'graphgoblin.db.graphgoblin.lock')}; verify ownership before resetting\n${UNCHANGED}`,
  });
}

// R13-R15: special files at the sidecar name (junctions: Windows directory links, no elevation).
for (const [id, name, desc, err] of [
  ['R-junction-exact', 'graphgoblin.db-shm', 'a junction at the exact SHM name', 'graphgoblin.db-shm is a link'],
  ['R-junction-other-spelling', 'GRAPHGOBLIN.DB-WAL', 'a junction listed only as GRAPHGOBLIN.DB-WAL (another spelling of the WAL name)', 'GRAPHGOBLIN.DB-WAL is a link'],
])
  await refusalCase({
    id,
    group: 'special files',
    description: desc,
    build: async (dataDir) => {
      const dir = await makeStore(dataDir, { wal: name !== 'GRAPHGOBLIN.DB-WAL' });
      await mkdir(join(runRoot, id + '-elsewhere'), { recursive: true });
      await writeFile(join(runRoot, id + '-elsewhere', 'outside.txt'), 'outside bytes');
      await symlink(join(runRoot, id + '-elsewhere'), join(dir, name), 'junction');
      return { dbFile: join(dir, 'graphgoblin.db') };
    },
    err: `reset refused: ${err}, not a database file; a reset removes only regular database files\n${UNCHANGED}`,
  });
await refusalCase({
  id: 'R-directory-at-journal',
  group: 'special files',
  description: 'a directory at the journal name',
  build: async (dataDir) => {
    const dir = await makeStore(dataDir);
    await mkdir(join(dir, 'graphgoblin.db-journal'));
    await writeFile(join(dir, 'graphgoblin.db-journal', 'inner.txt'), 'inner');
    return { dbFile: join(dir, 'graphgoblin.db') };
  },
  err: `reset refused: graphgoblin.db-journal is a directory, not a database file; a reset removes only regular database files\n${UNCHANGED}`,
});

// R16-R20: strict manifest collisions stay strict.
for (const [id, linkRel, err] of [
  ['R-wal-as-shm', 'graphgoblin.db-shm', 'the manifest would list graphgoblin.db-shm twice'],
  ['R-wal-in-removed-workspace', `workspaces/${RUN}/copy-wal`, 'the manifest would list graphgoblin.db-wal twice'],
  ['R-wal-in-artifacts', 'artifacts/copy-wal', 'the manifest would list graphgoblin.db-wal twice'],
  ['R-wal-in-chat-audio', 'chat-audio/copy-wal', 'the manifest would list graphgoblin.db-wal twice'],
  ['R-wal-as-kept-workspace-entry', 'workspaces/copy-wal', 'the manifest would both remove and keep workspaces/copy-wal'],
])
  await refusalCase({
    id,
    group: 'strict manifest collisions',
    description: `root WAL hard-linked as ${linkRel}`,
    linked: [linkRel],
    build: async (dataDir) => {
      const dir = await makeStore(dataDir);
      await mkdir(join(dataDir, ...linkRel.split('/').slice(0, -1)), { recursive: true });
      await link(join(dir, 'graphgoblin.db-wal'), join(dataDir, ...linkRel.split('/')));
      return { dbFile: join(dir, 'graphgoblin.db') };
    },
    err: `reset refused: ${err}\n${UNCHANGED}`,
  });

const evidence = {
  head,
  platform: process.platform,
  osRelease: release(),
  node: process.version,
  runRoot,
  readerTemp,
  distHashes,
  seed: { stdout: seed.stdout, stderr: seed.stderr },
  holds,
  summary: results.map((r) => ({ id: r.id, pass: r.pass, failed: r.checks.filter((c) => !c.ok).map((c) => c.name) })),
  results,
};
await writeFile(outJson, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
const failed = results.filter((r) => !r.pass);
process.stdout.write(JSON.stringify({ cases: results.length, passed: results.length - failed.length, failed: failed.map((r) => r.id) }) + '\n');
if (failed.length) process.exitCode = 1;
