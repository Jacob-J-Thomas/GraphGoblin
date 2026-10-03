import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexHarness } from '@graphgoblin/adapter-codex';
import { JevDecider } from '@graphgoblin/adapter-jev';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { JEV_SECRET, LOCAL_OWNER, createContainer, type Container } from './container.js';
import type { ApiInstance } from './types.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'gg-container-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

function config(env: Record<string, string> = {}) {
  return loadConfig({
    GG_DATA_DIR: dataDir,
    GG_DB_URL: `file:${join(dataDir, 'gg.db').replace(/\\/g, '/')}`,
    GG_SWAGGER_UI: 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    ...env,
  });
}

function jevOf(container: Container): JevDecider {
  const jev = container.ports.deciders.find((d) => d.id === 'jev');
  expect(jev).toBeInstanceOf(JevDecider);
  return jev as JevDecider;
}

describe('default adapters', () => {
  let container: Container;
  let app: ApiInstance;
  const hook = vi.fn(() => Promise.resolve());

  beforeEach(async () => {
    hook.mockClear();
    // No harness, structured, or decider overrides: the real Codex and Jev adapters are wired.
    // Nothing here starts a session, so the Codex CLI is never spawned.
    container = await createContainer(config(), { startTimers: false, secretHooks: [hook] });
    await container.start();
    app = await buildApp(container, { logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await container.stop();
  });

  it('registers the Codex harness, structured completions, and the jev and codex deciders', () => {
    expect(container.ports.harnesses.codex).toBeInstanceOf(CodexHarness);
    expect(container.ports.structured).toBeDefined();
    expect(container.ports.deciders.map((d) => d.id)).toEqual(['jev', 'codex']);
    expect(container.ports.deciders[1]?.available()).toBe(true);
  });

  it('starts without a Jev key and leaves Jev unavailable', () => {
    expect(jevOf(container).available()).toBe(false);
  });

  it('refreshes Jev when its key secret is set or deleted through the API', async () => {
    const jev = jevOf(container);
    const set = await app.inject({
      method: 'PUT',
      url: `/secrets/${JEV_SECRET}`,
      payload: { value: 'test-key' },
    });
    expect(set.statusCode).toBe(200);
    expect(jev.available()).toBe(true);
    expect(hook).toHaveBeenCalledWith(LOCAL_OWNER, JEV_SECRET);

    const deleted = await app.inject({ method: 'DELETE', url: `/secrets/${JEV_SECRET}` });
    expect(deleted.statusCode).toBe(204);
    expect(jev.available()).toBe(false);
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it('ignores other secrets and other owners', async () => {
    const jev = jevOf(container);
    const refresh = vi.spyOn(jev, 'refresh');
    await app.inject({ method: 'PUT', url: '/secrets/other', payload: { value: 'x' } });
    await container.onSecretChanged('someone-else', JEV_SECRET);
    expect(refresh).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledWith(LOCAL_OWNER, 'other');
  });

  it('does not notify when deleting a secret that does not exist', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/secrets/missing' });
    expect(res.statusCode).toBe(404);
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('Jev key at boot', () => {
  it('picks up a key stored before the process started', async () => {
    const first = await createContainer(config(), { startTimers: false });
    await first.start();
    await first.repos.secretsFor(LOCAL_OWNER).set(JEV_SECRET, 'stored-key');
    await first.stop();

    const second = await createContainer(config({ GG_CODEX_BINARY: 'C:/tools/codex.exe' }), {
      startTimers: false,
    });
    expect(second.config.codexBinary).toBe('C:/tools/codex.exe');
    await second.start();
    try {
      expect(jevOf(second).available()).toBe(true);
    } finally {
      await second.stop();
    }
  });
});

describe('container directory ownership', () => {
  it('refuses a second container before opening or recovering the store, and releases on stop', async () => {
    const first = await createContainer(config(), { startTimers: false });
    await first.start();
    const lockPath = join(dataDir, 'graphgoblin.lock');
    const lock = await readFile(lockPath, 'utf8');
    try {
      await expect(createContainer(config({ GG_PORT: '4749' }))).rejects.toThrow(
        `another GraphGoblin process holds ${lockPath}`,
      );
      expect(await readFile(lockPath, 'utf8')).toBe(lock);
    } finally {
      await first.stop();
      await first.stop();
    }
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const next = await createContainer(config(), { startTimers: false });
    await next.start();
    const recovery = vi.spyOn(first.manager, 'start');
    await expect(first.start()).rejects.toThrow('container has been stopped');
    expect(recovery).not.toHaveBeenCalled();
    await next.stop();
  });

  it('releases ownership if container construction fails', async () => {
    await expect(createContainer(config({ GG_MASTER_KEY: 'invalid' }))).rejects.toThrow(
      'GG_MASTER_KEY must decode to exactly 32 bytes',
    );
    await expect(access(join(dataDir, 'graphgoblin.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('releases ownership when startup fails before recovery', async () => {
    const container = await createContainer(config());
    vi.spyOn(container.handle, 'migrate').mockRejectedValueOnce(new Error('migration failed'));
    const recover = vi.spyOn(container.manager, 'start');
    await expect(container.start()).rejects.toThrow('migration failed');
    expect(recover).not.toHaveBeenCalled();
    await expect(access(join(dataDir, 'graphgoblin.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await container.stop();
  });

  it('serializes repeated starts and keeps the lock when stopped during migration', async () => {
    const container = await createContainer(config(), { startTimers: false });
    const migrate = container.handle.migrate;
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const migration = vi.spyOn(container.handle, 'migrate').mockImplementationOnce(async () => {
      await gate;
      await migrate();
    });
    const starting = container.start();
    const repeated = container.start();
    const stopping = container.stop();
    try {
      await expect(createContainer(config())).rejects.toThrow('another GraphGoblin process holds');
      expect(migration).toHaveBeenCalledTimes(1);
    } finally {
      resume();
      await Promise.all([starting, repeated, stopping]);
    }
    await expect(access(join(dataDir, 'graphgoblin.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
