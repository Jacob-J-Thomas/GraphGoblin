import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  access,
  link,
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalPath } from './canonical-path.js';
import { main } from './main.js';
import { createApiProcessFixture, eventually, listening } from './testing/api-subprocess.js';

const fixtures: Awaited<ReturnType<typeof createApiProcessFixture>>[] = [];
async function fixture() {
  const created = await createApiProcessFixture();
  fixtures.push(created);
  return created;
}
afterEach(async () => {
  for (const created of fixtures.splice(0)) await created.dispose();
}, 60_000);
const noLock = (path: string) => expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });

function expectOwnershipRefusal(stderr: string): void {
  const lines = stderr.split(/\r?\n/u);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe('');
  expect(lines[0]).toMatch(
    /^(?:another GraphGoblin process holds |Store ownership could not be verified \()/u,
  );
  expect(lines[0]).not.toMatch(/[\p{Cc}\p{Zl}\p{Zp}]/u);
  expect(lines[0]).toContain('before retrying');
}

// Node force-kills children on Windows for SIGINT/SIGTERM; JS handlers never run there.
// Linux CI supplies the native signal evidence. No captured callbacks or stubbed process.exit.
const nativeSignals = describe.skipIf(process.platform !== 'linux');
const icacls = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'icacls.exe');
const whoami = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'whoami.exe');

describe('built entry and the reserved Windows launcher variable (#438)', () => {
  it('emits the exact protocol declaration within 4 KiB beside the guard module', async () => {
    const built = fileURLToPath(new URL('../dist/main.js', import.meta.url));
    const head = (await readFile(built)).subarray(0, 4096).toString('latin1');
    expect(head).toContain('export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;');
    await access(fileURLToPath(new URL('../dist/windows-log/guard.js', import.meta.url)));
    expect(head).toContain('export const MACOS_LAUNCHER_LOG_PROTOCOL = 1;');
    await access(fileURLToPath(new URL('../dist/macos-log/guard.js', import.meta.url)));
    await access(fileURLToPath(new URL('../dist/managed-log/guard.js', import.meta.url)));
    await access(
      fileURLToPath(new URL('../dist/managed-log/gateway-log-writer.js', import.meta.url)),
    );
  });

  it('consumes the variable for CLI commands, which keep their ordinary output', async () => {
    const f = await fixture();
    const logs = join(f.dataDir, 'cli-logs');
    await mkdir(logs);
    const command = f.run(['--create-api-key', 'reserved variable'], {
      gg_Windows_Launcher_Log_Dir: logs,
      gg_Macos_Launcher_Log_Admission: 'not a snapshot',
    });
    expect(await command.waitForExit()).toEqual({ code: 0, signal: null });
    expect(command.stdout).toMatch(/gg_[A-Za-z0-9_-]+/);
    expect(await readdir(logs)).toEqual([]);
  }, 60_000);

  it.skipIf(process.platform === 'win32')(
    'ignores the Windows-only variable elsewhere and keeps shell logging',
    async () => {
      const f = await fixture();
      const token = await f.createKey();
      const logs = join(f.dataDir, 'shell-logs');
      await mkdir(logs);
      const child = f.run([], { GG_WINDOWS_LAUNCHER_LOG_DIR: logs });
      await f.ready(child, token);
      expect(await readdir(logs)).toEqual([]);
    },
    60_000,
  );

  it.runIf(process.platform === 'win32')(
    'logs only to the private pair, refuses an unsafe folder (71) and a second owner (70)',
    async () => {
      const execute = promisify(execFile);
      const f = await fixture();
      const token = await f.createKey();
      const unsafe = join(f.dataDir, 'unsafe-logs');
      await mkdir(unsafe);
      await execute(icacls, [unsafe, '/grant', '*S-1-5-32-545:(OI)(CI)(R)'], { windowsHide: true });
      const refused = f.run([], { GG_WINDOWS_LAUNCHER_LOG_DIR: unsafe });
      expect(await refused.waitForExit()).toEqual({ code: 71, signal: null });
      expect([refused.stdout, refused.stderr]).toEqual(['', '']);
      expect(await readdir(unsafe)).toEqual([]);
      await noLock(f.lockPath);

      const logs = join(f.dataDir, 'private-logs');
      await mkdir(logs);
      const sid = /"(S-1-[0-9-]+)"/.exec(
        (await execute(whoami, ['/user', '/fo', 'csv', '/nh'], { windowsHide: true })).stdout,
      )?.[1];
      expect(sid).toBeDefined();
      await execute(
        icacls,
        [
          logs,
          '/inheritance:r',
          '/grant:r',
          `*${sid}:(OI)(CI)F`,
          '*S-1-5-18:(OI)(CI)F',
          '*S-1-5-32-544:(OI)(CI)F',
        ],
        { windowsHide: true },
      );
      const child = f.run([], { GG_WINDOWS_LAUNCHER_LOG_DIR: logs });
      await eventually(async () => {
        if (child.exited) throw new Error('managed gateway exited before readiness');
        return listening(f.port);
      });
      const response = await fetch(`http://127.0.0.1:${f.port}/loops?probe=GG_QUERY_CANARY`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      const contender = f.run([], { GG_WINDOWS_LAUNCHER_LOG_DIR: logs });
      expect(await contender.waitForExit()).toEqual({ code: 70, signal: null });
      expect([contender.stdout, contender.stderr]).toEqual(['', '']);
      await eventually(async () =>
        (await readFile(join(logs, 'gateway.log'), 'utf8')).includes('"statusCode":200'),
      );
      const log = await readFile(join(logs, 'gateway.log'), 'utf8');
      expect(log).toContain('GraphGoblin API listening');
      expect(log).not.toContain('GG_QUERY_CANARY');
      expect(log).not.toContain(token);
      expect([child.stdout, child.stderr]).toEqual(['', '']);
      expect((await readdir(logs)).sort()).toEqual(['gateway.log']);
    },
    60_000,
  );
});

describe('physical Mac managed entry', () => {
  it.runIf(process.platform === 'darwin')(
    'rejects a malformed snapshot before loading the app or creating a store',
    async () => {
      const f = await fixture();
      const child = f.run([], { gg_Macos_Launcher_Log_Admission: 'invalid' });
      expect(await child.waitForExit()).toEqual({ code: 71, signal: null });
      expect([child.stdout, child.stderr]).toEqual(['', '']);
      await noLock(f.lockPath);
      await noLock(join(f.dataDir, 'master.key'));
      await noLock(join(f.dataDir, 'graphgoblin.db'));
    },
    60_000,
  );

  it.skipIf(process.platform === 'darwin')(
    'consumes the Mac variable and preserves ordinary shell startup elsewhere',
    async () => {
      const f = await fixture();
      const token = await f.createKey();
      const child = f.run([], { GG_MACOS_LAUNCHER_LOG_ADMISSION: 'invalid' });
      await f.ready(child, token);
      expect(child.stdout).toContain('GraphGoblin API listening');
    },
    60_000,
  );
});

describe('built API entry and startup failures', () => {
  it('holds ownership while listening and releases it on supported HTTP close', async () => {
    const f = await fixture();
    // Test fixture fences are not product configuration; preserve them even if this case fails.
    // Inherited JEV_API_KEY is cleared too, so this in-process start cannot seed it (#565).
    for (const name of Object.keys(process.env)) {
      const upper = name.toUpperCase();
      if ((upper.startsWith('GG_') && !upper.startsWith('GG_TEST_')) || upper === 'JEV_API_KEY')
        vi.stubEnv(name, undefined);
    }
    for (const [name, value] of Object.entries(f.env))
      if (name.toUpperCase().startsWith('GG_')) vi.stubEnv(name, value);
    let running: Awaited<ReturnType<typeof main>> | undefined;
    try {
      running = await main();
      expect(running.container.config.ollamaEnabled).toBe(false);
      expect(running.container.config.jevApiKey).toBeUndefined();
      const lock = await readFile(f.lockPath, 'utf8');
      await expect(main()).rejects.toThrow('another GraphGoblin process holds');
      expect(await readFile(f.lockPath, 'utf8')).toBe(lock);
      expect((await running.app.inject('/healthz')).statusCode).toBe(200);
      await running.app.close();
      await noLock(f.lockPath);
      expect(await listening(f.port)).toBe(false);
    } finally {
      await running?.app.close();
      await running?.container.stop();
      vi.unstubAllEnvs();
    }
  }, 60_000);

  it('serves authenticated requests using a binary-created key and refuses a competing process', async () => {
    const f = await fixture();
    const token = await f.createKey();
    const child = f.run();
    try {
      await f.ready(child, token);
      const lock = await readFile(f.lockPath, 'utf8');
      const contender = f.run();
      expect(await contender.waitForExit()).toEqual({ code: 1, signal: null });
      expect(contender.stderr).toContain('another GraphGoblin process holds');
      expectOwnershipRefusal(contender.stderr);
      // Ownership diagnostics use canonical paths, including Windows short-name temp roots.
      expect(contender.stderr).toContain(await realpath(f.lockPath));
      expect(contender.stderr).toContain(
        'wait for the owning process to finish or stop it before retrying',
      );
      expect(contender.stdout).toBe('');
      expect(await readFile(f.lockPath, 'utf8')).toBe(lock);
      const response = await fetch(`http://127.0.0.1:${f.port}/loops`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
    } finally {
      // Cross-platform forced fixture cleanup; graceful shutdown is asserted only below on POSIX.
      await child.dispose();
    }
    expect(await listening(f.port)).toBe(false);
  }, 60_000);

  it('refuses a shared database in one line and leaves its existing owner serving', async () => {
    const f = await fixture();
    const other = await fixture();
    const database = join(f.dataDir, 'shared.db');
    const env = { GG_DB_URL: `file:${database.replaceAll('\\', '/')}` };
    const key = f.run(['--create-api-key', 'database owner'], env);
    expect(await key.waitForExit()).toEqual({ code: 0, signal: null });
    const token = /gg_[A-Za-z0-9_-]+/.exec(key.stdout)?.[0] ?? '';
    expect(token).toMatch(/^gg_/);
    const child = f.run([], env);
    try {
      await f.ready(child, token);
      const directoryRecord = await readFile(f.lockPath, 'utf8');
      const databaseLock = `${await realpath(database)}.graphgoblin.lock`;
      const databaseRecord = await readFile(databaseLock, 'utf8');
      const contender = other.run([], env);
      expect(await contender.waitForExit()).toEqual({ code: 1, signal: null });
      expectOwnershipRefusal(contender.stderr);
      expect(contender.stderr).toContain(
        `another GraphGoblin process holds ${await realpath(databaseLock)}`,
      );
      expect(contender.stdout).toBe('');
      expect(await readFile(f.lockPath, 'utf8')).toBe(directoryRecord);
      expect(await readFile(databaseLock, 'utf8')).toBe(databaseRecord);
      await noLock(other.lockPath);
      const response = await fetch(`http://127.0.0.1:${f.port}/loops`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
    } finally {
      await child.dispose();
    }
  }, 60_000);

  it.each(['data-directory', 'database', 'reclamation'] as const)(
    'explains uncertain %s ownership in one line and preserves the owner record',
    async (kind) => {
      const f = await fixture();
      const database = join(f.dataDir, 'uncertain.db');
      const guard = `${f.lockPath}.reclaim`;
      const marker = '00000000-0000-4000-8000-000000000000.json';
      const path =
        kind === 'database'
          ? `${database}.graphgoblin.lock`
          : kind === 'reclamation'
            ? join(guard, marker)
            : f.lockPath;
      if (kind === 'reclamation') await mkdir(guard);
      const record = '{"pid":';
      await writeFile(path, record);
      const child = f.run(
        [],
        kind === 'database' ? { GG_DB_URL: `file:${database.replaceAll('\\', '/')}` } : {},
      );
      expect(await child.waitForExit()).toEqual({ code: 1, signal: null });
      expectOwnershipRefusal(child.stderr);
      expect(child.stderr).toContain(
        'Store ownership could not be verified (malformed or incomplete owner record)',
      );
      expect(child.stderr).toContain(await realpath(kind === 'reclamation' ? guard : path));
      expect(child.stderr).toContain('inspect the owner record and running GraphGoblin processes');
      expect(child.stdout).toBe('');
      expect(await readFile(path, 'utf8')).toBe(record);
      if (kind === 'reclamation') expect(await readdir(guard)).toEqual([marker]);
      if (kind !== 'data-directory') await noLock(f.lockPath);
      expect(await listening(f.port)).toBe(false);
    },
    60_000,
  );

  it('escapes controls in a configured ownership path without changing its record', async () => {
    const f = await fixture();
    // Win32 rejects C0 filename controls; C1 and Unicode line separators are valid there.
    const controls =
      process.platform === 'win32' ? '\u0085\u2028\u2029' : '\n\r\t\u001b\u0085\u2028\u2029';
    const escapedControls =
      process.platform === 'win32'
        ? '\\u0085\\u2028\\u2029'
        : '\\u000a\\u000d\\u0009\\u001b\\u0085\\u2028\\u2029';
    const dataDir = join(f.dataDir, `uncertain${controls}store`);
    await mkdir(dataDir);
    const lockPath = join(dataDir, 'graphgoblin.lock');
    const record = '{"pid":';
    await writeFile(lockPath, record);
    const child = f.run([], { GG_DATA_DIR: dataDir });
    expect(await child.waitForExit()).toEqual({ code: 1, signal: null });
    expectOwnershipRefusal(child.stderr);
    expect(child.stderr).toContain(`uncertain${escapedControls}store`);
    expect(child.stderr).not.toContain(dataDir);
    expect(child.stdout).toBe('');
    expect(await readFile(lockPath, 'utf8')).toBe(record);
    expect(await listening(f.port)).toBe(false);
  }, 60_000);

  it('retains diagnostics for a real data-directory filesystem failure', async () => {
    const f = await fixture();
    const dataDir = join(f.dataDir, 'not-a-directory');
    await writeFile(dataDir, 'keep');
    const child = f.run([], { GG_DATA_DIR: dataDir });
    expect(await child.waitForExit()).toEqual({ code: 1, signal: null });
    expect(child.stderr).toMatch(/EEXIST|ENOTDIR/);
    expect(child.stderr).toMatch(/^\s+at /m);
    expect(child.stdout).not.toContain('GraphGoblin API listening');
    expect(await readFile(dataDir, 'utf8')).toBe('keep');
    await noLock(f.lockPath);
    expect(await listening(f.port)).toBe(false);
  }, 60_000);

  it('dispatches the API-key and preflight CLIs with their real exit codes', async () => {
    const f = await fixture();
    const token = await f.createKey();
    expect(token).toMatch(/^gg_/);
    await noLock(f.lockPath);
    const usage = f.run(['--create-api-key']);
    expect(await usage.waitForExit()).toEqual({ code: 2, signal: null });
    expect(usage.stderr).toContain('a key name is required');
    const invalidKeyConfig = f.run(['--create-api-key', 'invalid config'], { GG_PORT: 'invalid' });
    expect(await invalidKeyConfig.waitForExit()).toEqual({ code: 1, signal: null });
    // Preflight wins dispatch even if the other command is present. Invalid config also ensures
    // this fixture performs no installed-provider readiness probe or session.
    const preflight = f.run(['--preflight', '--create-api-key'], { GG_PORT: 'invalid' });
    expect(await preflight.waitForExit()).toEqual({ code: 1, signal: null });
    expect(preflight.stdout).toContain('GraphGoblin preflight');
    expect(preflight.stdout).toContain('FAIL');
    expect(preflight.stderr).not.toContain('a key name is required');
    expect(await listening(f.port)).toBe(false);
  }, 60_000);

  it('releases ownership on a real corrupt-database startup fault before HTTP setup', async () => {
    const f = await fixture();
    await f.createKey();
    // A fresh file has no WAL that could legitimately restore a damaged main-file header.
    const corrupt = join(f.dataDir, 'corrupt.db');
    await writeFile(corrupt, 'This is deliberately not a SQLite database');
    const child = f.run([], { GG_DB_URL: `file:${corrupt.replaceAll('\\', '/')}` });
    expect(await child.waitForExit()).toEqual({ code: 1, signal: null });
    expect(child.stderr).toMatch(/not a database|SQLITE_NOTADB/i);
    expect(child.stderr).toMatch(/^\s+at /m);
    expect(child.stdout).not.toContain('GraphGoblin API listening');
    await noLock(f.lockPath);
    expect(await listening(f.port)).toBe(false);
  }, 60_000);

  it('releases ownership after a real occupied-port listen failure', async () => {
    const f = await fixture();
    await f.createKey();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(f.port, '127.0.0.1', resolve));
    try {
      const child = f.run();
      expect(await child.waitForExit()).toEqual({ code: 1, signal: null });
      expect(child.stderr).toContain('EADDRINUSE');
      expect(child.stderr).toMatch(/^\s+at /m);
      await noLock(f.lockPath);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await listening(f.port)).toBe(false);
  }, 60_000);

  // POSIX permits a literal '*' asset name; Win32 rejects it. Static registration then collides
  // with the SPA wildcard, producing a real post-container buildApp failure, unlike corrupt SQL.
  it.skipIf(process.platform === 'win32')(
    'releases ownership when real static route registration fails during HTTP setup (POSIX filename fixture)',
    async () => {
      const f = await fixture();
      await f.createKey();
      const web = join(f.dataDir, 'web');
      await mkdir(web);
      await writeFile(join(web, 'index.html'), '<html>fixture</html>');
      await writeFile(join(web, '*'), 'literal wildcard asset');
      const child = f.run([], { GG_WEB_DIST: web });
      expect(await child.waitForExit()).toEqual({ code: 1, signal: null });
      expect(child.stderr).toMatch(/FST_ERR_DUPLICATED_ROUTE|already declared/);
      expect(child.stderr).toMatch(/^\s+at /m);
      expect(child.stdout).not.toContain('GraphGoblin API listening');
      await noLock(f.lockPath);
      expect(await listening(f.port)).toBe(false);
    },
    60_000,
  );
});

type ProcessFixture = Awaited<ReturnType<typeof createApiProcessFixture>>;

const hardLinkAction =
  'has multiple hard links; use one ordinary SQLite file so GraphGoblin can establish exclusive ownership';

/** No provider runs in these children: Ollama is off and both harness executables are absent. */
function providerFreeStore(f: ProcessFixture, database: string): NodeJS.ProcessEnv {
  return {
    GG_DB_URL: `file:${database.replaceAll('\\', '/')}`,
    GG_OLLAMA_ENABLED: 'false',
    GG_CODEX_BINARY: join(f.dataDir, 'absent-codex'),
    GG_CLAUDE_BINARY: join(f.dataDir, 'absent-claude'),
  };
}

/** A real SQLite store holding one key, with a second hard link beside its first name. */
async function hardLinkedStore(f: ProcessFixture) {
  const database = join(f.dataDir, 'linked.db');
  const alias = join(f.dataDir, 'linked-alias.db');
  const key = f.run(['--create-api-key', 'hard-linked owner'], providerFreeStore(f, database));
  expect(await key.waitForExit()).toEqual({ code: 0, signal: null });
  const token = /^\s+(gg_[A-Za-z0-9_-]+)\s*$/m.exec(key.stdout)?.[1] ?? '';
  expect(token).toMatch(/^gg_/);
  await link(database, alias);
  return { database, alias, token, bytes: await readFile(database) };
}

/** A managed log folder only the current user, SYSTEM and Administrators can use. */
async function privateLogDirectory(path: string): Promise<string> {
  const execute = promisify(execFile);
  await mkdir(path);
  const sid = /"(S-1-[0-9-]+)"/.exec(
    (await execute(whoami, ['/user', '/fo', 'csv', '/nh'], { windowsHide: true })).stdout,
  )?.[1];
  if (sid === undefined) throw new Error('whoami did not report the current user SID');
  await execute(
    icacls,
    [
      path,
      '/inheritance:r',
      '/grant:r',
      `*${sid}:(OI)(CI)F`,
      '*S-1-5-18:(OI)(CI)F',
      '*S-1-5-32-544:(OI)(CI)F',
    ],
    { windowsHide: true },
  );
  return path;
}

describe('hard-linked database startup refusal (#533)', () => {
  it('refuses both hard-linked spellings in one stack-free line, then the ordinary file serves', async () => {
    const f = await fixture();
    const { database, alias, token, bytes } = await hardLinkedStore(f);
    for (const spelling of [database, alias]) {
      const canonical = canonicalPath(spelling);
      const child = f.run([], providerFreeStore(f, spelling));
      expect(await child.waitForExit()).toEqual({ code: 1, signal: null });
      expect(child.stderr).toBe(`database ${canonical} ${hardLinkAction}\n`);
      expect(child.stdout).toBe('');
      expect(await readFile(database)).toEqual(bytes);
      expect(await readFile(alias)).toEqual(bytes);
      await noLock(f.lockPath);
      await noLock(`${canonical}.graphgoblin.lock`);
      await noLock(`${canonical}.graphgoblin.lock.reclaim`);
      expect(await listening(f.port)).toBe(false);
    }
    // The stated remedy: the same store as one ordinary SQLite file starts and serves.
    await unlink(alias);
    const child = f.run([], providerFreeStore(f, database));
    try {
      await f.ready(child, token);
      expect(child.stderr).not.toContain('multiple hard links');
    } finally {
      await child.dispose();
    }
    expect(await listening(f.port)).toBe(false);
  }, 60_000);

  it('keeps the stack for an unexpected database filesystem failure (not hard-linked)', async () => {
    const f = await fixture();
    const blocker = join(f.dataDir, 'not-a-directory');
    await writeFile(blocker, 'keep');
    const child = f.run([], providerFreeStore(f, join(blocker, 'store.db')));
    expect(await child.waitForExit()).toEqual({ code: 1, signal: null });
    expect(child.stderr).toMatch(/EEXIST|ENOTDIR|ENOENT/);
    expect(child.stderr).toMatch(/^\s+at /m);
    expect(child.stderr).not.toContain('multiple hard links');
    expect(child.stdout).not.toContain('GraphGoblin API listening');
    expect(await readFile(blocker, 'utf8')).toBe('keep');
    await noLock(f.lockPath);
    expect(await listening(f.port)).toBe(false);
  }, 60_000);

  it.runIf(process.platform === 'win32')(
    'records a hard-linked database for the managed launcher only as store/store-unavailable (74)',
    async () => {
      const f = await fixture();
      const { database, alias, bytes } = await hardLinkedStore(f);
      for (const [index, spelling] of [database, alias].entries()) {
        const logs = await privateLogDirectory(join(f.dataDir, `managed-logs-${index}`));
        const child = f.run([], {
          ...providerFreeStore(f, spelling),
          GG_WINDOWS_LAUNCHER_LOG_DIR: logs,
        });
        expect(await child.waitForExit()).toEqual({ code: 74, signal: null });
        expect([child.stdout, child.stderr]).toEqual(['', '']);
        expect(await readdir(logs)).toEqual(['gateway.log']);
        const log = await readFile(join(logs, 'gateway.log'), 'utf8');
        const records = log
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(records).toHaveLength(1);
        expect(Object.keys(records[0]!)).toEqual([
          'level',
          'time',
          'pid',
          'msg',
          'stage',
          'cause',
          'detail',
          'guidance',
        ]);
        expect(records[0]).toMatchObject({
          level: 50,
          msg: 'GraphGoblin startup failed',
          stage: 'store',
          cause: 'store-unavailable',
          detail: 'The store could not be opened.',
          guidance:
            'Check the configured store and any other GraphGoblin process, then launch again.',
        });
        expect(log).not.toContain('hard links');
        expect(log).not.toContain('linked');
        expect(await readFile(database)).toEqual(bytes);
        expect(await readFile(alias)).toEqual(bytes);
        await noLock(f.lockPath);
        await noLock(`${canonicalPath(spelling)}.graphgoblin.lock`);
        expect(await listening(f.port)).toBe(false);
      }
    },
    60_000,
  );
});

nativeSignals(
  'native API shutdown: Linux CI; win32 force-kills children without JS handlers',
  () => {
    it.each(['SIGINT', 'SIGTERM'] as const)(
      'closes its listener, releases ownership and exits once on %s',
      async (signal) => {
        const f = await fixture();
        const token = await f.createKey();
        const child = f.run();
        await f.ready(child, token);
        const lock = await readFile(f.lockPath, 'utf8');
        const contender = f.run();
        expect(await contender.waitForExit()).toEqual({ code: 1, signal: null });
        expect(contender.stderr).toContain('another GraphGoblin process holds');
        expect(await readFile(f.lockPath, 'utf8')).toBe(lock);
        expect(child.child.kill(signal)).toBe(true);
        expect(await child.waitForExit()).toEqual({ code: 0, signal: null });
        expect(child.stdout.match(/"msg":"shutting down"/g)).toHaveLength(1);
        await noLock(f.lockPath);
        expect(await listening(f.port)).toBe(false);
      },
      60_000,
    );

    it('handles a real signal before readiness, holds ownership through startup and shuts down once', async () => {
      const f = await fixture();
      await f.createKey();
      // Keep native signal dispatch asynchronous while startup still awaits its supported key file.
      const keyFile = join(f.dataDir, 'master.key');
      await promisify(execFile)('mkfifo', [keyFile]);
      const child = f.run([], { GG_MASTER_KEY: undefined });
      await eventually(async () => {
        try {
          return (await readFile(f.lockPath, 'utf8')).length > 0;
        } catch {
          return false;
        }
      });
      const lock = await readFile(f.lockPath, 'utf8');
      expect(child.child.kill('SIGINT')).toBe(true);
      await child.waitForLog('shutting down');
      // The shutdown log proves receipt while the FIFO still prevents readiness.
      expect(child.stdout).not.toContain('GraphGoblin API listening');
      expect(await listening(f.port)).toBe(false);
      expect(child.child.kill('SIGTERM')).toBe(true);
      expect(await readFile(f.lockPath, 'utf8')).toBe(lock);
      await writeFile(keyFile, Buffer.alloc(32, 8).toString('base64'));
      expect(await child.waitForExit()).toEqual({ code: 0, signal: null });
      expect(child.stdout).toContain('GraphGoblin API listening');
      expect(child.stdout.indexOf('shutting down')).toBeLessThan(
        child.stdout.indexOf('GraphGoblin API listening'),
      );
      expect(child.stdout.match(/"msg":"shutting down"/g)).toHaveLength(1);
      await noLock(f.lockPath);
      expect(await listening(f.port)).toBe(false);
    }, 60_000);
  },
);
