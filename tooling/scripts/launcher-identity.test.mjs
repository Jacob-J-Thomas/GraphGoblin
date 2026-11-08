import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const identityEntry = join(root, 'apps/api/dist/instance-identity.js');
const execute = promisify(execFile);

it('matches launcher identity to the built gateway with both bundled shells and retains refusal boundaries', async () => {
  // Tooling's test dependencies build both shells. Do not silently test an absent fallback.
  await access(join(root, 'apps/web/dist/index.html'));
  await access(join(root, 'apps/web/dist-goblin/index.html'));
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-launcher-identity space-α-'));
  const env = {
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
