import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteApiKeys, hashApiKey, openDatabase } from '@graphgoblin/infrastructure/sqlite';
import { bundledWebDist, defaultDataDir, loadConfig } from './config.js';
import {
  CREATE_API_KEY_USAGE,
  parseCreateApiKeyArgs,
  runCreateApiKeyCli,
} from './create-api-key.js';
import { createTestApp } from './testing/test-app.js';

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0))
    await rm(d, { recursive: true, force: true }).catch(() => undefined);
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gg-key-'));
  dirs.push(dir);
  return dir;
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    write: (text: string) => void out.push(text),
    writeError: (text: string) => void err.push(text),
  };
}

describe('parseCreateApiKeyArgs', () => {
  it('reads the name and optional scopes', () => {
    expect(parseCreateApiKeyArgs(['--create-api-key', 'mcp'])).toEqual({
      label: 'mcp',
      scopes: ['*'],
    });
    expect(
      parseCreateApiKeyArgs(['--create-api-key', ' ci ', '--scopes', 'loops:write, runs:write']),
    ).toEqual({ label: 'ci', scopes: ['loops:write', 'runs:write'] });
    expect(parseCreateApiKeyArgs(['--scopes=runs:write', '--create-api-key', 'x'])).toEqual({
      label: 'x',
      scopes: ['runs:write'],
    });
  });

  it('explains unusable arguments', () => {
    expect(parseCreateApiKeyArgs(['--create-api-key'])).toMatch(/name is required/);
    expect(parseCreateApiKeyArgs(['--create-api-key', '--scopes', 'a'])).toMatch(/required/);
    expect(parseCreateApiKeyArgs(['--create-api-key', '  '])).toMatch(/required/);
    expect(parseCreateApiKeyArgs([])).toMatch(/required/);
    expect(parseCreateApiKeyArgs(['--create-api-key', 'x'.repeat(121)])).toMatch(/120/);
    expect(parseCreateApiKeyArgs(['--create-api-key', 'x', '--scopes'])).toMatch(/comma/);
    expect(parseCreateApiKeyArgs(['--create-api-key', 'x', '--scopes=,'])).toMatch(/comma/);
  });

  it('refuses typos, strays, repeats, and missing values instead of granting *', () => {
    const key = ['--create-api-key', 'typo'];
    expect(parseCreateApiKeyArgs([...key, '--scope', 'runs:read'])).toBe('unknown option --scope');
    expect(parseCreateApiKeyArgs([...key, '-s', 'runs:read'])).toMatch(/unknown option -s/);
    expect(parseCreateApiKeyArgs([...key, 'runs:read'])).toBe('unexpected argument "runs:read"');
    expect(parseCreateApiKeyArgs([...key, '--scopes', '--wrong'])).toMatch(/comma/);
    expect(parseCreateApiKeyArgs([...key, '--scopes=--wrong'])).toMatch(/comma/);
    expect(parseCreateApiKeyArgs([...key, '--scopes', 'a', '--scopes', 'b'])).toMatch(
      /more than once/,
    );
    expect(parseCreateApiKeyArgs([...key, '--create-api-key', 'again'])).toMatch(/more than once/);
    expect(parseCreateApiKeyArgs([...key, '--scopes', 'runs:write,bad scope'])).toMatch(
      /not a scope name/,
    );
    expect(parseCreateApiKeyArgs(['--create-api-key', '--scopes', 'a'])).toMatch(/required/);
  });

  it('refuses empty scope entries from leading, trailing, or doubled commas', async () => {
    const dir = await tempDir();
    for (const scopes of ['runs:read,', ',runs:read', 'runs:read,,loops:read', ' , ']) {
      expect(parseCreateApiKeyArgs(['--create-api-key', 'x', '--scopes', scopes])).toMatch(/comma/);
      expect(parseCreateApiKeyArgs(['--create-api-key', 'x', `--scopes=${scopes}`])).toMatch(
        /comma/,
      );
      const io = capture();
      const dataDir = join(dir, 'never-created');
      expect(
        await runCreateApiKeyCli({
          argv: ['--create-api-key', 'x', '--scopes', scopes],
          env: { GG_DATA_DIR: dataDir },
          ...io,
        }),
      ).toBe(2);
      expect(io.out).toEqual([]);
      expect(io.err.join('')).toContain(CREATE_API_KEY_USAGE);
      await expect(access(dataDir)).rejects.toThrow();
    }
  });

  it('exits 2 for a typo before touching storage', async () => {
    const dir = await tempDir();
    const io = capture();
    const code = await runCreateApiKeyCli({
      argv: ['--create-api-key', 'typo', '--scope', 'runs:read'],
      env: { GG_DATA_DIR: join(dir, 'never-created') },
      ...io,
    });
    expect(code).toBe(2);
    expect(io.out).toEqual([]);
    expect(io.err.join('')).toContain(CREATE_API_KEY_USAGE);
    await expect(access(join(dir, 'never-created'))).rejects.toThrow();
  });
});

describe('graphgoblin-api --create-api-key', () => {
  it('creates a key in a fresh data directory and prints the token once, to stdout only', async () => {
    const dir = await tempDir();
    const dataDir = join(dir, 'data');
    const io = capture();
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m),
    );
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    const code = await runCreateApiKeyCli({
      argv: ['--create-api-key', 'first key', '--scopes', 'loops:write,runs:write'],
      env: { GG_DATA_DIR: dataDir },
      ...io,
    });
    expect(code).toBe(0);
    await expect(access(join(dataDir, 'graphgoblin.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(io.err).toEqual([]);
    const printed = io.out.join('');
    const token = /\b(gg_[A-Za-z0-9_-]+)/.exec(printed)?.[1];
    expect(token).toBeDefined();
    expect(printed.split(token!)).toHaveLength(2); // exactly once
    expect(printed).toContain('first key');
    expect(printed).toContain('loops:write,runs:write');
    // Nothing else saw the token: no console, no direct process output.
    for (const spy of [...consoleSpies, stdout, stderr]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(token!);
    }

    // Only the hash is stored, and the key authenticates.
    const handle = openDatabase({ url: loadConfig({ GG_DATA_DIR: dataDir }).dbUrl });
    try {
      const rows = await handle.client.execute('SELECT label, hash, scopes FROM api_keys');
      expect(JSON.stringify(rows.rows)).not.toContain(token!);
      expect(rows.rows[0]?.['hash']).toBe(hashApiKey(token!));
      const keys = new SqliteApiKeys(handle.db, { now: () => new Date() }, { next: () => 'x' });
      expect(await keys.authenticate(token!)).toMatchObject({
        label: 'first key',
        ownerId: 'local',
        scopes: ['loops:write', 'runs:write'],
      });
    } finally {
      handle.close();
    }
  });

  it('opens a required-key server with the printed key', async () => {
    const dir = await tempDir();
    const dataDir = join(dir, 'data');
    const io = capture();
    expect(
      await runCreateApiKeyCli({
        argv: ['--create-api-key', 'owner'],
        env: { GG_DATA_DIR: dataDir },
        ...io,
      }),
    ).toBe(0);
    const token = /\b(gg_[A-Za-z0-9_-]+)/.exec(io.out.join(''))![1]!;
    const t = await createTestApp({
      env: {
        GG_DATA_DIR: dataDir,
        GG_DB_URL: loadConfig({ GG_DATA_DIR: dataDir }).dbUrl,
        GG_REQUIRE_API_KEY: 'true',
      },
    });
    try {
      expect((await t.app.inject('/loops')).statusCode).toBe(401);
      const ok = await t.app.inject({
        url: '/loops',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await t.close();
    }
  });

  it('refuses to write while a server holds the directory, then succeeds after stop', async () => {
    const dataDir = await tempDir();
    const t = await createTestApp({ env: { GG_DATA_DIR: dataDir } });
    const lockPath = join(dataDir, 'graphgoblin.lock');
    const original = await readFile(lockPath, 'utf8');
    const io = capture();
    const options = { argv: ['--create-api-key', 'owner'], env: { GG_DATA_DIR: dataDir }, ...io };
    try {
      expect(await runCreateApiKeyCli(options)).toBe(1);
      expect(io.err.join('')).toContain(`another GraphGoblin process holds ${lockPath}`);
      expect(io.out).toEqual([]);
      expect(await readFile(lockPath, 'utf8')).toBe(original);
      await expect(access(join(dataDir, 'graphgoblin.db'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await t.close();
    }
    expect(await runCreateApiKeyCli(options)).toBe(0);
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('prints usage for bad arguments and the reason for bad configuration or storage', async () => {
    const bad = capture();
    expect(await runCreateApiKeyCli({ argv: ['--create-api-key'], env: {}, ...bad })).toBe(2);
    expect(bad.err.join('')).toContain(CREATE_API_KEY_USAGE);
    expect(bad.out).toEqual([]);

    const config = capture();
    expect(
      await runCreateApiKeyCli({
        argv: ['--create-api-key', 'x'],
        env: { GG_PORT: 'not a port' },
        ...config,
      }),
    ).toBe(1);
    expect(config.err.join('')).toMatch(/invalid configuration/);

    const storage = capture();
    expect(
      await runCreateApiKeyCli({
        argv: ['--create-api-key', 'x'],
        env: { GG_DATA_DIR: await tempDir(), GG_DB_URL: 'libsql://unreachable.invalid' },
        ...storage,
      }),
    ).toBe(1);
    expect(storage.err.join('')).toMatch(/could not create the API key/);
    expect(storage.out).toEqual([]);
  });

  it('works against an in-memory database and the process streams by default', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const argv = process.argv;
    process.argv = ['node', 'main.js', '--create-api-key', 'mem'];
    const env = process.env['GG_DB_URL'];
    const dataEnv = process.env['GG_DATA_DIR'];
    process.env['GG_DB_URL'] = ':memory:';
    process.env['GG_DATA_DIR'] = await tempDir();
    try {
      expect(await runCreateApiKeyCli()).toBe(0);
      expect(String(stdout.mock.calls[0]?.[0])).toMatch(/gg_/);
      process.argv = ['node', 'main.js', '--create-api-key'];
      expect(await runCreateApiKeyCli()).toBe(2);
      expect(String(stderr.mock.calls[0]?.[0])).toMatch(/usage/);
    } finally {
      process.argv = argv;
      if (env === undefined) delete process.env['GG_DB_URL'];
      else process.env['GG_DB_URL'] = env;
      if (dataEnv === undefined) delete process.env['GG_DATA_DIR'];
      else process.env['GG_DATA_DIR'] = dataEnv;
    }
  });
});

describe('configuration defaults for an installed checkout', () => {
  it('defaults the data directory to ~/.graphgoblin', () => {
    expect(defaultDataDir()).toMatch(/\.graphgoblin$/);
    expect(loadConfig({}).dataDir).toBe(defaultDataDir());
    expect(loadConfig({ GG_DATA_DIR: '' }).dataDir).toBe(defaultDataDir());
  });

  it('serves the built web app by default, unless GG_WEB_DIST says otherwise', () => {
    const found = bundledWebDist(() => true);
    expect(found).toMatch(/[\\/]web[\\/]dist$/);
    expect(bundledWebDist(() => false)).toBeUndefined();
    expect(loadConfig({}, { webDistFallback: found }).webDist).toBe(found);
    expect(loadConfig({ GG_WEB_DIST: '' }, { webDistFallback: found }).webDist).toBeUndefined();
    expect(loadConfig({ GG_WEB_DIST: 'elsewhere' }, { webDistFallback: found }).webDist).toMatch(
      /elsewhere$/,
    );
  });
});
