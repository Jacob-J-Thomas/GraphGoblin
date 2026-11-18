// Native Windows executable + built API, disposable stores, no provider turns or owner ports.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  aliasStage,
  errorCodeOf,
  openWindowsLauncherEvidence,
} from './windows-launcher-evidence.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// CI evidence (#496): typed records only, appended as they occur. Without the CI variable nothing
// is written; the variable is removed from this process before any child starts.
const ciEvidence = openWindowsLauncherEvidence({ repoRoot: root });
const execute = ciEvidence.observeExecFile(promisify(execFile));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GG_') && key !== 'JEV_API_KEY'),
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function ownershipFixture(path, owner) {
  const record = { ...owner, token: owner.token ?? randomUUID() };
  if (path.endsWith('.reclaim')) {
    await mkdir(path);
    path = join(path, `${record.token}.json`);
  }
  const contents = JSON.stringify(record);
  await writeFile(path, contents);
  return { path, contents };
}

function ownershipContender(dataDir) {
  const module = pathToFileURL(join(root, 'apps/api/dist/data-dir-lock.js')).href;
  const program = `
    const { acquireDataDirLock } = await import(process.argv[1]);
    process.stdin.resume();
    const released = new Promise(resolve => process.stdin.once('end', resolve));
    try {
      const lock = await acquireDataDirLock(process.argv[2]);
      process.stdout.write(JSON.stringify({ status: 'acquired', pid: process.pid }) + '\\n');
      await released;
      await lock.release();
    } catch (error) {
      process.stdout.write(JSON.stringify({ status: 'refused', pid: process.pid, error: error.message }) + '\\n');
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, module, dataDir], {
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let stdout = '';
  let stderr = '';
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Ownership contender ${child.pid} timed out: ${stderr}`)),
      55_000,
    );
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (!stdout.includes('\n'))
        reject(new Error(`Ownership contender exited ${code}: ${stderr}`));
    });
  });
  return { child, result, exited };
}
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
  const cleanup = (result) =>
    ciEvidence.record('cleanup', { action: 'gateway-drain', result, count: null });
  try {
    await health(config);
  } catch {
    cleanup('not-running');
    return;
  }
  await fetch(origin(config) + '/system/shutdown', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'drain' }),
    signal: AbortSignal.timeout(3000),
  }).catch((error) => {
    cleanup('failed');
    throw error;
  });
  for (let i = 0; i < 100; i++) {
    try {
      await health(config);
    } catch {
      cleanup('drained');
      return;
    }
    await sleep(100);
  }
  cleanup('failed');
  throw new Error('Disposable gateway did not finish its normal drain.');
}

async function compileLauncher(compiler, exe) {
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
}

function launchNative(exe, path, environment = env) {
  return execute(exe, ['--config', path, '--ensure-gateway'], {
    cwd: root,
    env: environment,
    windowsHide: true,
    timeout: 30_000,
  });
}

const systemTool = (tool) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', tool);
let currentUserSid;
/**
 * Managed log roots must be private (#438). A profile or checkout can inherit access for other
 * local principals, so every fixture that receives logs restricts its own ACL explicitly.
 */
async function privateDirectory(path) {
  await mkdir(path, { recursive: true });
  currentUserSid ??= /"(S-1-[0-9-]+)"/.exec(
    (await execute(systemTool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { windowsHide: true }))
      .stdout,
  )?.[1];
  assert.ok(currentUserSid, 'The current user SID must be known.');
  await execute(
    systemTool('icacls.exe'),
    [
      path,
      '/inheritance:r',
      '/grant:r',
      `*${currentUserSid}:(OI)(CI)F`,
      '*S-1-5-18:(OI)(CI)F',
      '*S-1-5-32-544:(OI)(CI)F',
    ],
    { windowsHide: true },
  );
  return path;
}

function logRecords(contents) {
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test(
  'Windows PowerShell 5.1 installer validates before replacing native launcher files',
  { skip: process.platform !== 'win32', timeout: 120_000 },
  ciEvidence.observeTest('installer', async () => {
    await mkdir(join(root, '.tmp'), { recursive: true });
    const base = await mkdtemp(join(root, '.tmp', 'windows-launcher-installer-'));
    ciEvidence.fixture('installer', base);
    const install = join(base, 'installed space α');
    const store = join(base, 'store');
    await mkdir(store);
    const exe = join(install, 'GraphGoblin.exe');
    const installer = join(root, 'scripts/install-windows-launcher.ps1');
    const system = process.env.SystemRoot;
    const powerShell = join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const compiler = join(system, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const fixture = join(base, 'fixture.exe');
    await compileLauncher(compiler, fixture);
    const source = join(base, 'Chrome source.lnk');
    const proxy = join(base, 'chrome_proxy.exe');
    await writeFile(proxy, 'Inert Shell Link target fixture');
    const desktop = join(base, 'Desktop/GraphGoblin.lnk');
    const programs = join(base, 'Programs/GraphGoblin.lnk');
    const port = await freePort();
    const options = {
      RepoPath: root,
      NodePath: process.execPath,
      DataDir: store,
      Port: port,
      PwaShortcut: source,
      InstallDir: install,
      DesktopShortcut: desktop,
      StartMenuShortcut: programs,
    };
    function runPowerShell(script, request) {
      return execute(
        powerShell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        {
          env: { ...env, GG_INSTALLER_FIXTURE: JSON.stringify(request) },
          cwd: base,
          windowsHide: true,
          timeout: 40_000,
        },
      );
    }
    const chromeId = (
      await execute(fixture, ['--expected-app-id', String(port)], { windowsHide: true })
    ).stdout.trim();
    await runPowerShell(
      `$ErrorActionPreference = 'Stop'
      $request = $env:GG_INSTALLER_FIXTURE | ConvertFrom-Json
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut($request.source)
      $shortcut.TargetPath = $request.proxy
      $shortcut.Arguments = $request.arguments
      $shortcut.Save()`,
      { source, proxy, arguments: `--profile-directory="Default" --app-id=${chromeId}` },
    );
    const fixtureConfig = join(base, 'fixture.json');
    await writeFile(
      fixtureConfig,
      JSON.stringify({
        Repo: root,
        Node: process.execPath,
        DataDir: store,
        Port: port,
        Environment: {},
        StartupTimeoutSeconds: 30,
        WindowTimeoutSeconds: 2,
        LauncherAppUserModelId: 'Chrome.PwaFixture',
      }),
    );
    await execute(
      fixture,
      ['--ensure-gateway', '--config', fixtureConfig, '--stamp-shortcut', source],
      {
        windowsHide: true,
      },
    );

    const invoke = (overrides = {}) =>
      runPowerShell(
        `$ErrorActionPreference = 'Stop'
      $request = $env:GG_INSTALLER_FIXTURE | ConvertFrom-Json
      $options = @{}
      foreach ($property in $request.options.PSObject.Properties) { $options[$property.Name] = $property.Value }
      if ($options.ContainsKey('Environment')) {
        $settings = @{}
        foreach ($property in $options.Environment.PSObject.Properties) { $settings[$property.Name] = $property.Value }
        $options.Environment = $settings
      }
      & $request.installer @options`,
        { installer, options: { ...options, ...overrides } },
      );
    async function invokeWithNodeDiscovery(childPath, overrides = {}) {
      const discoveredOptions = { ...options, ...overrides };
      delete discoveredOptions.NodePath;
      return runPowerShell(
        `$ErrorActionPreference = 'Stop'
      Set-StrictMode -Version Latest
      $request = $env:GG_INSTALLER_FIXTURE | ConvertFrom-Json
      $env:PATH = $request.childPath
      $options = @{}
      foreach ($property in $request.options.PSObject.Properties) { $options[$property.Name] = $property.Value }
      if ($options.ContainsKey('Environment')) {
        $settings = @{}
        foreach ($property in $options.Environment.PSObject.Properties) { $settings[$property.Name] = $property.Value }
        $options.Environment = $settings
      }
      & $request.installer @options`,
        { installer, options: discoveredOptions, childPath },
      );
    }
    const sourceBefore = await readFile(source);
    await invoke();
    assert.deepEqual(await readFile(source), sourceBefore);
    const config = JSON.parse(await readFile(exe + '.json', 'utf8'));
    const configPath = exe + '.json';
    const validConfig = await execute(fixture, ['--validate-install', '--config', configPath], {
      cwd: base,
      windowsHide: true,
    });
    assert.equal(validConfig.stdout, '');
    assert.equal(validConfig.stderr, '');
    for (const output of [desktop, programs]) {
      const inspected = JSON.parse(
        (await execute(exe, ['--inspect-shortcut', output], { windowsHide: true })).stdout,
      );
      assert.equal(await realpath(inspected.TargetPath), await realpath(exe));
      assert.equal(inspected.Arguments, `--config "${await realpath(exe)}.json"`);
      const id = await execute(exe, ['--read-shortcut-id', output], { windowsHide: true });
      assert.equal(id.stdout.trim(), config.LauncherAppUserModelId);
    }

    const alias = join(base, 'same source hard link.lnk');
    await link(source, alias);
    const files = [exe, exe + '.json', source, alias, desktop, programs];
    const snapshot = () => Promise.all(files.map((file) => readFile(file)));
    const before = await snapshot();
    async function refuses(overrides, expected) {
      await assert.rejects(invoke(overrides), (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, expected);
        assert.doesNotMatch(error.stdout + error.stderr, /GG_INSTALLER_PRIVATE_PATH_CANARY/);
        return true;
      });
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await readdir(store), []);
    }
    async function refusesPrivate(args, expected, stagedOutput) {
      await assert.rejects(execute(fixture, args, { cwd: base, windowsHide: true }), (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stderr, `${expected}\r\n`);
        assert.equal(error.stdout, '');
        return true;
      });
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await readdir(store), []);
      if (stagedOutput) await assert.rejects(lstat(stagedOutput), { code: 'ENOENT' });
    }
    const noNodePath = [join(system, 'System32'), system].join(';');
    await assert.rejects(invokeWithNodeDiscovery(noNodePath), (error) => {
      assert.equal(error.code, 1);
      assert.match(
        error.stderr,
        /Node was not found\. Install Node 22.*-NodePath.*run the installer again\./is,
      );
      assert.doesNotMatch(error.stderr, /PropertyNotFoundException|property.+Source|\.Source/i);
      return true;
    });
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await readdir(store), []);

    const discoveredInstall = join(base, 'discovered install');
    const discoveredStore = join(base, 'discovered store');
    await mkdir(discoveredStore);
    const nodeAvailablePath = [dirname(process.execPath), join(system, 'System32'), system].join(
      ';',
    );
    await invokeWithNodeDiscovery(nodeAvailablePath, {
      DataDir: discoveredStore,
      InstallDir: discoveredInstall,
      NoShortcuts: true,
      Port: port,
    });
    const discoveredExe = join(discoveredInstall, 'GraphGoblin.exe');
    const discoveredConfig = JSON.parse(await readFile(discoveredExe + '.json', 'utf8'));
    assert.equal(discoveredConfig.Node, await realpath(process.execPath));
    assert.equal(discoveredConfig.Port, port);
    assert.deepEqual(await readdir(discoveredStore), []);
    assert.deepEqual(await readFile(source), sourceBefore);

    const drive = base.slice(0, 2);
    const driveRelativeConfig = `${drive}${relative(base, configPath)}`;
    const rootRelativeConfig = configPath.slice(2);
    await refusesPrivate(
      ['--validate-install', '--config', driveRelativeConfig],
      'Invalid staged launcher configuration path.',
    );
    await refusesPrivate(
      ['--validate-install', '--config', rootRelativeConfig],
      'Invalid staged launcher configuration path.',
    );

    const stageDir = join(base, 'private path staging');
    await mkdir(stageDir);
    for (const [kind, privatePath] of [
      ['drive-relative', (absolute) => `${drive}${relative(base, absolute)}`],
      ['root-relative', (absolute) => absolute.slice(2)],
    ]) {
      const shortcut = join(stageDir, `${kind}.lnk`);
      const invalidShortcut = privatePath(shortcut);
      await refusesPrivate(
        ['--stage-shortcut', invalidShortcut, configPath, exe],
        'Invalid staged shortcut or final launcher path.',
        shortcut,
      );

      const finalExe = join(stageDir, `${kind}-launcher.exe`);
      await refusesPrivate(
        [
          '--stage-shortcut',
          join(stageDir, `${kind}-final.lnk`),
          configPath,
          privatePath(finalExe),
        ],
        'Invalid staged shortcut or final launcher path.',
        join(stageDir, `${kind}-final.lnk`),
      );
    }
    await refuses({ NoShortcuts: true, Environment: { GG_PORT: '9999' } }, /reserved GG_\*/i);
    await refuses(
      { NoShortcuts: true, Environment: { GG_Windows_Launcher_Log_Dir: base } },
      /reserved GG_\*/i,
    );
    // Both the installer and its staged native validator require the current guarded build.
    const staleRepo = join(base, 'stale repo');
    for (const [file, contents] of [
      ['apps/api/dist/main.js', 'export const legacyEntry = true;\n'],
      ['apps/api/dist/instance-identity.js', '// stale helper\n'],
      ['apps/web/dist/index.html', '<html></html>'],
    ]) {
      await mkdir(dirname(join(staleRepo, file)), { recursive: true });
      await writeFile(join(staleRepo, file), contents);
    }
    await mkdir(join(staleRepo, 'apps/windows-launcher'), { recursive: true });
    await copyFile(
      join(root, 'apps/windows-launcher/Launcher.cs'),
      join(staleRepo, 'apps/windows-launcher/Launcher.cs'),
    );
    await refuses(
      { RepoPath: staleRepo },
      /Build the checkout first: missing apps\/api\/dist\/windows-log\/guard\.js/,
    );
    await mkdir(join(staleRepo, 'apps/api/dist/windows-log'));
    await copyFile(
      join(root, 'apps/api/dist/windows-log/guard.js'),
      join(staleRepo, 'apps/api/dist/windows-log/guard.js'),
    );
    await refuses({ RepoPath: staleRepo }, /staged launcher configuration was refused/);
    await refuses({ DesktopShortcut: alias }, /distinct files and paths/i);
    await refuses(
      { NodePath: join(base, 'GG_INSTALLER_PRIVATE_PATH_CANARY', 'node.exe') },
      /Node.+22\.22\.2.+-NodePath/is,
    );
  }),
);

test(
  'native Windows launcher readiness, reuse, races, refusals, detached lifetime and shell route',
  { skip: process.platform !== 'win32', timeout: 240_000 },
  ciEvidence.observeTest('launcher', async (t) => {
    await mkdir(join(root, '.tmp'), { recursive: true });
    const base = await mkdtemp(join(root, '.tmp', 'windows-launcher-'));
    ciEvidence.fixture('launcher', base);
    const install = join(base, 'launcher space-α');
    await privateDirectory(install);
    const exe = join(install, 'GraphGoblin.exe');
    const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    await compileLauncher(compiler, exe);
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
    const launch = (path) => launchNative(exe, path);
    const first = await configuration('primary');
    await t.test(
      'concurrent cold starts create one gateway and later clicks reuse its PID',
      async () => {
        const clicks = await Promise.all(Array.from({ length: 4 }, () => launch(first.path)));
        // Successful clicks are quiet; the gateway's own stdio is NUL, never a caller pipe.
        for (const click of clicks) assert.deepEqual([click.stdout, click.stderr], ['', '']);
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
        const records = logRecords(await readFile(join(install, 'gateway.log'), 'utf8'));
        assert.ok(
          records.some(
            (record) =>
              record.msg === 'GraphGoblin API listening' && String(record.pid) === before.pid,
          ),
        );
        // Managed access records carry method, route template and status only.
        for (const record of records.filter((entry) => entry.req || entry.res))
          for (const key of Object.keys(record.req ?? record.res))
            assert.ok(['method', 'route', 'statusCode'].includes(key), `access field ${key}`);
        await assert.rejects(lstat(join(install, 'launcher.log')), { code: 'ENOENT' });
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
            /another GraphGoblin process holds this store; check its port\/configuration/,
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
          ciEvidence.record('cleanup', {
            action: 'window-fixture',
            result: closed ? 'closed' : 'killed',
            count: null,
          });
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
        await assert.rejects(
          launch(failure.path),
          /Store ownership could not be verified \(malformed or incomplete owner record\)/,
        );
        assert.equal(await readFile(lock, 'utf8'), 'unverifiable owner');
        assert.equal(await readFile(join(install, 'gateway.log'), 'utf8'), before);
      },
    );
    await t.test(
      'reused live PID in both locks and guards permits exactly one cold gateway',
      async () => {
        const reused = await configuration('reused-pid');
        await mkdir(reused.config.DataDir);
        const oldOwner = {
          pid: process.pid,
          windowsCreationTime: '134000000000000000',
          token: randomUUID(),
        };
        for (const file of [
          'graphgoblin.lock',
          'graphgoblin.lock.reclaim',
          'graphgoblin.db.graphgoblin.lock',
          'graphgoblin.db.graphgoblin.lock.reclaim',
        ]) {
          await ownershipFixture(join(reused.config.DataDir, file), oldOwner);
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
      'a protected system PID with a different verified identity is recovered without touching that process',
      async () => {
        const discovery = `
          $ErrorActionPreference='Stop'; $selected=$null;
          $candidates=Get-CimInstance Win32_Process -Filter "Name = 'csrss.exe' OR Name = 'lsass.exe' OR Name = 'services.exe' OR Name = 'unsecapp.exe' OR Name = 'wininit.exe' OR Name = 'winlogon.exe'";
          foreach($candidate in $candidates) {
            if ($null -eq $candidate.CreationDate) { continue }; $probe=$null;
            try { $probe=[Diagnostics.Process]::GetProcessById([int]$candidate.ProcessId); $null=$probe.get_HasExited() }
            catch {
              $cause=$_.Exception.GetBaseException();
              if ($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 5) {
                $selected=[pscustomobject]@{pid=[int]$candidate.ProcessId;name=$candidate.Name;windowsCreationTime=$candidate.CreationDate.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture);deniedOperation='Process.HasExited';errorCode=5}; break;
              }
            } finally { if ($null -ne $probe) { $probe.Dispose() } }
          }
          ConvertTo-Json -InputObject $selected -Compress
        `;
        const selected = JSON.parse(
          (
            await execute(
              'powershell.exe',
              ['-NoProfile', '-NonInteractive', '-Command', discovery],
              { env, windowsHide: true, timeout: 15_000 },
            )
          ).stdout,
        );
        assert.ok(
          selected,
          'Required protected-process regression could not find a system PID with denied HasExited and queryable CreationDate.',
        );
        assert.equal(selected.errorCode, 5);
        assert.match(selected.windowsCreationTime, /^[1-9][0-9]{16,18}$/);
        const reused = await configuration('reused-protected-pid');
        await mkdir(reused.config.DataDir);
        const previous = {
          pid: selected.pid,
          windowsCreationTime: (BigInt(selected.windowsCreationTime) - 10000000n).toString(),
          token: randomUUID(),
        };
        const fixtures = [];
        for (const file of [
          'graphgoblin.lock',
          'graphgoblin.lock.reclaim',
          'graphgoblin.db.graphgoblin.lock',
          'graphgoblin.db.graphgoblin.lock.reclaim',
        ]) {
          fixtures.push(await ownershipFixture(join(reused.config.DataDir, file), previous));
        }
        const state = await execute(
          process.execPath,
          [join(root, 'apps/api/dist/instance-identity.js'), '--store-state'],
          {
            cwd: root,
            env: {
              ...env,
              GG_DATA_DIR: reused.config.DataDir,
              GG_PORT: String(reused.config.Port),
              GG_WEB_DIST: join(root, 'apps/web/dist'),
            },
            windowsHide: true,
            timeout: 30_000,
          },
        );
        assert.equal(JSON.parse(state.stdout).state, 'free');
        for (const fixture of fixtures)
          assert.equal(await readFile(fixture.path, 'utf8'), fixture.contents);
        try {
          await launch(reused.path);
          const running = await health(reused.config);
          assert.notEqual(Number(running.pid), selected.pid);
          const { windowsProcessIdentity } =
            await import('../../apps/api/dist/windows-process-identity.js');
          assert.equal(
            (await windowsProcessIdentity(selected.pid)).identity,
            selected.windowsCreationTime,
          );
          console.log(
            JSON.stringify({
              evidence: 'protected-system-pid-reuse',
              selected,
              gatewayPid: running.pid,
            }),
          );
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
        const { identity: creationTime } = await windowsProcessIdentity(process.pid);
        assert.match(creationTime, /^[1-9][0-9]{16,18}$/);
        for (const [name, record] of [
          ['matching', { pid: process.pid, windowsCreationTime: creationTime }],
          ['pid-only', { pid: process.pid }],
          ['inaccessible', { pid: 4 }],
          ['file-guard', { pid: process.pid, windowsCreationTime: '134000000000000000' }],
        ]) {
          const refused = await configuration('held-' + name, { StartupTimeoutSeconds: 1 });
          await mkdir(refused.config.DataDir);
          const lock = join(
            refused.config.DataDir,
            name === 'matching' || name === 'file-guard'
              ? 'graphgoblin.db.graphgoblin.lock.reclaim'
              : 'graphgoblin.lock',
          );
          const original =
            name === 'file-guard'
              ? { path: lock, contents: JSON.stringify(record) }
              : await ownershipFixture(lock, record);
          if (name === 'file-guard') await writeFile(original.path, original.contents);
          const before = await readFile(join(install, 'gateway.log'), 'utf8');
          await assert.rejects(
            launch(refused.path),
            name === 'matching'
              ? /another GraphGoblin process holds this store/
              : /Store ownership could not be verified/,
          );
          assert.equal(await readFile(original.path, 'utf8'), original.contents);
          assert.equal(await readFile(join(install, 'gateway.log'), 'utf8'), before);
          process.kill(process.pid, 0);
        }
      },
    );
    console.log(JSON.stringify({ evidence: 'windows-launcher-native', artifacts: base }));
  }),
);

const identityLine = /^[a-f0-9]{64}\n$/;
const freeStoreLine = '{"state":"free"}\n';
const identityRefusal =
  "The Node 22 runtime, launcher configuration or store ownership could not be checked. Check the configured runtime, GG_* overrides and read permissions on the store's lock files.";
const configRefusal = /belongs to an unrelated or differently configured service/;
const leaseNames = ['graphgoblin.lock', 'graphgoblin.db.graphgoblin.lock'];

function publicCommandOutput(output, protocol) {
  if (!output) return '';
  if (protocol && (identityLine.test(output) || output === freeStoreLine)) return output;
  const firstLine = output.split(/\r?\n/, 1)[0];
  if (firstLine === identityRefusal) return firstLine;
  if (configRefusal.test(firstLine)) return 'unrelated or differently configured service';
  return `[${Buffer.byteLength(output)} bytes suppressed]`;
}

async function observeCommand(evidence, name, command) {
  const {
    code = null,
    signal = null,
    stdout = '',
    stderr = '',
  } = await command.then(
    (result) => ({ ...result, code: 0 }),
    (error) => error,
  );
  evidence[name] = {
    code,
    signal,
    stdout: publicCommandOutput(
      stdout,
      name.endsWith('-identity') || name.endsWith('-store-state'),
    ),
    stderr: publicCommandOutput(stderr, false),
  };
  return { code, stdout, stderr };
}

function assertOutput(result, expected, name) {
  assert.equal(result.code, 0, `${name} must exit successfully.`);
  assert.ok(result.stderr === '', `${name} must have empty stderr.`);
  assert.ok(result.stdout === expected, `${name} returned an unexpected stdout record.`);
}

async function nativeObservation(script, overrides = {}) {
  const command = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);
    ${script}`;
  const args = ['-NoProfile', '-NonInteractive', '-Command', command];
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const { stdout, stderr } = await execute(powershell, args, {
    env: { ...env, ...overrides },
    windowsHide: true,
    timeout: 15_000,
  });
  assert.ok(stderr === '', 'Native Windows inspection emitted stderr.');
  return parseInspection(stdout, 'Native Windows inspection');
}

function parseInspection(contents, name) {
  try {
    return JSON.parse(contents);
  } catch {
    assert.fail(`${name} must contain valid JSON.`);
  }
}

function listening(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(2000, () => socket.destroy(new Error(`TCP probe timed out on ${port}.`)));
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(error);
    });
  });
}

async function ownedAliasGateway(config, digest) {
  const running = await health(config);
  assert.ok(
    digest && running.identity === digest,
    'The listener must have the configured identity.',
  );
  assert.ok(/^[1-9][0-9]*$/.test(running.pid), 'The listener must report its PID.');
  const pid = Number(running.pid);
  const native = await nativeObservation(`
    $owner = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}';
    if (!$owner -or !$owner.CreationDate) { throw 'No process creation identity'; }
    [pscustomobject]@{
      pid = [int]$owner.ProcessId
      birth = $owner.CreationDate.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)
      executable = $owner.ExecutablePath
      commandLine = $owner.CommandLine
    } | ConvertTo-Json -Compress
  `);
  assert.equal(native.pid, pid);
  assert.match(native.birth, /^[1-9][0-9]{16,18}$/);
  const executable = await realpath(native.executable);
  assert.equal(executable, await realpath(config.Node));
  const args = /^"([^"]+)" "([^"]+)"$/.exec(native.commandLine);
  assert.ok(args, 'The gateway must have a native Node executable and a single main argument.');
  assert.equal(normalize(args[1]), normalize(config.Node));
  const main = normalize(args[2]);
  assert.equal(main, join(config.Repo, 'apps/api/dist/main.js'));
  const leases = {};
  for (const name of leaseNames) {
    const contents = await readFile(join(config.DataDir, name));
    const record = parseInspection(contents, name);
    assert.ok(
      record?.pid === pid && record.windowsCreationTime === native.birth,
      `${name} must belong to the running process.`,
    );
    leases[name] = createHash('sha256').update(contents).digest('hex');
  }
  return { pid, birth: native.birth, executable, main, leases };
}

async function releaseAliasGateway(start, digest, owner) {
  const { config, path } = start;
  if (await listening(config.Port)) {
    const running = await health(config);
    assert.ok(
      digest && running.identity === digest,
      'Only the configured listener can be drained.',
    );
    const url = origin(config) + '/system/shutdown';
    const request = () => ({ redirect: 'error', signal: AbortSignal.timeout(3000) });
    const status = await fetch(url, request());
    assert.equal(status.status, 200);
    const { phase, activeRunIds, unconfirmedRunIds, controlToken } = await status.json();
    assert.equal(phase, 'running');
    assert.ok(Array.isArray(activeRunIds) && activeRunIds.length === 0);
    assert.ok(Array.isArray(unconfirmedRunIds) && unconfirmedRunIds.length === 0);
    assert.ok(typeof controlToken === 'string' && controlToken.length > 0);
    const current = await ownedAliasGateway(config, digest);
    if (owner) assert.deepEqual(current, owner);
    owner = current;
    const drain = await fetch(url, {
      ...request(),
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-graphgoblin-shutdown-token': controlToken },
      body: JSON.stringify({ action: 'drain' }),
    });
    assert.equal(drain.status, 202);
  }
  if (owner) {
    const deadline = Date.now() + 10_000;
    let birth;
    do {
      birth = await nativeObservation(`
        $owner = Get-CimInstance Win32_Process -Filter 'ProcessId = ${owner.pid}';
        if (!$owner) { 'null'; return }
        if (!$owner.CreationDate) { throw 'No process creation identity'; }
        ConvertTo-Json -InputObject ($owner.CreationDate.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)) -Compress
      `);
      if (birth !== owner.birth) break;
      await sleep(100);
    } while (Date.now() < deadline);
    assert.ok(
      birth === null || (/^[1-9][0-9]{16,18}$/.test(birth) && birth !== owner.birth),
      'The owned PID and birth must disappear after managed drain.',
    );
  } else {
    // Without a verified owner or clean refusal, a gateway may still be binding.
    await assert.rejects(lstat(join(dirname(path), 'gateway.log')), { code: 'ENOENT' });
  }
  assert.equal(await listening(config.Port), false, 'The gateway listener must close.');
  for (const name of leaseNames) {
    await assert.rejects(lstat(join(config.DataDir, name)), { code: 'ENOENT' });
    await assert.rejects(lstat(join(config.DataDir, `${name}.reclaim`)), { code: 'ENOENT' });
  }
  return owner ? 'drained-pid-listener-leases' : 'no-gateway-spawned';
}

function sameFile(current, original) {
  return (
    current.dev === original.dev &&
    current.ino === original.ino &&
    current.birthtimeNs === original.birthtimeNs
  );
}

async function checkLauncherAlias(exe, sandbox, repo, kind, linkType) {
  const fixture = await privateDirectory(await mkdtemp(join(sandbox, `${kind}-`)));
  const alias = join(fixture, 'checkout alias-α');
  // The link's final state is observed with lstat only; it is never traversed or exported.
  ciEvidence.fixture('alias-link', alias, ciEvidence.fixture('alias-fixture', fixture));
  const evidence = {
    evidence: 'windows-launcher-checkout-alias',
    kind,
    requestedLinkType: linkType,
    fixture,
    commands: {},
    cold: [],
  };
  const fixtureStat = await lstat(fixture, { bigint: true });
  let link;
  let targetMatched = false;
  let releaseVerified = true;
  let stage = 'create-alias';
  let failure;
  try {
    await symlink(repo, alias, kind);
    stage = 'verify-alias';
    const created = await lstat(alias, { bigint: true });
    assert.ok(created.isSymbolicLink());
    assert.equal(await realpath(alias), repo);
    assert.equal(await realpath(await readlink(alias)), repo);
    targetMatched = true;
    evidence.reparse = await nativeObservation(
      `
      $item = Get-Item -LiteralPath $env:GG_TEST_CHECKOUT_ALIAS -Force;
      [pscustomobject]@{
        linkType = $item.LinkType
        directory = [bool]($item.Attributes -band [IO.FileAttributes]::Directory)
        reparsePoint = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
      } | ConvertTo-Json -Compress
    `,
      { GG_TEST_CHECKOUT_ALIAS: alias },
    );
    const observedType = evidence.reparse.linkType;
    assert.ok(observedType === linkType || (kind === 'dir' && observedType === 'SymLink'));
    assert.ok(evidence.reparse.directory === true && evidence.reparse.reparsePoint === true);
    link = created;
    stage = 'configure-fixture';
    const dataDir = join(fixture, 'store');
    const wrongDataDir = join(fixture, 'wrong-store');
    await mkdir(dataDir);
    await mkdir(wrongDataDir);
    const port = await freePort();
    evidence.port = port;
    const environment = Object.fromEntries(
      Object.entries(env).filter(([key]) => {
        const upper = key.toUpperCase();
        return !upper.startsWith('GG_') && upper !== 'JEV_API_KEY';
      }),
    );
    async function configuration(name, checkout, overrides = {}) {
      const directory = join(fixture, name);
      await mkdir(directory);
      const config = {
        Repo: checkout,
        Node: process.execPath,
        DataDir: dataDir,
        Port: port,
        Environment: { GG_LOG_LEVEL: 'info', GG_OLLAMA_ENABLED: 'false' },
        StartupTimeoutSeconds: 15,
        WindowTimeoutSeconds: 2,
        ...overrides,
      };
      const path = join(directory, 'launcher.json');
      await writeFile(path, JSON.stringify(config));
      return { name, config, path };
    }
    const direct = await configuration('direct', repo);
    const aliased = await configuration('alias', alias);
    const mismatchStore = await configuration('wrong-store-config', alias, {
      DataDir: wrongDataDir,
    });
    const mismatchSettings = await configuration('wrong-settings-config', alias, {
      Environment: { ...aliased.config.Environment, GG_REQUIRE_API_KEY: 'true' },
    });
    const launch = (name, { path }) =>
      observeCommand(evidence.commands, name, launchNative(exe, path, environment));
    const helper = (name, { config }, mode) => {
      const entry = join(config.Repo, 'apps/api/dist/instance-identity.js');
      const importing = mode === 'import';
      const args = importing
        ? ['--input-type=module', '-e', 'await import(process.argv[1])', pathToFileURL(entry).href]
        : [entry, ...(mode ? [mode] : [])];
      const command = execute(config.Node, args, {
        cwd: config.Repo,
        env: {
          ...environment,
          ...config.Environment,
          GG_DATA_DIR: config.DataDir,
          GG_HOST: '127.0.0.1',
          GG_PORT: importing ? 'invalid' : String(config.Port),
          GG_WEB_DIST: join(config.Repo, 'apps/web/dist'),
        },
        windowsHide: true,
        timeout: 15_000,
      });
      return observeCommand(evidence.commands, name, command);
    };
    stage = 'capture-cli';
    const directIdentity = await helper('direct-identity', direct);
    const aliasIdentity = await helper('alias-identity', aliased);
    const state = await helper('alias-store-state', aliased, '--store-state');
    const imported = await helper('alias-import', aliased, 'import');
    const entriesBeforeCold = (await readdir(dataDir)).length;
    evidence.storeEntriesBeforeCold = entriesBeforeCold;
    const digest =
      directIdentity.code === 0 &&
      directIdentity.stderr === '' &&
      identityLine.test(directIdentity.stdout)
        ? directIdentity.stdout.slice(0, -1)
        : undefined;
    for (const [start, alternate] of [
      [aliased, direct],
      [direct, aliased],
    ]) {
      stage = `${start.name}-check-free-port`;
      assert.equal(await listening(port), false, 'The cold launcher must have a free port.');
      releaseVerified = false;
      let owner;
      let roundFailure;
      const observation = { spelling: start.name };
      evidence.cold.push(observation);
      try {
        // Preserve both CLI probe results and the actual native launch on a failing baseline.
        stage = `${start.name}-cold`;
        const launched = await launch(`${start.name}-cold`, start);
        stage = 'assert-cli';
        assert.ok(digest, 'Direct identity helper must emit one lowercase digest and LF.');
        assertOutput(aliasIdentity, directIdentity.stdout, 'Aliased identity helper');
        assertOutput(state, freeStoreLine, 'Aliased store-state helper');
        assertOutput(imported, '', 'Aliased import with invalid CLI settings');
        assert.equal(
          entriesBeforeCold,
          0,
          'The read-only helper and import must leave the store empty.',
        );
        stage = `${start.name}-cold-ready`;
        assertOutput(launched, '', `${start.name} cold launcher`);
        owner = await ownedAliasGateway(start.config, digest);
        observation.owner = owner;
        for (const warm of [start, alternate]) {
          stage = `${start.name}-cold-${warm.name}-warm`;
          const result = await launch(stage, warm);
          assertOutput(result, '', `${warm.name} warm launcher`);
          assert.deepEqual(await ownedAliasGateway(start.config, digest), owner);
        }
        for (const mismatch of [mismatchStore, mismatchSettings]) {
          stage = `${start.name}-cold-${mismatch.name}`;
          const refused = await launch(stage, mismatch);
          assert.equal(refused.code, 1);
          assert.ok(
            configRefusal.test(refused.stderr),
            'Native launcher must refuse the mismatched gateway.',
          );
          assert.deepEqual(await ownedAliasGateway(start.config, digest), owner);
          await assert.rejects(lstat(join(dirname(mismatch.path), 'gateway.log')), {
            code: 'ENOENT',
          });
        }
        assert.deepEqual(await readdir(wrongDataDir), []);
      } catch (error) {
        roundFailure = error;
      }
      try {
        observation.release = await releaseAliasGateway(start, digest, owner);
        releaseVerified = true;
      } catch (error) {
        observation.releaseFailure = error.code ?? 'unknown';
        if (!roundFailure) {
          stage = `${start.name}-release`;
          roundFailure = error;
        }
      }
      ciEvidence.record('alias-round', {
        kind,
        spelling: start.name,
        ownerVerified: owner !== undefined,
        release: observation.release ?? 'failed',
        releaseFailure:
          'releaseFailure' in observation
            ? errorCodeOf({ code: observation.releaseFailure })
            : null,
      });
      if (roundFailure) throw roundFailure;
    }
  } catch (error) {
    failure = error;
    evidence.failure = {
      stage,
      code: error.code ?? null,
      errno: error.errno,
      syscall: error.syscall,
    };
    if (stage === 'create-alias') {
      evidence.aliasAbsent = await lstat(alias).then(
        () => false,
        (error) => error.code === 'ENOENT',
      );
    }
  }
  try {
    if (link && releaseVerified) {
      assert.equal(dirname(alias), fixture);
      assert.equal(dirname(fixture), sandbox);
      assert.equal(await realpath(fixture), fixture);
      assert.ok(sameFile(await lstat(fixture, { bigint: true }), fixtureStat));
      const current = await lstat(alias, { bigint: true });
      assert.ok(current.isSymbolicLink() && sameFile(current, link));
      assert.equal(await realpath(alias), repo);
      assert.equal(await realpath(await readlink(alias)), repo);
      await unlink(alias);
      evidence.aliasUnlinked = true;
    }
  } catch (error) {
    evidence.unlinkFailure = error.code ?? 'unknown';
    failure ??= error;
  }
  console.log(JSON.stringify(evidence));
  // Typed projection of the same facts: no paths, protocol identity or command output.
  const reparseType = evidence.reparse?.linkType;
  ciEvidence.record('alias', {
    kind,
    observedLinkType:
      reparseType === 'Junction' || reparseType === 'SymbolicLink'
        ? reparseType
        : evidence.reparse
          ? 'other'
          : 'unobserved',
    reparsePoint:
      typeof evidence.reparse?.reparsePoint === 'boolean' ? evidence.reparse.reparsePoint : null,
    directory: typeof evidence.reparse?.directory === 'boolean' ? evidence.reparse.directory : null,
    targetMatched,
    failureStage: evidence.failure ? aliasStage(evidence.failure.stage) : null,
    failureCode: evidence.failure ? errorCodeOf(failure) : null,
    disposition: evidence.aliasUnlinked
      ? 'unlinked'
      : evidence.aliasAbsent === true
        ? 'not-created'
        : link && !releaseVerified
          ? 'retained-release-unverified'
          : evidence.unlinkFailure !== undefined
            ? 'retained-unlink-refused'
            : 'retained-unverified-link',
    unlinkFailure:
      evidence.unlinkFailure === undefined ? null : errorCodeOf({ code: evidence.unlinkFailure }),
  });
  if (failure) throw failure;
}

test(
  'native Windows launcher accepts junction and directory symlink checkout paths',
  { skip: process.platform !== 'win32', timeout: 240_000 },
  ciEvidence.observeTest('checkout-alias', async (t) => {
    const repo = await realpath(root);
    const temp = await realpath(tmpdir());
    const fromRepo = relative(repo, temp);
    assert.ok(isAbsolute(fromRepo) || fromRepo === '..' || fromRepo.startsWith(`..${sep}`));
    const sandbox = await mkdtemp(join(temp, 'graphgoblin-launcher-alias-'));
    ciEvidence.fixture('alias-sandbox', sandbox);
    const exe = join(sandbox, 'GraphGoblin.exe');
    await compileLauncher(
      join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      exe,
    );
    for (const [kind, linkType] of [
      ['junction', 'Junction'],
      ['dir', 'SymbolicLink'],
    ]) {
      await t.test(`cold and warm native launcher with a ${linkType} checkout`, () =>
        checkLauncherAlias(exe, sandbox, repo, kind, linkType),
      );
    }
  }),
);

test(
  'independent API processes never share ownership while reclaiming a reused PID',
  { skip: process.platform !== 'win32', timeout: 180_000 },
  ciEvidence.observeTest('lock-contention', async () => {
    await mkdir(join(root, '.tmp'), { recursive: true });
    const base = await mkdtemp(join(root, '.tmp', 'windows-launcher-contention-'));
    ciEvidence.fixture('contention', base);
    const { windowsProcessIdentity } =
      await import('../../apps/api/dist/windows-process-identity.js');
    const { identity } = await windowsProcessIdentity(process.pid);
    assert.match(identity, /^[1-9][0-9]{16,18}$/);
    for (let trial = 1; trial <= 3; trial++) {
      const dataDir = join(base, `trial-${trial}`);
      await mkdir(dataDir);
      const previous = {
        pid: process.pid,
        windowsCreationTime: (BigInt(identity) - 10000000n).toString(),
        token: randomUUID(),
      };
      await ownershipFixture(join(dataDir, 'graphgoblin.lock'), previous);
      await ownershipFixture(join(dataDir, 'graphgoblin.lock.reclaim'), previous);
      const contenders = Array.from({ length: 5 }, () => ownershipContender(dataDir));
      try {
        const results = await Promise.all(contenders.map((contender) => contender.result));
        const owners = results.filter((result) => result.status === 'acquired');
        const refused = results.filter((result) => result.status === 'refused').length;
        ciEvidence.record('contention', {
          trial,
          contenders: contenders.length,
          acquired: owners.length,
          refused,
          other: results.length - owners.length - refused,
        });
        // No successful contender is released before every result is known. The launcher
        // mutex and in-process acquiringPaths cannot serialize these separate API writers.
        for (const owner of owners) {
          const contender = contenders.find(({ child }) => child.pid === owner.pid);
          assert.equal(contender.child.exitCode, null);
          process.kill(owner.pid, 0);
        }
        console.log(
          JSON.stringify({
            evidence: 'independent-api-lock-contention',
            trial,
            results,
            artifacts: dataDir,
          }),
        );
        assert.equal(
          owners.length,
          1,
          'Expected exactly one live owner after stale-guard reclamation.',
        );
        for (const result of results) {
          if (result.status === 'acquired') continue;
          assert.equal(result.status, 'refused');
          assert.match(
            result.error,
            /another GraphGoblin process holds|Store ownership could not be verified/,
          );
        }
        const recorded = JSON.parse(await readFile(join(dataDir, 'graphgoblin.lock'), 'utf8'));
        assert.equal(recorded.pid, owners[0].pid);
      } finally {
        for (const { child } of contenders) child.stdin.end();
        let closedContenders = 0;
        await Promise.all(
          contenders.map(async ({ child, exited }) => {
            const closed = await Promise.race([
              exited.then(() => true),
              sleep(5000).then(() => false),
            ]);
            if (closed) closedContenders++;
            if (!closed) child.kill();
            assert.equal(closed, true, 'Ownership contender did not release on stdin EOF.');
          }),
        ).finally(() =>
          ciEvidence.record('cleanup', {
            action: 'contenders',
            result: closedContenders === contenders.length ? 'closed' : 'killed',
            count: closedContenders,
          }),
        );
      }
    }
  }),
);

/** Complete LF records totalling exactly `bytes`. */
function completeLines(bytes) {
  const buffer = Buffer.alloc(bytes, 0x73);
  for (let index = 99; index < bytes; index += 100) buffer[index] = 0x0a;
  buffer[bytes - 1] = 0x0a;
  return buffer;
}

/** A stopped gateway keeps its log until exit; observe that exact PID disappear. */
async function exited(pid) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      process.kill(Number(pid), 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await sleep(50);
  }
  throw new Error(`Gateway ${pid} did not exit after its drain.`);
}

/** A reservation or sharing conflict identifies no holder; shutdown guidance is conditional. */
const destinationInUse =
  /log folder is in use: another process holds the folder's log reservation or has gateway\.log open, and that process was not identified\. If it is a GraphGoblin gateway, possibly an older version still running, shut it down deliberately; otherwise close the program holding the folder or its log\. Launch again once it is released\./;

/** Stand-in for the predecessor's inherited FILE_APPEND_DATA handle, held by another process. */
function holdLegacyAppend(path) {
  const holder = spawn(
    systemTool('WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$f = New-Object IO.FileStream($env:GG_TEST_HELD, [IO.FileMode]::Append, [Security.AccessControl.FileSystemRights]::AppendData, [IO.FileShare]::ReadWrite, 4096, [IO.FileOptions]::None); [Console]::Out.WriteLine('held'); [void][Console]::In.ReadToEnd(); $f.Dispose()",
    ],
    { env: { ...env, GG_TEST_HELD: path }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const closed = new Promise((resolve) => holder.once('close', resolve));
  const ready = new Promise((resolve, reject) => {
    holder.stdout.on('data', (chunk) => {
      if (String(chunk).includes('held')) resolve();
    });
    holder.once('exit', (code) => reject(new Error(`Legacy append holder exited ${code}`)));
  });
  return {
    ready,
    async release() {
      holder.stdin.end();
      await closed;
    },
  };
}

test(
  'bounded Windows logs: stale entry, closed outcomes, one writer per root, legacy writer and unsafe names',
  { skip: process.platform !== 'win32', timeout: 300_000 },
  ciEvidence.observeTest('bounded-logs', async (t) => {
    await mkdir(join(root, '.tmp'), { recursive: true });
    const base = await mkdtemp(join(root, '.tmp', 'windows-launcher-logs-'));
    ciEvidence.fixture('logs', base);
    const install = await privateDirectory(join(base, 'install α'));
    const canonicalInstall = await realpath(install);
    // Gateway and launcher inherit an isolated TEMP: a no-write witness for managed log names.
    const isolatedTemp = join(base, 'isolated temp');
    await mkdir(isolatedTemp);
    const environment = { ...env, TEMP: isolatedTemp, TMP: isolatedTemp };
    const exe = join(install, 'GraphGoblin.exe');
    const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    await compileLauncher(compiler, exe);
    const launch = (path) =>
      launchNative(exe, path, environment).then(
        (result) => ({ code: 0, ...result }),
        (error) => error,
      );
    // The file shares a 20-port pool. Configurations that are refused before any gateway binds
    // share one port, and each case asserts that nothing ever listens on it.
    const refusalPort = await freePort();
    async function configuration(directory, name, overrides = {}) {
      const config = {
        Repo: root,
        Node: process.execPath,
        DataDir: join(base, `${name}-store`),
        Port: overrides.Port ?? refusalPort,
        Environment: { GG_LOG_LEVEL: 'info', GG_OLLAMA_ENABLED: 'false' },
        StartupTimeoutSeconds: 15,
        WindowTimeoutSeconds: 2,
        ...overrides,
      };
      const path = join(directory, `${name}.json`);
      await writeFile(path, JSON.stringify(config));
      return { config, path };
    }
    const gatewayLog = join(install, 'gateway.log');
    const launcherRecords = async () =>
      logRecords(await readFile(join(install, 'launcher.log'), 'utf8'));
    const live = [];

    await t.test('native closed outcomes, launcher pair bounds and NUL stdio checks', async () => {
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
      const work = join(base, 'native checks');
      await mkdir(work);
      const result = await execute(checks, ['--bounded-log-checks', work, process.execPath], {
        env: environment,
        windowsHide: true,
        timeout: 60_000,
      });
      assert.match(result.stdout, /bounded log, closed outcome and NUL stdio checks passed/);
    });

    await t.test(
      'a stale built entry beside the current guard module refuses before spawn',
      async () => {
        const stale = join(base, 'stale checkout');
        for (const [file, contents] of [
          ['apps/api/dist/main.js', 'export const legacyEntry = true;\n'],
          ['apps/api/dist/instance-identity.js', '// stale helper\n'],
          ['apps/web/dist/index.html', '<html></html>'],
        ]) {
          await mkdir(dirname(join(stale, file)), { recursive: true });
          await writeFile(join(stale, file), contents);
        }
        const guard = join(stale, 'apps/api/dist/windows-log/guard.js');
        await mkdir(dirname(guard), { recursive: true });
        await copyFile(join(root, 'apps/api/dist/windows-log/guard.js'), guard);
        const staleConfig = await configuration(install, 'stale', { Repo: stale });
        const refused = await launch(staleConfig.path);
        assert.equal(refused.code, 1);
        assert.equal(refused.stdout, '');
        assert.match(refused.stderr, /built gateway does not match this launcher/);
        await unlink(guard);
        const missing = await launch(staleConfig.path);
        assert.equal(missing.code, 1);
        assert.match(missing.stderr, /not built: apps\/api\/dist\/windows-log\/guard\.js/);
        assert.equal(await listening(staleConfig.config.Port), false);
        await assert.rejects(lstat(gatewayLog), { code: 'ENOENT' });
        await assert.rejects(lstat(staleConfig.config.DataDir), { code: 'ENOENT' });
        const records = await launcherRecords();
        assert.deepEqual(
          records.map((record) => [record.stage, record.code]),
          [
            ['configuration', 'configuration-refused'],
            ['configuration', 'configuration-refused'],
          ],
        );
      },
    );

    await t.test(
      'an application startup failure reports its written closed diagnostic (74)',
      async () => {
        const corrupt = join(base, 'corrupt.db');
        await writeFile(corrupt, 'GG_PRIVATE_DB_CANARY deliberately not SQLite');
        const failing = await configuration(install, 'startup-failure', {
          Environment: {
            GG_LOG_LEVEL: 'info',
            GG_OLLAMA_ENABLED: 'false',
            GG_DB_URL: 'file:' + corrupt.replaceAll('\\', '/'),
          },
          StartupTimeoutSeconds: 60,
        });
        const refused = await launch(failing.path);
        assert.equal(refused.code, 1);
        assert.match(
          refused.stderr,
          /failed during startup\. A startup diagnostic naming the failed stage was written/,
        );
        assert.ok(refused.stderr.includes(`Log folder: ${canonicalInstall}`));
        assert.doesNotMatch(refused.stderr, /CANARY|SQLITE|not a database/i);
        const last = logRecords(await readFile(gatewayLog, 'utf8')).at(-1);
        assert.deepEqual(Object.keys(last).sort(), [
          'cause',
          'detail',
          'guidance',
          'level',
          'msg',
          'pid',
          'stage',
          'time',
        ]);
        assert.deepEqual(
          [last.msg, last.stage, last.cause],
          ['GraphGoblin startup failed', 'store', 'store-unavailable'],
        );
        const recorded = (await launcherRecords()).at(-1);
        assert.deepEqual([recorded.code, recorded.childExit], ['startup-failed-logged', 74]);
        assert.equal(await listening(failing.config.Port), false);
        await assert.rejects(lstat(join(failing.config.DataDir, 'graphgoblin.lock')), {
          code: 'ENOENT',
        });
      },
    );

    const primary = await configuration(install, 'primary', { Port: await freePort() });
    try {
      await t.test(
        'one writer per physical root refuses a junction contender and a disjoint store and port',
        async () => {
          const started = await launch(primary.path);
          assert.deepEqual([started.code, started.stdout, started.stderr], [0, '', '']);
          live.push(primary.config);
          const owner = await health(primary.config);
          const logBefore = await stat(gatewayLog, { bigint: true });
          const alias = join(base, 'log root junction');
          await symlink(install, alias, 'junction');
          const contenderStore = join(base, 'contender-store');
          await mkdir(contenderStore);
          // The contender exits before binding; it shares the never-bound refusal port.
          const contenderPort = refusalPort;
          const contender = await execute(process.execPath, [join(root, 'apps/api/dist/main.js')], {
            cwd: root,
            env: {
              ...environment,
              GG_WINDOWS_LAUNCHER_LOG_DIR: alias,
              GG_DATA_DIR: contenderStore,
              GG_HOST: '127.0.0.1',
              GG_PORT: String(contenderPort),
              GG_WEB_DIST: join(root, 'apps/web/dist'),
              GG_OLLAMA_ENABLED: 'false',
            },
            windowsHide: true,
            timeout: 30_000,
          }).then(
            (result) => ({ code: 0, ...result }),
            (error) => error,
          );
          assert.deepEqual([contender.code, contender.stdout, contender.stderr], [70, '', '']);
          assert.deepEqual(await readdir(contenderStore), []);
          assert.equal(await listening(contenderPort), false);
          assert.deepEqual(await health(primary.config), owner);
          assert.equal((await stat(gatewayLog, { bigint: true })).ino, logBefore.ino);

          const disjoint = await configuration(install, 'disjoint', { StartupTimeoutSeconds: 1 });
          const refused = await launch(disjoint.path);
          assert.equal(refused.code, 1);
          // A live gateway holds the log here, yet the sharing violation alone does not show it.
          assert.match(refused.stderr, destinationInUse);
          assert.doesNotMatch(refused.stderr, /by another GraphGoblin gateway/);
          assert.equal(await listening(disjoint.config.Port), false);
          await assert.rejects(lstat(disjoint.config.DataDir), { code: 'ENOENT' });
          assert.deepEqual(await health(primary.config), owner);
          assert.equal((await stat(gatewayLog, { bigint: true })).ino, logBefore.ino);
          const refusal = (await launcherRecords()).at(-1);
          assert.deepEqual([refusal.code, refusal.childExit], ['destination-in-use', undefined]);

          const otherDirectory = await privateDirectory(join(base, 'other config'));
          const warm = await configuration(otherDirectory, 'warm', { ...primary.config });
          const reused = await launch(warm.path);
          assert.deepEqual([reused.code, reused.stdout, reused.stderr], [0, '', '']);
          assert.deepEqual(await health(primary.config), owner);
          await assert.rejects(lstat(join(otherDirectory, 'gateway.log')), { code: 'ENOENT' });
          await unlink(alias);
        },
      );

      await t.test(
        'deliberate stop, legacy append writer refusal and oversized history replacement',
        async () => {
          const first = await health(primary.config);
          await stop(primary.config);
          // The stopped gateway keeps its log until process exit; an immediate click waits.
          const relaunched = await launch(primary.path);
          assert.deepEqual([relaunched.code, relaunched.stderr], [0, '']);
          const second = await health(primary.config);
          assert.notEqual(second.pid, first.pid);
          await stop(primary.config);
          await exited(second.pid);

          const blocked = await configuration(install, 'legacy-blocked', {
            StartupTimeoutSeconds: 1,
          });
          const holder = holdLegacyAppend(gatewayLog);
          try {
            await holder.ready;
            const before = await readFile(gatewayLog);
            const refused = await launch(blocked.path);
            assert.equal(refused.code, 1);
            // The holder here is not a gateway; the same neutral guidance applies.
            assert.match(refused.stderr, destinationInUse);
            assert.doesNotMatch(refused.stderr, /by another GraphGoblin gateway/);
            assert.equal(await listening(blocked.config.Port), false);
            await assert.rejects(lstat(blocked.config.DataDir), { code: 'ENOENT' });
            assert.deepEqual(await readFile(gatewayLog), before);
          } finally {
            await holder.release();
          }

          await writeFile(gatewayLog, completeLines(4 * 1024 * 1024 + 100));
          const replaced = await launch(primary.path);
          assert.deepEqual([replaced.code, replaced.stderr], [0, '']);
          const third = await health(primary.config);
          const bytes = await readFile(gatewayLog);
          assert.ok(bytes.length < 64 * 1024, 'Oversized stopped-writer history must be replaced.');
          const records = logRecords(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          assert.ok(records.some((record) => String(record.pid) === third.pid));
          await stop(primary.config);
          await exited(third.pid);
        },
      );
    } finally {
      for (const config of live) await stop(config);
    }

    await t.test('unsafe managed names are refused and their targets preserved', async () => {
      const target = join(base, 'protected target.log');
      await writeFile(target, 'protected bytes');
      const previous = join(install, 'gateway.log.1');
      await unlink(previous).catch(() => undefined);
      await link(target, previous);
      const unsafe = await configuration(install, 'unsafe', { StartupTimeoutSeconds: 1 });
      const before = await readFile(gatewayLog);
      const refused = await launch(unsafe.path);
      assert.equal(refused.code, 1);
      assert.match(refused.stderr, /log folder is unsafe or unavailable/);
      assert.equal(await readFile(target, 'utf8'), 'protected bytes');
      assert.equal((await stat(target)).nlink, 2);
      assert.deepEqual(await readFile(gatewayLog), before);
      assert.equal(await listening(unsafe.config.Port), false);
      await unlink(previous);
    });

    // Fixed inventory and bounds; no managed TEMP, staging or spill names anywhere.
    assert.deepEqual(
      (await readdir(isolatedTemp)).filter((name) => /(gateway|launcher)\.log/i.test(name)),
      [],
    );
    const managed = (await readdir(install)).filter((name) => /\.log/i.test(name));
    for (const name of managed)
      assert.ok(
        ['gateway.log', 'gateway.log.1', 'launcher.log', 'launcher.log.1'].includes(name),
        `Unexpected managed log name ${name}`,
      );
    assert.ok((await stat(gatewayLog)).size <= 4 * 1024 * 1024);
    assert.ok((await stat(join(install, 'launcher.log'))).size <= 256 * 1024);
    console.log(JSON.stringify({ evidence: 'windows-launcher-bounded-logs', artifacts: base }));
  }),
);
