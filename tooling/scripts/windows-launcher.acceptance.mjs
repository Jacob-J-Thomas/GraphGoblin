// Native Windows executable + built API, disposable stores, no provider turns or owner ports.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import {
  access,
  chmod,
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
  isExpectedOwnershipRefusal,
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
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const facts = error => {
      const failures = [];
      const pending = [error];
      for (let inspected = 0; pending.length && inspected < 8; inspected++) {
        const current = pending.shift();
        if (current.operation) failures.push({ code: current.code ?? null, operation: current.operation, markerToken: current.markerToken ?? null });
        if (current.errors) pending.push(...current.errors);
        if (current.cause) pending.push(current.cause);
      }
      return { code: error.code ?? null, operation: error.operation ?? null, markerToken: error.markerToken ?? null, failures };
    };
    process.stdin.resume();
    const released = new Promise(resolve => process.stdin.once('end', resolve));
    let lock;
    try {
      lock = await acquireDataDirLock(process.argv[2]);
      const { token } = JSON.parse(await readFile(join(process.argv[2], 'graphgoblin.lock'), 'utf8'));
      process.stdout.write(JSON.stringify({ status: 'acquired', pid: process.pid, token }) + '\\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({ status: 'refused', pid: process.pid, error: error.message, ...facts(error) }) + '\\n');
    }
    if (lock) {
      await released;
      try {
        await lock.release();
        process.stdout.write(JSON.stringify({ status: 'released', pid: process.pid }) + '\\n');
      } catch (error) {
        process.stdout.write(JSON.stringify({ status: 'release-failed', pid: process.pid, ...facts(error) }) + '\\n');
        process.exitCode = 1;
      }
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, module, dataDir], {
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
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
  return {
    child,
    result,
    exited,
    messages: () =>
      stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
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
  ciEvidence.observeTest('installer', async (t) => {
    await mkdir(join(root, '.tmp'), { recursive: true });
    const base = await mkdtemp(join(root, '.tmp', 'windows-launcher-installer-'));
    ciEvidence.fixture('installer', base);
    const install = join(base, 'installed space α');
    await privateDirectory(install);
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
    function runPowerShell(script, request, inherited = {}) {
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
          env: { ...env, ...inherited, GG_INSTALLER_FIXTURE: JSON.stringify(request) },
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

    const invoke = (overrides = {}, inherited = {}) =>
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
        inherited,
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
    async function observeStages(action) {
      const stages = [];
      let watchFailure;
      const observer = watch(base, { recursive: true }, (_event, name) => {
        if (name?.includes('gg-launcher-stage-')) stages.push(name);
      });
      observer.on('error', (error) => (watchFailure = error));
      try {
        await action();
        await sleep(50);
        if (watchFailure) throw watchFailure;
        return stages;
      } finally {
        observer.close();
      }
    }
    const sourceBefore = await readFile(source);
    const safeOverrides = {
      GG_LOG_LEVEL: 'silent',
      GG_REQUIRE_API_KEY: 'false',
      GG_OLLAMA_ENABLED: 'false',
    };
    const secretCanary = 'GG_LAUNCHER_SECRET_CANARY synthetic only';
    const ordinaryStages = await observeStages(() =>
      invoke(
        { Environment: safeOverrides },
        {
          GG_MASTER_KEY: secretCanary,
          GG_JEV_API_KEY: secretCanary,
          GG_LOG_LEVEL: 'invalid-inherited-value',
          GG_MAX_CONCURRENT_RUNS: 'invalid-inherited-value',
        },
      ),
    );
    assert.ok(
      ordinaryStages.length > 0,
      'A normal hashtable install must exercise the stage observer.',
    );
    assert.deepEqual(await readFile(source), sourceBefore);
    const config = JSON.parse(await readFile(exe + '.json', 'utf8'));
    assert.deepEqual(config.Environment, safeOverrides);
    assert.ok(!(await readFile(exe + '.json', 'utf8')).includes(secretCanary));
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
        assert.ok(!(error.stdout + error.stderr).includes(secretCanary));
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
    const secretRefusal =
      'Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY (case-insensitive). Keep credentials in GraphGoblin secret stores; use the data directory master.key for encryption.';
    const secretKeys = [
      'GG_MASTER_KEY',
      'GG_JEV_API_KEY',
      'GG_Master_Key',
      'GG_Jev_Api_Key',
      'gg_master_key',
      'gg_jev_api_key',
    ];
    const manualDirectory = join(base, 'manual credentials');
    await privateDirectory(manualDirectory);
    const baseEntries = await readdir(base);
    for (const key of secretKeys) {
      for (const NoShortcuts of [false, true]) {
        await refuses(
          { NoShortcuts, Environment: { ...safeOverrides, [key]: secretCanary } },
          /Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY/,
        );
        assert.deepEqual(await readdir(base), baseEntries, 'Refusal must create no stage.');
      }
      const manual = join(manualDirectory, 'manual-credential-config.json');
      await writeFile(
        manual,
        JSON.stringify({ ...config, Environment: { ...safeOverrides, [key]: secretCanary } }),
      );
      const manualBefore = await readFile(manual);
      await refusesPrivate(['--validate-install', '--config', manual], secretRefusal);
      const stagedShortcut = join(base, 'refused-credential-shortcut.lnk');
      await refusesPrivate(
        ['--stage-shortcut', stagedShortcut, manual, exe],
        secretRefusal,
        stagedShortcut,
      );
      await assert.rejects(
        execute(exe, ['--ensure-gateway', '--config', manual], { env, windowsHide: true }),
        (error) => {
          assert.equal(error.code, 1);
          assert.equal(error.stdout, '');
          assert.ok(error.stderr.startsWith(secretRefusal));
          assert.ok(!error.stderr.includes(secretCanary));
          return true;
        },
      );
      assert.deepEqual(await readFile(manual), manualBefore);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await readdir(store), []);
      assert.equal(await listening(port), false, 'Refused config must not start a gateway.');
      const launcherLog = await readFile(join(manualDirectory, 'launcher.log'), 'utf8');
      assert.ok(!launcherLog.includes(secretCanary));
      await unlink(manual);
    }
    const protectedOutputs = [exe, configPath, desktop, programs];
    const originalModes = await Promise.all(
      protectedOutputs.map(async (file) => (await stat(file)).mode),
    );
    try {
      for (const file of protectedOutputs) await chmod(file, 0o444);
      for (const key of secretKeys) {
        const stages = await observeStages(() =>
          refuses(
            {
              Environment: {
                ...safeOverrides,
                Keys: 'ordinary companion',
                [key]: secretCanary,
              },
            },
            /Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY/,
          ),
        );
        assert.deepEqual(stages, [], 'Credential refusal must precede any temporary stage.');
      }
      await refuses(
        {
          RepoPath: join(base, 'must-not-be-opened'),
          NodePath: join(base, 'must-not-be-run.exe'),
          Environment: { Keys: 'ordinary companion', GG_MASTER_KEY: secretCanary },
        },
        /Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY/,
      );
    } finally {
      for (let index = 0; index < protectedOutputs.length; index++)
        await chmod(protectedOutputs[index], originalModes[index]);
    }
    for (const key of ['GG_MASTER_KEY', 'GG_JEV_API_KEY']) {
      await refuses(
        { Environment: { [key]: '' } },
        /Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY/,
      );
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

    // Public reinstall, publication rollback, compiler staging and default discovery (#498, #532,
    // #520). Every control runs before this case's only gateway start, so the owned store stays
    // empty, and none of them starts a gateway or browser or touches an owner folder or pin.
    const outputState = (paths) =>
      Promise.all(
        paths.map(async (path) => {
          const { dev, ino } = await stat(path, { bigint: true });
          return { path, dev, ino, bytes: await readFile(path) };
        }),
      );
    const sourceState = () => outputState([source, alias]);
    const sourceStateBefore = await sourceState();
    assert.equal(sourceStateBefore[1].ino, sourceStateBefore[0].ino, 'The alias is a hard link.');
    const refused = (attempt, message) =>
      attempt.then(
        () => assert.fail(message),
        (error) => error,
      );
    // An -EncodedCommand child serializes its error stream as CLIXML (progress records included),
    // and the error view may wrap long lines: decode its error lines, then compare refusals
    // without whitespace.
    const xmlEntities = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
    function errorText(stderr) {
      if (!stderr.startsWith('#< CLIXML')) return stderr;
      return [...stderr.matchAll(/<S S="Error">([^<]*)<\/S>/g)]
        .map(([, line]) =>
          line
            .replace(/&(lt|gt|quot|apos|amp);/g, (_, name) => xmlEntities[name])
            .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) =>
              String.fromCharCode(Number.parseInt(hex, 16)),
            ),
        )
        .join('');
    }
    const compact = (text) => text.replace(/\s+/g, '');
    function assertRefusal(error, ...messages) {
      assert.equal(error.code, 1);
      const text = compact(errorText(error.stderr));
      assert.ok(
        messages.some((message) => text.includes(compact(message))),
        `Unexpected installer refusal: ${error.stderr}`,
      );
    }
    async function assertNoStages(directories) {
      for (const directory of directories) {
        const names = await readdir(directory);
        assert.deepEqual(
          names.filter((name) => name.startsWith('gg-launcher-stage-')),
          [],
          'No installer-owned stage may remain beside an output.',
        );
      }
    }
    async function assertLauncherLinks(links, launcher, installed) {
      const canonical = await realpath(launcher);
      for (const link of links) {
        const shortcut = JSON.parse(
          (await execute(fixture, ['--inspect-shortcut', link], { windowsHide: true })).stdout,
        );
        assert.equal(await realpath(shortcut.TargetPath), canonical);
        assert.equal(shortcut.Arguments, `--config "${canonical}.json"`);
        assert.equal(shortcut.IconLocation, installed.IconLocation);
        const id = await execute(fixture, ['--read-shortcut-id', link], { windowsHide: true });
        assert.equal(id.stdout.trim(), installed.LauncherAppUserModelId);
      }
    }
    /** A separate process holds `path` with read access and FILE_SHARE_READ only. */
    function holdWithReadSharing(path) {
      const holding = execute(
        powerShell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$held = [IO.File]::Open($env:GG_TEST_HELD, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read); try { [Console]::Out.WriteLine('held'); [Console]::Out.Flush(); [void][Console]::In.ReadToEnd() } finally { $held.Dispose() }",
        ],
        { env: { ...env, GG_TEST_HELD: path }, cwd: base, windowsHide: true, timeout: 60_000 },
      );
      // The outcome is the observed child record; a closed pipe must not escape as an event.
      holding.child.stdin.on('error', () => {});
      const settled = holding.then(
        (result) => ({ result }),
        (error) => ({ error }),
      );
      const ready = new Promise((resolve, reject) => {
        holding.child.stdout.on('data', (chunk) => {
          if (String(chunk).includes('held')) resolve();
        });
        settled.then(() => reject(new Error('The read-sharing holder exited before holding.')));
      });
      return {
        ready,
        release() {
          holding.child.stdin.end();
          return settled;
        },
      };
    }

    // Disposable Shell Links: a previous direct Chrome pin, and a PWA source for the default port
    // 4747, whose app ID is derived without connecting to or starting anything on that port.
    const seeds = join(base, 'seeds');
    await mkdir(seeds);
    const pinnedSeed = join(seeds, 'previous direct pin.lnk');
    const defaultSource = join(seeds, 'default port source.lnk');
    const defaultChromeId = (
      await execute(fixture, ['--expected-app-id', '4747'], { windowsHide: true })
    ).stdout.trim();
    await runPowerShell(
      `$ErrorActionPreference = 'Stop'
      $request = $env:GG_INSTALLER_FIXTURE | ConvertFrom-Json
      $shell = New-Object -ComObject WScript.Shell
      foreach ($link in $request.links) {
        $shortcut = $shell.CreateShortcut($link.path)
        $shortcut.TargetPath = $request.proxy
        $shortcut.Arguments = $link.arguments
        $shortcut.Description = $link.description
        $shortcut.Save()
      }`,
      {
        proxy,
        links: [
          {
            path: pinnedSeed,
            arguments: `--profile-directory="Default" --app-id=${chromeId}`,
            description: 'Previous direct Chrome pin fixture',
          },
          {
            path: defaultSource,
            arguments: `--profile-directory="Default" --app-id=${defaultChromeId}`,
            description: 'Default port Chrome PWA fixture',
          },
        ],
      },
    );
    await execute(
      fixture,
      ['--ensure-gateway', '--config', fixtureConfig, '--stamp-shortcut', defaultSource],
      { windowsHide: true },
    );

    const reinstallRoot = join(base, 'reinstall');
    const reinstallDir = join(reinstallRoot, 'installed launcher');
    const reinstallExe = join(reinstallDir, 'GraphGoblin.exe');
    const reinstallLinks = ['Desktop', 'Programs', 'Pinned'].map((folder) =>
      join(reinstallRoot, folder, 'GraphGoblin.lnk'),
    );
    const [reinstallDesktop, reinstallPrograms, reinstallPinned] = reinstallLinks;
    for (const link of reinstallLinks) await mkdir(dirname(link), { recursive: true });
    await copyFile(pinnedSeed, reinstallPinned);
    const reinstallOutputs = [reinstallExe, reinstallExe + '.json', ...reinstallLinks];
    const reinstallFolders = [reinstallRoot, ...reinstallLinks.map((link) => dirname(link))];
    const reinstallOptions = (level) => ({
      InstallDir: reinstallDir,
      DesktopShortcut: reinstallDesktop,
      StartMenuShortcut: reinstallPrograms,
      PinnedShortcut: reinstallPinned,
      Environment: { ...safeOverrides, GG_LOG_LEVEL: level },
    });

    // Also the short fresh and same-path reinstall success controls for #532. Rewriting a disposable
    // pinned file is not evidence of Explorer's taskbar behaviour.
    await t.test(
      'public first install and same-path reinstall persist changed settings and every shortcut',
      async () => {
        const seededPin = await readFile(reinstallPinned);
        const installed = [];
        for (const level of ['warn', 'debug']) {
          const result = await invoke(reinstallOptions(level));
          assert.equal(errorText(result.stderr), '');
          assert.match(result.stdout, /Launcher configured\./);
          const persisted = JSON.parse(await readFile(reinstallExe + '.json', 'utf8'));
          assert.deepEqual(persisted.Environment, { ...safeOverrides, GG_LOG_LEVEL: level });
          assert.equal(persisted.Port, port);
          assert.equal(persisted.DataDir, store);
          assert.match(persisted.LauncherAppUserModelId, /^GraphGoblin\.[a-f0-9]{24}$/);
          await assertLauncherLinks(reinstallLinks, reinstallExe, persisted);
          installed.push(persisted);
          assert.deepEqual(await sourceState(), sourceStateBefore);
          assert.deepEqual(await readdir(store), []);
          await assertNoStages([...reinstallFolders, reinstallDir]);
        }
        // Only the explicitly changed setting differs; the launcher identity is stable.
        assert.equal(installed[1].LauncherAppUserModelId, installed[0].LauncherAppUserModelId);
        assert.deepEqual(
          { ...installed[1], Environment: null },
          { ...installed[0], Environment: null },
        );
        assert.notDeepEqual(await readFile(reinstallPinned), seededPin);
      },
    );

    await t.test(
      'a later output held with read-only sharing restores every previous file',
      async () => {
        const outputsBefore = await outputState(reinstallOutputs);
        // Identity and hash reads still succeed; replacing or deleting the Programs link does not.
        const holder = holdWithReadSharing(reinstallPrograms);
        let refusal;
        let released;
        let stages;
        try {
          await holder.ready;
          stages = await observeStages(async () => {
            refusal = await refused(
              invoke(reinstallOptions('info')),
              'A denied replacement must refuse the installation.',
            );
          });
        } finally {
          released = await holder.release();
        }
        assert.ok(released.result, 'The read-sharing holder must exit normally after release.');
        assert.equal(released.result.stdout.trim(), 'held');
        assertRefusal(refusal, 'Launcher publication failed. The previous files were restored.');
        assert.ok(stages.length > 0, 'The restored installation must exercise its stages.');
        assert.deepEqual(await outputState(reinstallOutputs), outputsBefore);
        assert.deepEqual(await sourceState(), sourceStateBefore);
        assert.deepEqual(await readdir(store), []);
        await assertNoStages([...reinstallFolders, reinstallDir]);
      },
    );

    const resourceRefusals = ['CS1567', 'CS1619'].map(
      (code) =>
        `Launcher compilation failed while the .NET Framework C# compiler prepared the launcher's Win32 resources (compiler error ${code}). The installer compiles in a temporary gg-launcher-stage folder inside the install folder, or its nearest existing parent, and that staging path may be too long for this compiler. Choose a shorter writable local folder with -InstallDir, then run the installer again.`,
    );
    await t.test(
      'long staging paths refuse compilation with InstallDir guidance and keep installed files',
      async () => {
        // Fixture geometry, not a product rule: an existing 174-character InstallDir gives a
        // 241-character staged executable, which the .NET Framework compiler was observed to
        // refuse during resource preparation. The installer itself has no path-length limit.
        const geometry = 174;
        const canonicalBase = await realpath(base);
        const longName = (parent) => {
          const length = geometry - join(canonicalBase, parent).length - 1;
          assert.ok(length >= 16 && length <= 200, 'The checkout leaves no room for the fixture.');
          return `long install ${'x'.repeat(length)}`.slice(0, length);
        };
        // Watcher names are relative to the fixture root: the folder that received each stage.
        const stagedIn = (stages) =>
          new Set(
            stages
              .map((name) => dirname(name))
              .filter((folder) => !folder.includes('gg-launcher-stage-')),
          );

        // A fresh install into the existing long folder stages there and is refused.
        const freshName = longName('long fresh');
        const longFresh = join(canonicalBase, 'long fresh', freshName);
        await mkdir(longFresh, { recursive: true });
        assert.equal((await realpath(longFresh)).length, geometry);
        const freshFolders = ['Desktop', 'Programs'].map((folder) =>
          join(base, 'long fresh links', folder),
        );
        for (const folder of freshFolders) await mkdir(folder, { recursive: true });
        let freshRefusal;
        const freshStages = await observeStages(async () => {
          freshRefusal = await refused(
            invoke({
              InstallDir: longFresh,
              DesktopShortcut: join(freshFolders[0], 'GraphGoblin.lnk'),
              StartMenuShortcut: join(freshFolders[1], 'GraphGoblin.lnk'),
              Environment: safeOverrides,
            }),
            'A long fresh staging path must be refused.',
          );
        });
        assertRefusal(freshRefusal, ...resourceRefusals);
        assert.deepEqual([...stagedIn(freshStages)], [join('long fresh', freshName)]);
        for (const folder of [longFresh, ...freshFolders])
          assert.deepEqual(await readdir(folder), []);

        // While the same long folder is absent, staging uses its shorter existing parent.
        const lowerAnchor = join(canonicalBase, 'long reinstall');
        await mkdir(lowerAnchor);
        const installName = longName('long reinstall');
        const longInstall = join(lowerAnchor, installName);
        const longExe = join(longInstall, 'GraphGoblin.exe');
        const longLinks = ['Desktop', 'Programs', 'Pinned'].map((folder) =>
          join(base, 'long reinstall links', folder, 'GraphGoblin.lnk'),
        );
        for (const link of longLinks) await mkdir(dirname(link), { recursive: true });
        await copyFile(pinnedSeed, longLinks[2]);
        const longOptions = (level) => ({
          InstallDir: longInstall,
          DesktopShortcut: longLinks[0],
          StartMenuShortcut: longLinks[1],
          PinnedShortcut: longLinks[2],
          Environment: { ...safeOverrides, GG_LOG_LEVEL: level },
        });
        let first;
        const firstStages = stagedIn(
          await observeStages(async () => {
            first = await invoke(longOptions('warn'));
          }),
        );
        assert.equal(errorText(first.stderr), '');
        assert.ok(firstStages.has('long reinstall'), 'The first install stages in the parent.');
        assert.ok(!firstStages.has(join('long reinstall', installName)));
        assert.equal((await realpath(longInstall)).length, geometry);
        const longOutputs = [longExe, longExe + '.json', ...longLinks];
        const installed = await outputState(longOutputs);
        assert.equal(JSON.parse(installed[1].bytes).Environment.GG_LOG_LEVEL, 'warn');

        // Once it exists, the same-path reinstall stages inside it and is refused safely.
        let reinstallRefusal;
        const reinstallStages = await observeStages(async () => {
          reinstallRefusal = await refused(
            invoke(longOptions('debug')),
            'A long same-path reinstall must be refused.',
          );
        });
        assertRefusal(reinstallRefusal, ...resourceRefusals);
        assert.deepEqual([...stagedIn(reinstallStages)], [join('long reinstall', installName)]);
        assert.deepEqual(await outputState(longOutputs), installed);
        assert.deepEqual((await readdir(longInstall)).sort(), [
          'GraphGoblin.exe',
          'GraphGoblin.exe.json',
        ]);
        await assertNoStages([lowerAnchor, ...longLinks.map((link) => dirname(link))]);
        assert.deepEqual(await sourceState(), sourceStateBefore);
        assert.deepEqual(await readdir(store), []);
      },
    );

    await t.test('a non-resource compiler failure keeps the generic redacted refusal', async () => {
      // Every compiler line names this path, which carries the private canary and partial codes
      // that are not diagnostics. The first source's diagnostic quotes the decoy type name
      // 'CS1619'. The second fails with an actual CS1029 whose #error message contains a later
      // 'error CS1619:', which is not the line's diagnostic field.
      const compileRepo = join(base, 'GG_INSTALLER_PRIVATE_PATH_CANARY CS15670 CS1619 repo');
      for (const file of [
        'apps/api/dist/main.js',
        'apps/api/dist/instance-identity.js',
        'apps/api/dist/windows-log/guard.js',
        'apps/web/dist/index.html',
      ]) {
        await mkdir(dirname(join(compileRepo, file)), { recursive: true });
        await writeFile(join(compileRepo, file), '// compiler failure control only\n');
      }
      await mkdir(join(compileRepo, 'apps/windows-launcher'));
      for (const program of [
        'class CompilerControl { CS1619 field; }\n',
        '#error error CS1619: unrelated compiler failure\n',
      ]) {
        await writeFile(join(compileRepo, 'apps/windows-launcher/Launcher.cs'), program);
        const refusal = await refused(
          invoke({ RepoPath: compileRepo }),
          'A compiler failure must refuse the installation.',
        );
        assert.equal(refusal.code, 1);
        const text = errorText(refusal.stderr);
        assert.match(text, /^Launcher compilation failed\.\r?$/m);
        assert.doesNotMatch(text, /Win32 resources|-InstallDir|CS1567|CS1619/);
        for (const output of [refusal.stdout, refusal.stderr, text]) {
          assert.doesNotMatch(output, /GG_INSTALLER_PRIVATE_PATH_CANARY/);
          assert.ok(!output.includes(secretCanary));
        }
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await readdir(store), []);
        await assertNoStages([install, dirname(desktop), dirname(programs)]);
      }
    });

    // #520: the shipped script binds its own zero-argument defaults in a hidden, no-profile child.
    // Checkout, project Node PATH, APPDATA/LOCALAPPDATA, GG_DATA_DIR and TEMP/TMP are fixture
    // values, and a test-only, process-local TypeAccelerators entry answers the script's two
    // [Environment]::GetFolderPath lookups with fixture Desktop and Programs folders. This proves
    // default binding and source selection with an isolated resolver, not how Windows resolves
    // any account's redirected folders. The fixture refuses before the installer on any doubt.
    const confinedDefaults = `$ErrorActionPreference = 'Stop'
      Set-StrictMode -Version Latest
      class GraphGoblinFixtureFolders {
        static [string] $Desktop
        static [string] $Programs
        static [string] GetFolderPath([string] $Folder) {
          if ($Folder -ceq 'Desktop') { return [GraphGoblinFixtureFolders]::Desktop }
          if ($Folder -ceq 'Programs') { return [GraphGoblinFixtureFolders]::Programs }
          throw [NotSupportedException]::new('The fixture folder resolver supports only Desktop and Programs.')
        }
      }
      function Stop-Fixture([string] $Reason) { throw "Fixture refused before the installer ran: $Reason." }
      # Registered before anything parses the installer: parsing resolves its type names, and the
      # process then keeps a resolved [Environment] for every later script block.
      $accelerators = [psobject].Assembly.GetType('System.Management.Automation.TypeAccelerators', $true)
      if ($accelerators::Get.ContainsKey('Environment')) { Stop-Fixture 'an Environment accelerator already exists' }
      $accelerators::Add('Environment', [GraphGoblinFixtureFolders])
      $request = $env:GG_INSTALLER_FIXTURE | ConvertFrom-Json
      [GraphGoblinFixtureFolders]::Desktop = $request.Desktop
      [GraphGoblinFixtureFolders]::Programs = $request.Programs
      $env:PATH = $request.path
      $env:APPDATA = $request.appData
      $env:LOCALAPPDATA = $request.localAppData
      $env:GG_DATA_DIR = $request.dataDir
      $env:TEMP = $request.temp
      $env:TMP = $request.temp
      $text = [IO.File]::ReadAllText($request.installer)
      if ([regex]::Matches($text, 'GetFolderPath|SpecialFolder|System\\.Environment|TypeAccelerators', 'IgnoreCase').Count -ne 2) {
        Stop-Fixture 'the installer folder lookups changed'
      }
      $tokens = $null
      $parseErrors = $null
      $ast = [Management.Automation.Language.Parser]::ParseFile($request.installer, [ref] $tokens, [ref] $parseErrors)
      if ($parseErrors.Count -ne 0) { Stop-Fixture 'the installer did not parse' }
      $typed = @($ast.FindAll({
        param($node)
        ($node -is [Management.Automation.Language.TypeExpressionAst] -or
          $node -is [Management.Automation.Language.TypeConstraintAst] -or
          $node -is [Management.Automation.Language.AttributeAst]) -and
        $node.TypeName.FullName -match '(?:^|\\W)Environment(?:$|\\W)'
      }, $true))
      $lookups = @(foreach ($node in $typed) {
        $call = $node.Parent
        if ($node -isnot [Management.Automation.Language.TypeExpressionAst] -or
          $node.TypeName.FullName -cne 'Environment' -or
          $call -isnot [Management.Automation.Language.InvokeMemberExpressionAst] -or
          !$call.Static -or ![object]::ReferenceEquals($call.Expression, $node) -or
          $call.Member -isnot [Management.Automation.Language.StringConstantExpressionAst] -or
          $call.Member.Value -cne 'GetFolderPath' -or $null -eq $call.Arguments -or
          $call.Arguments.Count -ne 1 -or
          $call.Arguments[0] -isnot [Management.Automation.Language.StringConstantExpressionAst]) {
          Stop-Fixture 'the installer has an unsupported Environment use'
        }
        $call.Arguments[0].Value
      })
      if (($lookups -join ',') -cne 'Desktop,Programs') { Stop-Fixture 'the installer folder lookups changed' }
      if ((& ([scriptblock]::Create('[Environment]'))) -ne [GraphGoblinFixtureFolders]) {
        Stop-Fixture 'Environment does not resolve to the fixture folder resolver'
      }
      foreach ($folder in 'Desktop', 'Programs') {
        if ((& ([scriptblock]::Create("[Environment]::GetFolderPath('$folder')"))) -cne $request.$folder) {
          Stop-Fixture "the $folder lookup does not resolve to its fixture folder"
        }
      }
      $unsupported = $false
      try {
        [void](& ([scriptblock]::Create("[Environment]::GetFolderPath('ApplicationData')")))
        $unsupported = $true
      } catch { }
      if ($unsupported) { Stop-Fixture 'the resolver answered an unsupported folder' }
      & $request.installer`;
    async function defaultsFixture(name) {
      const folder = join(base, name);
      const appData = join(folder, 'AppData', 'Roaming');
      const folders = {
        Desktop: join(folder, 'Desktop'),
        Programs: join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
        appData,
        localAppData: join(folder, 'AppData', 'Local'),
        dataDir: join(folder, 'store'),
        temp: join(folder, 'Temp'),
      };
      for (const path of Object.values(folders)) await mkdir(path, { recursive: true });
      return folders;
    }
    const invokeDefaults = (folders) =>
      runPowerShell(
        confinedDefaults,
        { installer, path: nodeAvailablePath, ...folders },
        {
          APPDATA: folders.appData,
          LOCALAPPDATA: folders.localAppData,
          GG_DATA_DIR: folders.dataDir,
          TEMP: folders.temp,
          TMP: folders.temp,
        },
      );
    const launcherFolders = (folders) => {
      const installDir = join(folders.localAppData, 'GraphGoblin', 'Launcher');
      return { installDir, launcher: join(installDir, 'GraphGoblin.exe') };
    };

    await t.test(
      'zero-argument defaults select the Chrome Apps source and publish separate Desktop and Programs links',
      async () => {
        const folders = await defaultsFixture('defaults chrome apps');
        const chromeApps = join(folders.Programs, 'Chrome Apps');
        await mkdir(chromeApps);
        const pwa = join(chromeApps, 'GraphGoblin.lnk');
        await copyFile(defaultSource, pwa);
        const pwaBefore = await outputState([pwa]);
        const result = await invokeDefaults(folders);
        assert.equal(errorText(result.stderr), '');
        assert.match(result.stdout, /Launcher configured\./);
        assert.match(result.stdout, /Gateway: http:\/\/127\.0\.0\.1:4747\/app\//);
        const { installDir, launcher } = launcherFolders(folders);
        const persisted = JSON.parse(await readFile(launcher + '.json', 'utf8'));
        assert.equal(persisted.Repo, dirname(dirname(installer)));
        assert.equal(persisted.Node, await realpath(process.execPath));
        assert.equal(persisted.DataDir, folders.dataDir);
        assert.equal(persisted.Port, 4747);
        assert.equal(persisted.ChromeAppId, defaultChromeId);
        assert.equal(persisted.PwaAppUserModelId, 'Chrome.PwaFixture');
        assert.deepEqual(persisted.Environment, {});
        const links = [
          join(folders.Desktop, 'GraphGoblin.lnk'),
          join(folders.Programs, 'GraphGoblin.lnk'),
        ];
        await assertLauncherLinks(links, launcher, persisted);
        const [desktopLink, programsLink] = await outputState(links);
        assert.ok(
          desktopLink.dev !== programsLink.dev || desktopLink.ino !== programsLink.ino,
          'Desktop and Programs links must be separate files.',
        );
        assert.deepEqual(await outputState([pwa]), pwaBefore);
        assert.deepEqual(await readdir(folders.dataDir), []);
        await assertNoStages([
          folders.localAppData,
          dirname(installDir),
          installDir,
          folders.Desktop,
          folders.Programs,
          chromeApps,
        ]);
      },
    );

    await t.test(
      'a Desktop-only default source collides with the Desktop output and keeps sentinels',
      async () => {
        const folders = await defaultsFixture('defaults desktop source');
        const pwa = join(folders.Desktop, 'GraphGoblin.lnk');
        await copyFile(defaultSource, pwa);
        const { installDir, launcher } = launcherFolders(folders);
        await mkdir(installDir, { recursive: true });
        const sentinels = [launcher, launcher + '.json', join(folders.Programs, 'GraphGoblin.lnk')];
        for (const sentinel of sentinels) await writeFile(sentinel, `sentinel ${randomUUID()}\n`);
        const watched = [pwa, ...sentinels];
        const before = await outputState(watched);
        const refusal = await refused(
          invokeDefaults(folders),
          'A Desktop-only source must collide with the Desktop output.',
        );
        assertRefusal(
          refusal,
          'The PWA source and launcher outputs must use distinct files and paths. Choose a separate shortcut destination.',
        );
        assert.deepEqual(await outputState(watched), before);
        assert.deepEqual(await readdir(folders.Desktop), ['GraphGoblin.lnk']);
        assert.deepEqual(await readdir(folders.Programs), ['GraphGoblin.lnk']);
        assert.deepEqual((await readdir(installDir)).sort(), [
          'GraphGoblin.exe',
          'GraphGoblin.exe.json',
        ]);
        assert.deepEqual(await readdir(folders.dataDir), []);
        await assertNoStages([folders.localAppData, dirname(installDir)]);
      },
    );

    await t.test('without a default source no destination or stage is published', async () => {
      const folders = await defaultsFixture('defaults missing source');
      await mkdir(join(folders.Programs, 'Chrome Apps'));
      const refusal = await refused(
        invokeDefaults(folders),
        'A missing default source must be refused.',
      );
      assertRefusal(
        refusal,
        'Install the Chrome PWA, then supply -PwaShortcut with its .lnk path.',
      );
      assert.deepEqual(await readdir(folders.Desktop), []);
      assert.deepEqual(await readdir(folders.Programs), ['Chrome Apps']);
      assert.deepEqual(await readdir(join(folders.Programs, 'Chrome Apps')), []);
      assert.deepEqual(await readdir(folders.localAppData), []);
      assert.deepEqual(await readdir(folders.dataDir), []);
    });

    try {
      const started = await execute(exe, ['--ensure-gateway', '--config', configPath], {
        env: {
          ...env,
          GG_MASTER_KEY: secretCanary,
          GG_JEV_API_KEY: secretCanary,
          GG_LOG_LEVEL: 'invalid-inherited-value',
          GG_MAX_CONCURRENT_RUNS: 'invalid-inherited-value',
        },
        windowsHide: true,
        timeout: 30_000,
      });
      assert.deepEqual([started.stdout, started.stderr], ['', '']);
      await health(config);
      await access(join(store, 'master.key'));
      const response = await fetch(origin(config) + '/secrets');
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { items: [] });
      assert.deepEqual(await readFile(source), sourceBefore);
      assert.deepEqual(await snapshot(), before);
      assert.ok(!(await readFile(join(install, 'gateway.log'), 'utf8')).includes(secretCanary));
    } finally {
      await stop(config);
    }
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
      await writeFile(join(dataDir, 'unrelated.txt'), 'retain unrelated bytes');
      const contenders = Array.from({ length: 5 }, () => ownershipContender(dataDir));
      try {
        const results = await Promise.all(contenders.map((contender) => contender.result));
        const owners = results.filter((result) => result.status === 'acquired');
        const refused = results.filter((result) => result.status === 'refused').length;
        for (const result of results) {
          ciEvidence.record('ownership-result', {
            trial,
            pid: result.pid,
            status: result.status,
            seededToken: previous.token,
            ownerToken: result.token ?? null,
            markerToken: result.markerToken ?? null,
            operation: result.operation ?? null,
            errorCode: result.code ?? null,
            diagnostic:
              result.status === 'acquired'
                ? 'acquired'
                : /another GraphGoblin process holds/.test(result.error)
                  ? 'store-held'
                  : /Store ownership could not be verified/.test(result.error)
                    ? 'store-unverified'
                    : result.code
                      ? 'filesystem'
                      : 'other',
          });
          for (const [index, failure] of (result.failures ?? []).entries())
            ciEvidence.record('ownership-error', { trial, pid: result.pid, index, ...failure });
        }
        ciEvidence.record('contention', {
          trial,
          contenders: contenders.length,
          acquired: owners.length,
          refused,
          other: results.length - owners.length - refused,
        });
        // No successful contender is released before every result is known. The launcher
        // mutex and in-process acquiringPaths cannot serialize these separate API writers.
        let liveOwners = 0;
        for (const owner of owners) {
          const contender = contenders.find(({ child }) => child.pid === owner.pid);
          if (contender.child.exitCode === null) {
            try {
              process.kill(owner.pid, 0);
              liveOwners++;
            } catch {
              /* recorded below */
            }
          }
        }
        // Retain the final record check before any assertion can stop this trial.
        const recorded = await readFile(join(dataDir, 'graphgoblin.lock'), 'utf8').then(
          (contents) => JSON.parse(contents),
          () => null,
        );
        const seededMarker = await lstat(
          join(dataDir, 'graphgoblin.lock.reclaim', `${previous.token}.json`),
        ).then(
          () => 'present',
          (error) => (error.code === 'ENOENT' ? 'absent' : 'unavailable'),
        );
        ciEvidence.record('ownership-check', {
          trial,
          liveOwners,
          recordedPid: recorded?.pid ?? null,
          recordedToken: recorded?.token ?? null,
          recordedOwnerMatched:
            owners.length === 1 &&
            recorded?.pid === owners[0].pid &&
            recorded?.token === owners[0].token,
          seededMarker,
        });
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
        assert.equal(liveOwners, 1, 'Expected the acquired writer to remain live.');
        assert.equal(recorded?.pid, owners[0].pid);
        assert.equal(recorded?.token, owners[0].token);
        assert.equal(seededMarker, 'absent');
        for (const result of results) {
          if (result.status === 'acquired') continue;
          assert.equal(result.status, 'refused');
          assert.ok(
            isExpectedOwnershipRefusal(result),
            'Expected an ownership refusal without filesystem or cleanup failures.',
          );
        }
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
        const presence = (path) =>
          lstat(path).then(
            () => 'present',
            (error) => (error.code === 'ENOENT' ? 'absent' : 'unavailable'),
          );
        const main = await presence(join(dataDir, 'graphgoblin.lock'));
        const guard = await presence(join(dataDir, 'graphgoblin.lock.reclaim'));
        const staging = await readdir(dataDir).then(
          (entries) =>
            entries.filter((name) => name.startsWith('graphgoblin.lock.reclaim.')).length,
          () => null,
        );
        const unrelatedIntact = await readFile(join(dataDir, 'unrelated.txt'), 'utf8').then(
          (contents) => contents === 'retain unrelated bytes',
          () => false,
        );
        const released = contenders
          .flatMap((contender) => contender.messages())
          .filter((message) => message.status === 'released').length;
        ciEvidence.record('ownership-cleanup', {
          trial,
          released,
          main,
          guard,
          staging,
          unrelatedIntact,
        });
        assert.equal(released, 1, 'Expected exactly one successful ownership release.');
        assert.equal(main, 'absent');
        assert.equal(guard, 'absent');
        assert.equal(staging, 0);
        assert.equal(unrelatedIntact, true);
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
      const helpers = await execute(checks, ['--helper-checks', work, process.execPath], {
        env: environment,
        windowsHide: true,
        timeout: 60_000,
      });
      assert.match(helpers.stdout, /Native helper job, pipe and deadline checks passed/);
      const decisions = await execute(checks, ['--cleanup-deadline-checks'], {
        env: environment,
        windowsHide: true,
        timeout: 10_000,
      });
      assert.equal(
        decisions.stdout.trim(),
        'Deterministic cleanup decision checks passed (no kernel fault injected).',
      );
      const workDecisions = await execute(checks, ['--work-deadline-checks'], {
        env: environment,
        windowsHide: true,
        timeout: 10_000,
      });
      assert.equal(
        workDecisions.stdout.trim(),
        'Deterministic caller work deadline checks passed (no scheduling fault injected).',
      );
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

    await t.test('held ownership retains guidance and budgets the last recheck', async () => {
      // A tiny isolated built checkout replaces only the read-only protocol fixture. Its
      // main records a spawn then exits; no real gateway, store or owner PID is involved.
      for (const scenario of ['too-late', 'stalled-recheck', 'released']) {
        const fixture = join(base, scenario);
        const samples = join(fixture, 'samples');
        const spawned = join(fixture, 'spawned');
        const lock = join(fixture, 'graphgoblin.lock');
        const marker = JSON.stringify({ pid: 1, token: randomUUID(), fixture: true });
        for (const directory of ['apps/api/dist/windows-log', 'apps/web/dist'])
          await mkdir(join(fixture, directory), { recursive: true });
        await writeFile(lock, marker);
        const before = await stat(lock, { bigint: true });
        await writeFile(join(fixture, 'apps/web/dist/index.html'), '<html></html>');
        await writeFile(join(fixture, 'apps/api/dist/windows-log/guard.js'), '');
        await writeFile(
          join(fixture, 'apps/api/dist/main.js'),
          `export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(spawned)},'spawned');process.exit(75);`,
        );
        await writeFile(
          join(fixture, 'apps/api/dist/instance-identity.js'),
          `import fs from 'node:fs';
          if(process.argv[2]!=='--store-state'){process.stdout.write('a'.repeat(64));}
          else {
            const file=${JSON.stringify(samples)};
            const count=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0;
            fs.writeFileSync(file,String(count+1));
            if(count===0) setTimeout(()=>process.stdout.write(JSON.stringify({state:'held',path:${JSON.stringify(lock)},detail:'another GraphGoblin process holds this store'})),600);
            else if(${JSON.stringify(scenario)}==='released') process.stdout.write('{"state":"free"}');
            else setInterval(()=>{},1000);
          }`,
        );
        const attempt = await configuration(install, `held-${scenario}`, {
          Repo: fixture,
          // Ten seconds leaves room for the measured first sample and the real TCP probe,
          // while still forcing a final stalled query below the helper's 15-second cap.
          StartupTimeoutSeconds: scenario === 'too-late' ? 2 : 10,
        });
        const started = performance.now();
        const result = await launch(attempt.path);
        const elapsed = performance.now() - started;
        assert.equal(result.code, 1);
        assert.ok(elapsed < 13_000, `The ${scenario} refusal exceeded bounded work and cleanup.`);
        assert.equal(await readFile(lock, 'utf8'), marker);
        const after = await stat(lock, { bigint: true });
        assert.deepEqual([after.dev, after.ino], [before.dev, before.ino]);
        assert.equal(await readFile(samples, 'utf8'), scenario === 'too-late' ? '1' : '2');
        if (scenario === 'released') {
          assert.equal(await readFile(spawned, 'utf8'), 'spawned');
          assert.match(result.stderr, /failed during startup, and no startup diagnostic/);
        } else {
          await assert.rejects(lstat(spawned), { code: 'ENOENT' });
          assert.match(result.stderr, /another GraphGoblin process holds this store/);
          assert.match(result.stderr, /No second gateway was started/);
          assert.match(
            result.stderr,
            /Do not stop an unrelated process or delete an unverified lock/,
          );
          assert.equal((await launcherRecords()).at(-1).code, 'store-held');
        }
      }
    });

    await t.test(
      'ownership admission requires strict raw JSON and preserves held refusals',
      async () => {
        // Only the disposable helper protocol/main are stubbed. The shipped compiled launcher
        // admits or refuses startup through its public entry; no real owner or WMI is simulated.
        const fixture = join(base, 'strict protocol fixture');
        const payload = join(fixture, 'payload');
        const samples = join(fixture, 'samples');
        const mode = join(fixture, 'mode');
        const spawned = join(fixture, 'spawned');
        const canary = 'GG_STRICT_OWNERSHIP_CANARY';
        for (const directory of ['apps/api/dist/windows-log', 'apps/web/dist'])
          await mkdir(join(fixture, directory), { recursive: true });
        await writeFile(join(fixture, 'apps/web/dist/index.html'), '<html></html>');
        await writeFile(join(fixture, 'apps/api/dist/windows-log/guard.js'), '');
        await writeFile(
          join(fixture, 'apps/api/dist/main.js'),
          `export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(spawned)},'spawned');process.exit(75);`,
        );
        await writeFile(
          join(fixture, 'apps/api/dist/instance-identity.js'),
          `import fs from 'node:fs';import path from 'node:path';
        process.stderr.write(${JSON.stringify(canary)});
        if(process.argv[2]!=='--store-state')process.stdout.write('a'.repeat(64)+'\\n');
        else {
          const count=Number(fs.readFileSync(${JSON.stringify(samples)},'utf8'));
          fs.writeFileSync(${JSON.stringify(samples)},String(count+1));
          process.stdout.write(count===0&&fs.readFileSync(${JSON.stringify(mode)},'utf8')==='retained'
            ?JSON.stringify({state:'held',path:path.join(process.env.GG_DATA_DIR,'graphgoblin.lock'),detail:'another GraphGoblin process holds this store'})+'\\n'
            :fs.readFileSync(${JSON.stringify(payload)},'utf8'));
        }`,
        );
        const cases = [
          ['javascript-lines', "{\nstate:'free'\n}", 'invalid'],
          ['single-quotes', "{'state':'free'}", 'invalid'],
          ['duplicate-held-free', '{"state":"held","state":"free"}', 'invalid'],
          [
            'duplicate-free-held',
            '{"state":"free","state":"held","path":"x","detail":"x"}',
            'invalid',
          ],
          ['escaped-duplicate', '{"state":"held","\\u0073tate":"free"}', 'invalid'],
          [
            'duplicate-path',
            '{"state":"held","path":"x","p\\u0061th":"y","detail":"x"}',
            'invalid',
          ],
          ['unknown-field', JSON.stringify({ state: 'free', extra: canary }), 'invalid'],
          ['trailing-object', '{"state":"free"}{"state":"free"}', 'invalid'],
          ['trailing-comma', '{"state":"free",}', 'invalid'],
          ['comment', `{"state":/*${canary}*/"free"}`, 'invalid'],
          ['raw-string-lf', '{"state":"fr\nee"}', 'invalid'],
          ['bad-escape', '{"state":"\\x66ree"}', 'invalid'],
          ['bad-unicode', '{"state":"\\u00g0"}', 'invalid'],
          ['apostrophe-escape', '{"state":"fr\\\'ee"}', 'invalid'],
          ['outer-non-json', '\u00a0{"state":"free"}\u00a0', 'invalid'],
          ['wrong-type', '{"state":null}', 'invalid'],
          ['nested-value', '{"state":{"state":"free"}}', 'invalid'],
          ['empty-object', '{}', 'invalid'],
          ['unknown-state', '{"state":"other"}', 'invalid'],
          ['free-with-held-fields', '{"state":"free","path":"x","detail":"x"}', 'invalid'],
          ['held-missing', '{"state":"held","path":"x"}', 'invalid'],
          ['held-blank', '{"state":"held","path":" ","detail":"x"}', 'invalid'],
          ['held-blank-detail', '{"state":"held","path":"x","detail":" "}', 'invalid'],
          ['producer-free', JSON.stringify({ state: 'free' }) + '\n', 'free'],
          ['json-whitespace', ' \t\r\n{ "state" \t: "free" }\r\n', 'free'],
          ['escaped-free', '{"st\\u0061te":"fr\\u0065e"}\n', 'free'],
          [
            'producer-held',
            (lock) =>
              JSON.stringify({
                state: 'held',
                path: lock,
                detail: `another GraphGoblin process holds this store ${canary}`,
              }) + '\n',
            'held',
          ],
          [
            'escaped-reordered-held',
            (lock) =>
              `{"detail":"another GraphGoblin process holds this store \\b\\f\\n\\r\\t \\/ \\" \\\\ ${canary}","p\\u0061th":${JSON.stringify(lock).replaceAll('α', '\\u03b1').replaceAll('🦊', '\\ud83e\\udd8a')},"st\\u0061te":"h\\u0065ld"}\n`,
            'held',
          ],
          ['held-then-duplicate', '{"state":"held","\\u0073tate":"free"}', 'retained'],
          ['held-then-non-json', '\u00a0{"state":"free"}', 'retained'],
        ];
        for (const [name, response, expected] of cases) {
          const attempt = await configuration(install, `strict-${name}`, {
            Repo: fixture,
            DataDir: join(fixture, `store α 🦊 ${name}`),
            StartupTimeoutSeconds: expected === 'retained' ? 10 : 1,
          });
          await mkdir(attempt.config.DataDir);
          const originals = [];
          for (const file of [
            'graphgoblin.lock',
            'graphgoblin.lock.reclaim',
            'graphgoblin.db.graphgoblin.lock',
            'graphgoblin.db.graphgoblin.lock.reclaim',
          ]) {
            const path = join(attempt.config.DataDir, file);
            const original = await ownershipFixture(path, { pid: 1, token: randomUUID() });
            originals.push({ ...original, identity: await stat(original.path, { bigint: true }) });
            if (file.endsWith('.reclaim'))
              originals.push({ path, identity: await stat(path, { bigint: true }) });
          }
          const lock = join(attempt.config.DataDir, 'graphgoblin.lock');
          await writeFile(payload, typeof response === 'function' ? response(lock) : response);
          await writeFile(samples, '0');
          await writeFile(mode, expected);
          const result = await launch(attempt.path);
          assert.equal(result.code, 1, name);
          assert.equal(result.stdout, '', name);
          assert.ok(!result.stderr.includes(canary), name);
          const recorded = (await launcherRecords()).at(-1);
          assert.ok(!JSON.stringify(recorded).includes(canary), name);
          if (expected === 'free') {
            assert.equal(await readFile(spawned, 'utf8'), 'spawned', name);
            assert.equal(recorded.code, 'startup-failed-unlogged', name);
            await unlink(spawned);
          } else {
            await assert.rejects(lstat(spawned), { code: 'ENOENT' }, name);
            assert.equal(
              recorded.code,
              expected === 'invalid' ? 'helper-invalid' : 'store-held',
              name,
            );
            if (expected !== 'invalid') {
              assert.equal(recorded.lock, lock, name);
              assert.match(result.stderr, /No second gateway was started/, name);
              assert.match(
                result.stderr,
                /Do not stop an unrelated process or delete an unverified lock/,
                name,
              );
            }
          }
          assert.equal(await readFile(samples, 'utf8'), expected === 'retained' ? '2' : '1', name);
          for (const original of originals) {
            const after = await stat(original.path, { bigint: true });
            assert.deepEqual(
              [after.dev, after.ino],
              [original.identity.dev, original.identity.ino],
              name,
            );
            if (original.contents !== undefined)
              assert.equal(await readFile(original.path, 'utf8'), original.contents, name);
          }
        }
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
