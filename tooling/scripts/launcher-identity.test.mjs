import { execFile } from 'node:child_process';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const identityEntry = join(root, 'apps/api/dist/instance-identity.js');
const execute = promisify(execFile);

function launcherEnvironment(dataDir) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.toUpperCase().startsWith('GG_') && name.toUpperCase() !== 'JEV_API_KEY',
      ),
    ),
    GG_DATA_DIR: dataDir,
    GG_PORT: '0',
    GG_LOG_LEVEL: 'silent',
    GG_REQUIRE_API_KEY: 'false',
    GG_OLLAMA_ENABLED: 'false',
  };
}

it('reads the same identity and store state through a checkout link', async () => {
  const scratch = await mkdtemp(join(await realpath(tmpdir()), 'gg-launcher-link-'));
  const alias = join(scratch, 'checkout alias α %');
  const dataDir = join(scratch, 'data');
  const aliasedEntry = join(alias, relative(root, identityEntry));
  const env = launcherEnvironment(dataDir);
  const run = (argv, cwd, overrides = {}) =>
    execute(process.execPath, argv, {
      cwd,
      env: { ...env, ...overrides },
      windowsHide: true,
      timeout: 15_000,
    });
  let linked = false;
  try {
    await mkdir(dataDir);
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    linked = true;
    expect(await realpath(alias)).toBe(await realpath(root));
    expect(await realpath(aliasedEntry)).toBe(await realpath(identityEntry));

    const direct = await run([identityEntry], root);
    const digest = direct.stdout.trim();
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(direct).toEqual({ stdout: digest + '\n', stderr: '' });
    const state = await run([identityEntry, '--store-state'], root);
    expect(state).toEqual({ stdout: '{"state":"free"}\n', stderr: '' });
    expect.soft(await run([aliasedEntry], alias)).toEqual(direct);
    expect.soft(await run([aliasedEntry, '--store-state'], alias)).toEqual(state);
    // One enrollment line of strings; the checkout spelling never changes the launch digest.
    const enrollment = await run([identityEntry, '--launch-enrollment'], root);
    expect(enrollment.stderr).toBe('');
    expect(enrollment.stdout.endsWith('}\n')).toBe(true);
    const enrolled = JSON.parse(enrollment.stdout);
    expect(enrolled).toEqual({
      version: '1',
      launch: expect.stringMatching(/^v1:[a-f0-9]{64}$/),
      instance: digest,
      dataDir: await realpath(dataDir),
      database: 'file',
      lookup: join(dataDir, 'graphgoblin.db'),
      target: join(await realpath(dataDir), 'graphgoblin.db'),
    });
    expect.soft(await run([aliasedEntry, '--launch-enrollment'], alias)).toEqual(enrollment);
    await expect
      .soft(run([aliasedEntry, '--store-state'], alias, { GG_PORT: 'invalid' }))
      .rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: 'Launcher configuration is invalid. Check the configured GG_* overrides.\n',
      });
    // A real wrapper file is Node's entry and imports the helper through the alias, so the
    // helper's entry guard compares two different existing files (#494). The wrapper records the
    // argv[1] and file identity its own process observed, outside the store and before importing.
    const wrapper = join(scratch, 'import wrapper.mjs');
    const witness = join(scratch, 'import witness.json');
    await writeFile(
      wrapper,
      [
        "import { lstatSync, writeFileSync } from 'node:fs';",
        'const entry = process.argv[1];',
        'const observed = lstatSync(entry, { bigint: true });',
        'const { dev, ino } = observed;',
        'const facts = { entry, file: observed.isFile(), dev: String(dev), ino: String(ino) };',
        `writeFileSync(${JSON.stringify(witness)}, JSON.stringify(facts), { flag: 'wx' });`,
        `await import(${JSON.stringify(pathToFileURL(aliasedEntry).href)});`,
        '',
      ].join('\n'),
    );
    const imported = await run([wrapper], alias, { GG_PORT: 'invalid' });
    expect(imported).toEqual({ stdout: '', stderr: '' });
    expect(await readdir(dataDir)).toEqual([]);
    const wrapperFile = await lstat(wrapper, { bigint: true });
    const helperFile = await lstat(identityEntry, { bigint: true });
    expect(JSON.parse(await readFile(witness, 'utf8'))).toEqual({
      entry: wrapper,
      file: true,
      dev: String(wrapperFile.dev),
      ino: String(wrapperFile.ino),
    });
    expect(wrapperFile.isFile()).toBe(true);
    expect(helperFile.isFile()).toBe(true);
    for (const id of [wrapperFile.dev, wrapperFile.ino, helperFile.dev, helperFile.ino]) {
      expect(id).toBeGreaterThan(0n);
    }
    expect([wrapperFile.dev, wrapperFile.ino]).not.toEqual([helperFile.dev, helperFile.ino]);
    expect(await realpath(wrapper)).not.toBe(await realpath(identityEntry));
  } finally {
    if (linked) await unlink(alias);
    await rm(scratch, { recursive: true, force: true, maxRetries: 10 });
  }
});

it('matches launcher identity to the built gateway with both bundled shells and retains refusal boundaries', async () => {
  // Tooling's test dependencies build both shells. Do not silently test an absent fallback.
  await access(join(root, 'apps/web/dist/index.html'));
  await access(join(root, 'apps/web/dist-goblin/index.html'));
  const dataDir = await mkdtemp(join(await realpath(tmpdir()), 'gg-launcher-identity space-α-'));
  const env = launcherEnvironment(dataDir);
  const identity = async (overrides = {}) => {
    const result = await execute(process.execPath, [identityEntry], {
      cwd: root,
      env: { ...env, ...overrides },
      windowsHide: true,
      timeout: 10_000,
    });
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toMatch(/^[a-f0-9]{64}$/);
    return result.stdout.trim();
  };
  const enrollment = async (overrides = {}) => {
    const result = await execute(process.execPath, [identityEntry, '--launch-enrollment'], {
      cwd: root,
      env: { ...env, ...overrides },
      windowsHide: true,
      timeout: 10_000,
    });
    expect(result.stderr).toBe('');
    const record = JSON.parse(result.stdout);
    for (const value of Object.values(record)) expect(typeof value).toBe('string');
    return record;
  };
  const launch = async (overrides = {}) => (await enrollment(overrides)).launch;
  try {
    const expected = await identity();
    const expectedLaunch = await launch();
    expect(expectedLaunch).toMatch(/^v1:[a-f0-9]{64}$/);
    // The launcher helper must remain read-only even before the first gateway startup.
    expect(await readdir(dataDir)).toEqual([]);
    const state = () =>
      execute(process.execPath, [identityEntry, '--store-state'], {
        cwd: root,
        env,
        windowsHide: true,
        timeout: 15_000,
      });
    expect(JSON.parse((await state()).stdout)).toEqual({ state: 'free' });
    expect(await readdir(dataDir)).toEqual([]);
    const guard = join(dataDir, 'graphgoblin.db.graphgoblin.lock.reclaim');
    await writeFile(guard, 'unverifiable owner');
    expect(JSON.parse((await state()).stdout)).toMatchObject({
      state: 'held',
      path: guard,
      detail: expect.stringContaining('could not be verified'),
    });
    expect(await readFile(guard, 'utf8')).toBe('unverifiable owner');
    await rm(guard);
    const entry = pathToFileURL(join(root, 'apps/api/dist/main.js')).href;
    const gateway = await execute(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const {main} = await import(${JSON.stringify(entry)});
        const {app,container} = await main();
        try {
          const health = await app.inject('/healthz');
          process.stdout.write(JSON.stringify({
            status: health.statusCode,
            identity: health.headers['x-graphgoblin-instance'],
            launch: health.headers['x-graphgoblin-launch-identity'],
            pid: health.headers['x-graphgoblin-pid'],
            processPid: String(process.pid),
            web: (await app.inject('/app/')).statusCode,
            goblin: (await app.inject('/goblin/')).statusCode
          }));
        } finally { await app.close(); await container.stop(); }`,
      ],
      { cwd: root, env, windowsHide: true, timeout: 30_000 },
    );
    expect(gateway.stderr).toBe('');
    const health = JSON.parse(gateway.stdout);
    expect(health).toEqual({
      status: 200,
      identity: expected,
      launch: expectedLaunch,
      pid: health.processPid,
      processPid: health.processPid,
      web: 200,
      goblin: 200,
    });
    expect(health.processPid).toMatch(/^\d+$/);
    const database = join(dataDir, 'graphgoblin.db');
    const before = await readFile(database);
    expect(await identity()).toBe(expected);
    expect(await launch()).toBe(expectedLaunch);
    for (const changed of [
      { GG_GOBLIN_DIST: '' },
      { GG_WEB_DIST: '' },
      { GG_REQUIRE_API_KEY: 'true' },
      { GG_DB_URL: 'file:' + join(dataDir, 'other.db').replaceAll('\\', '/') },
    ]) {
      expect(await identity(changed)).not.toBe(expected);
      expect(await launch(changed)).not.toBe(expectedLaunch);
    }
    // Secrets never enter either digest.
    expect(
      await launch({ GG_MASTER_KEY: 'GG_SECRET_CANARY', JEV_API_KEY: 'GG_SECRET_CANARY' }),
    ).toBe(expectedLaunch);
    // A non-file database contributes only its kind; no raw URL leaves the helper.
    const remoteUrl = { GG_DB_URL: 'libsql://remote.invalid/?authToken=GG_URL_CANARY' };
    const remote = await enrollment(remoteUrl);
    expect(Object.keys(remote)).toEqual(['version', 'launch', 'instance', 'dataDir', 'database']);
    expect(remote.database).toBe('non-file');
    expect(JSON.stringify(remote)).not.toContain('GG_URL_CANARY');
    expect(remote.launch).not.toBe(expectedLaunch);
    // One snapshot: the enrolled full fingerprint is the legacy helper's, raw non-file value included.
    expect(remote.instance).toBe(await identity(remoteUrl));
    expect(remote.instance).not.toBe(expected);
    expect(await readFile(database)).toEqual(before);
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10 });
  }
});
