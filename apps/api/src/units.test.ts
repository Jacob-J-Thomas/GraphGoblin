import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '@graphgoblin/engine/testing';
import { MAX_MODEL_NAME_LENGTH } from '@graphgoblin/contracts';
import { loadConfig } from './config.js';
import { emitOpenApi } from './emit-openapi.js';
import { InboundEventBus } from './event-bus.js';
import { UlidIds } from './ids.js';
import { loadMasterKey } from './master-key.js';
import { main } from './main.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0))
    await rm(d, { recursive: true, force: true }).catch(() => undefined);
});

describe('loadConfig', () => {
  it('uses the contract model-name bound for process defaults', () => {
    const model = 'm'.repeat(MAX_MODEL_NAME_LENGTH);
    expect(loadConfig({ GG_DEFAULT_MODEL: model }).defaultModel).toBe(model);
    expect(() => loadConfig({ GG_DEFAULT_MODEL: `${model}m` })).toThrow(/GG_DEFAULT_MODEL/);
  });
  it('applies defaults and derives the database url from the data directory', () => {
    const config = loadConfig({});
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(4747);
    expect(config.dbUrl).toMatch(/^file:.*graphgoblin\.db$/);
    expect(config.requireApiKey).toBe(false);
    expect(config.defaultModel).toBe('gpt-6-luna');
    expect(config.masterKey).toBeUndefined();
    expect(config.publicUrl).toBeUndefined();
    expect(config.jevApiKey).toBeUndefined();
  });

  it('parses overrides and rejects bad values', () => {
    const config = loadConfig({
      GG_PORT: '8080',
      GG_REQUIRE_API_KEY: 'yes',
      GG_DB_URL: ':memory:',
      GG_MASTER_KEY: 'abc',
      GG_PUBLIC_URL: 'https://gg.test',
      GG_DEFAULT_EFFORT: 'high',
    });
    expect(config).toMatchObject({
      port: 8080,
      requireApiKey: true,
      dbUrl: ':memory:',
      masterKey: 'abc',
      publicUrl: 'https://gg.test',
      defaultEffort: 'high',
    });
    expect(() => loadConfig({ GG_PORT: 'nope' })).toThrow(/invalid configuration/);
    expect(() => loadConfig({ GG_DEFAULT_EFFORT: 'turbo' })).toThrow(/GG_DEFAULT_EFFORT/);
  });

  it.each([
    { env: { GG_JEV_API_KEY: 'test-primary-key' }, expected: 'test-primary-key' },
    { env: { JEV_API_KEY: 'test-fallback-key' }, expected: 'test-fallback-key' },
    {
      env: { GG_JEV_API_KEY: 'test-primary-key', JEV_API_KEY: 'test-fallback-key' },
      expected: 'test-primary-key',
    },
    { env: { GG_JEV_API_KEY: '' }, expected: undefined },
    { env: { JEV_API_KEY: '' }, expected: undefined },
    { env: { GG_JEV_API_KEY: '', JEV_API_KEY: 'test-fallback-key' }, expected: undefined },
  ])('resolves the Jev environment seed ($env)', ({ env, expected }) => {
    expect(loadConfig(env).jevApiKey).toBe(expected);
  });
});

describe('UlidIds', () => {
  it('produces valid, time-ordered, unique ULIDs', () => {
    const clock = new FakeClock();
    const ids = new UlidIds(clock);
    const a = ids.next();
    clock.advance(1);
    const b = ids.next();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(b.slice(0, 10) > a.slice(0, 10)).toBe(true);
    const many = new Set(Array.from({ length: 500 }, () => ids.next()));
    expect(many.size).toBe(500);
    expect(new UlidIds().next()).toHaveLength(26);
  });
});

describe('loadMasterKey', () => {
  it('uses the environment key when valid and rejects wrong lengths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gg-key-'));
    dirs.push(dir);
    const key = Buffer.alloc(32, 3);
    expect(
      (await loadMasterKey({ dataDir: dir, masterKey: key.toString('base64') })).equals(key),
    ).toBe(true);
    await expect(loadMasterKey({ dataDir: dir, masterKey: 'short' })).rejects.toThrow(/32 bytes/);
  });

  it('generates a key file once and reuses it, rejecting corrupt files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gg-key-'));
    dirs.push(dir);
    const first = await loadMasterKey({ dataDir: join(dir, 'nested') });
    const second = await loadMasterKey({ dataDir: join(dir, 'nested') });
    expect(first.equals(second)).toBe(true);
    expect(first).toHaveLength(32);
    expect((await readFile(join(dir, 'nested', 'master.key'), 'utf8')).length).toBeGreaterThan(40);
    await writeFile(join(dir, 'nested', 'master.key'), 'bad', 'utf8');
    await expect(loadMasterKey({ dataDir: join(dir, 'nested') })).rejects.toThrow(/32-byte/);
  });
});

describe('InboundEventBus', () => {
  it('fans out to subscribers, keeps a bounded recent list per owner, and unsubscribes', async () => {
    const bus = new InboundEventBus(2);
    const seen: string[] = [];
    const off = bus.subscribe((e) => {
      seen.push(e.type);
    });
    for (const [i, type] of ['a', 'b', 'c'].entries()) {
      await bus.publish({
        id: String(i),
        ownerId: i === 1 ? 'other' : 'local',
        type,
        payload: null,
        receivedAt: 'now',
      });
    }
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(bus.list('local').map((e) => e.type)).toEqual(['c']);
    expect(bus.list('other').map((e) => e.type)).toEqual(['b']);
    off();
    await bus.publish({ id: '9', ownerId: 'local', type: 'd', payload: null, receivedAt: 'now' });
    expect(seen).toHaveLength(3);
  });
});

describe('emitOpenApi', () => {
  it('writes a document with the expected paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gg-openapi-test-'));
    dirs.push(dir);
    const out = join(dir, 'openapi.json');
    const document = JSON.parse(await emitOpenApi(out)) as {
      paths: Record<string, unknown>;
      info: { title: string };
    };
    expect(document.info.title).toBe('GraphGoblin API');
    expect(Object.keys(document.paths).length).toBeGreaterThan(20);
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(document);
    const inline = JSON.parse(await emitOpenApi()) as { paths: Record<string, unknown> };
    expect(Object.keys(inline.paths)).toEqual(Object.keys(document.paths));
  }, 30_000);
});

describe('main', () => {
  it('boots the server from environment configuration and shuts down', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gg-main-'));
    dirs.push(dir);
    const previous = { ...process.env };
    Object.assign(process.env, {
      GG_DATA_DIR: dir,
      GG_DB_URL: ':memory:',
      GG_PORT: '0',
      GG_LOG_LEVEL: 'silent',
      GG_SWAGGER_UI: 'false',
      GG_HOST: '0.0.0.0',
      GG_MASTER_KEY: Buffer.alloc(32, 2).toString('base64'),
    });
    try {
      const { app, container } = await main();
      const address = app.server.address();
      expect(address && typeof address === 'object' && address.port > 0).toBe(true);
      await app.close();
      await container.stop();
    } finally {
      process.env = previous;
    }
  }, 30_000);
});
