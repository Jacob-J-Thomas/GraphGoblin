import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexHarness } from '@graphgoblin/adapter-codex';
import { JevDecider } from '@graphgoblin/adapter-jev';
import { openDatabase } from '@graphgoblin/infrastructure/sqlite';
import { CapturingLogger } from '@graphgoblin/engine/testing';
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

async function jevAvailable(container: Container): Promise<boolean> {
  return (
    (await container.classifierRegistry.resolve(LOCAL_OWNER, 'jev', 'noul')).status === 'ready'
  );
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

  it('registers the Codex harness, structured completions, and the Codex evaluator and classifier registry', () => {
    expect(container.ports.harnesses.codex).toBeInstanceOf(CodexHarness);
    expect(container.ports.structured).toBeDefined();
    expect(container.ports.deciders.map((d) => d.id)).toEqual(['codex']);
    expect(container.ports.deciders[0]?.available()).toBe(true);
  });

  it('starts without a Jev key and leaves Jev unavailable', async () => {
    expect(await jevAvailable(container)).toBe(false);
  });

  it('refreshes Jev when its key secret is set or deleted through the API', async () => {
    const set = await app.inject({
      method: 'PUT',
      url: `/secrets/${JEV_SECRET}`,
      payload: { value: 'test-key' },
    });
    expect(set.statusCode).toBe(200);
    expect(await jevAvailable(container)).toBe(true);
    expect(hook).toHaveBeenCalledWith(LOCAL_OWNER, JEV_SECRET);

    const deleted = await app.inject({ method: 'DELETE', url: `/secrets/${JEV_SECRET}` });
    expect(deleted.statusCode).toBe(204);
    expect(await jevAvailable(container)).toBe(false);
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it('ignores other secrets and other owners', async () => {
    const refresh = vi.spyOn(JevDecider.prototype, 'refresh');
    await app.inject({ method: 'PUT', url: '/secrets/other', payload: { value: 'x' } });
    await container.onSecretChanged('someone-else', JEV_SECRET);
    expect(refresh).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledWith(LOCAL_OWNER, 'other');
    refresh.mockRestore();
  });

  it('does not notify when deleting a secret that does not exist', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/secrets/missing' });
    expect(res.statusCode).toBe(404);
    expect(hook).not.toHaveBeenCalled();
  });

  it('shares configured Noul and Choice classifier snapshots and invalidates them after key and enable changes', async () => {
    await app.inject({
      method: 'PUT',
      url: `/secrets/${JEV_SECRET}`,
      payload: { value: 'first-key' },
    });
    const first = await container.classifierRegistry.resolve(LOCAL_OWNER, 'jev', 'choice');
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') throw new Error('expected configured Jev');
    expect(first.classifier).toBeInstanceOf(JevDecider);
    expect(await container.classifierRegistry.resolve(LOCAL_OWNER, 'jev', 'choice')).toEqual(first);
    await app.inject({
      method: 'PUT',
      url: `/secrets/${JEV_SECRET}`,
      payload: { value: 'second-key' },
    });
    const next = await container.classifierRegistry.resolve(LOCAL_OWNER, 'jev', 'choice');
    expect(next.status).toBe('ready');
    if (next.status !== 'ready') throw new Error('expected configured Jev');
    expect(next.classifier).not.toBe(first.classifier);
    const noul = vi
      .spyOn(JevDecider.prototype, 'classifyNoul')
      .mockResolvedValue({ type: 'noul', trueProbability: 1 });
    const choose = vi.spyOn(JevDecider.prototype, 'choose').mockResolvedValue({
      type: 'choice',
      optionId: 'yes',
      confidence: 1,
      probabilities: { yes: 1 },
    });
    try {
      expect(
        await next.classifier.classifyNoul(
          { question: 'Done?', context: {}, criteria: { true: 'Ready', false: 'Continue' } },
          new AbortController().signal,
        ),
      ).toEqual({ type: 'noul', trueProbability: 1 });
      await next.classifier.choose(
        { question: '?', context: {}, options: [{ id: 'yes', label: 'Yes', criteria: 'Approve' }] },
        new AbortController().signal,
      );
      expect(noul).toHaveBeenCalledOnce();
      expect(choose).toHaveBeenCalledOnce();
    } finally {
      noul.mockRestore();
      choose.mockRestore();
    }
    await app.inject({
      method: 'PATCH',
      url: '/classifier-models/jev',
      payload: { enabled: false },
    });
    expect(await jevAvailable(container)).toBe(false);
    expect(await container.classifierRegistry.resolve(LOCAL_OWNER, 'jev', 'choice')).toMatchObject({
      reason: 'CLASSIFIER_MODEL_DISABLED',
    });
    await app.inject({
      method: 'PATCH',
      url: '/classifier-models/jev',
      payload: { enabled: true },
    });
    expect(await jevAvailable(container)).toBe(true);
    await app.inject({ method: 'DELETE', url: `/secrets/${JEV_SECRET}` });
    expect(await jevAvailable(container)).toBe(false);
    expect(await container.classifierRegistry.resolve(LOCAL_OWNER, 'jev', 'choice')).toMatchObject({
      reason: 'CLASSIFIER_SECRET_MISSING',
    });
  });
});

describe('Jev key at boot', () => {
  it('seeds before recovery, refreshes metadata, and preserves a disabled built-in across real restarts', async () => {
    const first = await createContainer(config(), { startTimers: false });
    await first.start();
    await first.repos.classifiers.setEnabled(LOCAL_OWNER, 'jev', false);
    await first.handle.client.execute(
      "UPDATE classifier_models SET display_name = 'stale' WHERE id = 'jev'",
    );
    await first.stop();
    const second = await createContainer(config(), { startTimers: false });
    const recover = vi.spyOn(second.manager, 'start').mockImplementation(async () => {
      expect(await second.repos.classifiers.findOne(LOCAL_OWNER, 'jev')).toMatchObject({
        displayName: 'Jev',
        enabled: false,
      });
    });
    try {
      await second.start();
      expect(recover).toHaveBeenCalledOnce();
      expect(await jevAvailable(second)).toBe(false);
    } finally {
      await second.stop();
    }
  });
  it('seeds an encrypted local-owner secret once, keeps it across restarts, and never logs the value', async () => {
    const key = 'test-environment-seed-key';
    const logger = new CapturingLogger();
    const first = await createContainer(config({ GG_JEV_API_KEY: key }), {
      startTimers: false,
      logger,
    });
    try {
      await first.start();
      await first.start();
      expect(await first.repos.secretsFor(LOCAL_OWNER).resolve(JEV_SECRET)).toBe(key);
      expect(await first.repos.secretsFor('other-owner').resolve(JEV_SECRET)).toBeUndefined();
      expect(await jevAvailable(first)).toBe(true);
      const rows = await first.handle.db.query.secrets.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.ciphertext).not.toContain(key);
      expect(logger.lines.filter((line) => line.level === 'info')).toEqual([
        { level: 'info', obj: {}, msg: 'seeded jev-api-key from GG_JEV_API_KEY' },
      ]);
      expect(JSON.stringify(logger.lines)).not.toContain(key);
    } finally {
      await first.stop();
    }

    logger.lines.length = 0;
    const second = await createContainer(config(), { startTimers: false, logger });
    try {
      await second.start();
      expect(await second.repos.secretsFor(LOCAL_OWNER).resolve(JEV_SECRET)).toBe(key);
      expect(await jevAvailable(second)).toBe(true);
      expect(logger.lines).toEqual([]);
    } finally {
      await second.stop();
    }
  });

  it.each(['stored-key', ''])(
    'preserves an existing secret, including an empty value (%j)',
    async (stored) => {
      const first = await createContainer(config(), { startTimers: false });
      let before;
      try {
        await first.start();
        await first.repos.secretsFor(LOCAL_OWNER).set(JEV_SECRET, stored);
        before = await first.handle.db.query.secrets.findMany();
      } finally {
        await first.stop();
      }

      const envKey = 'test-ignored-environment-key';
      const logger = new CapturingLogger();
      const second = await createContainer(config({ GG_JEV_API_KEY: envKey }), {
        startTimers: false,
        logger,
      });
      try {
        await second.start();
        expect(await second.repos.secretsFor(LOCAL_OWNER).resolve(JEV_SECRET)).toBe(stored);
        expect(await second.handle.db.query.secrets.findMany()).toEqual(before);
        expect(logger.lines).toEqual([]);
        expect(JSON.stringify(logger.lines)).not.toContain(envKey);
      } finally {
        await second.stop();
      }
    },
  );

  it.each([
    {},
    { GG_JEV_API_KEY: '' },
    { JEV_API_KEY: '' },
    { GG_JEV_API_KEY: '', JEV_API_KEY: 'test-unused-fallback-key' },
  ])('does nothing without a non-empty environment seed (%j)', async (env) => {
    const logger = new CapturingLogger();
    const container = await createContainer(config(env), { startTimers: false, logger });
    try {
      await container.start();
      expect(await container.repos.secretsFor(LOCAL_OWNER).list()).toEqual([]);
      expect(await jevAvailable(container)).toBe(false);
      expect(logger.lines).toEqual([]);
    } finally {
      await container.stop();
    }
  });

  it('seeds from JEV_API_KEY when GG_JEV_API_KEY is unset, even if another owner has a key', async () => {
    const key = 'test-fallback-environment-key';
    const logger = new CapturingLogger();
    const container = await createContainer(config({ JEV_API_KEY: key }), {
      startTimers: false,
      logger,
    });
    try {
      await container.handle.migrate();
      await container.repos.secretsFor('other-owner').set(JEV_SECRET, 'other-owner-key');
      await container.start();
      expect(await container.repos.secretsFor(LOCAL_OWNER).resolve(JEV_SECRET)).toBe(key);
      expect(await container.repos.secretsFor('other-owner').resolve(JEV_SECRET)).toBe(
        'other-owner-key',
      );
      expect(await jevAvailable(container)).toBe(true);
      expect(logger.lines.filter((line) => line.level === 'info')).toEqual([
        { level: 'info', obj: {}, msg: 'seeded jev-api-key from GG_JEV_API_KEY' },
      ]);
      expect(JSON.stringify(logger.lines)).not.toContain(key);
    } finally {
      await container.stop();
    }
  });

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
      expect(await jevAvailable(second)).toBe(true);
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

describe('configuration admission before startup writes', () => {
  it('does not create SQLite/master-key files for an unknown process default', async () => {
    const invalid = config({
      GG_DEFAULTS: JSON.stringify({
        byHarness: { codex: { model: 'not-in-catalog', effort: 'low' } },
      }),
    });
    await expect(createContainer(invalid, { startTimers: false })).rejects.toThrow(
      /Invalid GG_DEFAULTS/,
    );
    for (const name of ['gg.db', 'master.key', 'graphgoblin.lock'])
      await expect(access(join(dataDir, name))).rejects.toThrow();
  });
  it('reads existing manual catalog entries without changing database bytes or rows on invalid effort', async () => {
    const valid = config();
    const first = await createContainer(valid, { startTimers: false });
    await first.start();
    await first.repos.catalog.upsert({
      harness: 'codex',
      model: 'manual-model',
      source: 'litellm',
      displayName: 'Manual',
      enabled: true,
      efforts: ['low'],
      defaultEffort: 'low',
    });
    await first.handle.client.execute('PRAGMA journal_mode=DELETE');
    await first.stop();
    const file = join(dataDir, 'gg.db');
    const before = await readFile(file);
    await expect(
      createContainer(
        config({
          GG_DEFAULTS: JSON.stringify({
            byHarness: { codex: { model: 'manual-model', effort: 'high' } },
          }),
        }),
        { startTimers: false },
      ),
    ).rejects.toThrow(/Invalid GG_DEFAULTS/);
    expect(await readFile(file)).toEqual(before);
    const second = await createContainer(
      config({
        GG_DEFAULTS: JSON.stringify({
          byHarness: { codex: { model: 'manual-model', effort: 'low' } },
        }),
      }),
      { startTimers: false },
    );
    await second.stop();
    expect(await readFile(file)).toEqual(before);
  });
  it('refuses an old store before creating a master key or applying migrations', async () => {
    const handle = openDatabase({ url: config().dbUrl });
    await handle.client.execute('CREATE TABLE old_data(id TEXT)');
    handle.close();
    await expect(createContainer(config(), { startTimers: false })).rejects.toMatchObject({
      code: 'DATA_UPGRADE_REQUIRED',
    });
    await expect(access(join(dataDir, 'master.key'))).rejects.toThrow();
    const inspection = openDatabase({ url: config().dbUrl });
    try {
      expect(
        (
          await inspection.client.execute(
            "SELECT name FROM sqlite_master WHERE name='__drizzle_migrations'",
          )
        ).rows,
      ).toEqual([]);
    } finally {
      inspection.close();
    }
  });
});
