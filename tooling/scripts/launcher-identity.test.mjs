import { execFile } from 'node:child_process';
import {
  access,
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
    await expect
      .soft(run([aliasedEntry, '--store-state'], alias, { GG_PORT: 'invalid' }))
      .rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: 'Launcher configuration is invalid. Check the configured GG_* overrides.\n',
      });
    const imported = await run(
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(pathToFileURL(aliasedEntry).href)})`,
      ],
      alias,
      { GG_PORT: 'invalid' },
    );
    expect(imported).toEqual({ stdout: '', stderr: '' });
    expect(await readdir(dataDir)).toEqual([]);
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
  try {
    const expected = await identity();
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
      pid: health.processPid,
      processPid: health.processPid,
      web: 200,
      goblin: 200,
    });
    expect(health.processPid).toMatch(/^\d+$/);
    const database = join(dataDir, 'graphgoblin.db');
    const before = await readFile(database);
    expect(await identity()).toBe(expected);
    for (const changed of [{ GG_GOBLIN_DIST: '' }, { GG_REQUIRE_API_KEY: 'true' }])
      expect(await identity(changed)).not.toBe(expected);
    expect(await readFile(database)).toEqual(before);
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10 });
  }
});
