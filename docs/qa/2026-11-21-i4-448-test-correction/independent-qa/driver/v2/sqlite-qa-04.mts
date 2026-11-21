// QA448 run 04: independent SQLite store scenarios with the real offline preflight, plus a control matrix
// for the candidate's storage observer. Production TypeScript is loaded through tsx with the `development`
// condition; nothing is written into the repository.
//
// Modes:  main | build <dbFile> <rows: missing-terra|full> | preflight <dbFile> <outJson> <dataDir>
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = 'G:/ggq/gg-i4-448-qa/GraphGoblin';
const Q = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-448-test-independent-01';
const SCRATCH = 'G:/ggq/qa-scratch/i4-448-test-independent-01';
const SELF = fileURLToPath(import.meta.url);
const DRIVER = dirname(SELF);
const BLOBS = join(Q, 'fixtures', 'blobs-04-sqlite');
const KEY = Buffer.alloc(32, 8).toString('base64');
const CANDIDATE_BLOB = 'a187acae037ae928b67715fe2d83f8cc1538c84f';
const CANDIDATE_SHA = 'a67356cd6773b265df80ced4e26a9c1f17cd0fe0c48f2d4cb286ddc315c611ae';
const PARENT_BLOB = '582e28eed3ce855dd09741f18bc4debc0cdfdf57';
const PARENT_SHA = '14b1532ec5bbf1d3257883c1ef57798600840db50a282161ffd07ba3166c4b71';
const src = (p: string) => pathToFileURL(join(REPO, p)).href;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const require = createRequire(import.meta.url);
const { snapshotDir } = require(join(DRIVER, 'snapshot.cjs'));
const mode = process.argv[2];

async function productRows(variant: string) {
  const { DEFAULT_MODEL_CATALOG } = await import(src('packages/infrastructure/src/sqlite/index.ts'));
  return variant === 'full'
    ? DEFAULT_MODEL_CATALOG
    : DEFAULT_MODEL_CATALOG.filter((e: { harness: string; model: string }) => !(e.harness === 'codex' && e.model === 'gpt-6.1-terra'));
}

if (mode === 'build') {
  // Child process: build with the production writer, then exit so every native handle is released.
  const [dbFile, variant] = process.argv.slice(3);
  const { openDatabase, SqliteModelCatalog } = await import(src('packages/infrastructure/src/sqlite/index.ts'));
  mkdirSync(dirname(dbFile), { recursive: true });
  const handle = openDatabase({ url: pathToFileURL(dbFile).href });
  try {
    await handle.migrate();
    await new SqliteModelCatalog(handle.db).seed(await productRows(variant));
    await handle.client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    handle.close();
  }
} else if (mode === 'preflight') {
  // Child process: real offline preflight, then immediate independent + verbatim-helper observations.
  const [dbFile, outJson, dataDir] = process.argv.slice(3);
  const { runPreflightCli } = await import(src('apps/api/src/preflight.ts'));
  const { FakeHarness } = await import(src('packages/engine/src/testing/index.ts'));
  const helper = await import(pathToFileURL(join(DRIVER, 'generated', 'candidate-helper.mts')).href);
  let out = '';
  const environment = {
    GG_DATA_DIR: dataDir,
    GG_DB_URL: pathToFileURL(dbFile).href,
    GG_MASTER_KEY: KEY,
    GG_DEFAULTS: JSON.stringify({ byHarness: { codex: { model: 'gpt-6.1-terra', effort: 'medium' } } }),
    GG_OLLAMA_ENABLED: 'false',
  };
  const code = await runPreflightCli({
    env: environment,
    harnesses: { codex: new FakeHarness(), claude: new FakeHarness([], 'claude') },
    deciders: [],
    startTimers: false,
    write: (t: string) => {
      out += t;
    },
  });
  const snapshot = snapshotDir(dirname(dbFile), { blobDir: BLOBS });
  const map = await helper.storeBytes(dbFile);
  writeFileSync(
    outJson,
    JSON.stringify({ code, out, environmentKeys: Object.keys(environment), snapshot, helperMap: saveMap(map), dataDirExists: existsSync(dataDir) }, null, 2),
  );
} else if (mode === 'main') {
  await main();
} else throw new Error(`mode ${mode}`);

function saveMap(map: Record<string, Buffer>) {
  mkdirSync(BLOBS, { recursive: true });
  const manifest: Record<string, { sha256: string; size: number }> = {};
  for (const [name, buf] of Object.entries(map)) {
    const digest = sha(buf);
    const file = join(BLOBS, `${digest}.bin`);
    if (!existsSync(file)) writeFileSync(file, buf);
    manifest[name] = { sha256: digest, size: buf.length };
  }
  return manifest;
}
function loadMap(manifest: Record<string, { sha256: string; size: number }>) {
  const map: Record<string, Buffer> = {};
  for (const [name, { sha256: digest }] of Object.entries(manifest)) {
    const buf = readFileSync(join(BLOBS, `${digest}.bin`));
    if (sha(buf) !== digest) throw new Error(`blob hash mismatch ${digest}`);
    map[name] = buf;
  }
  return map;
}

function generateHelpers() {
  const git = (blob: string) => execFileSync('git', ['-C', REPO, 'cat-file', 'blob', blob], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  const candidate = git(CANDIDATE_BLOB);
  const parent = git(PARENT_BLOB);
  if (sha(candidate) !== CANDIDATE_SHA) throw new Error('candidate blob hash mismatch');
  if (sha(parent) !== PARENT_SHA) throw new Error('parent blob hash mismatch');
  const cLines = candidate.toString('utf8').split('\n');
  const start = cLines.findIndex((l) => l.startsWith('/** SQLite readers update -shm read marks'));
  const helperStart = cLines.findIndex((l) => l === 'function expectStoreUnchanged(');
  let end = helperStart;
  while (cLines[end] !== '}') end++;
  const slice = cLines.slice(start, end + 1).join('\n');
  const pLines = parent.toString('utf8').split('\n');
  const pStart = pLines.findIndex((l) => l.startsWith('/** SQLite readers update -shm read marks'));
  let pEnd = pStart + 1;
  while (pLines[pEnd] !== '}') pEnd++;
  const pStoreBytes = pLines.slice(pStart, pEnd + 1).join('\n');
  const strict = pLines.filter((l) => /^\s*expect\(await storeBytes\(dbFile\)\)\.toEqual\(before\);$/.test(l));
  const strictStatement = strict[0].trim();
  const vitestPkg = createRequire(join(REPO, 'apps/api/package.json')).resolve('vitest/package.json');
  const vitestEsm = pathToFileURL(join(dirname(vitestPkg), 'dist', 'index.js')).href;
  const header = (what: string) =>
    `// GENERATED by QA448 sqlite-qa-04 (${what}). Verbatim source lines below; do not edit.\n` +
    `import { readFile, readdir } from 'node:fs/promises';\nimport { basename, dirname, join } from 'node:path';\nimport { expect } from '${vitestEsm}';\n\n`;
  const candidateModule = `${header(`candidate blob ${CANDIDATE_BLOB} lines ${start + 1}-${end + 1}`)}${slice}\n\nexport { storeBytes, expectStoreUnchanged };\n`;
  const oldModule =
    `${header(`parent blob ${PARENT_BLOB} lines ${pStart + 1}-${pEnd + 1} and its strict statement`)}${pStoreBytes}\n\n` +
    `export { storeBytes };\n` +
    `// The parent's statement, verbatim, against a live directory.\nexport async function oldStrictLive(dbFile: string, before: Record<string, Buffer>) {\n  ${strictStatement}\n}\n` +
    `// The same verbatim statement, with storeBytes bound to a captured after-observation.\nexport async function oldStrictOnCaptured(capturedAfter: Record<string, Buffer>, dbFile: string, before: Record<string, Buffer>) {\n  const storeBytes = async (_file: string) => capturedAfter;\n  ${strictStatement}\n}\n`;
  mkdirSync(join(DRIVER, 'generated'), { recursive: true });
  writeFileSync(join(DRIVER, 'generated', 'candidate-helper.mts'), candidateModule);
  writeFileSync(join(DRIVER, 'generated', 'old-predicate.mts'), oldModule);
  return {
    candidate: { blob: CANDIDATE_BLOB, sha256: CANDIDATE_SHA, lines: [start + 1, end + 1], sliceSha256: sha(Buffer.from(slice)), moduleSha256: sha(Buffer.from(candidateModule)) },
    parent: { blob: PARENT_BLOB, sha256: PARENT_SHA, storeBytesLines: [pStart + 1, pEnd + 1], strictStatement, strictOccurrences: strict.length, moduleSha256: sha(Buffer.from(oldModule)) },
    vitestEsm,
  };
}

function child(args: string[]) {
  const r = spawnSync(process.execPath, [...process.execArgv, SELF, ...args], { cwd: join(REPO, 'apps/api'), env: process.env, encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr.split('\n').filter((l) => l && !/ExperimentalWarning|--trace-warnings/.test(l)).join('\n'), error: r.error ? String(r.error) : undefined };
}

// D194 contract, written independently of the candidate helper, over independent snapshots.
function contract(before: any, after: any, dbName = 'gateway.db') {
  const b = Object.fromEntries((before.entries ?? []).map((e: any) => [e.name, e]));
  const a = Object.fromEntries((after.entries ?? []).map((e: any) => [e.name, e]));
  const reasons: string[] = [];
  if (!b[dbName]) reasons.push('no database before');
  if (!a[dbName]) reasons.push('database missing after');
  else if (b[dbName] && (a[dbName].sha256 !== b[dbName].sha256 || a[dbName].readSize !== b[dbName].readSize)) reasons.push('database bytes changed');
  const w = `${dbName}-wal`;
  if (b[w]) {
    if (!a[w]) reasons.push('existing WAL removed');
    else if (a[w].sha256 !== b[w].sha256 || a[w].readSize !== b[w].readSize) reasons.push('existing WAL bytes changed');
  } else if (a[w] && a[w].readSize !== 0) reasons.push('new nonempty WAL');
  return { accept: reasons.length === 0, reasons };
}
function brief(s: any, dbName = 'gateway.db') {
  if (s.error) return { error: s.error };
  const e = Object.fromEntries(s.entries.map((x: any) => [x.name, x]));
  const f = (n: string) =>
    e[n]
      ? {
          size: e[n].readSize,
          sha256: e[n].sha256,
          ...(e[n].dbHeader ? { walModeHeader: e[n].dbHeader.walModeHeader, pageCount: e[n].dbHeader.pageCount, fileChangeCounter: e[n].dbHeader.fileChangeCounter } : {}),
          ...(e[n].wal && !e[n].wal.empty ? { frames: e[n].wal.frameCount, validFramePrefix: e[n].wal.validFramePrefix, commitFrames: e[n].wal.commitFramesInValidPrefix, headerChecksumValid: e[n].wal.headerChecksumValid, pageSize: e[n].wal.pageSize, trailingBytes: e[n].wal.trailingBytes } : {}),
        }
      : 'absent';
  return { db: f(dbName), wal: f(`${dbName}-wal`), shm: f(`${dbName}-shm`), others: s.entries.map((x: any) => x.name).filter((n: string) => !n.startsWith(dbName)) };
}

async function main() {
  const { DatabaseSync } = await import('node:sqlite');
  const generated = generateHelpers();
  const helper = await import(pathToFileURL(join(DRIVER, 'generated', 'candidate-helper.mts')).href);
  const old = await import(pathToFileURL(join(DRIVER, 'generated', 'old-predicate.mts')).href);
  const base = mkdtempSync(join(SCRATCH, 'qa448-04-'));
  const result: any = { base, generated, scenarios: {}, controls: [], started: new Date().toISOString() };

  const decide = async (fn: () => unknown) => {
    try {
      await fn();
      return 'accept';
    } catch (e: any) {
      return e?.name === 'AssertionError' ? 'reject' : `error ${e?.name}: ${String(e?.message).slice(0, 120)}`;
    }
  };
  const observe = async (dbFile: string) => {
    const snap = snapshotDir(dirname(dbFile), { blobDir: BLOBS });
    const map = await helper.storeBytes(dbFile);
    return { snap, map, manifest: saveMap(map) };
  };
  const rows = (dbFile: string, withWal: boolean) => {
    // Read from a private copy (never the observed files) with Node's bundled SQLite.
    const dir = mkdtempSync(join(base, 'rowcopy-'));
    const copy = join(dir, 'copy.db');
    copyFileSync(dbFile, copy);
    if (withWal && existsSync(`${dbFile}-wal`)) copyFileSync(`${dbFile}-wal`, `${copy}-wal`);
    const db = new DatabaseSync(copy);
    try {
      const norm = (r: any) => JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v)));
      return {
        sqliteVersion: (db.prepare('select sqlite_version() v').get() as any).v,
        journalMode: (db.prepare('PRAGMA journal_mode').get() as any).journal_mode,
        catalog: norm(db.prepare('SELECT * FROM model_catalog ORDER BY harness, model').all()),
        migrations: norm(db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()),
      };
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const rowsSummary = (r: any) => ({ sqliteVersion: r.sqliteVersion, catalogRows: r.catalog.length, migrationRows: r.migrations.length, hasCodexTerra: r.catalog.some((x: any) => x.harness === 'codex' && x.model === 'gpt-6.1-terra'), catalogSha256: sha(Buffer.from(JSON.stringify(r.catalog))), migrationsSha256: sha(Buffer.from(JSON.stringify(r.migrations))) });

  const build = (dbFile: string, variant: string) => {
    const c = child(['build', dbFile, variant]);
    if (c.status !== 0) throw new Error(`build failed: ${c.stderr}`);
    return c;
  };
  // A clean close by the last SQLite connection checkpoints and deletes -wal/-shm. node:sqlite closes
  // synchronously, so this yields a genuine SQLite-produced absent-WAL state without copying files.
  const normalizeAbsent = (dbFile: string) => {
    const before = snapshotDir(dirname(dbFile));
    const db = new DatabaseSync(dbFile);
    const jm = (db.prepare('PRAGMA journal_mode').get() as any).journal_mode;
    db.close();
    const after = snapshotDir(dirname(dbFile));
    return { journalMode: jm, postBuild: brief(before), normalized: brief(after), dbUnchanged: contract(before, after).reasons.every((r) => r !== 'database bytes changed') };
  };
  const freezeNonempty = (dbFile: string, frozenDir: string) => {
    // node:sqlite writer: real WAL frames for one committed DELETE; copy db/-wal/-shm while it is open.
    const db = new DatabaseSync(dbFile);
    db.exec('PRAGMA wal_autocheckpoint = 0');
    const jm = (db.prepare('PRAGMA journal_mode').get() as any).journal_mode;
    const changes = db.prepare("DELETE FROM model_catalog WHERE harness = 'codex' AND model = 'gpt-6.1-terra'").run().changes;
    mkdirSync(frozenDir, { recursive: true });
    for (const s of ['', '-wal', '-shm']) copyFileSync(`${dbFile}${s}`, join(frozenDir, `gateway.db${s}`));
    db.close();
    return { journalMode: jm, deletedRows: Number(changes) };
  };

  // ---------------- Scenarios with the real offline preflight ----------------
  const scenario = async (name: string, dbFile: string, setup: any, rowsWithWal = true) => {
    const dataDir = join(base, `data-${name}`);
    const before = await observe(dbFile);
    const rowsBefore = rows(dbFile, rowsWithWal);
    const outJson = join(base, `preflight-${name}.json`);
    const c = child(['preflight', dbFile, outJson, dataDir]);
    const pf = existsSync(outJson) ? JSON.parse(readFileSync(outJson, 'utf8')) : undefined;
    const settled = await observe(dbFile);
    const rowsAfter = rows(dbFile, rowsWithWal);
    const immediateMap = pf ? loadMap(pf.helperMap) : undefined;
    const evals: any = {};
    for (const [label, snapAfter, mapAfter] of [
      ['immediate', pf?.snapshot, immediateMap],
      ['settled', settled.snap, settled.map],
    ] as const) {
      if (!snapAfter) continue;
      evals[label] = {
        myPredicate: contract(before.snap, snapAfter),
        candidateHelper: await decide(() => helper.expectStoreUnchanged(dbFile, before.map, mapAfter)),
        oldStrict: await decide(() => old.oldStrictOnCaptured(mapAfter, dbFile, before.map)),
        transition: { walBefore: brief(before.snap).wal, walAfter: brief(snapAfter).wal, shmBefore: brief(before.snap).shm === 'absent' ? 'absent' : 'present', shmAfter: brief(snapAfter).shm === 'absent' ? 'absent' : 'present' },
      };
    }
    result.scenarios[name] = {
      setup,
      before: { state: brief(before.snap), helperMap: before.manifest, rows: rowsSummary(rowsBefore) },
      preflight: { childStatus: c.status, childStderr: c.stderr, code: pf?.code, outputLines: pf?.out.split('\n').filter((l: string) => /Database|Default model/.test(l)), dataDirCreated: pf?.dataDirExists },
      immediate: pf ? { state: brief(pf.snapshot), helperMap: pf.helperMap } : undefined,
      settled: { state: brief(settled.snap), helperMap: settled.manifest, rows: rowsSummary(rowsAfter) },
      rowsUnchanged: JSON.stringify(rowsBefore.catalog) === JSON.stringify(rowsAfter.catalog),
      migrationsUnchanged: JSON.stringify(rowsBefore.migrations) === JSON.stringify(rowsAfter.migrations),
      evaluations: evals,
      raw: { before: before.snap, immediate: pf?.snapshot, settled: settled.snap },
    };
  };

  // S1: verified absent WAL (genuine clean-close state), missing shipped Codex seed.
  let s1 = join(base, 'S1', 'store', 'gateway.db');
  build(s1, 'missing-terra');
  const s1n: any = normalizeAbsent(s1);
  if (s1n.normalized.wal !== 'absent' || s1n.normalized.shm !== 'absent') {
    // Recorded fallback only if a clean close did not remove the sidecars: copy the DB alone to a fresh path.
    const fresh = join(base, 'S1', 'fresh', 'gateway.db');
    mkdirSync(dirname(fresh), { recursive: true });
    copyFileSync(s1, fresh);
    s1n.fallback = { used: true, reason: 'sidecars remained after clean close', copiedTo: fresh };
    s1 = fresh;
  } else s1n.fallback = { used: false };
  await scenario('S1-absent', s1, { build: 'production writer in child process', normalize: s1n });
  // S2a: pre-existing empty WAL written as a zero-byte file onto a clean absent store (no -shm).
  const s2 = join(base, 'S2a', 'store', 'gateway.db');
  build(s2, 'missing-terra');
  const s2n = normalizeAbsent(s2);
  writeFileSync(`${s2}-wal`, Buffer.alloc(0));
  await scenario('S2a-empty-written', s2, { build: 'production writer in child process', normalize: s2n, wal: 'zero-byte file written before preflight' });
  // S2b: pre-existing empty WAL produced by a real earlier reader: S1's settled state, read again.
  await scenario('S2b-empty-from-prior-reader', s1, { from: 'S1-absent settled state (WAL/-shm created by the first preflight reader)' });
  // S3: frozen nonempty WAL with real node:sqlite frames (DB still contains the row; WAL deletes it).
  const s3src = join(base, 'S3', 'source', 'gateway.db');
  build(s3src, 'full');
  const s3n = normalizeAbsent(s3src);
  const s3 = join(base, 'S3', 'frozen', 'gateway.db');
  const s3f = freezeNonempty(s3src, dirname(s3));
  await scenario('S3-frozen-nonempty', s3, { build: 'production writer (full catalog) in child process', normalize: s3n, freeze: s3f });

  // ---------------- Observer control matrix on real files ----------------
  const golden = join(base, 'golden', 'gateway.db');
  build(golden, 'missing-terra');
  result.golden = normalizeAbsent(golden);
  const frozenSrcBase = join(base, 'frozen-golden-src', 'gateway.db');
  build(frozenSrcBase, 'full');
  result.frozenGoldenSource = normalizeAbsent(frozenSrcBase);
  const frozenGolden = join(base, 'frozen-golden', 'gateway.db');
  result.frozenGolden = freezeNonempty(frozenSrcBase, dirname(frozenGolden));
  let n = 0;
  const fresh = (kind: 'absent' | 'empty' | 'frozen') => {
    const dir = join(base, 'controls', String(++n).padStart(2, '0'));
    mkdirSync(dir, { recursive: true });
    const f = join(dir, 'gateway.db');
    if (kind === 'frozen') for (const s of ['', '-wal', '-shm']) copyFileSync(`${frozenGolden}${s}`, `${f}${s}`);
    else copyFileSync(golden, f);
    if (kind === 'empty') writeFileSync(`${f}-wal`, Buffer.alloc(0));
    return f;
  };
  const flip = (file: string, offset: number) => {
    const b = readFileSync(file);
    b[offset] = b[offset]! ^ 0x01;
    writeFileSync(file, b);
  };
  const realWrite = (f: string, sql: string, keepOpen: boolean) => {
    const db = new DatabaseSync(f);
    db.exec('PRAGMA wal_autocheckpoint = 0');
    const r = db.prepare(sql).run();
    if (!keepOpen) db.close();
    return { db: keepOpen ? db : undefined, changes: Number(r.changes) };
  };
  const control = async (id: string, kind: 'absent' | 'empty' | 'frozen', intent: 'accept' | 'reject', description: string, act: (f: string) => Promise<any> | any) => {
    const f = fresh(kind);
    const before = await observe(f);
    let after: any;
    let info: any;
    let openDb: any;
    try {
      info = await act(f);
      openDb = info?.db;
      after = await observe(f); // taken while any writer/reader from act() is still open
    } finally {
      openDb?.close();
    }
    const mine = contract(before.snap, after.snap);
    const helperDecision = await decide(() => helper.expectStoreUnchanged(f, before.map, after.map));
    const oldDecision = await decide(() => old.oldStrictOnCaptured(after.map, f, before.map));
    result.controls.push({
      id,
      kind,
      description,
      designedIntent: intent,
      info: info ? { ...info, db: undefined } : undefined,
      before: brief(before.snap),
      after: brief(after.snap),
      myPredicate: mine,
      candidateHelper: helperDecision,
      oldStrict: oldDecision,
      helperAgreesWithMine: (helperDecision === 'accept') === mine.accept && /^(accept|reject)$/.test(helperDecision),
      intentRealized: (intent === 'accept') === mine.accept,
      helperMaps: { before: before.manifest, after: after.manifest },
    });
  };
  const frozenWalBytes = readFileSync(`${frozenGolden}-wal`);
  const pageSize = readFileSync(golden).readUInt16BE(16);
  await control('P1', 'absent', 'accept', 'absent WAL stays absent; nothing done', () => ({}));
  await control('P2', 'absent', 'accept', 'absent WAL becomes a zero-byte file (fs)', (f) => writeFileSync(`${f}-wal`, Buffer.alloc(0)));
  await control('P3', 'absent', 'accept', 'absent WAL; real node:sqlite read-only reader open during observation', (f) => {
    const db = new DatabaseSync(f, { readOnly: true });
    const count = (db.prepare('SELECT count(*) c FROM model_catalog').get() as any).c;
    return { db, rowsSeen: Number(count) };
  });
  await control('P4', 'empty', 'accept', 'existing empty WAL stays empty', () => ({}));
  await control('P5', 'frozen', 'accept', 'existing nonempty WAL; real read-only reader open during observation (-shm may change)', (f) => {
    const db = new DatabaseSync(f, { readOnly: true });
    const terra = (db.prepare("SELECT count(*) c FROM model_catalog WHERE harness='codex' AND model='gpt-6.1-terra'").get() as any).c;
    return { db, terraRowsVisible: Number(terra) };
  });
  await control('N01', 'absent', 'reject', 'one database byte flipped inside page 2', (f) => flip(f, pageSize + 200));
  await control('N02', 'absent', 'reject', 'database file removed (renamed away)', (f) => renameSync(f, `${f}.moved`));
  await control('N03', 'absent', 'reject', 'real node:sqlite write then clean close (checkpoint into the database, WAL deleted)', (f) => realWrite(f, "DELETE FROM model_catalog WHERE harness='claude' AND model='claude-opus-5-5'", false));
  await control('N04', 'empty', 'reject', 'existing empty WAL removed', (f) => rmSync(`${f}-wal`));
  await control('N05', 'absent', 'reject', 'real frames added to an initially absent WAL (writer open)', (f) => realWrite(f, "DELETE FROM model_catalog WHERE harness='claude' AND model='claude-opus-5-5'", true));
  await control('N06', 'empty', 'reject', 'real frames added to an initially empty WAL (writer open)', (f) => realWrite(f, "DELETE FROM model_catalog WHERE harness='claude' AND model='claude-opus-5-5'", true));
  await control('N07', 'frozen', 'reject', 'existing nonempty WAL: one byte flipped inside the first frame page', (f) => flip(`${f}-wal`, 32 + 24 + 100));
  await control('N08', 'frozen', 'reject', 'existing nonempty WAL removed', (f) => rmSync(`${f}-wal`));
  await control('N09', 'frozen', 'reject', 'existing nonempty WAL truncated to zero bytes', (f) => truncateSync(`${f}-wal`, 0));
  await control('N10', 'frozen', 'reject', 'existing nonempty WAL: real frames appended by a second transaction (writer open)', (f) => realWrite(f, "DELETE FROM model_catalog WHERE harness='claude' AND model='claude-opus-5-5'", true));
  await control('N11', 'frozen', 'reject', 'existing nonempty WAL: real TRUNCATE checkpoint (writer open)', (f) => {
    const db = new DatabaseSync(f);
    const r = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    return { db, checkpoint: r };
  });
  await control('N12', 'absent', 'reject', 'absent WAL becomes a 32-byte WAL header without frames', (f) => writeFileSync(`${f}-wal`, frozenWalBytes.subarray(0, 32)));
  await control('N13', 'frozen', 'reject', 'existing nonempty WAL: salt-1 header byte flipped (same length)', (f) => flip(`${f}-wal`, 16));
  await control('N14', 'frozen', 'reject', 'existing nonempty WAL unchanged, database byte flipped', (f) => flip(f, pageSize + 200));

  result.finished = new Date().toISOString();
  result.summary = {
    scenarios: Object.fromEntries(
      Object.entries(result.scenarios).map(([k, s]: [string, any]) => [
        k,
        {
          preflightCode: s.preflight.code,
          walBefore: s.before.state.wal === 'absent' ? 'absent' : `${s.before.state.wal.size}B`,
          walImmediate: s.immediate ? (s.immediate.state.wal === 'absent' ? 'absent' : `${s.immediate.state.wal.size}B`) : 'n/a',
          walSettled: s.settled.state.wal === 'absent' ? 'absent' : `${s.settled.state.wal.size}B`,
          dbUnchanged: s.evaluations.settled?.myPredicate.reasons.every((r: string) => r !== 'database bytes changed'),
          myPredicate: Object.fromEntries(Object.entries(s.evaluations).map(([p, e]: [string, any]) => [p, e.myPredicate.accept ? 'accept' : `reject: ${e.myPredicate.reasons.join('/')}`])),
          candidateHelper: Object.fromEntries(Object.entries(s.evaluations).map(([p, e]: [string, any]) => [p, e.candidateHelper])),
          oldStrict: Object.fromEntries(Object.entries(s.evaluations).map(([p, e]: [string, any]) => [p, e.oldStrict])),
          rowsUnchanged: s.rowsUnchanged,
          migrationsUnchanged: s.migrationsUnchanged,
          codexTerraStored: s.settled.rows.hasCodexTerra,
        },
      ]),
    ),
    controls: result.controls.map((c: any) => `${c.id} intent=${c.designedIntent} mine=${c.myPredicate.accept ? 'accept' : 'reject'} helper=${c.candidateHelper} old=${c.oldStrict} agree=${c.helperAgreesWithMine} realized=${c.intentRealized}`),
    allHelperAgree: result.controls.every((c: any) => c.helperAgreesWithMine),
    allIntentsRealized: result.controls.every((c: any) => c.intentRealized),
  };
  writeFileSync(join(Q, 'observations', '04-sqlite.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.summary, null, 2));
}
