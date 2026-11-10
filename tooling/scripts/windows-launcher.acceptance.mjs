// Native Windows executable + built API, disposable stores, no provider turns or owner ports.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GG_') && key !== 'JEV_API_KEY'),
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextPort = Number(process.env.GG_TEST_PORT_START ?? 4830);
const lastPort = nextPort + 20;
async function freePort() {
  while (nextPort < lastPort) {
    const port = nextPort++;
    const server = createServer();
    const free = await new Promise((resolve) => {
      server.on('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('No disposable Windows launcher test port is available.');
}
const origin = (config) => `http://127.0.0.1:${config.Port}`;
const health = async (config) => {
  const response = await fetch(origin(config) + '/healthz', { signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 200);
  return {
    pid: response.headers.get('x-graphgoblin-pid'),
    identity: response.headers.get('x-graphgoblin-instance'),
  };
};
async function stop(config) {
  try {
    await health(config);
  } catch {
    return;
  }
  await fetch(origin(config) + '/system/shutdown', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'drain' }),
    signal: AbortSignal.timeout(3000),
  });
  for (let i = 0; i < 100; i++) {
    try {
      await health(config);
    } catch {
      return;
    }
    await sleep(100);
  }
  throw new Error('Disposable gateway did not finish its normal drain.');
}

test(
  'native Windows launcher readiness, reuse, races, refusals, detached lifetime and shell route',
  { skip: process.platform !== 'win32', timeout: 240_000 },
  async (t) => {
    await mkdir(join(root, '.tmp'), { recursive: true });
    const base = await mkdtemp(join(root, '.tmp', 'windows-launcher-'));
    const install = join(base, 'launcher space-α');
    await mkdir(install);
    const exe = join(install, 'GraphGoblin.exe');
    const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    await execute(
      compiler,
      [
        '/nologo',
        '/target:winexe',
        '/platform:x64',
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Web.Extensions.dll',
        `/out:${exe}`,
        join(root, 'apps/windows-launcher/Launcher.cs'),
      ],
      { windowsHide: true },
    );
    async function configuration(name, overrides = {}) {
      const config = {
        Repo: root,
        Node: process.execPath,
        DataDir: join(base, name),
        Port: await freePort(),
        Environment: { GG_LOG_LEVEL: 'info' },
        LauncherAppUserModelId: 'GraphGoblin.NativeAcceptance',
        StartupTimeoutSeconds: 15,
        WindowTimeoutSeconds: 2,
        ...overrides,
      };
      const path = join(install, name + '.json');
      await writeFile(path, JSON.stringify(config));
      return { config, path };
    }
    const launch = (path) =>
      execute(exe, ['--config', path, '--ensure-gateway'], {
        cwd: root,
        env,
        windowsHide: true,
        timeout: 30_000,
      });
    const first = await configuration('primary');
    await t.test(
      'concurrent cold starts create one gateway and later clicks reuse its PID',
      async () => {
        await Promise.all(Array.from({ length: 4 }, () => launch(first.path)));
        const before = await health(first.config);
        assert.match(before.identity, /^[a-f0-9]{64}$/);
        assert.equal(
          String(
            JSON.parse(await readFile(join(first.config.DataDir, 'graphgoblin.lock'), 'utf8')).pid,
          ),
          before.pid,
        );
        await launch(first.path);
        assert.deepEqual(await health(first.config), before);
        process.kill(Number(before.pid), 0); // launchers have exited; gateway and its log remain independent.
        assert.match(
          await readFile(join(install, 'gateway.log'), 'utf8'),
          /GraphGoblin API listening/,
        );
      },
    );
    try {
      await t.test(
        'wrong store and changed gateway settings are refused without stopping the live gateway',
        async () => {
          const before = await health(first.config);
          for (const overrides of [
            { DataDir: join(base, 'wrong-store') },
            { Environment: { GG_REQUIRE_API_KEY: 'true' } },
            { Environment: { GG_DB_URL: 'file:' + join(base, 'wrong.db').replaceAll('\\', '/') } },
          ]) {
            const wrong = await configuration('mismatch', { ...first.config, ...overrides });
            await assert.rejects(launch(wrong.path), /differently configured service/);
            assert.deepEqual(await health(first.config), before);
          }
        },
      );
      await t.test(
        'same database under a different data directory cannot acquire a second gateway',
        async () => {
          const shared = await configuration('shared', {
            StartupTimeoutSeconds: 1,
            Environment: {
              GG_DB_URL:
                'file:' + join(first.config.DataDir, 'graphgoblin.db').replaceAll('\\', '/'),
            },
          });
          await assert.rejects(
            launch(shared.path),
            /Store ownership is held or cannot be verified/,
          );
          await health(first.config);
        },
      );
      await t.test(
        'normal drain releases ownership and a shell shortcut cold start runs the launcher',
        async () => {
          const before = await health(first.config);
          await stop(first.config);
          const shortcut = join(install, 'GraphGoblin native route.lnk');
          await execute(
            exe,
            ['--config', first.path, '--ensure-gateway', '--create-shortcut', shortcut],
            { env, windowsHide: true },
          );
          assert.equal(
            (
              await execute(exe, ['--read-shortcut-id', shortcut], { env, windowsHide: true })
            ).stdout.trim(),
            first.config.LauncherAppUserModelId,
          );
          const inspected = JSON.parse(
            (await execute(exe, ['--inspect-shortcut', shortcut], { env, windowsHide: true }))
              .stdout,
          );
          assert.equal(inspected.TargetPath, exe);
          assert.ok(inspected.Arguments.includes(first.path));
          // Start-Process -Wait waits the whole tree, including the deliberately persistent gateway.
          const ps =
            "$click = Start-Process -FilePath $env:GG_TEST_LINK -PassThru -WindowStyle Hidden; if (!$click.WaitForExit(25000)) { throw 'Launcher did not exit' }; if ($click.ExitCode -ne 0) { throw 'Launcher failed' }";
          await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
            env: { ...env, GG_TEST_LINK: shortcut, GG_TEST_EXE: exe, GG_TEST_CONFIG: first.path },
            windowsHide: true,
            timeout: 30_000,
          });
          const after = await health(first.config);
          assert.notEqual(after.pid, before.pid);
          console.log(
            JSON.stringify({
              evidence: 'native-shell-shortcut-cold-route',
              beforePid: before.pid,
              afterPid: after.pid,
            }),
          );
        },
      );
      await t.test(
        'native HWND COM relaunch command preserves the cold launcher route',
        async () => {
          await stop(first.config);
          const checks = join(install, 'NativeChecks.exe');
          await execute(
            compiler,
            [
              '/nologo',
              '/target:exe',
              '/platform:x64',
              '/main:NativeChecks',
              '/reference:System.Windows.Forms.dll',
              '/reference:System.Web.Extensions.dll',
              `/out:${checks}`,
              join(root, 'apps/windows-launcher/Launcher.cs'),
              join(root, 'apps/windows-launcher/NativeChecks.cs'),
            ],
            { windowsHide: true },
          );
          const result = await execute(checks, [exe, first.path], {
            env,
            windowsHide: true,
            timeout: 30_000,
          });
          assert.match(result.stdout, /HWND COM\/relaunch route checks passed/);
          await health(first.config);
        },
      );
      await t.test('cross-process HWND metadata survives stamper exit and relaunches', async () => {
        await stop(first.config);
        const checks = join(install, 'NativeChecks.exe');
        const handleFile = join(install, 'fixture-window.txt');
        const fixture = spawn(checks, ['--window-fixture', handleFile], {
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const exited = new Promise((resolve) => fixture.once('exit', resolve));
        let handle;
        let closed;
        try {
          for (let attempt = 0; attempt < 100; attempt++) {
            try {
              handle = (await readFile(handleFile, 'utf8')).trim();
              if (handle) break;
            } catch {
              /* fixture is still creating its HWND */
            }
            await sleep(50);
          }
          assert.match(handle, /^\d+$/);
          await execute(checks, ['--stamp-window', handle, exe, first.path], {
            env,
            windowsHide: true,
            timeout: 10_000,
          });
          // A new process reads/exercises the native metadata only after the stamper exited.
          const result = await execute(checks, ['--relaunch-window', handle], {
            env,
            windowsHide: true,
            timeout: 30_000,
          });
          assert.match(result.stdout, /metadata survived stamper exit/);
          await health(first.config);
        } finally {
          if (handle) await execute(checks, ['--close-window', handle], { env, windowsHide: true });
          closed = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]);
          if (!closed) {
            fixture.kill();
          }
        }
        assert.equal(closed, true, 'Disposable native HWND fixture did not close.');
      });
    } finally {
      await stop(first.config);
    }
    await t.test('plain-health HTTP listener is refused and kept alive', async () => {
      const unrelated = await configuration('unrelated');
      const server = createHttpServer((_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end('{"status":"ok"}');
      });
      await new Promise((resolve) => server.listen(unrelated.config.Port, '127.0.0.1', resolve));
      try {
        await assert.rejects(launch(unrelated.path), /unrelated or differently configured/);
        assert.equal((await fetch(origin(unrelated.config))).status, 200);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
    await t.test(
      'a silent TCP listener never permits a gateway spawn across repeated clicks',
      async () => {
        const unrelated = await configuration('silent-tcp');
        const sockets = new Set();
        const server = createServer((socket) => {
          sockets.add(socket);
          socket.on('error', () => undefined);
          socket.on('close', () => sockets.delete(socket));
        });
        await new Promise((resolve) => server.listen(unrelated.config.Port, '127.0.0.1', resolve));
        const before = await readFile(join(install, 'gateway.log'), 'utf8');
        try {
          for (let trial = 0; trial < 8; trial++) {
            await assert.rejects(launch(unrelated.path), /occupied but .*not ready/);
            assert.equal(await readFile(join(install, 'gateway.log'), 'utf8'), before);
            await assert.rejects(readFile(join(unrelated.config.DataDir, 'graphgoblin.lock')), {
              code: 'ENOENT',
            });
          }
        } finally {
          for (const socket of sockets) socket.destroy();
          await new Promise((resolve) => server.close(resolve));
        }
      },
    );
    await t.test(
      'malformed store ownership is preserved and refused before starting a gateway',
      async () => {
        const failure = await configuration('failure', { StartupTimeoutSeconds: 1 });
        await mkdir(failure.config.DataDir);
        const lock = join(failure.config.DataDir, 'graphgoblin.lock');
        await writeFile(lock, 'unverifiable owner');
        const before = await readFile(join(install, 'gateway.log'), 'utf8');
        await assert.rejects(launch(failure.path), /Store ownership is held or cannot be verified/);
        assert.equal(await readFile(lock, 'utf8'), 'unverifiable owner');
        assert.equal(await readFile(join(install, 'gateway.log'), 'utf8'), before);
      },
    );
    await t.test(
      'reused live PID in both locks and guards permits exactly one cold gateway',
      async () => {
        const reused = await configuration('reused-pid');
        await mkdir(reused.config.DataDir);
        const oldOwner = JSON.stringify({
          pid: process.pid,
          windowsCreationTime: '134000000000000000',
          token: 'former-process',
        });
        for (const file of [
          'graphgoblin.lock',
          'graphgoblin.lock.reclaim',
          'graphgoblin.db.graphgoblin.lock',
          'graphgoblin.db.graphgoblin.lock.reclaim',
        ]) {
          await writeFile(join(reused.config.DataDir, file), oldOwner);
        }
        try {
          await Promise.all([launch(reused.path), launch(reused.path)]);
          const running = await health(reused.config);
          const record = JSON.parse(
            await readFile(join(reused.config.DataDir, 'graphgoblin.lock'), 'utf8'),
          );
          assert.equal(String(record.pid), running.pid);
          assert.match(record.windowsCreationTime, /^[1-9][0-9]{16,18}$/);
          assert.notEqual(record.windowsCreationTime, '134000000000000000');
          process.kill(process.pid, 0);
        } finally {
          await stop(reused.config);
        }
      },
    );
    await t.test(
      'matching and unknown identities preserve locks, guards and the live process',
      async () => {
        const { windowsProcessIdentity } =
          await import('../../apps/api/dist/windows-process-identity.js');
        const creationTime = await windowsProcessIdentity(process.pid);
        assert.match(creationTime, /^[1-9][0-9]{16,18}$/);
        for (const [name, record] of [
          ['matching', { pid: process.pid, windowsCreationTime: creationTime }],
          ['pid-only', { pid: process.pid }],
          ['inaccessible', { pid: 4 }],
        ]) {
          const refused = await configuration('held-' + name, { StartupTimeoutSeconds: 1 });
          await mkdir(refused.config.DataDir);
          const lock = join(
            refused.config.DataDir,
            name === 'matching' ? 'graphgoblin.db.graphgoblin.lock.reclaim' : 'graphgoblin.lock',
          );
          const original = JSON.stringify(record);
          await writeFile(lock, original);
          const before = await readFile(join(install, 'gateway.log'), 'utf8');
          await assert.rejects(
            launch(refused.path),
            /Store ownership is held or cannot be verified/,
          );
          assert.equal(await readFile(lock, 'utf8'), original);
          assert.equal(await readFile(join(install, 'gateway.log'), 'utf8'), before);
          process.kill(process.pid, 0);
        }
      },
    );
    console.log(JSON.stringify({ evidence: 'windows-launcher-native', artifacts: base }));
  },
);
