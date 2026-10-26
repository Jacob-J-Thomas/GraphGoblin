import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runResetCli } from './reset.js';

describe.runIf(process.platform === 'win32')('uninspectable Windows AF_UNIX entries', () => {
  let base: string;
  let executable: string;
  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'gg-wp-b3-qafix-socket-'));
    executable = join(base, 'afunix.exe');
    const source = fileURLToPath(new URL('./__fixtures__/af-unix-socket.cs', import.meta.url));
    const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
    await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -Path ${quote(source)} -OutputAssembly ${quote(executable)} -OutputType ConsoleApplication`,
      ],
      { windowsHide: true },
    );
  }, 60_000);
  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it.each(['workspace', 'root', 'database'] as const)(
    'refuses an uninspectable socket at %s without changing any entry',
    async (placement) => {
      const dataDir = join(base, placement);
      const runId = '01JQAFIXRUNAAAAAAAAAAAAAA';
      await mkdir(join(dataDir, 'workspaces', runId), { recursive: true });
      await mkdir(join(dataDir, 'artifacts'));
      await writeFile(join(dataDir, 'artifacts', 'body'), 'artifact bytes');
      await writeFile(join(dataDir, 'master.key'), 'key bytes');
      await writeFile(join(dataDir, 'graphgoblin.lock'), JSON.stringify({ pid: 2147483647 }));
      const socket =
        placement === 'workspace'
          ? join(dataDir, 'workspaces', runId, 'tool.sock')
          : join(dataDir, placement === 'database' ? 'graphgoblin.db' : 'tool.sock');
      if (placement !== 'database') await writeFile(join(dataDir, 'graphgoblin.db'), 'store bytes');
      // Node's Windows pipe listen(path) cannot create this reparse-point type. Bind AF_UNIX
      // natively, relative to cwd so sockaddr_un's 108-byte path bound is respected.
      await promisify(execFile)(executable, [basename(socket)], {
        cwd: dirname(socket),
        windowsHide: true,
      });
      const beforeNames = await readdir(dirname(socket));
      // Capture every readable fixture file; the socket itself cannot be read or lstat'ed.
      const bytes = await Promise.all(
        [
          'master.key',
          'graphgoblin.lock',
          'artifacts/body',
          ...(placement === 'database' ? [] : ['graphgoblin.db']),
        ].map((p) => readFile(join(dataDir, p))),
      );
      try {
        for (const confirmed of [false, true]) {
          let out = '',
            err = '';
          const code = await runResetCli({
            argv: ['--reset', ...(confirmed ? ['--yes', '--data-dir', dataDir] : [])],
            env: { GG_DATA_DIR: dataDir },
            readStore: () => Promise.resolve({ readable: true, format: 4, runIds: [runId] }),
            write: (s) => {
              out += s;
            },
            writeError: (s) => {
              err += s;
            },
          });
          expect.soft(code).toBe(1);
          expect.soft(err).toContain(socket);
          expect.soft(err).toContain('cannot be inspected without following it on this system');
          expect.soft(err).toContain('Stop the program using it');
          expect
            .soft(err)
            .toContain('move or remove that entry yourself, then run the reset again');
          expect.soft(err).toContain('Nothing in the data directory was changed.');
          expect.soft(out).not.toContain('Removing:');
          expect(await readdir(dirname(socket))).toEqual(beforeNames);
          await expect(lstat(socket)).rejects.toMatchObject({ code: 'EACCES' });
          expect(
            await Promise.all(
              [
                'master.key',
                'graphgoblin.lock',
                'artifacts/body',
                ...(placement === 'database' ? [] : ['graphgoblin.db']),
              ].map((p) => readFile(join(dataDir, p))),
            ),
          ).toEqual(bytes);
        }
      } finally {
        // Windows rm/lstat cannot inspect an AF_UNIX reparse point; explicitly unlink our fixture.
        await unlink(socket);
      }
    },
    60_000,
  );
});
